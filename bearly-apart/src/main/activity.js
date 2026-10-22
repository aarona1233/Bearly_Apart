// The "Recent" list in the app: what you sent (and whether it arrived at the relay) and what came in.
// Kept in memory only; it's for "did that go through?", not history.
const { EventEmitter } = require('events');

class Activity extends EventEmitter {
  constructor({ max = 15, now = () => Date.now() } = {}) {
    super();
    this.max = max;
    this.now = now;
    this.items = [];
    this.nextId = 1;
  }

  // entry: { dir: 'in'|'out', text, state?: 'sending'|'sent'|'failed', error? }
  add(entry) {
    const item = { id: this.nextId++, at: this.now(), ...entry };
    this.items.unshift(item);
    this.items.length = Math.min(this.items.length, this.max);
    this.emit('change');
    return item.id;
  }

  update(id, patch) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this.emit('change');
  }
}

module.exports = { Activity };
