'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { startChatApi } = require('./chat-api.cjs');
const { createChatModels } = require('./chat-models.cjs');
const { connectChatStore } = require('./chat-store.cjs');

function memoryStore() {
  const conversations = new Map();
  const messages = new Map();
  let counter = 0;
  const id = () => (++counter).toString(16).padStart(24, '0');
  return {
    conversations,
    ready: () => true,
    create: async tokenHash => {
      const key = id();
      conversations.set(key, tokenHash);
      return { id: key, provider: 'storage-only' };
    },
    authorize: async (key, tokenHash) => conversations.get(key) === tokenHash,
    append: async (conversationId, clientMessageId, text) => {
      const key = `${conversationId}:${clientMessageId}`;
      const existing = messages.get(key);
      if (existing) return existing.text === text ? { message: existing, replayed: true } : { conflict: true };
      const message = { id: id(), clientMessageId, text, role: 'user', createdAt: new Date().toISOString() };
      messages.set(key, message);
      return { message, replayed: false };
    },
    history: async (conversationId, before, limit) => {
      const rows = [...messages.entries()].filter(([key, row]) => key.startsWith(`${conversationId}:`) &&
        (!before || row.id < before)).map(([, row]) => row).sort((a, b) => b.id.localeCompare(a.id));
      const page = rows.slice(0, limit);
      return { messages: page.reverse(), nextBefore: rows.length > limit ? page[0].id : null };
    },
  };
}

test('strict chat schemas reject browser-assigned assistant roles and unbounded text', async () => {
  const connection = mongoose.createConnection();
  try {
    const { Conversation, Message } = createChatModels(connection);
    const input = {
      conversationId: new mongoose.Types.ObjectId(), clientMessageId: randomUUID(), role: 'user', text: 'Hello',
    };
    assert.equal(new Message(input).validateSync(), undefined);
    for (const change of [{ role: 'assistant' }, { text: ' ' }, { text: 'x'.repeat(2001) }, { clientMessageId: 'bad' }]) {
      assert.ok(new Message({ ...input, ...change }).validateSync());
    }
    assert.throws(() => new Message({ ...input, provider: 'es' }), /strict/i);
    assert.ok(new Conversation({ tokenHash: 'a'.repeat(64), provider: 'es' }).validateSync());
  } finally { await connection.close(); }
});

test('HTTP chat contract without MongoDB (in-memory test double)', { timeout: 20000 }, async t => {
  const store = memoryStore();
  const api = await startChatApi({ port: 0, store });
  t.after(() => api.close());
  async function request(path, { token, body, raw, headers = {} } = {}) {
    const response = await fetch(`${api.baseUrl}${path}`, {
      method: body === undefined && raw === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(3000),
    });
    return { status: response.status, data: await response.json() };
  }
  const json = { 'Content-Type': 'application/json' };
  const health = await request('/healthz');
  assert.equal(health.data.dialogflowConfigured, false);
  const first = await request('/conversations', { body: {}, headers: json });
  const second = await request('/conversations', { body: {}, headers: json });
  assert.equal(first.status, 201);
  const { id, token } = first.data;
  assert.notEqual(store.conversations.get(id), token);
  assert.equal(store.conversations.get(id), createHash('sha256').update(token).digest('hex'));
  const path = `/conversations/${id}/messages`;
  for (const invalidToken of [undefined, second.data.token, 'invalid']) {
    assert.equal((await request(path, { token: invalidToken })).status, 404);
  }
  const body = { clientMessageId: randomUUID(), text: 'Learn React' };
  const firstWrite = await request(path, { token, body, headers: json });
  assert.equal(firstWrite.status, 201);
  assert.equal(firstWrite.data.message.role, 'user');
  assert.equal(firstWrite.data.notice, 'Message stored; Dialogflow not configured.');
  const replay = await request(path, { token, body, headers: json });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.message.id, firstWrite.data.message.id);
  assert.equal((await request(path, { token, body: { ...body, text: 'Different' }, headers: json })).status, 409);
  assert.equal((await request(path, { token, body: { ...body, role: 'assistant' }, headers: json })).status, 400);
  for (const text of ['', ' ', 'x'.repeat(2001), 123]) {
    assert.equal((await request(path, { token, body: { ...body, text }, headers: json })).status, 400);
  }
  assert.equal((await request(path, { token, body })).status, 415);
  assert.equal((await request(path, { token, raw: '{', headers: json })).status, 400);
  assert.equal((await request(path, { token, raw: `"${'x'.repeat(17000)}"`, headers: json })).status, 413);
  assert.equal((await request('/conversations', {
    body: {}, headers: { ...json, 'Sec-Fetch-Site': 'cross-site' },
  })).status, 403);
  assert.equal((await request(`${path}?limit=51`, { token })).status, 400);
  assert.equal((await request(`${path}?before=wrong`, { token })).status, 400);
  assert.equal((await request(`${path}?limit=2&limit=3`, { token })).status, 400);
  await request(path, { token, body: { clientMessageId: randomUUID(), text: 'Second message' }, headers: json });
  const latest = await request(`${path}?limit=1`, { token });
  assert.equal(latest.data.messages[0].text, 'Second message');
  const older = await request(`${path}?limit=1&before=${latest.data.nextBefore}`, { token });
  assert.equal(older.data.messages[0].text, 'Learn React');
  assert.equal(older.data.nextBefore, null);
  assert.equal((await request(`/conversations/${second.data.id}/messages`, { token: second.data.token })).data.messages.length, 0);
});

test('real local MongoDB + HTTP: persistence, concurrent retry index, pagination and isolation', {
  skip: process.env.CHAT_MONGO_TEST !== '1', timeout: 30000,
}, async t => {
  // Opt-in writes remain in the dedicated lesson26 collections; no deletes or cleanup of user data.
  const store = await connectChatStore();
  let api;
  t.after(async () => {
    try { if (api) await api.close(); }
    finally { await store.close(); }
  });
  api = await startChatApi({ port: 0, store });
  const created = await fetch(`${api.baseUrl}/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(created.status, 201);
  const conversation = await created.json();
  const tokenHash = createHash('sha256').update(conversation.token).digest('hex');
  const other = await store.create(createHash('sha256').update(randomUUID()).digest('hex'));
  const clientMessageId = randomUUID();
  const endpoint = `${api.baseUrl}/conversations/${conversation.id}/messages`;
  const attempts = await Promise.all(Array.from({ length: 5 }, async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conversation.token}` },
      body: JSON.stringify({ clientMessageId, text: 'Lesson26 integration test: concurrent retry' }),
      signal: AbortSignal.timeout(5000),
    });
    assert.ok([200, 201].includes(response.status));
    return response.json();
  }));
  assert.equal(new Set(attempts.map(row => row.message.id)).size, 1);
  assert.equal(attempts.filter(row => !row.replayed).length, 1);
  assert.equal((await store.append(conversation.id, clientMessageId, 'Conflicting text')).conflict, true);
  await store.append(conversation.id, randomUUID(), 'Lesson26 integration test: second message');
  const reader = await connectChatStore();
  try {
    assert.ok(await reader.authorize(conversation.id, tokenHash));
    assert.equal(await reader.authorize(other.id, tokenHash), null);
    const page = await reader.history(conversation.id, undefined, 1);
    assert.equal(page.messages.length, 1);
    assert.ok(page.nextBefore);
    const older = await reader.history(conversation.id, page.nextBefore, 1);
    assert.equal(older.messages[0].clientMessageId, clientMessageId);
    assert.equal(older.nextBefore, null);
    assert.equal((await reader.history(other.id, undefined, 50)).messages.length, 0);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${conversation.token}` }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).messages.length, 2);
  } finally { await reader.close(); }
});
