// Send an event as if you were the other person — handy for testing.
//   node tools/send.js --server http://127.0.0.1:8787 --topic ba-xxx --from her kiss
//   node tools/send.js ... status hungry
//   node tools/send.js ... note "you are my favorite"
const { Relay } = require('../src/main/relay');
const { describe } = require('../src/main/catalog');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const server = opt('server', 'https://ntfy.sh');
const topic = opt('topic');
const from = opt('from', 'test');
const name = opt('name', from);
const [type, arg] = args;
if (!topic || !type) {
  console.error('usage: node tools/send.js --topic <topic> [--server url] [--from id] <type> [status|text]');
  process.exit(1);
}

const ev = { type, from };
if (type === 'status') ev.status = arg;
if (type === 'message' && arg) ev.keywords = arg.split(',');
if (type === 'tapback') ev.tapback = arg || 'love';
if (type === 'test') ev.status = arg;
const text = ['note', 'jar'].includes(type) ? arg : type === 'hello' ? `👋 ${name} paired with you` : describe(ev, name);

const relay = new Relay({ getConfig: () => ({ relay: { server, topic, token: '' } }), getSince: () => '', setSince: () => {} });
relay
  .publish(ev, text)
  .then(() => console.log(`sent ${type}${arg ? ` (${arg})` : ''}`))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
