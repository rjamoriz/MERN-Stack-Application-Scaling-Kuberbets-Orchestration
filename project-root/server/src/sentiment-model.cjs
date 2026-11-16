'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const tf = require('@tensorflow/tfjs-node');

const MODEL_ID = 'imdb-sentiment-cnn-v1';
const DEFAULT_MODEL_DIR = path.resolve(__dirname, '../models/pretrained-sentiment-v1');
const MAX_TEXT_LENGTH = 2000;
const PADDING_INDEX = 0;
const OOV_INDEX = 2;
const POSITIVE_THRESHOLD = 0.5;

function diagnostic(stage) {
  if (process.env.SENTIMENT_DIAGNOSTICS === '1') {
    console.error(`[sentiment] ${stage}`);
  }
}

class SentimentInputError extends Error {
  constructor(reason) {
    super('Text cannot be encoded by the sentiment model.');
    this.name = 'SentimentInputError';
    this.reason = reason;
  }
}

function validateMetadata(metadata, requireModelDefaults = false) {
  if (!metadata || metadata.index_from !== 3 ||
      !Number.isInteger(metadata.max_len) || metadata.max_len < 1 ||
      (requireModelDefaults && metadata.max_len !== 100) ||
      !Number.isInteger(metadata.vocabulary_size) || metadata.vocabulary_size < 4 ||
      !metadata.word_index || typeof metadata.word_index !== 'object' ||
      Array.isArray(metadata.word_index) || Object.keys(metadata.word_index).length === 0) {
    throw new Error('Unsupported or invalid sentiment model metadata.');
  }

  for (const [word, index] of Object.entries(metadata.word_index)) {
    if (!word || !Number.isInteger(index) || index < 1) {
      throw new Error('Unsupported or invalid sentiment vocabulary.');
    }
  }
}

function encodeSentimentText(text, metadata, inputDim = metadata?.vocabulary_size) {
  if (typeof text !== 'string') {
    throw new TypeError('Sentiment input must be a string.');
  }
  validateMetadata(metadata);
  if (!Number.isInteger(inputDim) || inputDim !== metadata.vocabulary_size) {
    throw new Error('Sentiment vocabulary does not match the model embedding.');
  }

  // Match the course model's lowercase/punctuation normalization while allowing repeated whitespace.
  const tokens = text.toLowerCase().replace(/[.,!]/g, '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new SentimentInputError('no-tokens');
  }

  const retainedTokens = tokens.slice(-metadata.max_len);
  const truncated = tokens.length > metadata.max_len;
  const encoded = [];
  let oovCount = 0;

  for (const token of retainedTokens) {
    const rawIndex = Object.hasOwn(metadata.word_index, token)
      ? metadata.word_index[token]
      : null;
    const modelIndex = rawIndex === null ? OOV_INDEX : rawIndex + metadata.index_from;
    if (rawIndex === null || !Number.isInteger(modelIndex) ||
        modelIndex < 1 || modelIndex >= inputDim) {
      encoded.push(OOV_INDEX);
      oovCount += 1;
    } else {
      encoded.push(modelIndex);
    }
  }

  if (oovCount === retainedTokens.length) {
    throw new SentimentInputError('all-oov');
  }

  return {
    sequence: [
      ...Array(metadata.max_len - encoded.length).fill(PADDING_INDEX),
      ...encoded
    ],
    tokenCount: retainedTokens.length,
    oovCount,
    truncated
  };
}

async function loadSentimentModel(modelDir = DEFAULT_MODEL_DIR) {
  let model;
  try {
    diagnostic('reading metadata');
    const directory = path.resolve(modelDir);
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
    validateMetadata(metadata, true);

    // Load only the already-downloaded model. Requests never download weights or train a fallback.
    diagnostic('loading native model');
    model = await tf.loadLayersModel(pathToFileURL(path.join(directory, 'model.json')).href);
    diagnostic('validating model architecture');
    const inputShape = model.inputs[0]?.shape;
    const outputShape = model.outputs[0]?.shape;
    const embedding = model.layers.find(layer => layer.getClassName() === 'Embedding');
    const embeddingSize = embedding?.getConfig().inputDim;
    const lastLayer = model.layers.at(-1);
    const outputActivation = lastLayer?.getConfig().activation;

    if (model.inputs.length !== 1 || !Array.isArray(inputShape) || inputShape.length !== 2 ||
        (inputShape[1] !== null && inputShape[1] !== metadata.max_len) ||
        model.outputs.length !== 1 || !Array.isArray(outputShape) || outputShape.length !== 2 ||
        outputShape[1] !== 1 || embeddingSize !== metadata.vocabulary_size ||
        outputActivation !== 'sigmoid') {
      throw new Error('Sentiment model architecture does not match its metadata.');
    }

    const scoreFor = sequence => {
      const input = tf.tensor2d([sequence], [1, metadata.max_len], 'int32');
      let prediction;
      try {
        prediction = model.predict(input);
        if (Array.isArray(prediction)) {
          throw new Error('Sentiment model returned multiple outputs.');
        }
        return prediction.dataSync()[0];
      } finally {
        input.dispose();
        for (const output of Array.isArray(prediction) ? prediction : [prediction]) {
          output?.dispose();
        }
      }
    };

    // Warm up the native backend once so readiness implies a finite, usable prediction.
    diagnostic('starting synchronous warmup');
    const warmupScore = scoreFor(Array(metadata.max_len).fill(PADDING_INDEX));
    diagnostic('finished synchronous warmup');
    if (!Number.isFinite(warmupScore) || warmupScore < 0 || warmupScore > 1) {
      throw new Error('Sentiment model warmup returned an invalid score.');
    }

    return {
      metadata,
      classify(text) {
        const encoded = encodeSentimentText(text, metadata, embeddingSize);
        const score = scoreFor(encoded.sequence);
        if (!Number.isFinite(score) || score < 0 || score > 1) {
          throw new Error('Sentiment model returned an invalid score.');
        }
        return {
          model: MODEL_ID,
          label: score >= POSITIVE_THRESHOLD ? 'positive' : 'negative',
          score,
          threshold: POSITIVE_THRESHOLD,
          tokenCount: encoded.tokenCount,
          oovCount: encoded.oovCount,
          truncated: encoded.truncated
        };
      },
      dispose() {
        model.dispose();
      }
    };
  } catch {
    if (model) {
      model.dispose();
    }
    throw new Error('Sentiment model artifacts are missing or invalid.');
  }
}

module.exports = {
  DEFAULT_MODEL_DIR,
  MAX_TEXT_LENGTH,
  MODEL_ID,
  OOV_INDEX,
  PADDING_INDEX,
  POSITIVE_THRESHOLD,
  SentimentInputError,
  encodeSentimentText,
  loadSentimentModel
};
