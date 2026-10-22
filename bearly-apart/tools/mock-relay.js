// A tiny ntfy-compatible server for testing offline: npm run mock-relay  (listens on :8787)
// Supports POST /<topic> and GET /<topic>/json?since=<id|unix-seconds>, which is all the app uses.
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const topics = new Map(); // topic -> { messages: [], subs: Set<res> }

function topic(name) {
  if (!topics.has(name)) topics.set(name, { messages: [], subs: new Set() });
  return topics.get(name);
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'POST' && parts.length === 1) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const t = topic(parts[0]);
        const msg = {
          id: crypto.randomBytes(6).toString('hex'),
          time: Math.floor(Date.now() / 1000),
          event: 'message',
          topic: parts[0],
          message: body,
          title: req.headers.title || undefined,
          tags: req.headers.tags ? String(req.headers.tags).split(',').map((s) => s.trim()) : undefined,
        };
        t.messages.push(msg);
        for (const s of t.subs) s.write(JSON.stringify(msg) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(msg));
        console.log(`[mock-relay] ${parts[0]} ← ${msg.tags?.join(',')} "${body}"`);
      });
      return;
    }
    if (req.method === 'GET' && parts.length === 2 && parts[1] === 'json') {
      const t = topic(parts[0]);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ id: crypto.randomBytes(6).toString('hex'), time: Math.floor(Date.now() / 1000), event: 'open', topic: parts[0] }) + '\n');
      const since = url.searchParams.get('since');
      if (since) {
        const idx = t.messages.findIndex((m) => m.id === since);
        const backlog = idx >= 0 ? t.messages.slice(idx + 1) : /^\d+$/.test(since) ? t.messages.filter((m) => m.time >= Number(since)) : [];
        for (const m of backlog) res.write(JSON.stringify(m) + '\n');
      }
      t.subs.add(res);
      const ka = setInterval(() => res.write(JSON.stringify({ event: 'keepalive', time: Math.floor(Date.now() / 1000) }) + '\n'), 30_000);
      req.on('close', () => {
        clearInterval(ka);
        t.subs.delete(res);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`[mock-relay] listening on http://127.0.0.1:${PORT}`));
}

module.exports = { createServer };
