import React, { useEffect, useRef, useState } from 'react';
import { chatRequest, mergeMessages, readConversation, saveConversation } from '../chat-client.js';

export default function CourseChat() {
  const [conversation, setConversation] = useState(() => {
    try { return readConversation(window.sessionStorage); } catch { return null; }
  });
  const [messages, setMessages] = useState([]);
  const [before, setBefore] = useState(null);
  const [text, setText] = useState('');
  const [pendingMessage, setPendingMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Storage-only mode. Dialogflow is not configured.');
  const [sessionWarning, setSessionWarning] = useState('');
  const active = useRef(null);
  const locked = useRef(false);
  const generation = useRef(0);

  // StrictMode remounts and conversation changes must not publish stale history.
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    active.current?.abort();
    active.current = controller;
    setMessages([]);
    setBefore(null);
    setLoaded(false);
    setError('');
    setBusy(Boolean(conversation));
    if (conversation) {
      chatRequest(`/conversations/${conversation.id}/messages`, { conversation, signal: controller.signal })
        .then(data => {
          if (version !== generation.current || controller.signal.aborted) return;
          setMessages(data.messages);
          setBefore(data.nextBefore);
          setLoaded(true);
          setStatus('History loaded. Message storage only; no AI replies.');
        }).catch(error => {
          if (!controller.signal.aborted && version === generation.current) setError(error.message);
        }).finally(() => {
          if (!controller.signal.aborted && version === generation.current) setBusy(false);
        });
    }
    return () => { ++generation.current; controller.abort(); active.current?.abort(); };
  }, [conversation]);

  async function perform(task) {
    if (locked.current || busy) return;
    locked.current = true;
    const controller = new AbortController();
    active.current = controller;
    const version = generation.current;
    setBusy(true);
    setError('');
    try {
      await task(controller.signal, () => !controller.signal.aborted && version === generation.current);
    } catch (error) {
      if (!controller.signal.aborted && version === generation.current) setError(error.message);
    } finally {
      locked.current = false;
      if (!controller.signal.aborted && version === generation.current) setBusy(false);
    }
  }

  function newChat() {
    // An explicit click creates a conversation; an effect never creates one.
    perform(async (signal, current) => {
      const created = await chatRequest('/conversations', { signal, body: {} });
      if (!current()) return;
      try { saveConversation(window.sessionStorage, created); setSessionWarning(''); }
      catch {
        setSessionWarning('Session storage unavailable: this chat will not survive reload. Token remains in memory only.');
      }
      setPendingMessage(null);
      setText('');
      setConversation(created);
    });
  }

  function loadHistory(older = false) {
    perform(async (signal, current) => {
      const suffix = older && before ? `?before=${before}` : '';
      const data = await chatRequest(`/conversations/${conversation.id}/messages${suffix}`, { conversation, signal });
      if (!current()) return;
      setMessages(rows => older ? mergeMessages(rows, data.messages) : data.messages);
      setBefore(data.nextBefore);
      setLoaded(true);
      setStatus('History loaded. Any uncertain send keeps its original retry id.');
    });
  }

  function send(event) {
    event.preventDefault();
    if (!conversation || !loaded || busy || (!pendingMessage && !text.trim())) return;
    // Keep the exact id AND text after any uncertain response; never silently resend.
    const outgoing = pendingMessage || { clientMessageId: crypto.randomUUID(), text: text.trim() };
    setPendingMessage(outgoing);
    perform(async (signal, current) => {
      const data = await chatRequest(`/conversations/${conversation.id}/messages`, {
        conversation, signal, body: outgoing,
      });
      if (!current()) return;
      setMessages(rows => mergeMessages(rows, [data.message]));
      setPendingMessage(null);
      setText('');
      setStatus(data.notice);
    });
  }

  return (
    <section aria-labelledby="course-chat-heading">
      <p className="eyebrow">Lesson 26 / React → Express → MongoDB</p>
      <h2 id="course-chat-heading">Persistent course chat</h2>
      <p className="warning">Storage-only mode: messages are saved locally. Dialogflow ES/CX is NOT connected.
        There are no generated assistant replies.</p>
      <div className="actions">
        <button type="button" disabled={busy} onClick={newChat}>
          {conversation ? 'Start a separate chat' : 'Create chat'}
        </button>
        {conversation && <button type="button" disabled={busy} onClick={() => loadHistory()}>Reload latest history</button>}
        {before && <button type="button" disabled={busy} onClick={() => loadHistory(true)}>Load older messages</button>}
      </div>
      <p role="status">{busy ? 'Waiting for local chat storage…' : status}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {sessionWarning && <p className="warning">{sessionWarning}</p>}
      <ol className="course-chat-history" aria-label="Saved conversation messages" aria-live="polite" aria-busy={busy}>
        {messages.map(message => <li key={message.id}>
          <strong>You</strong> <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('en-US')}</time>
          <p>{message.text}</p>
        </li>)}
      </ol>
      {loaded && messages.length === 0 && <p>No saved messages yet.</p>}
      <form onSubmit={send} className="course-chat-form">
        <label htmlFor="course-chat-message">Your message (maximum 2,000 characters)</label>
        <textarea id="course-chat-message" rows="3" maxLength={2000} value={text}
          disabled={busy || Boolean(pendingMessage) || !loaded} onChange={event => setText(event.target.value)} />
        <button disabled={busy || !loaded || (!pendingMessage && !text.trim())}>
          {pendingMessage ? 'Retry same message safely' : 'Store message'}
        </button>
      </form>
      {pendingMessage && <p className="warning">Delivery is not yet confirmed. Reload history or explicitly retry
        this same message; its id prevents duplicate storage. Starting a separate chat leaves the old message unchanged.</p>}
      <p className="note">Only the latest 50 messages load initially. A tab-session capability authorizes this conversation;
        clearing session storage loses access. New chats do not reuse history. This is a private loopback lab, not production
        login or encryption. Do not enter sensitive information.</p>
    </section>
  );
}
