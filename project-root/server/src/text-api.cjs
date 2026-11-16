'use strict';

const express = require('express');
const { predictText, recommendText, converse } = require('./course-nlp.cjs');

async function startTextApi({ port = 3002 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('port must be an integer between 0 and 65535.');
  }
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (req, res) => res.json({ status: 'ready', service: 'course-nlp', localOnly: true }));
  const json = express.json({ strict: true, limit: '1kb', inflate: false });
  const routes = [
    { path: '/complete', field: 'text', run: body => predictText(body.text) },
    { path: '/recommend', field: 'query', run: body => recommendText(body.query) },
    { path: '/converse', field: 'message', run: body => converse(body.message, body.context ?? null) }
  ];
  for (const route of routes) {
    app.post(route.path, (req, res, next) => {
      if (!req.is('application/json')) {
        return res.status(415).json({ error: 'Content-Type must be application/json.' });
      }
      return next();
    }, json, (req, res) => {
      const body = req.body;
      const allowed = route.field === 'message' ? ['message', 'context'] : [route.field];
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !allowed.includes(key)) ||
          !Object.hasOwn(body, route.field) ||
          typeof body[route.field] !== 'string' ||
          body[route.field].length < 1 || body[route.field].length > 500 ||
          (route.field === 'message' && Object.hasOwn(body, 'context') &&
            body.context !== null && body.context !== 'awaiting-topic')) {
        return res.status(400).json({ error: `Expected ${route.field}: string (1–500 characters)${
          route.field === 'message' ? ', optional context: null or "awaiting-topic"' : ''}; no other keys.` });
      }
      return res.json(route.run(body));
    });
  }
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'JSON body exceeds the 1 KB limit.' });
    }
    if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
      return res.status(415).json({ error: 'Use uncompressed UTF-8 application/json.' });
    }
    if (error.type === 'entity.parse.failed' || error.type === 'request.aborted' ||
        error.type === 'request.size.invalid') {
      return res.status(400).json({ error: 'Malformed JSON body.' });
    }
    // Never log the body, query text, or an exception message that could include it.
    console.error('Unexpected course NLP API error.');
    return res.status(500).json({ error: 'Text request failed. See server logs.' });
  });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, '127.0.0.1');
    listener.once('listening', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

if (require.main === module) {
  startTextApi().then(api => {
    console.log(`Local course NLP API listening at ${api.baseUrl}`);
    const stop = () => api.close().catch(() => { console.error('Text API shutdown failed.'); process.exitCode = 1; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch(() => { console.error('Text API startup failed.'); process.exitCode = 1; });
}

module.exports = { startTextApi };
