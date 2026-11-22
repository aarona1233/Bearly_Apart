// The two judges that aren't you two: an AI on a computer running Ollama, and a friend with a file. No Electron here.
const { RUBRIC, money } = require('./draft');

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const PREFERRED_MODEL = 'granite4.1:8b';
const FIND_TIMEOUT_MS = 3000;
// A model that isn't in memory yet takes a while to load.
const JUDGE_TIMEOUT_MS = 180_000;

async function findModel(fetch) {
  const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(FIND_TIMEOUT_MS) });
  if (!res.ok) return null;
  const names = ((await res.json()).models || []).map((m) => m.name).filter((n) => !/embed/i.test(n));
  return names.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : names[0] || null;
}

function buildLines(s, id, catalog) {
  const won = s.won[id];
  if (!won.length) return '(nothing: they won no items)';
  return won.map(([itemId, cents]) => `- ${catalog.item(itemId)?.name} (${money(cents)}): ${catalog.item(itemId)?.flavorText}`).join('\n');
}

// Asks the local Ollama to score both builds. Returns { <player id>: [four scores] }, or null if it isn't here or gave
// an answer that can't be trusted.
async function askOllama(s, catalog, names, { fetch = globalThis.fetch, log = () => {} } = {}) {
  const [a, b] = s.players;
  try {
    const model = await findModel(fetch);
    if (!model) return null;
    const topic = catalog.topic(s.topic);
    const ids = RUBRIC.map((c) => c.id);
    const shape = `{${ids.map((c) => `"${c}": 3`).join(', ')}}`;
    const prompt = `You are the judge for a party game. Two people, "${names[a]}" and "${names[b]}", each drafted a build for the topic "${topic.title}" (category: ${topic.category}).${s.ctx ? `\nSpecifically, for this setting: "${s.ctx}".` : ''}

${names[a]}'s build:
${buildLines(s, a, catalog)}

${names[b]}'s build:
${buildLines(s, b, catalog)}

Score EACH build on these categories, 1 (rough) to 5 (perfect): ${ids.join(', ')}. Be a fun, slightly cheeky judge, but fair: don't just tie every score.

Respond with ONLY a JSON object shaped exactly like:
{"${names[a]}": ${shape}, "${names[b]}": ${shape}}`;
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, format: 'json', stream: false }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return readVerdict(JSON.parse((await res.json()).response), s.players, names);
  } catch (err) {
    log(`[draft] AI judge: ${err.message}`);
    return null;
  }
}

function readVerdict(raw, players, names) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const id of players) {
    const key = Object.keys(raw).find((k) => k.trim().toLowerCase() === String(names[id]).trim().toLowerCase());
    const sheet = key && RUBRIC.map((c) => Number(raw[key]?.[c.id]));
    if (!sheet || !sheet.every(Number.isFinite)) return null;
    out[id] = sheet.map((n) => Math.max(1, Math.min(5, Math.round(n))));
  }
  return out;
}

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A page a friend opens to judge: both builds with their pictures inside the file, and a line to text back. It holds
// nothing about the relay, so it can go to anyone. artData(id) -> a data: URL for the item's picture, or ''.
function judgeFileHtml(s, catalog, names, artData) {
  const topic = catalog.topic(s.topic);
  const builds = s.players.map((id) => {
    const items = s.won[id].map(([itemId, cents]) => {
      const item = catalog.item(itemId);
      const art = artData(itemId);
      return `<li>${art ? `<img src="${art}" alt="">` : ''}<div><b>${escapeHtml(item?.name)}</b> <span class="price">${money(cents)}</span><br><small>${escapeHtml(item?.flavorText)}</small></div></li>`;
    });
    const sliders = RUBRIC.map((c) => `<label>${escapeHtml(c.label)} <output>3</output><input type="range" min="1" max="5" value="3"></label>`).join('');
    return `<section data-name="${escapeHtml(names[id])}"><h2>${escapeHtml(names[id])}’s build</h2><ul>${items.join('') || '<li>Nothing! They won no items.</li>'}</ul><div class="sliders">${sliders}</div></section>`;
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Judge this draft</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 560px; padding: 20px 16px 40px; background: #fff6f8; color: #5b3a46; font: 15px/1.45 ui-rounded, system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 0 0 10px; }
  section, .reply { background: #fff; border: 1px solid #f3d3dd; border-radius: 16px; padding: 16px; margin-top: 14px; }
  ul { list-style: none; margin: 0 0 14px; padding: 0; }
  li { display: flex; gap: 10px; align-items: center; padding: 6px 0; }
  li img { width: 56px; height: 56px; border-radius: 10px; flex: none; }
  small, .hint { color: #9a7a86; }
  .price { color: #f2648f; font-weight: 700; }
  label { display: block; font-weight: 600; margin-top: 10px; }
  output { float: right; color: #f2648f; font-weight: 800; }
  input[type=range] { width: 100%; accent-color: #f2648f; }
  #line { font-size: 18px; font-weight: 800; margin: 8px 0; }
  button { font: inherit; font-weight: 700; border: 0; border-radius: 999px; padding: 10px 18px; background: #f2648f; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<h1>🐻 Judge this draft</h1>
<p>${escapeHtml(names[s.players[0]])} and ${escapeHtml(names[s.players[1]])} each spent $20 at auction building the best <b>${escapeHtml(topic.title)}</b>${s.ctx ? ` for: <i>${escapeHtml(s.ctx)}</i>` : ''}. Score each build from 1 (rough) to 5 (perfect).</p>
${builds.join('\n')}
<div class="reply">
  <h2>Text this back</h2>
  <noscript><p>Reply with four numbers from 1 to 5 for each build, in this order: ${RUBRIC.map((c) => escapeHtml(c.label)).join(', ')}.</p></noscript>
  <p id="line"></p>
  <button id="copy" hidden>Copy</button>
  <p class="hint">Send it to either of them, however you like. They paste it into the app and the winner comes out.</p>
</div>
<script>
  const line = document.getElementById('line');
  const copy = document.getElementById('copy');
  function update() {
    line.textContent = [...document.querySelectorAll('section')]
      .map((sec) => sec.dataset.name + ' ' + [...sec.querySelectorAll('input')].map((i) => i.value).join(' '))
      .join(' · ');
  }
  for (const input of document.querySelectorAll('input')) {
    input.addEventListener('input', () => {
      input.parentElement.querySelector('output').textContent = input.value;
      update();
    });
  }
  copy.hidden = !navigator.clipboard;
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(line.textContent);
    copy.textContent = 'Copied!';
  });
  update();
</script>
</body>
</html>
`;
}

module.exports = { askOllama, readVerdict, judgeFileHtml };
