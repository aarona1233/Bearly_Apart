// Brings the old Draft Night game's content into the app: the topic packs, smaller copies of the item art, and the
// two button sounds. Run it again after adding packs or art to the old project.
//   node tools/import-draft.js "<Draft app folder>"
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const from = process.argv[2];
if (!from || !fs.existsSync(path.join(from, 'shared', 'src', 'index.ts'))) {
  console.error('Usage: node tools/import-draft.js "<Draft app folder>"');
  process.exit(1);
}
const OUT = path.join(__dirname, '..', 'assets', 'draft');
fs.mkdirSync(path.join(OUT, 'art'), { recursive: true });

// The packs are TypeScript, so the old project's own tsx prints them as JSON.
const index = pathToFileURL(path.resolve(from, 'shared', 'src', 'index.ts')).href;
const script = path.join(os.tmpdir(), `bearly-draft-import-${process.pid}.mts`);
fs.writeFileSync(script, `import { ALL_TOPICS } from ${JSON.stringify(index)}; process.stdout.write(JSON.stringify(ALL_TOPICS));`);
const tsx = path.join(from, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const raw = execFileSync(process.execPath, [tsx, script], { cwd: from, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
fs.rmSync(script);
const topics = JSON.parse(raw).map((t) => ({
  id: t.id,
  title: t.title,
  category: t.category,
  ...(t.reveal ? { reveal: t.reveal } : {}),
  ...(t.contexts?.length ? { contexts: t.contexts } : {}),
  slots: t.slots,
  // photoQuery only searched for stock photos, which the app doesn't use.
  items: t.items.map(({ photoQuery, photoUrl, ...item }) => item),
}));
fs.writeFileSync(path.join(OUT, 'topics.json'), JSON.stringify(topics));
console.log(`${topics.length} topics, ${topics.reduce((n, t) => n + t.items.length, 0)} items`);

for (const sfx of ['sfx-click.mp3', 'sfx-bid.mp3']) fs.copyFileSync(path.join(from, 'web', 'public', 'audio', sfx), path.join(OUT, sfx));

execFileSync(process.env.PYTHON || 'python', [path.join(__dirname, 'import-draft-art.py'), path.join(from, 'web', 'public', 'art'), path.join(OUT, 'art')], { stdio: 'inherit' });
