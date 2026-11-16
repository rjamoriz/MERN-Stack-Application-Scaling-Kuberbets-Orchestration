const tf = require('@tensorflow/tfjs-node');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function isValidSize(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 100000;
}

async function loadHousePriceModel(modelDir) {
  const directory = path.resolve(modelDir);
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
  if (metadata.schemaVersion !== 1 || metadata.modelName !== 'tuned-house-price' ||
      metadata.synthetic !== true || metadata.inputDivisor !== 1000 ||
      metadata.outputMultiplier !== 1000000 ||
      !isValidSize(metadata.trainingRange?.min) ||
      !isValidSize(metadata.trainingRange?.max) ||
      metadata.trainingRange.min > metadata.trainingRange.max) {
    throw new Error('Unsupported or invalid house-price model metadata.');
  }
  const model = await tf.loadLayersModel(pathToFileURL(path.join(directory, 'model.json')).href);
  if (model.inputs.length !== 1 || model.inputs[0].shape.length !== 2 ||
      model.inputs[0].shape[1] !== 1 || model.outputs.length !== 1 ||
      model.outputs[0].shape.length !== 2 || model.outputs[0].shape[1] !== 1) {
    model.dispose();
    throw new Error('Expected a regression model with one feature and one output.');
  }
  return {
    metadata,
    predict(sizeSqFt) {
      if (!isValidSize(sizeSqFt)) {
        throw new RangeError('sizeSqFt must be a finite JSON number between 1 and 100000.');
      }
      const priceDollars = tf.tidy(() => {
        const input = tf.tensor2d([[sizeSqFt / metadata.inputDivisor]]);
        return model.predict(input).dataSync()[0] * metadata.outputMultiplier;
      });
      if (!Number.isFinite(priceDollars)) {
        throw new Error('Model produced a non-finite prediction.');
      }
      return {
        sizeSqFt, priceDollars,
        withinTrainingRange: sizeSqFt >= metadata.trainingRange.min &&
          sizeSqFt <= metadata.trainingRange.max,
        syntheticDemo: true
      };
    },
    dispose() { model.dispose(); }
  };
}

module.exports = { loadHousePriceModel, isValidSize };
