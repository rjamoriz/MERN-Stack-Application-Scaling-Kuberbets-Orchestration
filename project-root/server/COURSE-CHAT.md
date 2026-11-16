# Lesson 26 — persistent React chat, before cloud inference

## What is implemented

`client/src/components/CourseChat.jsx` is rendered by the existing `App` in `client/src/main.jsx`. All previous demos remain. Browser requests use `/chatbot`; Vite proxies only that prefix to the separate Express service on **127.0.0.1:3004**. Existing services on 3001, 3002 and 3003 are unchanged.

This checkpoint is deliberately **storage-only**. The server stores user messages and reports **“Message stored; Dialogflow not configured.”** It does not generate assistant messages, call Google, substitute the local NLP lesson, or claim that ES/CX authentication exists. Lesson 26's earlier Google Cloud instructions are preparation, not evidence of a connected agent. No cloud SDK, credential, or additional dependency is needed for this checkpoint.

## Start the application

MongoDB must already be running on `127.0.0.1:27017`. In separate terminals:

```sh
cd project-root/server
node src/chat-api.cjs
```

```sh
cd project-root/client
npm run dev
```

Open `http://127.0.0.1:5173`, find **Persistent course chat**, click **Create chat**, and store a message. Reload the page: the same tab restores its conversation capability from `sessionStorage` and fetches its saved history. **Start a separate chat** creates isolated history; it does not delete the old conversation. If a response is interrupted, reload history or explicitly retry the **same** message. The UI retains that message's id and text until acknowledgement; it never silently resends. Reloading the page discards an unconfirmed retry id, so inspect restored history before composing it again.

Only the latest 50 messages load initially. **Load older messages** uses an exclusive ObjectId cursor; **Reload latest history** resets the view to the newest page. Message text renders as ordinary React text, never raw HTML.

## Follow the data, not just the UI

1. `POST /conversations` accepts exactly `{}` and returns a random 256-bit capability once.
2. The browser keeps only its conversation id, capability and provider in tab-session storage. Losing that capability loses access; there is no recovery/list-all endpoint.
3. Every history or write request needs `Authorization: Bearer <capability>`. The server compares its SHA-256 hash scoped to the requested conversation. Missing, unknown and unauthorized conversations all return 404.
4. `chat-models.cjs` uses strict, timestamped Mongoose schemas in **mern_ai_course.lesson26_conversations** and **mern_ai_course.lesson26_messages** only. The server deliberately hardcodes the approved local database. No existing data is deleted.
5. Messages are separate documents, not an unbounded embedded array. Each has a conversation id, UUID v4 client id, server-selected `user` role and 1–2,000-character text. The browser cannot supply an assistant role or provider.
6. A unique compound index on `(conversationId, clientMessageId)` guarantees one stored message under concurrent retries. Replaying the same id/text returns 200 with the original message; different text returns 409. Initial writes return 201. This is storage idempotency, not a promise of future exactly-once cloud inference.
7. History queries are indexed, cursor-paginated and bounded to 1–50 documents per response. Their `nextBefore` cursor is the oldest returned id when another page exists. Each page is returned oldest-first for display.

The health endpoint reports database connection state separately from the disabled cloud provider. Startup waits for MongoDB and indexes; failed startup never binds the port. `/healthz` is connection readiness, not a guarantee that every later database write succeeds. Input errors use 400/413/415; unexpected storage failures use generic 503 without logging tokens, text or exception messages. A 503 or lost response can occur **after** a write committed, which is why retry ids matter.

## Manual API examples (curl or Postman)

```sh
curl -sS http://127.0.0.1:3004/healthz
curl -sS -X POST http://127.0.0.1:3004/conversations \
  -H 'Content-Type: application/json' -d '{}'
```

Keep the returned `id` and `token` private. Substitute them in a local Postman Bearer authorization field or the following commands. Do not share screenshots containing tokens or put real tokens into source control.

```sh
curl -sS -X POST http://127.0.0.1:3004/conversations/CONVERSATION_ID/messages \
  -H 'Authorization: Bearer TOKEN' -H 'Content-Type: application/json' \
  -d '{"clientMessageId":"d2a44c55-b745-4e50-8ad0-ddfd91a477ea","text":"Help me learn React"}'
curl -sS 'http://127.0.0.1:3004/conversations/CONVERSATION_ID/messages?limit=20' \
  -H 'Authorization: Bearer TOKEN'
```

Repeating the exact POST is safe. For a new message use a **new UUID v4** (the UI uses `crypto.randomUUID()`). A new conversation needs its own token. Use `/chatbot/…` instead of the direct API URL when sending through Vite.

## Focused validation — no build

The appended notebook cell displays the real files and runs these commands with deadlines:

```sh
# server/ — schema and HTTP tests use an in-memory store, not real persistence
node --test src/chat-api.test.cjs
# client/ — existing course tests plus session, merge and HTTP-client tests
node --test src/course-learning.test.js src/chat-client.test.js
# server/ — explicit opt-in REAL local MongoDB persistence/index test
CHAT_MONGO_TEST=1 node --test src/chat-api.test.cjs
```

The real integration test creates a conversation through HTTP, sends concurrent duplicate requests through the real API, opens an independent MongoDB reader, and exercises conflict detection, isolation, pagination and HTTP history retrieval. It writes labeled test messages only into the dedicated lesson collections. Those records intentionally remain; there is **no broad cleanup or deletion**. Default tests skip the real MongoDB case. Tests are delivered, not claimed to have passed until notebook output confirms them.

The notebook also has a bounded temporary API health check that closes its listener and owned MongoDB connection. It does not leave a permanent API running. No production build or cloud request is part of validation. Browser interaction, responsiveness, keyboard navigation and reloading should be checked manually; helper tests are not a mounted React/browser test.

## Security and next checkpoint

This is a **private loopback learning lab**, not production authentication. A capability is a bearer secret; same-origin scripts/XSS can access session storage, and a duplicated browser tab may inherit it. Session storage is not encryption. The server binds only loopback, disables caching, limits JSON size, rejects browser-declared cross-site writes and does not enable CORS. These measures do not replace HTTPS, user accounts, quotas/rate limits, retention policies or XSS protection. Storage is durable and has no automatic expiry; do not enter sensitive data.

ES/CX integration remains pending confirmed project/agent/location configuration and server-side credentials. A future adapter must bind an immutable provider to a fresh conversation, use its own Dialogflow session, persist only verified server-generated assistant output, and distinguish a stored user message from a failed provider call. Never send ADC credentials to React, silently switch providers, or replay a cloud call just because storage was retried.
