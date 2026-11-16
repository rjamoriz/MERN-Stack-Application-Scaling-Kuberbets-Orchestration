'use strict';

const express = require('express');
const { createHash, randomBytes } = require('node:crypto');
const { connectChatStore } = require('./chat-store.cjs');

const objectId = /^[a-f0-9]{24}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = token => createHash('sha256').update(token).digest('hex');
const notice = 'Message stored; Dialogflow not configured.';
const exactBody = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) &&
  Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));

function createChatApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Browser calls go through Vite's same-origin proxy; no permissive CORS.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
        req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'Cross-site writes are not allowed.' });
    }
    next();
  });
  app.get('/healthz', (req, res) => {
    const ready = store.ready();
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'unavailable', service: 'lesson26-chat',
      database: ready ? 'connected' : 'disconnected',
      provider: 'storage-only', dialogflowConfigured: false,
    });
  });
  const json = [
    (req, res, next) => req.is('application/json') ? next() :
      res.status(415).json({ error: 'Use application/json.' }),
    express.json({ strict: true, limit: '16kb', inflate: false }),
  ];
  app.post('/conversations', ...json, async (req, res) => {
    if (!exactBody(req.body, [])) return res.status(400).json({ error: 'Expected an empty JSON object.' });
    const token = randomBytes(32).toString('hex');
    const conversation = await store.create(hash(token));
    // The raw capability is returned once and never stored or logged by the server.
    res.status(201).json({ ...conversation, token, notice });
  });
  app.use('/conversations/:id', async (req, res, next) => {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.get('Authorization') || '');
    if (!objectId.test(req.params.id) || !match ||
        !await store.authorize(req.params.id, hash(match[1]))) {
      return res.status(404).json({ error: 'Conversation unavailable or access denied.' });
    }
    next();
  });
  app.get('/conversations/:id/messages', async (req, res) => {
    const { before, limit = '50' } = req.query;
    if (Object.keys(req.query).some(key => !['before', 'limit'].includes(key)) ||
        (before !== undefined && (typeof before !== 'string' || !objectId.test(before))) ||
        typeof limit !== 'string' || !/^[1-9]\d?$/.test(limit) || Number(limit) > 50) {
      return res.status(400).json({ error: 'Use optional before: message id and limit: integer 1–50.' });
    }
    res.json({ ...await store.history(req.params.id, before, Number(limit)), provider: 'storage-only', notice });
  });
  app.post('/conversations/:id/messages', ...json, async (req, res) => {
    const body = req.body;
    if (!exactBody(body, ['clientMessageId', 'text']) ||
        typeof body.clientMessageId !== 'string' || !uuid.test(body.clientMessageId) ||
        typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) {
      return res.status(400).json({ error: 'Expected UUID v4 clientMessageId and text (1–2000 characters); no other keys.' });
    }
    const result = await store.append(req.params.id, body.clientMessageId.toLowerCase(), body.text.trim());
    if (result.conflict) return res.status(409).json({ error: 'Message id already used for different text.' });
    res.status(result.replayed ? 200 : 201).json({ ...result, provider: 'storage-only', notice });
  });
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'JSON body exceeds 16 KB.' });
    if (['encoding.unsupported', 'charset.unsupported'].includes(error.type)) {
      return res.status(415).json({ error: 'Use uncompressed UTF-8 JSON.' });
    }
    if (['entity.parse.failed', 'request.aborted', 'request.size.invalid'].includes(error.type)) {
      return res.status(400).json({ error: 'Malformed JSON body.' });
    }
    console.error('Unexpected lesson26 chat request error.');
    res.status(503).json({ error: 'Chat storage unavailable. A write may have completed; retry only with the same message id.' });
  });
  return app;
}

async function startChatApi({ port = 3004, store } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid port.');
  const owned = !store;
  store ||= await connectChatStore();
  let server;
  try {
    const app = createChatApp(store);
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(port, '127.0.0.1');
      listener.once('listening', () => resolve(listener));
      listener.once('error', reject);
    });
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    return {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      async close() {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
        if (owned) await store.close();
      },
    };
  } catch (error) {
    if (owned) await store.close();
    throw error;
  }
}

if (require.main === module) {
  startChatApi().then(api => {
    console.log(`Lesson26 storage-only chat listening at ${api.baseUrl}; Dialogflow not configured.`);
    const stop = () => api.close().catch(() => { console.error('Chat shutdown failed.'); process.exitCode = 1; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch(() => { console.error('Chat startup failed. Check local MongoDB and port 3004.'); process.exitCode = 1; });
}

module.exports = { createChatApp, startChatApi };
