const SESSION_KEY = 'lesson26.storage-only.conversation.v1';

export function readConversation(storage) {
  try {
    const value = JSON.parse(storage.getItem(SESSION_KEY));
    return /^[a-f0-9]{24}$/.test(value?.id) && /^[a-f0-9]{64}$/.test(value?.token) &&
      value?.provider === 'storage-only' ? value : null;
  } catch { return null; }
}

export function saveConversation(storage, conversation) {
  // No localStorage: the capability is scoped to this browser tab's session.
  storage.setItem(SESSION_KEY, JSON.stringify({
    id: conversation.id, token: conversation.token, provider: conversation.provider,
  }));
}

export function mergeMessages(current, incoming) {
  const byId = new Map(current.map(row => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function chatRequest(path, { conversation, signal, body } = {}) {
  let response;
  try {
    response = await fetch(`/chatbot${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(conversation ? { Authorization: `Bearer ${conversation.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('No confirmed response. A write may already be stored; retry the SAME message or reload history.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Chat request failed (${response.status}).`);
  if (!data || data.provider !== 'storage-only') throw new Error('Unexpected chat response. Check the API and reload history.');
  const validId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
  const validMessage = row => row && validId(row.id) && row.role === 'user' &&
    typeof row.clientMessageId === 'string' && typeof row.text === 'string' &&
    row.text.length > 0 && row.text.length <= 2000 && typeof row.createdAt === 'string' &&
    Number.isFinite(Date.parse(row.createdAt));
  const valid = path === '/conversations' ? validId(data.id) && /^[a-f0-9]{64}$/.test(data.token) :
    body === undefined ? Array.isArray(data.messages) && data.messages.length <= 50 &&
      data.messages.every(validMessage) && (data.nextBefore === null || validId(data.nextBefore)) :
      validMessage(data.message);
  if (!valid) throw new Error('Unexpected chat payload. A write may be stored; reload history or retry the same message.');
  return data;
}
