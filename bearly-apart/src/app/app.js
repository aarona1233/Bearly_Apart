const $ = (id) => document.getElementById(id);
let data = null; // from ba.get(): config, statuses, sendables, scenes, …
let live = null; // pushed by the app whenever something changes

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const partner = () => data.config.partner.name || 'your love';
const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---------- tabs ------------------------------------------------------------

function showTab(name) {
  const access = name === 'access'; // after an update: only the Full Disk Access step of setup
  if (access) name = 'setup';
  else if (!document.querySelector(`[data-page="${name}"]`) || (name === 'setup' && data.config.setupDone)) name = 'send';
  document.body.classList.toggle('setup', name === 'setup');
  if (access) startAccessCheck();
  else if (name === 'setup') startSetup();
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const s of document.querySelectorAll('[data-page]')) s.classList.toggle('on', s.dataset.page === name);
  if (name === 'send' && location.hash === '#send') $('note').focus();
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
window.ba.onShowTab((tab) => {
  showTab(tab);
  if (tab === 'send') $('note').focus();
});

// ---------- live parts (header, banner, status, recent) ----------------------

// Settings → Updates: what the updater is doing, in words.
function renderUpdate() {
  const u = live.update;
  const off = !u || u.status === 'off';
  const when = u?.lastCheckedAt ? ` · checked ${ago(u.lastCheckedAt)}` : '';
  const mac = data.platform === 'darwin';
  const text = off
    ? 'Automatic updates aren’t set up in this build.'
    : {
        idle: `Version ${u.version}. Checks for a new one every hour.`,
        checking: 'Checking for a new version…',
        'up-to-date': `✓ Up to date (version ${u.version})${when}`,
        available: `Version ${u.latest} is out (you have ${u.version}).${mac ? '' : ' Run the new installer to get it.'}`,
        downloading: `⬇️ Downloading version ${u.latest}… ${u.total ? Math.round((100 * u.received) / u.total) : 0}%`,
        installing: `Installing version ${u.latest}: Bearly Apart closes and opens again by itself in a few seconds.`,
        error: `Couldn’t update: ${u.error}${when}`,
      }[u.status] || `Version ${u.version}`;
  $('update-status').textContent = text;
  $('update-summary').textContent = off || u.status === 'up-to-date' || u.status === 'idle' ? 'Updates' : u.status === 'error' ? 'Updates · ⚠️' : 'Updates · new version';
  $('check-update').disabled = off || ['checking', 'downloading', 'installing'].includes(u.status);
  $('auto-update').closest('label').hidden = off || !mac;
  const hasKey = !!data.config.updateToken;
  $('update-key-box').hidden = off;
  $('update-key-set').hidden = !hasKey;
  $('update-key').hidden = $('update-key-save').hidden = hasKey;
}

function renderLive() {
  renderUpdate();
  const c = data.config;
  const s = data.statuses;
  $('partner-name').textContent = live.paired ? partner() : 'Not paired yet';
  const ps = live.partnerStatus && s[live.partnerStatus.name];
  // "🟢 Here now · 💼 At work" / "💤 Away for 2h · 😴 Sleepy". Older apps don't report presence: last heard instead.
  const pp = live.partnerPresence;
  const where = !pp ? '' : pp.state === 'away' ? `💤 Away for ${ago(pp.at).replace(' ago', '')}` : '🟢 Here now';
  const what = ps ? `${ps.emoji} ${ps.short}` : '';
  $('partner-sub').textContent =
    where || what ? [where, what].filter(Boolean).join(' · ') : live.paired && live.lastHeardAt ? `Last heard from ${ago(live.lastHeardAt)}` : '';
  $('conn').textContent = live.connected ? '● Connected' : '○ Connecting…';
  $('conn').className = `conn ${live.connected ? 'on' : 'off'}`;

  // One banner at a time, most important first.
  const banner = $('banner');
  banner.replaceChildren();
  let msg = null;
  let action = null;
  if (!live.paired) [msg, action] = ['Not connected to your person yet.', ['Connect', () => showTab(data.config.setupDone ? 'settings' : 'setup')]];
  else if (live.imessage === 'no-access')
    [msg, action] = [
      live.justUpdated
        ? 'Bearly Apart was updated, so macOS needs one more click: in Full Disk Access, switch Bearly Apart off and back on (or select it, click −, then + to add it again).'
        : 'Texts can’t be seen yet: give Bearly Apart Full Disk Access.',
      ['Open that setting', () => window.ba.open('fda')],
    ];
  else if (live.imessage === 'missing') msg = 'Texts can’t be seen yet: sign in to Messages on this Mac (with Messages in iCloud on).';
  else if (live.snoozedUntil) [msg, action] = [`🔕 Bears are snoozed until ${timeOf(live.snoozedUntil)}.`, ['Resume', () => window.ba.snooze(0)]];
  else if (live.paused) msg = `⏸ Bears are waiting because ${data.pauseReasons[live.paused] || (live.paused.startsWith('app:') ? `${live.paused.slice(4)} is in front` : live.paused)}. They’ll play as soon as that’s over.`;
  banner.hidden = !msg;
  if (msg) {
    banner.append(el('span', { textContent: msg }));
    if (action) banner.append(el('button', { className: 'ghost small', textContent: action[0], onclick: action[1] }));
  }

  for (const b of document.querySelectorAll('.send-btn')) b.disabled = !live.paired;
  $('note-send').disabled = $('note-later').disabled = !live.paired;

  const mine = live.myStatus && s[live.myStatus.name];
  $('my-status').textContent = mine ? `You: ${mine.emoji} ${mine.short} · set ${ago(live.myStatus.at)}` : 'You haven’t set a status.';
  $('status-clear').hidden = !mine;
  for (const chip of document.querySelectorAll('.chip')) {
    chip.classList.toggle('on', chip.dataset.status === live.myStatus?.name);
    chip.disabled = !live.paired;
  }
  $('note-hint').textContent =
    `“Save for their morning” keeps it a secret until the first time ${partner()} is at the computer the next day.` +
    (live.noteJar ? ` ${partner()} saved ${live.noteJar} note${live.noteJar > 1 ? 's' : ''} for your morning 🫙` : '');

  renderDevices();
  const list = $('activity');
  list.replaceChildren(
    ...(live.activity.length
      ? live.activity.map((a) => {
          const mark = { sent: ' ✓', seen: ' ✓ 👀 seen', failed: ' ✗ not sent', sending: ' …' }[a.dir === 'in' ? '' : a.state] || '';
          return el(
            'li',
            {},
            el('span', { className: a.dir === 'in' ? 'in' : a.state, textContent: `${a.text}${mark}`, title: a.error || '' }),
            el('span', { className: 'meta', textContent: ago(a.at) }),
          );
        })
      : [el('li', { className: 'empty', textContent: 'Nothing yet.' })]),
  );
}

// ---------- send tab ----------------------------------------------------------

// A big emoji button that shows … while sending, then ✓ or ✗.
function sendButton(emoji, label, send) {
  const b = el('button', { className: 'send-btn' }, el('span', { className: 'emoji', textContent: emoji }), el('span', { className: 'lbl', textContent: label }), el('span', { className: 'tick' }));
  b.addEventListener('click', async () => {
    b.className = 'send-btn sending';
    b.querySelector('.tick').textContent = '';
    const r = await send();
    b.className = `send-btn ${r.ok ? 'sent' : 'failed'}`;
    b.querySelector('.tick').textContent = r.ok ? '✓' : '✗';
    if (!r.ok) toast(`Couldn’t send: ${r.error}`);
    else if (r.away) toast(`Sent! ${partner()} is away; it’ll be waiting for them 💌`);
    setTimeout(() => (b.className = 'send-btn'), 2500);
  });
  return b;
}

function buildSend() {
  $('send-hint').textContent = `Plays on ${partner()}’s screen right away. If they’re away or busy it waits, then shows up when they’re back.`;
  $('send-grid').replaceChildren(...Object.entries(data.sendables).map(([type, s]) => sendButton(s.emoji, s.short, () => window.ba.send(type))));
  $('more-grid').replaceChildren(...Object.entries(data.gifts).map(([gift, g]) => sendButton(g.emoji, g.label, () => window.ba.send('gift', { gift }))));

  $('status-hint').textContent = `Let ${partner()} know what you’re up to. Their bear acts it out on their screen once, and it stays next to your name in their 💗 menu until you change or clear it.`;
  $('status-chips').replaceChildren(
    ...Object.entries(data.statuses).map(([name, s]) => {
      const chip = el('button', { className: 'chip', textContent: `${s.emoji} ${s.short}` });
      chip.dataset.status = name;
      chip.addEventListener('click', () => setStatus(name, `${s.emoji} ${s.short}`));
      return chip;
    }),
  );
}

async function setStatus(name, text) {
  const r = await window.ba.send('status', { status: name });
  toast(r.ok ? (name === 'clear' ? 'Status cleared' : `Status set: ${text}`) : `Couldn’t send: ${r.error}`);
}
$('status-clear').addEventListener('click', () => setStatus('clear'));

async function sendNote(later) {
  const text = $('note').value.trim();
  if (!text) return toast('Write something first 🙂');
  const buttons = [$('note-send'), $('note-later')];
  buttons.forEach((b) => (b.disabled = true));
  toast('Sending…');
  const r = await window.ba.note(text, later);
  buttons.forEach((b) => (b.disabled = false));
  if (r.ok) {
    $('note').value = '';
    toast(later ? `Saved for ${partner()}’s morning 🫙` : 'Delivered 💌');
  } else toast(`Couldn’t send: ${r.error}. Your note is still here.`);
}
$('note-send').addEventListener('click', () => sendNote(false));
$('note-later').addEventListener('click', () => sendNote(true));

// ---------- animations tab ----------------------------------------------------

function buildGallery() {
  $('gallery').replaceChildren(
    ...data.scenes.map((sc) => {
      const play = el('button', { className: 'ghost small', textContent: '▶ Play' });
      play.addEventListener('click', () => window.ba.preview(sc.name));
      return el('div', { className: 'tile', title: sc.name }, sc.thumb ? el('img', { src: sc.thumb, alt: '' }) : '', el('b', { textContent: sc.title }), el('small', { textContent: sc.when }), play);
    }),
  );
}

// ---------- settings tab ----------------------------------------------------

function fillZones(selected) {
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];
  $('partner-tz').replaceChildren(new Option('(not set)', ''), ...zones.map((z) => new Option(z.replace(/_/g, ' '), z)));
  $('partner-tz').value = selected || '';
}

function fillSettings() {
  const c = data.config;
  $('me-name').value = c.me.name;
  $('me-character').value = c.me.character;
  $('me-handles').value = (c.me.handles || []).join(', ');
  $('partner-name-input').value = c.partner.name;
  $('partner-character').value = c.partner.character;
  fillZones(c.partner.timezone);
  $('handles').value = (c.partner.imessageHandles || []).join('\n');
  $('imessage-block').hidden = data.platform !== 'darwin';
  $('fda-warn').hidden = live.imessage !== 'no-access';
  $('quiet-start').value = c.quietHours.start;
  $('quiet-end').value = c.quietHours.end;
  $('calls').checked = c.pauseDuringCalls;
  $('fullscreen').checked = c.pauseWhenFullscreen;
  $('focus').checked = c.respectFocus;
  $('scale').value = c.scale;
  $('cooldown').value = c.cooldownSec;
  $('visit').value = c.visitDate;
  c.missing.slice(0, 3).forEach((m, i) => ($(`miss-${i}`).value = m.hours));
  $('login').checked = c.launchAtLogin;
  $('auto-update').checked = c.autoUpdate !== false;
  $('my-code').textContent = c.me.name ? data.pairing : 'Save your name first';
  $('pair-summary').textContent = c.partner.id ? `Connection · paired with ${partner()} 💞` : 'Connection · not paired yet';
  $('link-code').textContent = c.me.name && c.partner.id ? data.linkCode : 'Finish setting up first';
  renderDevices();
  $('profile').textContent = data.profileDir;
  $('sc-url').textContent = `${c.relay.server.replace(/\/+$/, '')}/${c.relay.topic}`;
  const id = c.me.id || '(save your name first)';
  $('sc-tags').textContent = [
    ...Object.entries(data.sendables).map(([type, s]) => `${s.emoji} ${type.padEnd(9)} ba,e.${type},f.${id}`),
    ...Object.entries(data.gifts).map(([gift, g]) => `${g.emoji} ${gift.padEnd(9)} ba,e.gift,g.${gift},f.${id}`),
    ...Object.entries(data.statuses).map(([name, s]) => `${s.emoji} ${name.padEnd(9)} ba,e.status,s.${name},f.${id}`),
  ].join('\n');
}

function collect() {
  const c = data.config;
  return {
    me: { name: $('me-name').value.trim(), character: $('me-character').value, handles: $('me-handles').value.split(/\n|,/).map((s) => s.trim()).filter(Boolean) },
    partner: {
      name: $('partner-name-input').value.trim(),
      character: $('partner-character').value,
      timezone: $('partner-tz').value,
      imessageHandles: $('handles').value.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    },
    quietHours: { start: $('quiet-start').value, end: $('quiet-end').value },
    pauseDuringCalls: $('calls').checked,
    pauseWhenFullscreen: $('fullscreen').checked,
    respectFocus: $('focus').checked,
    scale: Number($('scale').value),
    cooldownSec: Number($('cooldown').value) || 0,
    visitDate: $('visit').value,
    missing: c.missing.map((m, i) => ({ ...m, hours: Number($(`miss-${i}`)?.value) || m.hours })),
    launchAtLogin: $('login').checked,
    autoUpdate: $('auto-update').checked,
  };
}

async function reload() {
  data = await window.ba.get();
  live = data.live;
  buildSend();
  buildGallery();
  fillSettings();
  renderLive();
}

$('save').addEventListener('click', async () => {
  if (!$('me-name').value.trim()) return toast('Add your name first 🙂');
  await window.ba.save(collect());
  await reload();
  toast('Saved 💕');
});
$('copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText($('my-code').textContent);
  toast('Copied. Send it to them!');
});
$('pair').addEventListener('click', async () => {
  if (!$('me-name').value.trim()) return toast('Add your name first 🙂');
  await window.ba.save(collect());
  const r = await window.ba.pair($('their-code').value);
  if (!r.ok) return toast(r.error);
  $('their-code').value = '';
  await reload();
  toast('Paired! 💞');
});
// "Your computers": this one plus any other computer of mine the relay has heard from.
function renderDevices() {
  const others = Object.values(live?.myDevices || {});
  const row = (name, sub) => el('li', {}, el('span', { textContent: name }), el('span', { className: 'meta', textContent: sub }));
  $('devices').replaceChildren(
    row(`💻 ${data.deviceName}`, 'this computer'),
    ...others.map((d) => row(`💻 ${d.name}`, d.state === 'away' ? `away · ${ago(d.at)}` : `active ${ago(d.at)}`)),
  );
  $('devices-summary').textContent = `Your computers · ${1 + others.length}`;
}
$('copy-link').addEventListener('click', () => {
  navigator.clipboard.writeText($('link-code').textContent);
  toast('Copied. Paste it into your other computer’s setup.');
});
$('use-link').addEventListener('click', async () => {
  if (!confirm('Make this computer use your other computer’s name, bear and connection?')) return;
  const r = await window.ba.pair($('their-link').value);
  if (!r.ok) return toast(r.error);
  if (!r.linked) return toast('That was an invite, so you are now paired with them. For your own computers, use a link code.');
  $('their-link').value = '';
  await reload();
  toast('Linked! This computer now matches your other one 💻💻');
});
$('reset').addEventListener('click', async () => {
  if (!confirm('Make a brand-new code? You will need to pair again.')) return;
  await window.ba.resetPairing();
  await reload();
});
$('open-fda').addEventListener('click', () => window.ba.open('fda'));
$('check-update').addEventListener('click', async () => {
  const s = await window.ba.checkUpdate();
  if (s?.status === 'up-to-date') toast('You have the newest version 🐻');
});
async function saveUpdateKey(key) {
  const r = await window.ba.setUpdateKey(key);
  if (!r.ok) return toast(r.error);
  $('update-key').value = '';
  await reload();
  toast(key ? 'Key saved. Checking for updates…' : 'Key removed');
  if (key) window.ba.checkUpdate();
}
$('update-key-save').addEventListener('click', () => saveUpdateKey($('update-key').value.trim()));
$('update-key-remove').addEventListener('click', () => confirm('Remove the update key from this computer?') && saveUpdateKey(''));
$('auto-update').addEventListener('change', async () => {
  await window.ba.save({ autoUpdate: $('auto-update').checked });
  data.config.autoUpdate = $('auto-update').checked;
});
$('open-profile').addEventListener('click', () => window.ba.open('profile'));
$('open-gifs').addEventListener('click', () => window.ba.open('gifs'));

window.ba.onLive((l) => {
  live = l;
  if (!data) return;
  renderLive();
  if (document.body.classList.contains('setup')) setupOnLive();
});
setInterval(() => data && renderLive(), 30_000); // keeps "5m ago" fresh

reload().then(() => showTab(data.config.setupDone ? location.hash.slice(1) || 'send' : 'setup'));
