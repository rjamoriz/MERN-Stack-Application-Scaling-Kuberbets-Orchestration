const tf = require('@tensorflow/tfjs-node');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
  const train = input.train.filter((_, i) => i % 4 !== 0);
  const validation = input.train.filter((_, i) => i % 4 === 0);
  const test = input.test;
  const tensorX = rows => tf.tensor2d(rows.map(r => [r.size / 1000]));
  const tensorY = rows => tf.tensor2d(rows.map(r => [r.price / 1000]));
  const trainX = tensorX(train), trainY = tensorY(train);
  const valX = tensorX(validation), valY = tensorY(validation);
  const models = [], optimizers = [], trials = [];
  let testX;
  const predict = async (model, x) => {
    const output = model.predict(x);
    try { return Array.from(await output.data(), v => v * 1000000); }
    finally { output.dispose(); }
  };
  const mae = (predictions, rows) =>
    predictions.reduce((sum, p, i) => sum + Math.abs(p - rows[i].price * 1000), 0) / rows.length;
  try {
    for (const units of [0, 8]) {
      for (const learningRate of [0.005, 0.03]) {
        const model = tf.sequential();
        const initializer = seed => tf.initializers.glorotUniform({ seed });
        if (units) {
          model.add(tf.layers.dense({
            units, inputShape: [1], activation: 'tanh', kernelInitializer: initializer(42)
          }));
          model.add(tf.layers.dense({ units: 1, kernelInitializer: initializer(43) }));
        } else {
          model.add(tf.layers.dense({ units: 1, inputShape: [1], kernelInitializer: initializer(42) }));
        }
        models.push(model);
        const optimizer = tf.train.adam(learningRate);
        optimizers.push(optimizer);
        model.compile({ optimizer, loss: 'meanSquaredError' });
        const history = await model.fit(trainX, trainY, {
          validationData: [valX, valY], epochs: 120, batchSize: train.length,
          shuffle: false, verbose: 0
        });
        trials.push({
          units, learningRate, name: `${units ? 'Hidden 8' : 'Linear'}, lr=${learningRate}`,
          valMae: mae(await predict(model, valX), validation),
          trainLoss: history.history.loss, valLoss: history.history.val_loss
        });
      }
    }
    const best = trials.reduce(
      (winner, trial, i) => trial.valMae < trials[winner].valMae ? i : winner, 0
    );
    testX = tensorX(test);
    const predictions = await predict(models[best], testX);
    const mean = train.reduce((sum, r) => sum + r.price * 1000, 0) / train.length;
    const modelDir = path.resolve('models', 'tuned-house-price');
    await fs.mkdir(modelDir, { recursive: true });
    await models[best].save(pathToFileURL(modelDir).href, { includeOptimizer: false });
    const metadata = {
      schemaVersion: 1, modelName: 'tuned-house-price', synthetic: true,
      inputDivisor: 1000, outputMultiplier: 1000000,
      trainingRange: {
        min: Math.min(...train.map(r => r.size)),
        max: Math.max(...train.map(r => r.size))
      },
      selected: trials[best].name
    };
    await fs.writeFile(path.join(modelDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    console.log(JSON.stringify({
      trials, best, predictions, modelDir,
      testActual: test.map(r => r.price * 1000), testMae: mae(predictions, test),
      baselineMae: mae(test.map(() => mean), test),
      counts: { train: train.length, validation: validation.length, test: test.length }
    }));
  } finally {
    [trainX, trainY, valX, valY, testX].filter(Boolean).forEach(t => t.dispose());
    models.forEach(m => m.dispose());
    optimizers.forEach(o => o.dispose());
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
