/**
 * Regenerate the `.br` / `.gz` siblings the OpenClaw gateway may serve in place
 * of a static asset. Kept standalone and dependency-free on purpose.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * Write `content` to `file` and refresh `file.br` (brotli q11) and `file.gz`
 * (gzip level 9) next to it. Siblings are only written when the asset already
 * has them; `.html`/`.webmanifest` have none upstream and must stay without.
 * @param {string} file absolute or relative path of the asset
 * @param {string|Buffer} content bytes to write
 * @returns {{file: string, brotli: boolean, gzip: boolean}}
 */
export function writeWithPrecompressed(file, content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const tmp = `${file}.cle-brand-tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);
  const brotli = fs.existsSync(`${file}.br`);
  const gzip = fs.existsSync(`${file}.gz`);
  if (brotli) fs.writeFileSync(`${file}.br`, zlib.brotliCompressSync(buffer, {
    params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11},
  }));
  if (gzip) fs.writeFileSync(`${file}.gz`, zlib.gzipSync(buffer, {level: 9}));
  return {file, brotli, gzip};
}
