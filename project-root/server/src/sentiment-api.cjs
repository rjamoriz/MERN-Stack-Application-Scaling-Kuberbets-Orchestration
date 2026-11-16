'use strict';

const express = require('express');
const {
  DEFAULT_MODEL_DIR,
  MAX_TEXT_LENGTH,
  MODEL_ID,
  SentimentInputError,
  loadSentimentModel
} = require('./sentiment-model.cjs');

const DEFAULT_PORT = 3003;
const BODY_LIMIT = '8kb';

function createSentimentMiddleware(classifier) {
  // Keep inference in one middleware so request validation, model work, and response formatting stay separate.
  return async (req, res, next) => {
    try {
      res.locals.classification = await classifier.classify(req.body.text);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json.' });
  }
  return next();
}

function validateRequest(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'text') ||
      !Object.hasOwn(body, 'text') || typeof body.text !== 'string' ||
      body.text.trim().length === 0 || body.text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({
      error: `Expected exactly { "text": string } with 1–${MAX_TEXT_LENGTH} characters.`
    });
  }
  return next();
}

function createSentimentApp(classifier) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (req, res) => res.json({
    status: 'ready',
    model: MODEL_ID,
    maxLength: classifier.metadata.max_len
  }));

  const json = express.json({ strict: true, limit: BODY_LIMIT, inflate: false });
  // Keep the pipeline explicit: media type, bounded parse, input validation, inference, response.
  app.post(
    '/classify',
    requireJson,
    json,
    validateRequest,
    createSentimentMiddleware(classifier),
    (req, res) => res.json(res.locals.classification)
  );

  app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }
    if (error instanceof SentimentInputError) {
      const message = error.reason === 'no-tokens'
        ? 'Text contains no usable tokens.'
        : 'Text contains no known model-vocabulary words.';
      return res.status(422).json({ error: message });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: `JSON body exceeds the ${BODY_LIMIT} limit.` });
    }
    if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
      return res.status(415).json({ error: 'Use uncompressed UTF-8 application/json.' });
    }
    if (error.type === 'entity.parse.failed' || error.type === 'request.aborted' ||
        error.type === 'request.size.invalid') {
      return res.status(400).json({ error: 'Malformed JSON body.' });
    }

    // Do not log request content, exception messages, or other data that could reveal user text.
    console.error('Unexpected sentiment API error.');
    return res.status(500).json({ error: 'Sentiment request failed. See server logs.' });
  });
  return app;
}

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

async function startSentimentApi({
  modelDir = DEFAULT_MODEL_DIR,
  port = DEFAULT_PORT
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('port must be an integer between 0 and 65535.');
  }

  let classifier;
  try {
    classifier = await loadSentimentModel(modelDir);
    const server = await listen(createSentimentApp(classifier), port);
    let closePromise;
    return {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      close() {
        if (!closePromise) {
          closePromise = new Promise((resolve, reject) => {
            // Let in-flight requests finish, but do not wait indefinitely on a client socket.
            const deadline = setTimeout(() => server.closeAllConnections(), 2000);
            deadline.unref();
            server.close(error => {
              clearTimeout(deadline);
              return error ? reject(error) : resolve();
            });
            server.closeIdleConnections();
          }).finally(() => classifier.dispose());
        }
        return closePromise;
      }
    };
  } catch (error) {
    if (classifier) {
      classifier.dispose();
    }
    throw error;
  }
}

if (require.main === module) {
  const port = process.env.PORT === undefined ? DEFAULT_PORT : Number(process.env.PORT);
  startSentimentApi({ port }).then(api => {
    console.log(`Local sentiment API listening at ${api.baseUrl}`);
    const stop = () => api.close().catch(() => {
      console.error('Sentiment API shutdown failed.');
      process.exitCode = 1;
    });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  }).catch(() => {
    console.error('Sentiment API startup failed. Check PORT and the downloaded model artifacts.');
    process.exitCode = 1;
  });
}

module.exports = {
  BODY_LIMIT,
  DEFAULT_PORT,
  createSentimentApp,
  createSentimentMiddleware,
  startSentimentApi
};
