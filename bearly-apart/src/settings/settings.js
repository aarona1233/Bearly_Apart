const $ = (id) => document.getElementById(id);

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function fillZones(selected) {
  const sel = $('partner-tz');
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];
  sel.replaceChildren(new Option('(not set)', ''), ...zones.map((z) => new Option(z.replace(/_/g, ' '), z)));
  sel.value = selected || '';
}

function shortcutHelp(c, statuses, sendables) {
  $('sc-url').textContent = `${c.relay.server.replace(/\/+$/, '')}/${c.relay.topic}`;
  const id = c.me.id || '(save your name first)';
  const lines = [
    ...Object.entries(sendables).map(([type, s]) => `${s.emoji} ${type.padEnd(9)} ba,e.${type},f.${id}`),
    ...Object.entries(statuses).map(([name, s]) => `${s.emoji} ${name.padEnd(9)} ba,e.status,s.${name},f.${id}`),
  ];
  $('sc-tags').textContent = lines.join('\n');
}

function render({ config: c, pairing, platform, imessage, profileDir, statuses, sendables }) {
  shortcutHelp(c, statuses, sendables);
  $('me-name').value = c.me.name;
  $('me-character').value = c.me.character;
  $('partner-name').value = c.partner.name;
  $('partner-character').value = c.partner.character;
  fillZones(c.partner.timezone);
  $('handles').value = (c.partner.imessageHandles || []).join('\n');
  $('quiet-start').value = c.quietHours.start;
  $('quiet-end').value = c.quietHours.end;
  $('cooldown').value = c.cooldownSec;
  $('visit').value = c.visitDate;
  c.missing.slice(0, 3).forEach((m, i) => ($(`miss-${i}`).value = m.hours));
  $('scale').value = c.scale;
  $('fullscreen').checked = c.pauseWhenFullscreen;
  $('focus').checked = c.respectFocus;
  $('login').checked = c.launchAtLogin;
  $('my-code').textContent = c.me.name ? pairing : 'Save your name first ↑';
  $('paired-info').textContent = c.partner.id ? `💞 Paired with ${c.partner.name || c.partner.id}` : 'Not paired yet. One of you copies their code to the other, who pastes it below.';
  $('imessage-block').hidden = platform !== 'darwin';
  $('fda-warn').hidden = imessage !== 'no-access';
  $('profile').textContent = profileDir;
}

async function load() {
  render(await window.ba.get());
}

function collect(c) {
  const missing = c.missing.map((m, i) => ({ ...m, hours: Number($(`miss-${i}`)?.value) || m.hours }));
  return {
    me: { name: $('me-name').value.trim(), character: $('me-character').value },
    partner: {
      name: $('partner-name').value.trim(),
      character: $('partner-character').value,
      timezone: $('partner-tz').value,
      imessageHandles: $('handles').value.split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    },
    quietHours: { start: $('quiet-start').value, end: $('quiet-end').value },
    cooldownSec: Number($('cooldown').value) || 0,
    visitDate: $('visit').value,
    missing,
    scale: Number($('scale').value),
    pauseWhenFullscreen: $('fullscreen').checked,
    respectFocus: $('focus').checked,
    launchAtLogin: $('login').checked,
  };
}

$('save').addEventListener('click', async () => {
  const cur = (await window.ba.get()).config;
  if (!$('me-name').value.trim()) return toast('Add your name first 🙂');
  await window.ba.save(collect(cur));
  await load();
  toast('Saved 💕');
});

$('copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText($('my-code').textContent);
  toast('Copied — send it to them!');
});

$('pair').addEventListener('click', async () => {
  try {
    if (!$('me-name').value.trim()) return toast('Add your name first 🙂');
    const cur = (await window.ba.get()).config;
    await window.ba.save(collect(cur));
    await window.ba.pair($('their-code').value);
    $('their-code').value = '';
    await load();
    toast('Paired! 💞');
  } catch (err) {
    toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
});

$('reset').addEventListener('click', async () => {
  if (!confirm('Make a brand-new code? You will need to pair again.')) return;
  await window.ba.resetPairing();
  await load();
});

$('open-fda').addEventListener('click', () => window.ba.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'));

async function setupTry() {
  const t = await window.ba.tryList();
  $('try-scene').replaceChildren(...t.scenes.map((n) => new Option(n, n)));
  $('try-scene').value = 'message';
  $('try-status').replaceChildren(...Object.entries(t.statuses).map(([n, s]) => new Option(`${s.emoji} ${s.label.replace(/^is /, '')}`, n)));
  $('try-send').replaceChildren(
    ...Object.entries(t.sendables).map(([type, s]) => {
      const b = document.createElement('button');
      b.className = 'ghost';
      b.textContent = `${s.emoji} ${type.replace('-', ' ')}`;
      b.disabled = !t.paired;
      b.addEventListener('click', async () => {
        try {
          await window.ba.send(type);
          toast('Sent 💕');
        } catch {
          toast('Could not send — are you online?');
        }
      });
      return b;
    }),
  );
  $('try-status-send').disabled = !t.paired;
}

$('try-play').addEventListener('click', () => window.ba.preview($('try-scene').value));
$('try-status-send').addEventListener('click', async () => {
  try {
    await window.ba.send('status', $('try-status').value);
    toast('Status sent');
  } catch {
    toast('Could not send — are you online?');
  }
});
$('try-snooze').addEventListener('click', () => (window.ba.snooze(60), toast('Snoozed for an hour')));
$('try-resume').addEventListener('click', () => (window.ba.snooze(0), toast('Bears are back')));

load();
setupTry();
