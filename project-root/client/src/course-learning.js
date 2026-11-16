export const SYNTHETIC_HOUSES = [
  [750, 125], [800, 132], [850, 129], [900, 141],
  [1400, 218], [1450, 231], [1500, 224], [1550, 240],
  [2100, 321], [2200, 334], [2250, 328], [2300, 345],
];

const squaredDistance = (a, b) => a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);

export function standardize(points) {
  if (points.length < 2 || points.some(row => row.length !== 2 || row.some(x => !Number.isFinite(x)))) {
    throw new Error('Clustering expects at least two finite two-feature observations.');
  }
  const means = [0, 1].map(j => points.reduce((sum, row) => sum + row[j], 0) / points.length);
  const scales = means.map((mean, j) =>
    Math.sqrt(points.reduce((sum, row) => sum + (row[j] - mean) ** 2, 0) / points.length)
  );
  if (scales.some(scale => scale === 0)) throw new Error('Both features must vary.');
  return points.map(row => row.map((value, j) => (value - means[j]) / scales[j]));
}

export function kmeans(points, k) {
  if (!Number.isInteger(k) || k < 2 || k >= points.length ||
      new Set(points.map(row => JSON.stringify(row))).size < k) {
    throw new Error('Choose k between 2 and n-1, with at least k distinct observations.');
  }
  // Farthest-first initialization makes the small course experiment reproducible.
  let centers = [points[0].slice()];
  while (centers.length < k) {
    const distances = points.map(row => Math.min(...centers.map(center => squaredDistance(row, center))));
    centers.push(points[distances.indexOf(Math.max(...distances))].slice());
  }
  let labels = points.map(() => -1);
  for (let iteration = 0; iteration < 100; iteration++) {
    const next = points.map(row => {
      const distances = centers.map(center => squaredDistance(row, center));
      return distances.indexOf(Math.min(...distances));
    });
    const groups = centers.map((_, cluster) => points.filter((_, i) => next[i] === cluster));
    if (groups.some(group => group.length === 0)) throw new Error('Empty cluster; choose another k or initialization.');
    centers = groups.map(group => group[0].map((_, j) =>
      group.reduce((sum, row) => sum + row[j], 0) / group.length
    ));
    if (next.every((label, i) => label === labels[i])) return { labels: next, centers };
    labels = next;
  }
  throw new Error('K-means did not converge within 100 iterations.');
}

export function silhouette(points, labels) {
  const clusters = [...new Set(labels)];
  if (clusters.length < 2) throw new Error('Silhouette requires at least two clusters.');
  return points.reduce((sum, point, i) => {
    const same = points.filter((_, j) => j !== i && labels[j] === labels[i]);
    if (same.length === 0) return sum; // A singleton receives silhouette zero.
    const averageDistance = rows => rows.reduce((total, row) =>
      total + Math.sqrt(squaredDistance(point, row)), 0) / rows.length;
    const a = averageDistance(same);
    const b = Math.min(...clusters.filter(cluster => cluster !== labels[i]).map(cluster =>
      averageDistance(points.filter((_, j) => labels[j] === cluster))
    ));
    return sum + (Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b));
  }, 0) / points.length;
}

export function pca2(points) {
  // In 2D the covariance eigenvectors are a rotation; both PCs preserve distances.
  const covariance = (a, b) => points.reduce((sum, row) => sum + row[a] * row[b], 0) / points.length;
  const angle = 0.5 * Math.atan2(2 * covariance(0, 1), covariance(0, 0) - covariance(1, 1));
  return points.map(([x, y]) => [
    x * Math.cos(angle) + y * Math.sin(angle),
    -x * Math.sin(angle) + y * Math.cos(angle),
  ]);
}

export function clusterHouses() {
  const scaled = standardize(SYNTHETIC_HOUSES);
  const candidates = [2, 3, 4].map(k => {
    const result = kmeans(scaled, k);
    return { k, ...result, score: silhouette(scaled, result.labels) };
  });
  const selected = candidates.reduce((best, row) => row.score > best.score ? row : best);
  return { candidates, selected, projected: pca2(scaled) };
}

export const LESSONS = [
  { id: 'api-errors', topic: 'api', title: 'Reliable inference endpoints' },
  { id: 'ml-clusters', topic: 'ml', title: 'Discover patterns with clustering' },
  { id: 'react-state', topic: 'react', title: 'Model asynchronous React state' },
  { id: 'api-serving', topic: 'api', title: 'Serve a versioned model' },
  { id: 'ml-validation', topic: 'ml', title: 'Evaluate without leakage' },
  { id: 'react-effects', topic: 'react', title: 'Clean up effects and requests' },
];

export function rankLessons(interests) {
  const total = ['react', 'ml', 'api'].reduce((sum, topic) => sum + interests[topic], 0);
  if (!(total > 0) || ['react', 'ml', 'api'].some(topic =>
    !Number.isFinite(interests[topic]) || interests[topic] < 0)) {
    throw new Error('Topic interests must be finite non-negative weights with a positive total.');
  }
  // This interpretable score is a content-based heuristic, not a trained ranker.
  return LESSONS.map(lesson => ({ ...lesson, score: interests[lesson.topic] / total }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
