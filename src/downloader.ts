// downloader.ts
import Downloader from 'nodejs-file-downloader';
import tar from 'tar';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { Logger, Quester } from 'koishi';

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export async function handleFile(
  nodeDir: string,
  nodeName: string,
  logger: Logger,
  http: Quester,
) {
  const url = `https://registry.npmjs.org/@node-rs/${nodeName.replace(
    '.',
    '-',
  )}/latest`;

  let tarballUrl: string | undefined;

  try {
    const res = await http.get(url);
    tarballUrl = res.data.dist.tarball;
    logger.info(`Stating download from ${tarballUrl}`);
  } catch (e) {
    logger.error(`Failed to fetch from URL: ${url}`, e);
    throw new DownloadError(`Failed to fetch from URL: ${e.message}`);
  }

  if (!tarballUrl)
    throw new DownloadError(`Failed to get the binary url from ${url}`);

  const downloader = new Downloader({
    url: tarballUrl,
    directory: nodeDir,
    onProgress: function (percentage, _chunk, remainingSize) {
      //Gets called with each chunk.
      logger.info(
        `${percentage} % Remaining(MB): ${remainingSize / 1024 / 1024}`,
      );
    },
  });
  try {
    const { filePath, downloadStatus } = await downloader.download();
    if (downloadStatus === 'COMPLETE') {
      await extract(path.resolve(filePath));
      logger.success(`File downloaded successfully at ${filePath}`);
    } else {
      throw new DownloadError('Download was aborted');
    }
  } catch (e) {
    logger.error('Failed to download the file', e);
    throw new DownloadError(`Failed to download the binary file: ${e.message}`);
  }
}

/**
 * Extracts a .tgz file downloaded from npm to the directory of the file.
 *
 * @param {string} filePath - The path of the .tgz file.
 * @returns {Promise<void>} A promise that resolves when the extraction is complete, or rejects if an error occurs.
 */
const extract = async (filePath: string): Promise<void> => {
  return new Promise<void>(async (resolve, reject) => {
    try {
      const outputDir = path.dirname(filePath);
      const readStream = fs.createReadStream(filePath);
      const gunzip = zlib.createGunzip();
      const extractStream = tar.extract({ cwd: outputDir });

      // Pipe streams
      readStream.pipe(gunzip).pipe(extractStream);

      // Handle potential errors.
      readStream.on('error', (err) => {
        reject(`An error occurred while reading the file: ${err}`);
      });

      gunzip.on('error', (err) => {
        reject(`An error occurred while gunzipping the file: ${err}`);
      });

      extractStream.on('error', (err) => {
        reject(`An error occurred during extraction: ${err}`);
      });

      // Close the streams and resolve the promise when extraction is done.
      extractStream.on('finish', () => {
        readStream.close();
        gunzip.end();
        resolve();
      });
    } catch (err) {
      reject(
        `An unexpected error occurred during the extraction process: ${err}`,
      );
    }
  });
};
