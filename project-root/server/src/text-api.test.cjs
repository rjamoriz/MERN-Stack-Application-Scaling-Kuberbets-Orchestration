'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTextApi } = require('./text-api.cjs');

test('ephemeral loopback HTTP: health, predictions, retrieval and stateless conversation', async t => {
  const api = await startTextApi({ port: 0 });
  t.after(() => api.close());
  assert.match(api.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const health = await fetch(`${api.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ready');
  const post = (path, body) => fetch(`${api.baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const completion = await post('/complete', { text: 'we learn re' });
  assert.equal(completion.status, 200);
  assert.equal((await completion.json()).suggestions[0].word, 'react');
  const whitespace = await post('/complete', { text: ' ' });
  assert.deepEqual((await whitespace.json()).suggestions, []);
  const recommendation = await post('/recommend', { query: 'api validation' });
  assert.equal(recommendation.status, 200);
  assert.equal((await recommendation.json()).items[0].id, 'api');
  const first = await post('/converse', { message: 'recommend a lesson' });
  const { context } = await first.json();
  assert.equal(context, 'awaiting-topic');
  const followup = await post('/converse', { message: 'react', context });
  assert.equal((await followup.json()).intent, 'recommendation');
  const independent = await post('/converse', { message: 'react' });
  assert.equal((await independent.json()).intent, 'unknown');
});

test('HTTP rejects malformed/schema/oversized/non-JSON requests and unknown routes', async t => {
  const api = await startTextApi({ port: 0 });
  t.after(() => api.close());
  const request = (path, body, type = 'application/json') => fetch(`${api.baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': type }, body
  });
  const invalid = [
    ['/complete', '{}'], ['/complete', '[]'], ['/complete', 'null'],
    ['/complete', '{"text":'], ['/complete', '{"text":42}'],
    ['/complete', '{"text":""}'], ['/complete', JSON.stringify({ text: 'x'.repeat(501) })],
    ['/complete', '{"text":"react","extra":true}'],
    ['/recommend', '{"query":"react","context":null}'],
    ['/converse', '{"message":"react","context":"other"}'],
    ['/converse', '{"message":"react","context":1}'],
    ['/converse', '{"message":"hello","text":"extra"}'],
    ['/recommend', '{"query":null}'], ['/converse', '{}']
  ];
  for (const [path, body] of invalid) {
    const response = await request(path, body);
    assert.equal(response.status, 400, `${path}: ${body}`);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await request('/complete', JSON.stringify({ text: 'x'.repeat(1500) }))).status, 413);
  assert.equal((await request('/complete', 'hello', 'text/plain')).status, 415);
  assert.equal((await request('/missing', '{}')).status, 404);
  assert.equal((await fetch(`${api.baseUrl}/complete`)).status, 404);
});

test('HTTP startup rejects invalid ports without opening a server', async () => {
  for (const port of [-1, 65536, 1.2, '3002', NaN]) {
    await assert.rejects(startTextApi({ port }), RangeError);
  }
});
