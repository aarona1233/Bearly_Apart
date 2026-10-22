// Turns events (partner messages, pokes, statuses, silence, mornings) into scenes to play.
// No Electron in here so it can be unit-tested with a fake clock.
const { STATUSES, describe } = require('./catalog');
const { inRange, timeInZone } = require('./guard');

const HOUR = 3600_000;

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(dateStr, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

class Brain {
  // play(req) -> Promise<boolean played>; req = { scene, vars, priority, label, ev, live }
  //   live: play now or not at all (don't save it for later)
  constructor({ config, state, setState, play, publish, hasScene, now = () => Date.now(), log = () => {} }) {
    this.config = config;
    this.state = state;
    this.setState = setState;
    this.play = play;
    this.publish = publish;
    this.hasScene = hasScene;
    this.now = now;
    this.log = log;
    this.msgTimes = [];
    this.lastMsgSceneAt = 0;
    this.lastKeywordAt = {};
    this.busyLive = false;
  }

  vars(extra = {}) {
    const c = this.config();
    return {
      me: c.me.name || 'me',
      partner: c.partner.name || 'your love',
      mc: c.me.character,
      pc: c.partner.character,
      ...extra,
    };
  }

  heard(ev) {
    const asleep = ev.type === 'status' && !!STATUSES[ev.status]?.asleep;
    this.setState({ lastHeardAt: Math.max(this.state().lastHeardAt, ev.at || this.now()), missingLevel: 0, partnerAsleep: asleep });
  }

  // ---- inputs -------------------------------------------------------------

  onRelayEvent(ev) {
    const c = this.config();
    if (ev.from === c.me.id) return; // our own echo
    if (c.partner.id && ev.from !== c.partner.id && ev.type !== 'hello') {
      this.log(`[brain] ignoring event from unknown sender "${ev.from}"`);
      return;
    }
    this.fromPartner(ev);
  }

  onIMessage(m) {
    const c = this.config();
    if (m.direction === 'in') {
      this.fromPartner({ ...m, from: c.partner.id, source: 'imessage' });
    } else {
      // She texted him from any of her devices: forward a content-free ping so his
      // computer can react. Only matched keyword names travel, never the message text.
      const ev = { type: m.type, from: c.me.id, keywords: m.keywords, tapback: m.tapback };
      this.publish(ev, describe(ev, c.me.name || 'Your love')).catch((e) => this.log(`[brain] publish: ${e.message}`));
    }
  }

  fromPartner(ev) {
    ev.at = ev.at || this.now();
    this.heard(ev);
    const c = this.config();
    const name = c.partner.name || 'your love';
    switch (ev.type) {
      case 'message':
        return this.onMessage(ev);
      case 'tapback': {
        const scene = `tapback-${ev.tapback}`;
        if (this.hasScene(scene)) return this.queue(scene, ev, 2);
        return;
      }
      case 'heart': {
        const s = this.state();
        this.setState({ gotHeartAt: this.now() });
        if (this.now() - s.sentHeartAt < c.hugWindowSec * 1000) return this.queue('hug', ev, 6, { caption: 'Perfect timing! 🫂' });
        return this.queue('heart', ev, 3);
      }
      case 'kiss':
      case 'hug':
      case 'poke':
      case 'miss-you':
        return this.queue(ev.type, ev, { kiss: 5, hug: 6, poke: 4, 'miss-you': 5 }[ev.type]);
      case 'status': {
        this.setState({ partnerStatus: { name: ev.status, at: ev.at } });
        const info = STATUSES[ev.status] || { emoji: '💬', label: `is ${ev.status}` };
        const scene = this.hasScene(`status-${ev.status}`) ? `status-${ev.status}` : 'status';
        return this.queue(scene, ev, 4, { emoji: info.emoji, status: ev.status, statusLabel: info.label });
      }
      case 'note':
        return this.queue('note', ev, 7, { note: ev.text });
      case 'jar': {
        this.setState({ noteJar: [...this.state().noteJar, { text: ev.text, at: ev.at }] });
        return this.queue('jar', ev, 1);
      }
      case 'hello': {
        if (!c.partner.id || c.partner.id === ev.from) {
          this.onHello?.({ id: ev.from, name: ev.text?.replace(/^👋\s*/, '').replace(/ paired with you$/, '') || '', character: ev.character });
        }
        return this.queue('hello', ev, 3);
      }
      case 'test':
        return this.queue(ev.status || 'message', ev, 1);
      default:
        this.log(`[brain] unknown event ${ev.type} (${name})`);
    }
  }

  onMessage(ev) {
    const c = this.config();
    const t = this.now();
    for (const k of ev.keywords || []) {
      const scene = `kw-${k}`;
      if (!this.hasScene(scene)) continue;
      // Each keyword animation at most every 10 minutes, so "miss you miss you" isn't spammy.
      if (t - (this.lastKeywordAt[k] || 0) < 10 * 60_000) continue;
      this.lastKeywordAt[k] = t;
      this.lastMsgSceneAt = t;
      return this.queue(scene, ev, 4);
    }
    this.msgTimes = this.msgTimes.filter((x) => t - x < c.combo.windowSec * 1000);
    this.msgTimes.push(t);
    if (this.msgTimes.length >= c.combo.count) {
      this.msgTimes = [];
      this.lastMsgSceneAt = t;
      return this.queue('combo', ev, 3);
    }
    if (t - this.lastMsgSceneAt >= c.cooldownSec * 1000) {
      this.lastMsgSceneAt = t;
      return this.queue('message', ev, 2);
    }
    this.log('[brain] message animation on cooldown');
  }

  queue(scene, ev, priority, extra = {}) {
    const c = this.config();
    const label = describe(ev, c.partner.name || 'your love');
    return this.play({ scene, ev, priority, label, vars: this.vars({ text: ev.text || '', ...extra }) });
  }

  // ---- outgoing -----------------------------------------------------------

  async send(type, extra = {}) {
    const c = this.config();
    const ev = { type, from: c.me.id, ...extra };
    if (type === 'heart') {
      this.setState({ sentHeartAt: this.now() });
      if (this.now() - this.state().gotHeartAt < c.hugWindowSec * 1000) {
        this.play({ scene: 'hug', ev, priority: 6, label: 'hug', vars: this.vars({ caption: 'Perfect timing! 🫂' }) });
      }
    }
    if (type === 'hello') ev.character = c.me.character;
    const text = type === 'note' || type === 'jar' ? extra.text : describe(ev, c.me.name || 'Your love');
    await this.publish(ev, text);
  }

  // ---- timers (call every ~30s) ------------------------------------------

  async tick({ idleSec = 0 } = {}) {
    if (this.busyLive) return;
    this.busyLive = true;
    try {
      await this.checkMorning(idleSec);
      await this.checkMissing();
    } finally {
      this.busyLive = false;
    }
  }

  partnerProbablyAsleep() {
    const c = this.config();
    if (this.state().partnerAsleep) return true;
    const t = timeInZone(c.partner.timezone, new Date(this.now()));
    return t ? inRange(c.partnerSleepHours, t) : false;
  }

  async checkMissing() {
    const c = this.config();
    const s = this.state();
    if (!c.partner.id || !s.lastHeardAt) {
      if (!s.lastHeardAt) this.setState({ lastHeardAt: this.now() });
      return;
    }
    if (this.partnerProbablyAsleep()) return;
    const elapsed = this.now() - s.lastHeardAt;
    const levels = [...c.missing].sort((a, b) => a.hours - b.hours);
    let level = 0;
    levels.forEach((l, i) => {
      if (elapsed >= l.hours * HOUR) level = i + 1;
    });
    if (level <= s.missingLevel) return;
    const l = levels[level - 1];
    const hours = Math.floor(elapsed / HOUR);
    const played = await this.play({ scene: l.scene, priority: 1, live: true, label: 'missing', vars: this.vars({ hours }) });
    if (played) this.setState({ missingLevel: level });
  }

  async checkMorning(idleSec) {
    const c = this.config();
    const s = this.state();
    const d = new Date(this.now());
    if (!c.morning.enabled || d.getHours() < c.morning.afterHour || s.lastMorningDate === dayKey(d)) return;
    if (idleSec > 60 || inRange(c.quietHours, d)) return; // wait until she's actually at the computer
    const jar = [...s.noteJar];
    const note = jar.shift();
    const days = daysUntil(c.visitDate, d);
    let countdown = '';
    if (days !== null && days > 0) countdown = days === 1 ? 'Tomorrow you see each other!! 🎉' : `${days} days until you see each other`;
    if (days === 0) countdown = 'TODAY IS THE DAY!! 🎉✈️';
    const big = days !== null && [0, 1, 3, 7, 14, 30, 100].includes(days);
    const scene = big && this.hasScene('countdown') ? 'countdown' : 'good-morning';
    const played = await this.play({
      scene,
      priority: 5,
      live: true,
      label: 'morning',
      vars: this.vars({ note: note?.text || '', countdown, days: days ?? '' }),
    });
    if (played) this.setState({ lastMorningDate: dayKey(d), noteJar: jar });
  }
}

module.exports = { Brain, daysUntil, dayKey };
