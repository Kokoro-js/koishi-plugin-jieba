import { Context, Logger, Schema, Service } from 'koishi';
import path from 'path';
import { mkdir } from 'fs/promises';
import fs from 'fs';
import { handleFile, DownloadError } from './downloader';
import type { JiebaApi, Keyword, TaggedWord } from './type';

export const name = 'jieba';
const logger = new Logger(name);

declare module 'koishi' {
  interface Context {
    jieba: Jieba;
  }
}

export class Jieba extends Service implements JiebaApi {
  // nativeBinding
  loadDict: (dict: Buffer) => void;
  cut: (
    sentence: string | Buffer,
    hmm?: boolean | undefined | null,
  ) => string[];
  cutAll: (sentence: string | Buffer) => string[];
  cutForSearch: (
    sentence: string | Buffer,
    hmm?: boolean | undefined | null,
  ) => string[];
  tag: (
    sentence: string | Buffer,
    hmm?: boolean | undefined | null,
  ) => Array<TaggedWord>;
  extract: (
    sentence: string | Buffer,
    topn: number,
    allowedPos?: string | undefined | null,
  ) => Array<Keyword>;
  loadTFIDFDict: (dict: Buffer) => void;
  constructor(
    ctx: Context,
    public config: Jieba.Config,
  ) {
    super(ctx, 'jieba');

    ctx.i18n.define('zh', require('./locales/zh-CN'));
    ctx
      .command('jieba [message:string]')
      .option('action', '-a <id:posint>', { fallback: 0 })
      .option('action', '-c', { value: 1 })
      .option('action', '-e', { value: 2 })
      .option('number', '-n <num:posint>', { fallback: 3 })
      .action(({ options }, message) => {
        switch (options.action) {
          case 0:
            message = ctx.jieba.cut(message).join(', ');
            break;
          case 1:
            message = ctx.jieba.cutAll(message).join(', ');
            break;
          case 2:
            const keywords = ctx.jieba.extract(message, options.number);
            message = keywords
              .map((word) => word.keyword + ': ' + word.weight)
              .join('\n');
        }
        return message;
      });
  }

  async start() {
    let { nodeBinaryPath } = this.config;
    const nodeDir = path.resolve(this.ctx.baseDir, nodeBinaryPath);
    await mkdir(nodeDir, { recursive: true });
    let nativeBinding = null;
    try {
      nativeBinding = await getNativeBinding(nodeDir);
    } catch (e) {
      if (e instanceof UnsupportedError) {
        logger.error('Jieba 目前不支持你的系统');
      }
      if (e instanceof DownloadError) {
        logger.error('下载二进制文件遇到错误，请查看日志获取更详细信息');
      }
      throw e;
    }
    ({
      loadDict: this.loadDict,
      cut: this.cut,
      cutAll: this.cutAll,
      cutForSearch: this.cutForSearch,
      tag: this.tag,
      extract: this.extract,
      loadTFIDFDict: this.loadTFIDFDict,
    } = nativeBinding);
    try {
      nativeBinding.load();
    } catch (e) {
      if (e.message != 'Jieba was loaded, could not load again') {
        throw e;
      }
    }
    logger.success('Jieba 服务启动成功');
  }
}

function isMusl() {
  // For Node 10
  if (!process.report || typeof process.report.getReport !== 'function') {
    try {
      const lddPath = require('child_process')
        .execSync('which ldd')
        .toString()
        .trim();
      return fs.readFileSync(lddPath, 'utf8').includes('musl');
    } catch (e) {
      return true;
    }
  } else {
    const report: { header: any } = process.report.getReport() as unknown as {
      header: any;
    };
    const glibcVersionRuntime = report.header?.glibcVersionRuntime;
    return !glibcVersionRuntime;
  }
}

async function getNativeBinding(nodeDir) {
  const { platform, arch } = process;
  let nativeBinding;
  let nodeName;
  switch (platform) {
    case 'android':
      switch (arch) {
        case 'arm64':
          nodeName = 'jieba.android-arm64';
          break;
        case 'arm':
          nodeName = 'jieba.android-arm-eabi';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on Android ${arch}`,
          );
      }
      break;
    case 'win32':
      switch (arch) {
        case 'x64':
          nodeName = 'jieba.win32-x64-msvc';
          break;
        case 'ia32':
          nodeName = 'jieba.win32-ia32-msvc';
          break;
        case 'arm64':
          nodeName = 'jieba.win32-arm64-msvc';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on Windows: ${arch}`,
          );
      }
      break;
    case 'darwin':
      switch (arch) {
        case 'x64':
          nodeName = 'jieba.darwin-x64';
          break;
        case 'arm64':
          nodeName = 'jieba.darwin-arm64';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on macOS: ${arch}`,
          );
      }
      break;
    case 'freebsd':
      if (arch !== 'x64') {
        throw new UnsupportedError(
          `Unsupported architecture on FreeBSD: ${arch}`,
        );
      }
      nodeName = 'jieba.freebsd-x64';
      break;
    case 'linux':
      switch (arch) {
        case 'x64':
          if (isMusl()) {
            nodeName = 'jieba.linux-x64-musl';
          } else {
            nodeName = 'jieba.linux-x64-gnu';
          }
          break;
        case 'arm64':
          if (isMusl()) {
            nodeName = 'jieba.linux-arm64-musl';
          } else {
            nodeName = 'jieba.linux-arm64-gnu';
          }
          break;
        case 'arm':
          nodeName = 'jieba.linux-arm-gnueabihf';
          break;
        default:
          throw new UnsupportedError(
            `Unsupported architecture on Linux: ${arch}`,
          );
      }
      break;
    default:
      throw new UnsupportedError(
        `Unsupported OS: ${platform}, architecture: ${arch}`,
      );
  }
  const nodeFile = nodeName + '.node';
  const nodePath = path.join(nodeDir, 'package', nodeFile);
  const localFileExisted = fs.existsSync(nodePath);
  try {
    if (!localFileExisted) await handleFile(nodeDir, nodeName, logger);
    nativeBinding = require(nodePath);
  } catch (e) {
    logger.error('在处理二进制文件时遇到了错误', e);
    if (e instanceof DownloadError) {
      throw e;
    }
    throw new Error(`Failed to use ${nodePath} on ${platform}-${arch}`);
  }
  return nativeBinding;
}

export namespace Jieba {
  export interface Config {
    nodeBinaryPath: string;
  }
  export const Config = Schema.object({
    nodeBinaryPath: Schema.path({
      filters: ['directory'],
      allowCreate: true,
    })
      .description('Jieba 二进制文件存放目录')
      .default('node-rs/jieba'),
  });
}

Context.service('jieba', Jieba);
export default Jieba;
class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}
