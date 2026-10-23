// First-run setup: welcome → you → pair → them → (Mac) texts → done. Uses the helpers in app.js.
const IS_MAC_APP = () => data.platform === 'darwin';
let wizStep = null;
let fdaTimer = null;
let skipTexts = false;

function setupStepFor() {
  const c = data.config;
  if (!c.me.name) return 'welcome';
  if (!c.partner.id) return 'pair';
  if (IS_MAC_APP() && live.imessage !== 'ok' && !skipTexts) return 'texts';
  return 'done';
}

function goStep(name) {
  wizStep = name;
  clearInterval(fdaTimer);
  for (const w of document.querySelectorAll('.wiz')) w.classList.toggle('on', w.dataset.step === name);
  ENTER[name]?.();
}

const handlesFrom = (text) => text.split(/\n|,/).map((s) => s.trim()).filter(Boolean);

const ENTER = {
  you() {
    const c = data.config;
    $('w-name').value = c.me.name;
    $('w-handles').value = (c.me.handles || []).join(', ');
    pickBear(c.me.character);
    $('w-name').focus();
  },
  async pair() {
    $('w-invite-box').hidden = $('w-have-box').hidden = true;
    $('w-code').textContent = data.pairing;
    // An invite already on the clipboard? Go straight to pasting it.
    const code = await window.ba.clipboardCode();
    if (code) {
      $('w-paste').value = code;
      $('w-have-box').hidden = false;
    }
  },
  them() {
    const p = data.config.partner;
    $('w-them-title').textContent = `Connected with ${p.name || 'your person'}! 💞`;
    $('w-pname').value = p.name;
    $('w-pbear').value = p.character;
    $('w-phandles').value = (p.imessageHandles || []).join('\n');
    $('w-phandles-block').hidden = !IS_MAC_APP();
  },
  texts() {
    const status = $('w-fda-status');
    status.className = 'waiting';
    status.textContent = '⏳ Waiting for the switch…';
    const check = async () => {
      const access = await window.ba.setup('texts');
      if (access !== 'ok') {
        status.textContent =
          access === 'missing' ? '⚠️ Messages isn’t set up on this Mac yet: open Messages and sign in (with Messages in iCloud on).' : '⏳ Waiting for the switch…';
        return;
      }
      clearInterval(fdaTimer);
      status.className = 'waiting ok';
      status.textContent = '✓ Bearly Apart can see your texts now';
      setTimeout(() => goStep('done'), 1200);
    };
    check();
    fdaTimer = setInterval(check, 2000);
  },
  done() {
    $('w-done-text').textContent = `You and ${partner()} are connected. Send your first 💋 from the Send tab, or wait for theirs.`;
    $('w-login').checked = data.config.launchAtLogin;
  },
};

function pickBear(bear) {
  for (const b of document.querySelectorAll('.bear')) b.classList.toggle('on', b.dataset.bear === bear);
}
for (const b of document.querySelectorAll('.bear')) b.addEventListener('click', () => pickBear(b.dataset.bear));

$('w-start').addEventListener('click', () => goStep('you'));

$('w-you-next').addEventListener('click', async () => {
  const name = $('w-name').value.trim();
  if (!name) return toast('Type your name first 🙂');
  const character = document.querySelector('.bear.on')?.dataset.bear || 'brown';
  await window.ba.save({ me: { name, character, handles: handlesFrom($('w-handles').value) } });
  await reload();
  goStep(data.config.partner.id ? 'them' : 'pair');
});

$('w-invite').addEventListener('click', () => {
  $('w-invite-box').hidden = false;
  $('w-have-box').hidden = true;
});
$('w-have').addEventListener('click', () => {
  $('w-have-box').hidden = false;
  $('w-invite-box').hidden = true;
  $('w-paste').focus();
});
$('w-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(data.pairing);
  toast('Copied! Now send it to them 💌');
});
$('w-pair').addEventListener('click', async () => {
  const r = await window.ba.pair($('w-paste').value);
  if (!r.ok) return toast(r.error);
  await reload();
  goStep('them');
});

$('w-them-next').addEventListener('click', async () => {
  const partner = { name: $('w-pname').value.trim(), character: $('w-pbear').value };
  if (IS_MAC_APP()) partner.imessageHandles = handlesFrom($('w-phandles').value);
  await window.ba.save({ partner });
  await reload();
  goStep(setupStepFor());
});

$('w-fda').addEventListener('click', () => window.ba.open('fda'));
$('w-restart').addEventListener('click', () => window.ba.setup('relaunch'));
$('w-fda-skip').addEventListener('click', () => {
  skipTexts = true;
  goStep('done');
});

$('w-finish').addEventListener('click', async () => {
  await window.ba.save({ setupDone: true, launchAtLogin: $('w-login').checked });
  await reload();
  showTab('send');
  window.ba.preview('hello');
});

// Called by app.js when live state changes: the inviter's page moves on once the other side connects.
async function setupOnLive() {
  if (wizStep === 'pair' && live.paired) {
    await reload();
    goStep('them');
  }
}

function startSetup() {
  goStep(setupStepFor());
}
