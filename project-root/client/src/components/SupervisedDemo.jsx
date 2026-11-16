import React, { useEffect, useRef, useState } from 'react';

export default function SupervisedDemo() {
  const [size, setSize] = useState('1500');
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeRequest = useRef(null);

  // An unmounted component must not keep an obsolete request alive.
  useEffect(() => () => activeRequest.current?.abort(), []);

  function changeSize(event) {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setSize(event.target.value);
    setPrediction(null);
    setError('');
    setBusy(false);
  }

  async function predict(event) {
    event.preventDefault();
    const sizeSqFt = Number(size);
    if (!size.trim() || !Number.isFinite(sizeSqFt) || sizeSqFt < 1 || sizeSqFt > 100000) {
      setError('Enter a size between 1 and 100000 sq ft.');
      return;
    }
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setBusy(true);
    setError('');
    setPrediction(null);
    try {
      // Vite forwards /api to Express: no API keys or native TensorFlow in the browser.
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizeSqFt }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Inference failed: HTTP ${response.status}`);
      if (!data || !Number.isFinite(data.priceDollars) ||
          typeof data.withinTrainingRange !== 'boolean' || data.syntheticDemo !== true) {
        throw new Error('The API returned an unexpected prediction format.');
      }
      // Ignore a response if the input changed while the request was in flight.
      if (activeRequest.current === controller) setPrediction(data);
    } catch (failure) {
      if (activeRequest.current === controller) {
        setError(failure.name === 'AbortError' ? 'Prediction timed out. Try again.' : failure.message);
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section aria-labelledby="supervised-heading">
      <p className="eyebrow">01 / Supervised learning</p>
      <h2 id="supervised-heading">Use a learned relationship</h2>
      <p>Training used size/price pairs. React now requests inference; it does not retrain the model.</p>
      <form onSubmit={predict}>
        <label htmlFor="house-size">House size (sq ft)</label>
        <input id="house-size" type="number" min="1" max="100000" step="any" required value={size} onChange={changeSize} />
        <button disabled={busy}>{busy ? 'Predicting…' : 'Predict price'}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <div aria-live="polite">
        {prediction && <>
          <p className="metric">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(prediction.priceDollars)}</p>
          {!prediction.withinTrainingRange && <p className="warning">Outside the training size range: this is extrapolation.</p>}
        </>}
      </div>
      <p className="note">Synthetic training data. Not a real property valuation.</p>
    </section>
  );
}
