import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterHouses, standardize, pca2, kmeans, silhouette, rankLessons, SYNTHETIC_HOUSES } from './course-learning.js';

test('clustering compares k values and selects a complete, high-silhouette partition', () => {
  const { candidates, selected } = clusterHouses();
  assert.deepEqual(candidates.map(row => row.k), [2, 3, 4]);
  assert.equal(selected.k, 3);
  assert.equal(selected.labels.length, SYNTHETIC_HOUSES.length);
  assert.equal(new Set(selected.labels).size, 3);
  assert.ok(selected.score > 0.8 && selected.score <= 1);
  assert.deepEqual(selected, clusterHouses().selected);
});

test('standardization and the two-component PCA preserve standardized pairwise distance', () => {
  const scaled = standardize(SYNTHETIC_HOUSES);
  const projected = pca2(scaled);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (let i = 1; i < scaled.length; i++) {
    assert.ok(Math.abs(distance(scaled[0], scaled[i]) - distance(projected[0], projected[i])) < 1e-10);
  }
  assert.throws(() => standardize([[1, 2], [1, 3]]), /vary/);
  assert.throws(() => standardize([[1, NaN], [2, 3]]), /finite/);
});

test('clustering rejects impossible cluster counts and scores singletons as zero', () => {
  assert.throws(() => kmeans([[1, 1], [1, 1], [1, 1]], 2), /distinct/);
  assert.equal(silhouette([[0, 0], [1, 1]], [0, 1]), 0);
});

test('session interests change ranking without mutating state or inventing probabilities', () => {
  const interests = { react: 1, ml: 4, api: 1 };
  const results = rankLessons(interests);
  assert.equal(results[0].topic, 'ml');
  assert.equal(results[1].topic, 'ml');
  assert.equal(results[0].score, 4 / 6);
  assert.deepEqual(interests, { react: 1, ml: 4, api: 1 });
  assert.throws(() => rankLessons({ react: 0, ml: 0, api: 0 }), /positive/);
  assert.throws(() => rankLessons({ react: 1, ml: Infinity, api: 1 }), /finite/);
});
