import React, { useState } from 'react';
import { useNlpQuery } from '../nlp-client.js';

function isCompletion(data) {
  return data?.model === 'count-based-ngram' && Array.isArray(data.suggestions) &&
    data.suggestions.every(row => typeof row.word === 'string' && typeof row.text === 'string' &&
      Number.isFinite(row.probability) && row.probability >= 0 && row.probability <= 1);
}

export default function PredictiveTextDemo() {
  const [text, setText] = useState('');
  const { result, pending, error } = useNlpQuery('/complete', 'text', text, isCompletion);
  return (
    <section aria-labelledby="predictive-heading">
      <p className="eyebrow">04 / Predictive text + Axios</p>
      <h2 id="predictive-heading">Suggest the next course word</h2>
      <p>A count-based language model learns word transitions from a tiny hand-authored English course corpus. Try “react ” or a partial word.</p>
      <label htmlFor="predictive-text">Course text</label>
      <textarea id="predictive-text" rows="3" maxLength="500" value={text}
        onChange={event => setText(event.target.value)} placeholder="react " />
      <div aria-live="polite">
        {pending && <p>Finding completions…</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {result && <>
          <div className="actions">{result.suggestions.map(row =>
            <button key={row.word} onClick={() => setText(row.text)}>
              Use {row.word} ({Math.round(row.probability * 100)}%)
            </button>
          )}</div>
          {result.suggestions.length === 0 && <p>No matching continuation in the training corpus. Try a course-related phrase.</p>}
        </>}
      </div>
      <p className="note">Axios sends text only to this local server after a 300 ms pause; obsolete requests are aborted. Suggestions are learned counts, not LLM reasoning. Percentages describe corpus continuations, not correctness.</p>
    </section>
  );
}
