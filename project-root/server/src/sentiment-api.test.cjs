'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
if (process.env.SENTIMENT_DIAGNOSTICS === '1') {
  console.error('[sentiment-test] importing native backend');
}
const tf = require('@tensorflow/tfjs-node');
if (process.env.SENTIMENT_DIAGNOSTICS === '1') {
  console.error('[sentiment-test] native backend imported');
}
const { startSentimentApi } = require('./sentiment-api.cjs');
const { encodeSentimentText } = require('./sentiment-model.cjs');

const modelDir = path.resolve(__dirname, '../models/pretrained-sentiment-v1');
const testMetadata = {
  index_from: 3,
  max_len: 3,
  vocabulary_size: 10,
  word_index: { good: 1, bad: 2, movie: 3 }
};

function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
}

test('sentiment API course example', { timeout: 60000 }, async t => {
  const tensorsBeforeModel = tf.memory().numTensors;
  let api;

  t.after(async () => {
    if (api) {
      await api.close();
    }
    assert.equal(tf.memory().numTensors, tensorsBeforeModel, 'model and inference tensors should be released');
  }, { timeout: 5000 });

  t.diagnostic('sentiment startup: loading model and warming native inference');
  api = await startSentimentApi({ modelDir, port: 0 });
  t.diagnostic('sentiment startup: listener ready');

  await t.test('encodes, pre-pads, and truncates with explicit OOV accounting', { timeout: 15000 }, () => {
    const encoded = encodeSentimentText('good bad movie good', testMetadata);
    assert.deepEqual(encoded, {
      sequence: [5, 6, 4],
      tokenCount: 3,
      oovCount: 0,
      truncated: true
    });

    const padded = encodeSentimentText('good unknown', testMetadata);
    assert.deepEqual(padded.sequence, [0, 4, 2]);
    assert.equal(padded.oovCount, 1);
    assert.equal(padded.truncated, false);
  });

  await t.test('does not treat inherited vocabulary properties as words', { timeout: 15000 }, () => {
    const metadata = {
      ...testMetadata,
      word_index: Object.assign(Object.create({ good: 1 }), { bad: 2 })
    };
    const encoded = encodeSentimentText('good bad', metadata);
    assert.deepEqual(encoded.sequence, [0, 2, 5]);
    assert.equal(encoded.oovCount, 1);
  });

  await t.test('rejects all-OOV input and replaces indices outside the actual embedding', { timeout: 15000 }, () => {
    assert.throws(
      () => encodeSentimentText('unknown', testMetadata),
      error => error.name === 'SentimentInputError' && error.reason === 'all-oov'
    );
    const metadata = { ...testMetadata, word_index: { good: 1, outside: 7 } };
    assert.deepEqual(encodeSentimentText('outside good', metadata), {
      sequence: [0, 2, 4], tokenCount: 2, oovCount: 1, truncated: false
    });
  });

  await t.test('health reports ready only after loading and warming the model', { timeout: 15000 }, async () => {
    const response = await request(`${api.baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ready',
      model: 'imdb-sentiment-cnn-v1',
      maxLength: 100
    });
  });

  await t.test('positive and negative review examples return the documented response shape', { timeout: 15000 }, async () => {
    for (const text of [
      'This movie was excellent, warm, and wonderfully acted.',
      'The movie was awful, dull, and painfully disappointing.'
    ]) {
      const response = await request(`${api.baseUrl}/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text })
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(Object.keys(result).sort(), [
        'label', 'model', 'oovCount', 'score', 'threshold', 'tokenCount', 'truncated'
      ]);
      assert.equal(result.model, 'imdb-sentiment-cnn-v1');
      assert.ok(Number.isFinite(result.score) && result.score >= 0 && result.score <= 1);
      assert.equal(result.threshold, 0.5);
      assert.ok(['positive', 'negative'].includes(result.label));
      assert.equal(result.label, result.score >= result.threshold ? 'positive' : 'negative');
      assert.ok(Number.isInteger(result.tokenCount) && result.tokenCount >= 1 && result.tokenCount <= 100);
      assert.ok(Number.isInteger(result.oovCount) && result.oovCount >= 0 && result.oovCount <= result.tokenCount);
      assert.equal(typeof result.truncated, 'boolean');
      assert.equal(JSON.stringify(result).includes(text), false);
    }
  });

  await t.test('rejects invalid object shapes and empty text without echoing input', { timeout: 15000 }, async () => {
    const cases = [
      { body: { text: 'private review', extra: true }, expectedStatus: 400 },
      { body: { text: '' }, expectedStatus: 400 },
      { body: { text: '   ' }, expectedStatus: 400 },
      { body: { text: 42 }, expectedStatus: 400 }
    ];

    for (const { body, expectedStatus } of cases) {
      const response = await request(`${api.baseUrl}/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const responseText = await response.text();
      assert.equal(response.status, expectedStatus);
      assert.equal(responseText.includes('private review'), false);
    }
  });

  await t.test('returns 400 for malformed JSON and 415 for non-JSON media types', { timeout: 15000 }, async () => {
    const malformed = await request(`${api.baseUrl}/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"text":'
    });
    await malformed.arrayBuffer();
    assert.equal(malformed.status, 400);

    const wrongMedia = await request(`${api.baseUrl}/classify`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"text":"good"}'
    });
    await wrongMedia.arrayBuffer();
    assert.equal(wrongMedia.status, 415);
  });

  await t.test('returns 413 for a body over 8 KB and 422 for text with no usable known words', { timeout: 15000 }, async () => {
    const tooLarge = await request(`${api.baseUrl}/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(9000) })
    });
    await tooLarge.arrayBuffer();
    assert.equal(tooLarge.status, 413);

    const allOov = await request(`${api.baseUrl}/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'zzqvunlikelywordqvzz' })
    });
    await allOov.arrayBuffer();
    assert.equal(allOov.status, 422);

    const punctuation = await request(`${api.baseUrl}/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '!!! , .' })
    });
    await punctuation.arrayBuffer();
    assert.equal(punctuation.status, 422);
  });

  await t.test('returns JSON 404 for an unknown route', { timeout: 15000 }, async () => {
    const response = await request(`${api.baseUrl}/not-a-route`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Route not found.' });
  });

  await t.test('repeated inference does not accumulate tensors or reload the model', { timeout: 15000 }, async () => {
    const stableTensorCount = tf.memory().numTensors;
    for (let index = 0; index < 20; index += 1) {
      const response = await request(`${api.baseUrl}/classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'A moving and memorable film.' })
      });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.equal(tf.memory().numTensors, stableTensorCount);
  });

  await t.test('missing model artifacts fail before a listener is created', { timeout: 15000 }, async () => {
    const stableTensorCount = tf.memory().numTensors;
    await assert.rejects(
      startSentimentApi({
        modelDir: path.join(__dirname, '../models/not-present'),
        port: 0
      }),
      /Sentiment model artifacts are missing or invalid/
    );
    assert.equal(tf.memory().numTensors, stableTensorCount);
  });
});
