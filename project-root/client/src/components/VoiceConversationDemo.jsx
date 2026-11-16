import React, { useEffect, useRef, useState } from 'react';
import { nlpApi, nlpError } from '../nlp-client.js';

export default function VoiceConversationDemo() {
  const [message, setMessage] = useState('');
  const [context, setContext] = useState(null);
  const [turns, setTurns] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef(null);
  const request = useRef(null);
  const utterance = useRef(null);
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canSpeak = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  const lastReply = [...turns].reverse().find(turn => turn.role === 'Tutor')?.text;

  function stopListening() {
    const active = recognition.current;
    recognition.current = null;
    if (active) {
      // Remove callbacks before aborting: reset/unmount must not resurrect stale transcripts.
      active.onresult = active.onerror = active.onend = null;
      active.abort();
    }
    setListening(false);
  }
  function stopSpeaking() {
    if (utterance.current) {
      utterance.current.onerror = null;
      window.speechSynthesis.cancel();
      utterance.current = null;
    }
  }
  useEffect(() => () => {
    request.current?.abort();
    const active = recognition.current;
    if (active) {
      active.onresult = active.onerror = active.onend = null;
      active.abort();
    }
    if (utterance.current) {
      utterance.current.onerror = null;
      window.speechSynthesis.cancel();
    }
  }, []);

  async function send(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || text.length > 500) {
      setError('Enter a message between 1 and 500 characters.');
      return;
    }
    stopListening();
    stopSpeaking();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    try {
      const { data } = await nlpApi.post('/converse', { message: text, context }, { signal: controller.signal });
      if (typeof data?.reply !== 'string' || typeof data.intent !== 'string' ||
          ![null, 'awaiting-topic'].includes(data.context)) {
        throw new Error('The conversation API returned an unexpected response.');
      }
      if (request.current !== controller) return;
      // Explicit context enables a follow-up without storing conversation data on the server.
      setContext(data.context);
      setTurns(previous => [...previous, { role: 'You', text }, { role: 'Tutor', text: data.reply }].slice(-10));
      setMessage('');
    } catch (failure) {
      if (request.current === controller) setError(nlpError(failure));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  function startListening() {
    if (!Recognition || !consent) return;
    stopSpeaking();
    setError('');
    const active = new Recognition();
    recognition.current = active;
    active.lang = 'en-US';
    active.continuous = false;
    active.interimResults = false;
    active.onresult = event => {
      if (recognition.current !== active) return;
      const transcript = event.results[0]?.[0]?.transcript;
      if (typeof transcript === 'string' && transcript.trim()) setMessage(transcript);
      else setError('No transcript was recognized. Try again or type your message.');
    };
    active.onerror = event => {
      if (recognition.current === active) setError(`Speech recognition failed (${event.error}). You can still type.`);
    };
    active.onend = () => {
      if (recognition.current === active) {
        recognition.current = null;
        setListening(false);
      }
    };
    try {
      setListening(true);
      active.start();
    } catch (failure) {
      recognition.current = null;
      setListening(false);
      setError(`Cannot start speech recognition: ${failure.message}`);
    }
  }

  function readReply() {
    if (!canSpeak || !lastReply) return;
    stopListening();
    stopSpeaking();
    const speech = new window.SpeechSynthesisUtterance(lastReply);
    utterance.current = speech;
    speech.lang = 'en-US';
    speech.onerror = event => {
      if (utterance.current === speech) setError(`Speech playback failed (${event.error}). Read the text reply instead.`);
    };
    speech.onend = () => { if (utterance.current === speech) utterance.current = null; };
    window.speechSynthesis.speak(speech);
  }

  function reset() {
    request.current?.abort();
    request.current = null;
    stopListening();
    stopSpeaking();
    setPending(false);
    setContext(null);
    setTurns([]);
    setMessage('');
    setError('');
  }

  return (
    <section aria-labelledby="voice-heading">
      <p className="eyebrow">06 / Voice + conversational interfaces</p>
      <h2 id="voice-heading">Talk to a small course assistant</h2>
      <p>Try “hello”, “help”, or “recommend a lesson”, followed by “react”. Replies come from explicit intent rules, not a generative chatbot.</p>
      <p className="warning">Optional speech recognition may send audio to your browser/platform's speech service. It is not guaranteed offline. Review the transcript before sending it to the local NLP API.</p>
      <label className="consent"><input type="checkbox" checked={consent} onChange={event => {
        setConsent(event.target.checked);
        if (!event.target.checked) stopListening();
      }} />I understand the speech-service privacy notice and want to enable microphone controls.</label>
      {!Recognition && <p>Speech recognition is unavailable in this browser. Typed conversation remains available.</p>}
      <div className="actions">
        <button onClick={startListening} disabled={!Recognition || !consent || listening || pending}>Start listening</button>
        <button onClick={stopListening} disabled={!listening}>Stop listening</button>
        <button onClick={readReply} disabled={!canSpeak || !lastReply || pending}>Read last reply</button>
        <button onClick={stopSpeaking} disabled={!canSpeak}>Stop speaking</button>
        <button onClick={reset}>Reset conversation</button>
      </div>
      <p role="status">{listening ? 'Listening…' : 'Microphone inactive.'}</p>
      <form onSubmit={send} className="conversation-form">
        <label htmlFor="conversation-message">Message to the course assistant</label>
        <textarea id="conversation-message" rows="2" maxLength="500" disabled={pending} value={message}
          onChange={event => setMessage(event.target.value)} />
        <button disabled={pending || !message.trim()}>{pending ? 'Sending…' : 'Send message'}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <div role="log" aria-label="Course conversation" aria-live="polite">
        {turns.map((turn, i) => <p key={i}><strong>{turn.role}:</strong> {turn.text}</p>)}
      </div>
      <p className="note">Text works even without speech support. Only the last five exchanges are displayed in memory; reset/reload clears them. No automatic microphone start, speech playback, or transcript submission. Use HTTPS/localhost and grant microphone access only if you choose to test recognition.</p>
    </section>
  );
}
