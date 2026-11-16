const tf = require('@tensorflow/tfjs-node');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');

async function loadExperiment(modelDir) {
  const directory = path.resolve(modelDir);
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
  if (metadata.inputDivisor !== 1000 || metadata.outputMultiplier !== 1000000) {
    throw new Error('This lesson requires the course house-price preprocessing.');
  }
  const model = await tf.loadLayersModel(pathToFileURL(path.join(directory, 'model.json')).href);
  return { model, metadata, directory };
}

function evaluate(model, rows, metadata) {
  const predictions = tf.tidy(() => {
    const input = tf.tensor2d(rows.map(row => [row.size / metadata.inputDivisor]));
    return Array.from(model.predict(input).dataSync(), value => value * metadata.outputMultiplier);
  });
  if (predictions.some(value => !Number.isFinite(value))) {
    throw new Error('Non-finite prediction during optimization evaluation.');
  }
  const mae = predictions.reduce(
    (sum, prediction, i) => sum + Math.abs(prediction - rows[i].price * 1000), 0
  ) / rows.length;
  return { predictions, mae };
}

function benchmark(models) {
  const entries = Object.entries(models);
  const samples = Object.fromEntries(entries.map(([name]) => [name, []]));
  const input = tf.tensor2d([[1.5]]);
  const infer = model => tf.tidy(() => model.predict(input).dataSync()[0]);
  try {
    for (const [, model] of entries) {
      for (let i = 0; i < 30; i++) infer(model);
    }
    for (let round = 0; round < 7; round++) {
      const order = round % 2 ? [...entries].reverse() : entries;
      for (const [name, model] of order) {
        const start = performance.now();
        for (let i = 0; i < 100; i++) infer(model);
        samples[name].push((performance.now() - start) / 100);
      }
    }
  } finally {
    input.dispose();
  }
  return Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [name, { medianMs: sorted[3], minMs: sorted[0], maxMs: sorted[6], samplesMs: values }];
  }));
}

async function artifactSizes(directory) {
  const json = await fs.readFile(path.join(directory, 'model.json'));
  const manifest = JSON.parse(json);
  const files = [...new Set(manifest.weightsManifest.flatMap(group => group.paths))];
  const sizes = await Promise.all(files.map(async file =>
    (await fs.stat(path.join(directory, file))).size
  ));
  const weightBytes = sizes.reduce((sum, size) => sum + size, 0);
  return { weightBytes, modelAndWeightBytes: json.length + weightBytes };
}

module.exports = { loadExperiment, evaluate, benchmark, artifactSizes };
