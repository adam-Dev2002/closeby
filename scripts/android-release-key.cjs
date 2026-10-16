const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.private', 'android-release');
const credentialsFile = path.join(directory, 'credentials.json');
const storeFile = path.join(directory, 'closeby-release.p12');

function keytool(args, credentials) {
  const executable = path.join(process.env.JAVA_HOME || '', 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
  const result = spawnSync(executable, ['-J-Duser.language=en', ...args], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CLOSEBY_KEYTOOL_PASSWORD: credentials.storePassword },
  });
  // Never print child arguments, environment, or credentials on failure.
  if (result.error || result.status !== 0) throw new Error('Release keytool failed. Keep .private/android-release intact and inspect the local JDK setup.');
  return result.stdout;
}

function readCredentials() {
  const credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
  if (credentials.alias !== 'closeby-release' || typeof credentials.storePassword !== 'string' || credentials.storePassword.length < 32) {
    throw new Error('Invalid release signing credentials. Restore your signing backup; do not replace the key.');
  }
  return credentials;
}

function fingerprints() {
  const credentials = readCredentials();
  const certificate = keytool(['-list', '-v', '-keystore', storeFile, '-storetype', 'PKCS12', '-alias', credentials.alias, '-storepass:env', 'CLOSEBY_KEYTOOL_PASSWORD'], credentials);
  const sha1 = certificate.match(/SHA1:\s*([A-F0-9:]+)/i)?.[1];
  const sha256 = certificate.match(/SHA256:\s*([A-F0-9:]+)/i)?.[1];
  if (!sha1 || !sha256) throw new Error('Could not verify release certificate fingerprints.');
  return { packageName: 'com.closeby.tracker', alias: credentials.alias, sha1, sha256 };
}

function ensure() {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.existsSync(storeFile) !== fs.existsSync(credentialsFile)) {
    throw new Error('Incomplete signing directory. Restore both the original keystore and credentials from your backup; refusing to create a replacement.');
  }
  if (!fs.existsSync(credentialsFile)) {
    const credentials = { alias: 'closeby-release', storePassword: crypto.randomBytes(32).toString('hex'), createdAt: new Date().toISOString() };
    fs.writeFileSync(credentialsFile, `${JSON.stringify(credentials, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    keytool(['-genkeypair', '-noprompt', '-keystore', storeFile, '-storetype', 'PKCS12', '-alias', credentials.alias,
      '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA', '-validity', '10950',
      '-dname', 'CN=Closeby Android Release, O=Closeby', '-storepass:env', 'CLOSEBY_KEYTOOL_PASSWORD', '-keypass:env', 'CLOSEBY_KEYTOOL_PASSWORD'], credentials);
  }
  const report = fingerprints();
  fs.writeFileSync(path.join(directory, 'certificate.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

if (require.main === module) {
  try {
    const action = process.argv[2];
    if (!['ensure', 'fingerprints'].includes(action)) throw new Error('Usage: node scripts/android-release-key.cjs ensure|fingerprints');
    console.log(JSON.stringify(action === 'ensure' ? ensure() : fingerprints()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { fingerprints };
