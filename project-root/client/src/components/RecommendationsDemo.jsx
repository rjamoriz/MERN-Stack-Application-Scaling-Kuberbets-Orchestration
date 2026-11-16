import React, { useMemo, useState } from 'react';
import { rankLessons } from '../course-learning.js';

const START = { react: 1, ml: 1, api: 1 };
const GUIDANCE = {
  react: { beginner: 'Trace how an event changes state, then changes the rendered interface.', advanced: 'Inspect effect cleanup, stale responses, and the difference between state and derived values.' },
  ml: { beginner: 'Identify the input features, the learning objective, and how the result is evaluated.', advanced: 'Audit split independence, preprocessing scope, drift, and the limitations of evaluation metrics.' },
  api: { beginner: 'Follow JSON input through validation, prediction, and a JSON response.', advanced: 'Design contracts, model versioning, failure handling, and non-blocking inference capacity.' },
};

export default function RecommendationsDemo() {
  const [interests, setInterests] = useState(START);
  const [level, setLevel] = useState('beginner');
  // Scores are derived, not stored separately: one source of truth prevents stale rankings.
  const ranked = useMemo(() => rankLessons(interests), [interests]);

  function showInterest(topic) {
    // Functional updates preserve rapid consecutive interactions; no profile is persisted.
    setInterests(previous => ({ ...previous, [topic]: Math.min(previous[topic] + 1, 20) }));
  }
  function reset() {
    setInterests(START);
    setLevel('beginner');
  }

  return (
    <section aria-labelledby="recommendations-heading">
      <p className="eyebrow">03 / Recommendations + adaptive content</p>
      <h2 id="recommendations-heading">Adapt to explicit session feedback</h2>
      <p>Choose an interest to rerank course content immediately. No user tracking, saved profile, or online model training.</p>
      <div className="actions">{Object.keys(START).map(topic =>
        <button key={topic} onClick={() => showInterest(topic)}>More {topic.toUpperCase()}</button>
      )}<button onClick={reset}>Reset preferences</button></div>
      <label htmlFor="explanation-level">Explanation level</label>
      <select id="explanation-level" value={level} onChange={event => setLevel(event.target.value)}>
        <option value="beginner">Beginner</option><option value="advanced">Advanced</option>
      </select>
      <div aria-live="polite">
        <h3>Recommended lessons</h3>
        <ol className="recommendations">{ranked.slice(0, 3).map(lesson =>
          <li key={lesson.id}>
            <strong>{lesson.title}</strong>
            <p>{GUIDANCE[lesson.topic][level]}</p>
            <label>Interest share for {lesson.topic.toUpperCase()} ({Math.round(lesson.score * 100)}%)
              <meter min="0" max="1" value={lesson.score} />
            </label>
          </li>
        )}</ol>
      </div>
      <p className="note">The share is a normalized interest weight, not a probability of success. This is a transparent content-based heuristic. Production ranking needs evaluation, diversity controls, and consent for any persistence.</p>
    </section>
  );
}
