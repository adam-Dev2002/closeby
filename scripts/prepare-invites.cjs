const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.verification/invite-hosting');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(root, 'web/invite'), target, { recursive: true });
fs.copyFileSync(path.join(root, 'assets/branding/closeby-logo.png'), path.join(target, 'closeby-logo.png'));
const certificate = JSON.parse(fs.readFileSync(path.join(root, 'dist/android/signing-certificate.json'), 'utf8'));
const association = JSON.parse(fs.readFileSync(path.join(target, '.well-known/assetlinks.json'), 'utf8'));
if (!association.some(value => value.target.package_name === 'com.closeby.tracker'
  && value.target.sha256_cert_fingerprints.includes(certificate.sha256))) throw Error('App links must use the current release signing certificate');
// Spark Hosting blocks executable downloads. Remove only these known generated
// staging artifacts; distribute the signed APK from dist/android separately.
for (const obsolete of ['downloads/Closeby.apk', 'release.json']) {
  const file = path.join(target, obsolete);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
console.log(`Invitation hosting prepared at ${target}`);
