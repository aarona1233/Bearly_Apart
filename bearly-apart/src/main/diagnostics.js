// "Is everything working?": a list of checks, run after each install/update and from the Check tab. Each check
// answers ok / warn / fail / skip with a sentence a person can act on. The app passes in what each check needs
// (ctx), so this file has no Electron in it and can be tested with fakes.
const CHECKS = [
  {
    id: 'app',
    label: 'This app',
    run: (c) => ok(`Bearly Apart ${c.version} on ${c.os}, this computer: ${c.deviceName}`),
  },
  {
    id: 'setup',
    label: 'Set up and paired',
    run: (c) => {
      if (!c.config.me.name) return fail('Setup isn’t finished: no name yet. Open the app and finish the setup.');
      if (!c.config.partner.id) return fail('Not connected to your person yet: send them an invite, or paste theirs (Settings → Connection).');
      return ok(`${c.config.me.name} ⇄ ${c.config.partner.name || c.config.partner.id}`);
    },
  },
  {
    id: 'relay',
    label: 'Relay reachable',
    run: async (c) => {
      const ms = await c.relayReachable();
      return ok(`${c.config.relay.server} answered in ${ms} ms`);
    },
  },
  {
    id: 'live',
    label: 'Listening for messages',
    run: (c) => (c.relayConnected() ? ok('connected and waiting for their messages') : fail('not connected to the relay right now (no internet, or the relay is down); it keeps retrying')),
  },
  {
    id: 'roundtrip',
    label: 'Sending works',
    run: async (c) => {
      if (!c.config.partner.id) return skip('not paired yet');
      const ms = await c.roundTrip();
      return ok(`a test message went out and came back in ${ms} ms`);
    },
  },
  {
    id: 'partner',
    label: 'Their app answers',
    partner: true,
    run: async (c) => {
      if (!c.config.partner.id) return skip('not paired yet');
      const them = await c.askPartner();
      if (!them) return warn(`${c.config.partner.name || 'Their app'} didn’t answer within 20 seconds: it may be closed or asleep, or older than 0.7 (it can’t answer checks).`);
      const bits = [`version ${them.version || '?'}`, them.os, them.connected ? 'connected' : 'NOT connected'];
      if (them.imessage && them.imessage !== 'off') bits.push(`texts: ${TEXTS[them.imessage] || them.imessage}`);
      if (them.paused) bits.push(`bears waiting: ${them.paused}`);
      if (them.errors) bits.push(`${them.errors} error(s) in the last day`);
      const trouble = !them.connected || them.imessage === 'no-access' || them.imessage === 'missing';
      return (trouble ? warn : ok)(`${c.config.partner.name || 'Their app'} answered: ${bits.filter(Boolean).join(', ')}`);
    },
  },
  {
    id: 'art',
    label: 'Animations',
    run: (c) => {
      const { scenes, missing } = c.artCheck();
      if (!scenes) return fail('no animations loaded (scenes.json is missing or broken)');
      if (missing.length) return fail(`${missing.length} picture(s) missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
      return ok(`${scenes} animations, every picture there for both bears`);
    },
  },
  {
    id: 'overlay',
    label: 'Animation window',
    run: (c) => (c.overlayOk() ? ok('ready to show bears') : fail('the see-through window the bears play in has crashed: quit and reopen Bearly Apart')),
  },
  {
    id: 'now',
    label: 'Bears can play right now',
    run: async (c) => {
      const why = await c.pausedReason();
      return why ? warn(`not right now: ${why}. Anything that arrives waits and plays afterwards.`) : ok('nothing is holding them back');
    },
  },
  {
    id: 'statuses',
    label: 'Statuses',
    run: (c) => {
      const without = c.statusesWithoutScene();
      return without.length ? fail(`no animation for: ${without.join(', ')}`) : ok('every status has an animation');
    },
  },
  {
    id: 'texts',
    label: 'Seeing texts (iMessage)',
    run: (c) => {
      if (!c.isMac) return skip('only on a Mac (that’s where the texts are read)');
      if (c.imessage === 'ok') return c.config.partner.imessageHandles?.length ? ok('reading Messages') : warn('reading Messages, but their number isn’t set (Settings → Them)');
      if (c.imessage === 'no-access') return fail('needs Full Disk Access: System Settings → Privacy & Security → Full Disk Access → switch Bearly Apart off and on');
      if (c.imessage === 'missing') return fail('Messages isn’t set up on this Mac: sign in to Messages with “Messages in iCloud” on');
      return warn(`text watching is ${c.imessage}`);
    },
  },
  {
    id: 'login',
    label: 'Starts with the computer',
    run: (c) => {
      if (!c.packaged) return skip('running from the source code');
      return c.config.launchAtLogin ? ok('on') : warn('off: it won’t be running after a restart (Settings → When bears play)');
    },
  },
  {
    id: 'updates',
    label: 'Updates',
    run: (c) => {
      const u = c.update;
      if (!u || u.status === 'off') return skip('not set up in this version');
      if (u.status === 'error') return warn(u.error);
      return ok(`${u.status}${u.latest ? `, newest published: ${u.latest}` : ''}`);
    },
  },
  {
    id: 'errors',
    label: 'Recent errors',
    run: (c) => {
      const errs = c.recentErrors();
      return errs.length ? warn(`${errs.length} in the last day, latest: ${errs[errs.length - 1].slice(0, 160)}`) : ok('none in the last day');
    },
  },
];

const TEXTS = { ok: 'reading Messages', 'no-access': 'needs Full Disk Access', missing: 'Messages not set up', stopped: 'off' };

function ok(detail) {
  return { status: 'ok', detail };
}
function warn(detail) {
  return { status: 'warn', detail };
}
function fail(detail) {
  return { status: 'fail', detail };
}
function skip(detail) {
  return { status: 'skip', detail };
}

// Runs every check (a check that throws counts as failed, with its message). partner: false skips asking their app.
async function runDiagnostics(ctx, { partner = true, onProgress = () => {} } = {}) {
  const results = [];
  for (const check of CHECKS) {
    if (check.partner && !partner) continue;
    let r;
    try {
      r = await check.run(ctx);
    } catch (err) {
      r = fail(err?.message || String(err));
    }
    results.push({ id: check.id, label: check.label, ...r });
    onProgress(results);
  }
  return results;
}

const MARK = { ok: '✓', warn: '⚠', fail: '✗', skip: '–' };

function summary(results) {
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  if (fails) return `${fails} problem${fails > 1 ? 's' : ''} found`;
  if (warns) return `working, with ${warns} thing${warns > 1 ? 's' : ''} to look at`;
  return 'everything works';
}

// Plain text to copy and send: the results, then the end of the log.
function formatReport(results, { when = new Date(), logTail = [] } = {}) {
  const lines = [`Bearly Apart check, ${when.toISOString()}: ${summary(results)}`, ''];
  for (const r of results) lines.push(`${MARK[r.status]} ${r.label}: ${r.detail}`);
  if (logTail.length) lines.push('', '--- last log lines ---', ...logTail);
  return lines.join('\n');
}

module.exports = { CHECKS, runDiagnostics, formatReport, summary };
