const express = require('express');
const path = require('node:path');
const { loadHousePriceModel, isValidSize } = require('./house-price-model.cjs');

async function startInferenceApi({ modelDir, port = 3001 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('PORT must be an integer between 0 and 65535.');
  }
  const predictor = await loadHousePriceModel(modelDir);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1kb', strict: false }));
  app.get('/healthz', (req, res) => res.json({ status: 'ready', model: 'tuned-house-price' }));
  app.post('/predict', (req, res, next) => {
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json.' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !Object.hasOwn(body, 'sizeSqFt') ||
        !isValidSize(body.sizeSqFt)) {
      return res.status(400).json({
        error: 'Expected {"sizeSqFt": number}, with a finite number between 1 and 100000.'
      });
    }
    try {
      return res.json(predictor.predict(body.sizeSqFt));
    } catch (error) {
      return next(error);
    }
  });
  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body.' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'JSON body exceeds the 1 KB limit.' });
    }
    console.error('Inference request failed:', error);
    return res.status(500).json({ error: 'Inference failed. See server logs.' });
  });
  let httpServer;
  try {
    httpServer = await new Promise((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1');
      server.once('listening', () => resolve(server));
      server.once('error', reject);
    });
  } catch (error) {
    predictor.dispose();
    throw error;
  }
  return {
    baseUrl: `http://127.0.0.1:${httpServer.address().port}`,
    async close() {
      try {
        await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
      } finally {
        predictor.dispose();
      }
    }
  };
}

if (require.main === module) {
  const port = process.env.PORT === undefined ? 3001 : Number(process.env.PORT);
  const modelDir = process.env.MODEL_DIR || path.resolve(__dirname, '..', 'models', 'tuned-house-price');
  startInferenceApi({ modelDir, port }).then(api => {
    console.log(`Inference API listening at ${api.baseUrl}`);
    const stop = () => api.close().catch(error => { console.error(error); process.exitCode = 1; });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch(error => { console.error('API startup failed:', error); process.exitCode = 1; });
}

module.exports = { startInferenceApi };
