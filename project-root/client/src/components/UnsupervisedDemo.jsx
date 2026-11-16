import React, { useState } from 'react';
import { clusterHouses, SYNTHETIC_HOUSES } from '../course-learning.js';

const COLORS = ['#006b83', '#aa4b00', '#7138a8', '#317229'];

export default function UnsupervisedDemo() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  function run() {
    try {
      setResult(clusterHouses());
      setError('');
    } catch (failure) {
      setResult(null);
      setError(failure.message);
    }
  }
  const points = result?.projected || [];
  const xs = points.map(row => row[0]), ys = points.map(row => row[1]);
  const project = (value, values, start, length) =>
    start + (value - Math.min(...values)) / (Math.max(...values) - Math.min(...values) || 1) * length;

  return (
    <section aria-labelledby="unsupervised-heading">
      <p className="eyebrow">02 / Unsupervised learning</p>
      <h2 id="unsupervised-heading">Discover structure without labels</h2>
      <p>Cluster 12 invented houses using size and listed price as two input features. No target label is supplied.</p>
      <button onClick={run}>Run clustering</button>
      {error && <p role="alert" className="error">{error}</p>}
      {result && <div aria-live="polite">
        <p>Selected k = <strong>{result.selected.k}</strong> by highest silhouette score.</p>
        <table>
          <caption>Exploratory k comparison (larger silhouette is better)</caption>
          <thead><tr><th>k</th><th>Silhouette</th></tr></thead>
          <tbody>{result.candidates.map(row => <tr key={row.k}><td>{row.k}</td><td>{row.score.toFixed(3)}</td></tr>)}</tbody>
        </table>
        <svg viewBox="0 0 600 300" role="img" aria-label="PCA projection of standardized house features, colored by cluster">
          <line x1="45" y1="250" x2="570" y2="250" stroke="currentColor" />
          <line x1="45" y1="25" x2="45" y2="250" stroke="currentColor" />
          {points.map(([x, y], i) => <circle key={i}
            cx={project(x, xs, 60, 490)} cy={250 - project(y, ys, 15, 195)}
            r="7" fill={COLORS[result.selected.labels[i]]}>
            <title>{SYNTHETIC_HOUSES[i][0]} sq ft, ${SYNTHETIC_HOUSES[i][1]}k, cluster {result.selected.labels[i] + 1}</title>
          </circle>)}
          <text x="290" y="285">PC1</text><text x="5" y="20">PC2</text>
        </svg>
        <p>{result.selected.centers.map((_, i) =>
          <span className="legend" key={i} style={{ color: COLORS[i] }}>● Cluster {i + 1}</span>
        )}</p>
        <details><summary>Inspect cluster assignments</summary>
          <table><thead><tr><th>Size (sq ft)</th><th>Listed price ($k)</th><th>Cluster</th></tr></thead>
            <tbody>{SYNTHETIC_HOUSES.map(([size, price], i) =>
              <tr key={size}><td>{size}</td><td>{price}</td><td>{result.selected.labels[i] + 1}</td></tr>
            )}</tbody></table>
        </details>
      </div>}
      <p className="note">Features are standardized before k-means; PCA is for visualization. Cluster numbers have no inherent meaning. Tiny synchronous demo: use a worker for large datasets.</p>
    </section>
  );
}
