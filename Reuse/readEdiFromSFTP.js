// Requires: npm i ssh2-sftp-client
const SftpClient = require('ssh2-sftp-client');

async function readEdiFromSFTP() {
  const host = process.env.FTPHOST || process.env.FTP_HOST;
  const port = Number(process.env.FTPPORT || process.env.FTP_PORT || 22);
  const username = process.env.FTPUSER || process.env.FTP_USER;
  const password = process.env.FTPPASSWORD || process.env.FTP_PASSWORD;
  const remoteFile = process.env.EDI_REMOTE_FILE || '/IN/DHL.edi';

  const sftp = new SftpClient();
  try {
    await sftp.connect({ host, port, username, password });
    const buf = await sftp.get(remoteFile); // Buffer
    return bufferToTextAuto(buf);
  } catch (err) {
    console.error('SFTP download failed:', err?.message || err);
    return null;
  } finally {
    sftp.end();
  }
}
