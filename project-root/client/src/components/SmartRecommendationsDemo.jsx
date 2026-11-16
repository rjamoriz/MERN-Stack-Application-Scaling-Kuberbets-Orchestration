import React, { useState } from 'react';
import { useNlpQuery } from '../nlp-client.js';

function isRanking(data) {
  return data?.model === 'tfidf-cosine' && Array.isArray(data.items) &&
    data.items.every(row => typeof row.id === 'string' && typeof row.title === 'string' &&
      Number.isFinite(row.score) && row.score > 0 && row.score <= 1.000001 &&
      Array.isArray(row.matchedTerms) && row.matchedTerms.every(term => typeof term === 'string'));
}

export default function SmartRecommendationsDemo() {
  const [query, setQuery] = useState('');
  const { result, pending, error } = useNlpQuery('/recommend', 'query', query, isRanking);
  return (
    <section aria-labelledby="smart-heading">
      <p className="eyebrow">05 / NLP recommendations</p>
      <h2 id="smart-heading">Match learning goals to course material</h2>
      <p>Unlike topic-button feedback, this example uses TF-IDF text vectors and cosine similarity. Try “react state components”.</p>
      <label htmlFor="learning-goal">Describe what you want to learn</label>
      <textarea id="learning-goal" rows="2" maxLength="500" value={query} onChange={event => setQuery(event.target.value)} />
      <div aria-live="polite">
        {pending && <p>Matching course descriptions…</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {result && <ol className="recommendations">{result.items.map(item =>
          <li key={item.id}>
            <strong>{item.title}</strong>
            <p>Shared terms: {item.matchedTerms.join(', ')}</p>
            <label>Cosine similarity: {item.score.toFixed(3)}<meter min="0" max="1" value={item.score} /></label>
          </li>
        )}</ol>}
        {result?.items.length === 0 && <p>No vocabulary overlap. Rephrase using course terminology; the model does not understand synonyms.</p>}
      </div>
      <p className="note">The catalogue defines the vocabulary and IDF weights once. Queries never refit them. Scores measure lexical similarity, not recommendation accuracy; there is no learner history or persistent profile.</p>
    </section>
  );
}
