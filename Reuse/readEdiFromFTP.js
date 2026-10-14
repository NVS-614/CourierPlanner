// Requires: npm i basic-ftp
const ftp = require('basic-ftp');
const { Writable } = require('stream');

/** Writable that accumulates chunks to a Buffer */
class BufferWritable extends Writable {
  constructor() { super(); this._chunks = []; }
  _write(chunk, _enc, cb) { this._chunks.push(Buffer.from(chunk)); cb(); }
  getBuffer() { return Buffer.concat(this._chunks); }
}

/** Try UTF-8, fall back to latin1/ascii if the file isn't valid UTF-8 */
function bufferToTextAuto(buf) {
  const utf8 = buf.toString('utf8');
  if (!/\uFFFD/.test(utf8)) return utf8;     // no replacement chars → good
  const latin1 = buf.toString('latin1');
  if (!/\uFFFD/.test(latin1)) return latin1;
  return buf.toString('ascii');
}

/**
 * Download an EDI file from FTP/FTPS and return its text.
 * Env vars used (examples):
 *   FTPHOST, FTPPORT, FTPUSER, FTPPASSWORD
 *   EDI_REMOTE_FILE=/IN/DHL.edi
 *   FTPS=true (explicit TLS)  | FTPS=false (plain FTP)
 *   SSL_STRICT=true to enforce TLS cert validation
 */
async function readEdiFromFTP() {
  const host = process.env.FTPHOST || process.env.FTP_HOST;
  const port = Number(process.env.FTPPORT || process.env.FTP_PORT || 21);
  const user = process.env.FTPUSER || process.env.FTP_USER;
  const password = process.env.FTPPASSWORD || process.env.FTP_PASSWORD;
  const remoteFile = process.env.EDI_REMOTE_FILE || '/IN/UPS_EDI200_smallone.txt';

  const useFtps = String(process.env.FTPS || 'true').toLowerCase() === 'true'; // default FTPS
  const strictTls = String(process.env.SSL_STRICT || 'false').toLowerCase() === 'true';

  const client = new ftp.Client(20_000);
  client.ftp.verbose = false;

  try {
    await client.access({
      host,
      port,
      user,
      password,
      secure: useFtps,                 // Explicit FTPS if true
      secureOptions: { rejectUnauthorized: strictTls },
      passive: true,
    });

    const sink = new BufferWritable();
    await client.downloadTo(sink, remoteFile); // stream → memory
    const fileBuffer = sink.getBuffer();
    const ediText = bufferToTextAuto(fileBuffer);

    return ediText; // <-- what you asked for
  } catch (err) {
    console.error('FTP download failed:', {
      message: err?.message,
      code: err?.code,
      status: err?.response?.status,
    });
    return null;
  } finally {
    client.close();
  }
}

module.exports = { readEdiFromFTP };
