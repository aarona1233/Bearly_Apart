// The release keys, kept outside the project (they must never be committed or shared):
//   ~/.bearly-apart-signing/update-key.pem      Ed25519 private key: signs latest-mac.json (tools/release.js)
//   ~/.bearly-apart-signing/codesign.p12 (+ codesign-password.txt)
//                                               self-signed code-signing certificate for the Mac app (tools/package.js)
// The matching public update key is assets/update-public.pem, which ships in the app.
// Every computer you release from needs the same folder: copy it across (USB stick), don't make a new one, or
// installed copies stop accepting updates. BA_SIGNING_DIR points somewhere else.
//
//   node tools/signing.js    creates whatever is missing (never overwrites)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR = process.env.BA_SIGNING_DIR || path.join(os.homedir(), '.bearly-apart-signing');
const UPDATE_KEY = path.join(DIR, 'update-key.pem');
const P12 = path.join(DIR, 'codesign.p12');
const P12_PASSWORD = path.join(DIR, 'codesign-password.txt');
const PUBLIC_KEY = path.join(ROOT, 'assets', 'update-public.pem');

function publicFromPrivate(pem) {
  return crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' });
}

// The private update key, checked against the public key the app ships with.
function updateKey() {
  if (!fs.existsSync(UPDATE_KEY)) throw new Error(`No release key at ${UPDATE_KEY}. Copy the .bearly-apart-signing folder from the computer you made it on.`);
  const pem = fs.readFileSync(UPDATE_KEY, 'utf8');
  if (publicFromPrivate(pem).trim() !== fs.readFileSync(PUBLIC_KEY, 'utf8').trim()) {
    throw new Error(`${UPDATE_KEY} doesn't match assets/update-public.pem: installed copies would refuse this update.`);
  }
  return pem;
}

// { p12, passwordFile } for a stable signature (Full Disk Access survives updates), or null for ad-hoc.
function codesignIdentity() {
  return fs.existsSync(P12) && fs.existsSync(P12_PASSWORD) ? { p12: P12, passwordFile: P12_PASSWORD } : null;
}

function create(rcodesign) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(UPDATE_KEY)) {
    if (fs.existsSync(PUBLIC_KEY)) {
      throw new Error(`assets/update-public.pem already exists, so a release key was made before. Copy that .bearly-apart-signing folder here instead of making a new one.`);
    }
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(UPDATE_KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY, publicFromPrivate(fs.readFileSync(UPDATE_KEY, 'utf8')));
    console.log(`✓ made the update key (${UPDATE_KEY}) and assets/update-public.pem`);
  } else {
    updateKey();
    console.log('✓ update key is there and matches the app');
  }
  if (codesignIdentity()) return console.log('✓ code-signing certificate is there');
  if (!rcodesign) return console.warn('! rcodesign not found: the Mac app stays ad-hoc signed (Full Disk Access needs re-enabling after each update)');
  const password = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(P12_PASSWORD, password, { mode: 0o600 });
  execFileSync(rcodesign, ['generate-self-signed-certificate', '--person-name', 'Bearly Apart', '--p12-file', P12, '--p12-password', password], { stdio: 'inherit' });
  console.log(`✓ made the code-signing certificate (${P12})`);
}

module.exports = { DIR, UPDATE_KEY, PUBLIC_KEY, updateKey, codesignIdentity, create };

if (require.main === module) {
  try {
    create(require('./package.js').findRcodesign());
    console.log(`\nKeep ${DIR} safe, and copy it to any other computer you build releases on.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
