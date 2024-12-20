import { Context, h, Logger, Schema, Service } from 'koishi';
import path, { join } from 'path';
import { mkdir } from 'fs/promises';
import fs from 'fs';
import { handleFile, DownloadError } from './downloader';
import { Jieba as NativeJieba, Keyword, TaggedWord, TfIdf as NativeTfIdf } from './type'; // 假设 native-binding.ts 导出了最新的类型

export const name = 'jieba';

declare module 'koishi' {
  interface Context {
    jieba: Jieba;
  }
}

export class Jieba extends Service {
  public jieba: NativeJieba;
  public tfidf: NativeTfIdf;

  constructor(public ctx: Context, public config: Jieba.Config) {
    super(ctx, 'jieba', true);

    ctx.i18n.define('zh', require('./locales/zh-CN'));

    ctx.command('jieba <message:string>')
      .option('action', '-a <id:posint>', { fallback: 0 })
      .option('action', '-c', { value: 1 })
      .option('action', '-e', { value: 2 })
      .option('number', '-n <num:posint>', { fallback: 3 })
      .action(({ options, session }, message) => {
        if (!message) return session.text('.no-message');
        let result = '';
        switch (options.action) {
          case 0:
            result = this.cut(message).join(', ');
            break;
          case 1:
            result = this.cutAll(message).join(', ');
            break;
          case 2:
            const keywords = this.extract(message, options.number, null);
            result = keywords.map(word => `${word.keyword}: ${word.weight}`).join('\n');
            break;
          default:
            return session.text('.invalid-action');
        }
        return h('quote', { id: session.messageId }) + result;
      });
  }
  // @ts-ignore
  get logger(): Logger {
    return this.ctx.logger(name);
  }

  async start() {
    const nodeDir = path.resolve(this.ctx.baseDir, this.config.nodeBinaryDir);
    await mkdir(nodeDir, { recursive: true });
    let nativeBinding;

    try {
      nativeBinding = await this.getNativeBinding(nodeDir);
    } catch (e) {
      if (e instanceof UnsupportedError) {
        this.logger.error('当前系统不支持 Jieba 服务');
      } else if (e instanceof DownloadError) {
        this.logger.error('下载二进制文件时出错，请检查日志获取更多信息');
      } else {
        this.logger.error('加载 Jieba 原生绑定时出错', e);
      }
      throw e;
    }

    const { Jieba: JiebaClass, TfIdf: TfIdfClass } = nativeBinding;
    // 使用默认字典初始化 Jieba 实例
    this.jieba = JiebaClass.withDict(fs.readFileSync(join(__dirname, 'dict.txt')));
    // 初始化 TfIdf 实例
    this.tfidf = TfIdfClass.withDict(fs.readFileSync(join(__dirname, 'idf.txt')));

    this.logger.success('Jieba 服务启动成功');
  }

  private async getNativeBinding(nodeDir: string) {
    const { platform, arch } = process;
    const platformArchMap: Record<string, Record<string, string>> = {
      android: {
        arm64: 'jieba.android-arm64',
        arm: 'jieba.android-arm-eabi',
      },
      win32: {
        x64: 'jieba.win32-x64-msvc',
        ia32: 'jieba.win32-ia32-msvc',
        arm64: 'jieba.win32-arm64-msvc',
      },
      darwin: {
        x64: 'jieba.darwin-x64',
        arm64: 'jieba.darwin-arm64',
      },
      freebsd: {
        x64: 'jieba.freebsd-x64',
      },
      linux: {
        x64: isMusl() ? 'jieba.linux-x64-musl' : 'jieba.linux-x64-gnu',
        arm64: isMusl() ? 'jieba.linux-arm64-musl' : 'jieba.linux-arm64-gnu',
        arm: 'jieba.linux-arm-gnueabihf',
        riscv64: isMusl() ? 'jieba.linux-riscv64-musl' : 'jieba.linux-riscv64-gnu',
        ppc64: 'jieba.linux-ppc64-gnu',
        s390x: 'jieba.linux-s390x-gnu',
      },
    };

    if (!platformArchMap[platform] || !platformArchMap[platform][arch]) {
      throw new UnsupportedError(`不支持的操作系统或架构: ${platform}-${arch}`);
    }

    const nodeName = platformArchMap[platform][arch];
    const nodeFile = `${nodeName}.node`;
    const nodePath = path.join(nodeDir, 'package', nodeFile);

    if (!fs.existsSync(nodePath)) {
      await handleFile(nodeDir, nodeName, this.logger, this.ctx.http);
    }

    try {
      return require(nodePath);
    } catch (e) {
      this.logger.error(`加载原生绑定文件失败: ${nodePath}`, e);
      throw new Error(`无法使用 ${nodePath} 在 ${platform}-${arch} 上`);
    }
  }

  // 兼容旧 API 的方法转发
  loadDict(dict: Uint8Array): void {
    this.jieba.loadDict(dict);
  }

  cut(sentence: string | Buffer, hmm?: boolean | undefined | null): string[] {
    return this.jieba.cut(sentence, hmm);
  }

  cutAll(sentence: string | Buffer): string[] {
    return this.jieba.cutAll(sentence);
  }

  cutForSearch(sentence: string | Buffer, hmm?: boolean | undefined | null): string[] {
    return this.jieba.cutForSearch(sentence, hmm);
  }

  tag(sentence: string | Buffer, hmm?: boolean | undefined | null): Array<TaggedWord> {
    return this.jieba.tag(sentence, hmm);
  }

  // 新的 API 方法
  extract(sentence: string, topK: number, allowedPos?: Array<string> | null): Array<Keyword> {
    return this.tfidf.extractKeywords(this.jieba, sentence, topK, allowedPos);
  }

  loadTFIDFDict(dict: Uint8Array): void {
    this.tfidf.loadDict(dict);
  }
}

function isMusl(): boolean {
  if (!process.report || typeof process.report.getReport !== 'function') {
    try {
      const lddPath = require('child_process').execSync('which ldd').toString().trim();
      return fs.readFileSync(lddPath, 'utf8').includes('musl');
    } catch {
      return true;
    }
  } else {
    const report: { header: any } = process.report.getReport() as any;
    return !report.header?.glibcVersionRuntime;
  }
}

export namespace Jieba {
  export interface Config {
    nodeBinaryDir: string;
  }
  export const Config = Schema.object({
    nodeBinaryDir: Schema.path({
      filters: ['directory'],
      allowCreate: true,
    })
      .description('Jieba 二进制文件存放目录')
      .default('node-rs/jieba'),
  });
}

export default Jieba;
class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}
