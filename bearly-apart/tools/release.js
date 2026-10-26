// Publishes a Mac update that installed copies pick up by themselves (within the hour):
//   1. bump "version" in package.json   2. npm run publish:mac
// It builds "Bearly Apart for Mac.zip", signs latest-mac.json with the release key (tools/signing.js), and puts both
// on a GitHub release of the repo in package.json → updates.feed. With the GitHub CLI (`gh`, signed in) that's
// automatic; otherwise it prints the two files to drag onto a new release by hand.
//   node tools/release.js --no-build    reuse the zip already in dist/
//   node tools/release.js --no-upload   stop after writing dist/update/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pkg = require('../package.json');
const { mac, DIST, NAME } = require('./package.js');
const { updateKey } = require('./signing');
const { signManifest, verifyManifest, sha256File } = require('../src/main/updater');

// "https://github.com/OWNER/REPO/releases/latest/download/latest-mac.json" → "OWNER/REPO"
function githubRepo(feed) {
  return String(feed || '').match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest-mac\.json$/)?.[1] || null;
}

function hasGh() {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const repo = githubRepo(pkg.updates?.feed);
  if (!repo) throw new Error('Set "updates": { "feed": "https://github.com/OWNER/REPO/releases/latest/download/latest-mac.json" } in package.json first.');
  const key = updateKey(); // fails early if this computer doesn't have the release key
  if (!args.includes('--no-build')) await mac();

  const tag = `v${pkg.version}`;
  const asset = `Bearly-Apart-mac-${pkg.version}.zip`;
  const out = path.join(DIST, 'update');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const zip = path.join(out, asset);
  fs.copyFileSync(path.join(DIST, `${NAME} for Mac.zip`), zip);
  const manifest = signManifest(
    {
      version: pkg.version,
      url: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
      sha256: await sha256File(zip),
      size: fs.statSync(zip).size,
      notes: args.find((a) => a.startsWith('--notes='))?.slice(8) || '',
    },
    key,
  );
  verifyManifest(manifest, fs.readFileSync(path.join(__dirname, '..', 'assets', 'update-public.pem'), 'utf8'));
  const json = path.join(out, 'latest-mac.json');
  fs.writeFileSync(json, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✓ signed update ${pkg.version} (${(manifest.size / 1e6).toFixed(0)} MB) → ${path.relative(process.cwd(), out)}`);

  if (args.includes('--no-upload')) return;
  if (!hasGh()) {
    console.log(
      `\nUpload by hand: https://github.com/${repo}/releases/new\n` +
        `  Tag: ${tag}   Title: Bearly Apart ${pkg.version}\n` +
        `  Attach both files from ${out}:\n    ${asset}\n    latest-mac.json\n` +
        `  Leave "Set as the latest release" ticked, then Publish.\n` +
        `(Or install the GitHub CLI and run \`gh auth login\` once, and this step happens by itself.)`,
    );
    return;
  }
  execFileSync('gh', ['release', 'create', tag, zip, json, '--repo', repo, '--title', `Bearly Apart ${pkg.version}`, '--notes', manifest.notes || `Bearly Apart ${pkg.version}`, '--latest'], {
    stdio: 'inherit',
  });
  console.log(`✓ published ${tag}: installed Macs update within the hour (or right away from Settings → Updates)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
