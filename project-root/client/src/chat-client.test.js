import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConversation, saveConversation, mergeMessages, chatRequest } from './chat-client.js';

test('session restore rejects corrupt sessions and stores only capability metadata', () => {
  let saved = '{';
  const storage = { getItem: () => saved, setItem: (key, value) => { saved = value; } };
  assert.equal(readConversation(storage), null);
  assert.equal(readConversation({ getItem() { throw new Error('Blocked'); } }), null);
  const conversation = { id: 'a'.repeat(24), token: 'b'.repeat(64), provider: 'storage-only', text: 'not persisted' };
  saveConversation(storage, conversation);
  assert.deepEqual(readConversation(storage), { id: conversation.id, token: conversation.token, provider: 'storage-only' });
  assert.equal(saved.includes('not persisted'), false);
  saved = JSON.stringify({ ...conversation, provider: 'es' });
  assert.equal(readConversation(storage), null);
});

test('history and confirmed retries merge once in chronological ObjectId order', () => {
  const earlier = { id: '000000000000000000000001', text: 'First' };
  const later = { id: '000000000000000000000002', text: 'Second' };
  assert.deepEqual(mergeMessages([later], [earlier, later]), [earlier, later]);
});

test('client preserves uncertain-write semantics and refuses fabricated assistant payloads', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const conversation = { id: 'a'.repeat(24), token: 'b'.repeat(64) };
  const body = { clientMessageId: 'd2a44c55-b745-4e50-8ad0-ddfd91a477ea', text: 'Hi' };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, `/chatbot/conversations/${conversation.id}/messages`);
    assert.equal(options.headers.Authorization, `Bearer ${conversation.token}`);
    assert.deepEqual(JSON.parse(options.body), body);
    throw new TypeError('Network interrupted');
  };
  await assert.rejects(chatRequest(`/conversations/${conversation.id}/messages`, { conversation, body }), /may already be stored/);
  assert.equal(calls, 1, 'No automatic retry');
  globalThis.fetch = async () => new Response(JSON.stringify({
    provider: 'storage-only', message: { id: 'c'.repeat(24), role: 'assistant', text: 'Invented reply' },
  }), { status: 201 });
  await assert.rejects(chatRequest(`/conversations/${conversation.id}/messages`, { conversation, body }), /Unexpected chat payload/);
});
