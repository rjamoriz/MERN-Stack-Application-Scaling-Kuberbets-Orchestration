'use strict';

const { WordTokenizer } = require('natural/lib/natural/tokenizers/regexp_tokenizer');
const TfIdf = require('natural/lib/natural/tfidf/tfidf');

// Literal, hand-authored English teaching data, not a downloaded or general-purpose model.
const COURSE_SENTENCES = Object.freeze([
  'we learn react components',
  'we learn react hooks',
  'we learn api validation',
  'we learn tensorflow models',
  'we learn clustering methods',
  'we learn persistence patterns',
  'we learn privacy principles',
  'react components render interfaces',
  'react components receive props',
  'react hooks manage state',
  'react state updates interfaces',
  'react forms collect input',
  'api routes validate input',
  'api routes return json',
  'api requests need validation',
  'api errors explain failures',
  'tensorflow models learn patterns',
  'tensorflow models predict values',
  'tensorflow tensors contain numbers',
  'tensorflow training updates weights',
  'clustering groups similar examples',
  'clustering methods compare distances',
  'clustering features need scaling',
  'clustering results need interpretation',
  'persistence saves model artifacts',
  'persistence restores model weights',
  'persistence tests verify predictions',
  'privacy keeps examples local',
  'privacy avoids personal data',
  'privacy requires explicit consent'
]);

const LEARNING_RESOURCES = Object.freeze([
  { id: 'react', title: 'React components and hooks',
    description: 'react components props hooks state forms interfaces rendering' },
  { id: 'api', title: 'Express API validation',
    description: 'api express routes http json requests validation errors endpoints' },
  { id: 'tensorflow', title: 'TensorFlow training basics',
    description: 'tensorflow tensors training weights regression models predictions loss' },
  { id: 'clustering', title: 'Clustering and feature scaling',
    description: 'clustering clusters distances features scaling unsupervised groups silhouette' },
  { id: 'persistence', title: 'Model persistence and reload',
    description: 'persistence save load reload artifacts filesystem serialization restore weights' },
  { id: 'privacy', title: 'Local privacy principles',
    description: 'privacy local consent personal sensitive data logging retention security' }
].map(resource => Object.freeze(resource)));

const tokenizer = new WordTokenizer();
// WordTokenizer preserves case; lowercase explicitly. No stemming or semantic expansion.
const words = text => tokenizer.tokenize(text.toLowerCase()).filter(word => /^[a-z0-9_]+$/.test(word));
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'i', 'in',
  'is', 'it', 'me', 'my', 'of', 'on', 'or', 'please', 'the', 'to', 'with',
  'you', 'your', 'about', 'learn', 'lesson', 'lessons', 'recommend', 'course'
]);
const catalogueWords = text => words(text).filter(word => !STOPWORDS.has(word));

function increment(counts, word) {
  counts.set(word, (counts.get(word) || 0) + 1);
}

function trainCounts(sentences) {
  const unigram = new Map();
  const contexts = new Map();
  const seen = new Set();
  let tokenCount = 0;
  let missingCount = 0;
  let duplicateCount = 0;
  for (const sentence of sentences) {
    if (typeof sentence !== 'string' || words(sentence).length === 0) {
      missingCount++;
      continue;
    }
    const canonical = words(sentence).join(' ');
    if (seen.has(canonical)) duplicateCount++;
    seen.add(canonical);
    // Reset at punctuation, even if a future corpus entry contains multiple sentences.
    for (const segment of sentence.split(/[.!?;:\r\n]+/)) {
      const tokens = words(segment);
      tokenCount += tokens.length;
      tokens.forEach((word, index) => {
        increment(unigram, word);
        for (let length = 1; length <= Math.min(2, index); length++) {
          const key = tokens.slice(index - length, index).join(' ');
          if (!contexts.has(key)) contexts.set(key, new Map());
          increment(contexts.get(key), word);
        }
      });
    }
  }
  if (missingCount || duplicateCount) {
    throw new Error('Course corpus must contain nonempty, unique sentences.');
  }
  return {
    unigram, contexts,
    report: Object.freeze({
      sentenceCount: sentences.length, tokenCount, vocabularySize: unigram.size,
      duplicateCount, missingCount
    })
  };
}

// Train once per module load; query functions never mutate the training data.
const languageModel = trainCounts(COURSE_SENTENCES);
const getCorpusReport = () => ({ ...languageModel.report });

function predictText(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string.');
  const result = { model: 'count-based-ngram', contextLength: 0, suggestions: [] };
  const segment = text.split(/[.!?;:\r\n]+/).at(-1);
  const partial = segment.match(/[a-z0-9_]+$/i)?.[0] || '';
  const prefix = partial ? text.slice(0, -partial.length) : text;
  const context = words(partial ? segment.slice(0, -partial.length) : segment);
  let matches = [];
  for (let length = Math.min(2, context.length); length >= 1; length--) {
    const counts = languageModel.contexts.get(context.slice(-length).join(' '));
    matches = [...(counts || [])].filter(([word]) => word.startsWith(partial.toLowerCase()));
    if (matches.length) {
      result.contextLength = length;
      break;
    }
  }
  // Only a standalone partial word may fall back to vocabulary completion.
  if (!context.length && partial) {
    matches = [...languageModel.unigram].filter(([word]) => word.startsWith(partial.toLowerCase()));
  }
  const total = matches.reduce((sum, [, count]) => sum + count, 0);
  result.suggestions = matches
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .slice(0, 3)
    .map(([word, count]) => ({
      word, text: `${prefix}${word} `, probability: count / total, count
    }));
  return result;
}

const tfidf = new TfIdf();
for (const resource of LEARNING_RESOURCES) {
  // Arrays bypass Natural's implicit stopwords; use our explicit list above.
  tfidf.addDocument(catalogueWords(`${resource.title} ${resource.description}`), resource.id);
}
const vocabulary = new Set(LEARNING_RESOURCES.flatMap(resource =>
  catalogueWords(`${resource.title} ${resource.description}`)));
// Natural 8.2.6: idf(term) = 1 + ln(N / (1 + documentFrequency(term))).
// Fit on the six catalogue documents ONLY, never add a request as a document.
const idf = new Map([...vocabulary].map(term => [term, tfidf.idf(term)]));

function vectorize(tokens) {
  const frequencies = new Map();
  for (const term of tokens) if (idf.has(term)) increment(frequencies, term);
  return new Map([...frequencies].map(([term, count]) => [term, count * idf.get(term)]));
}

const magnitude = vector => Math.hypot(...vector.values());
const documentVectors = LEARNING_RESOURCES.map(resource => {
  const vector = vectorize(catalogueWords(`${resource.title} ${resource.description}`));
  return { vector, norm: magnitude(vector) };
});

function recommendText(query) {
  if (typeof query !== 'string') throw new TypeError('query must be a string.');
  const vector = vectorize(catalogueWords(query));
  const norm = magnitude(vector);
  if (!norm) return { model: 'tfidf-cosine', items: [] };
  const items = LEARNING_RESOURCES.map((resource, index) => {
    const document = documentVectors[index];
    const matchedTerms = [...vector.keys()].filter(term => document.vector.has(term)).sort();
    const dot = matchedTerms.reduce((sum, term) => sum + vector.get(term) * document.vector.get(term), 0);
    const score = Math.max(0, Math.min(1, dot / (norm * document.norm)));
    return { id: resource.id, title: resource.title, score, matchedTerms };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en')).slice(0, 3);
  return { model: 'tfidf-cosine', items };
}

const HELP = 'Try hello, help, reset, or recommend a lesson. Topics: react, api, tensorflow, clustering, persistence, privacy.';

function converse(message, context = null) {
  if (typeof message !== 'string') throw new TypeError('message must be a string.');
  if (context !== null && context !== 'awaiting-topic') throw new TypeError('Invalid conversation context.');
  const input = message.trim().toLowerCase().replace(/[.!?]+$/, '').trim();
  if (/^(reset|start over|cancel)$/.test(input)) {
    return { intent: 'reset', reply: `Context cleared. ${HELP}`, context: null };
  }
  if (/^(hello|hi|hey)$/.test(input)) {
    return { intent: 'greeting', reply: `Hello! ${HELP}`, context: null };
  }
  if (/^(help|what can you do)$/.test(input)) {
    return { intent: 'help', reply: HELP, context: null };
  }
  const recommendation = input.match(/^(?:recommend|suggest)(?: (?:a |some )?lessons?)?(?: (?:about|on|for))?(?:\s+(.+))?$/);
  if (recommendation && !recommendation[1]) {
    return { intent: 'recommendation', reply: 'Which topic: react, api, tensorflow, clustering, persistence, or privacy?',
      context: 'awaiting-topic' };
  }
  if (recommendation || context === 'awaiting-topic') {
    const { items } = recommendText(recommendation ? recommendation[1] : message);
    if (items.length) {
      return { intent: 'recommendation', reply: `Suggested lessons: ${items.map(item => item.title).join('; ')}.`,
        context: null };
    }
  }
  return { intent: 'unknown', reply: `I do not recognize that course request. ${HELP}`, context: null };
}

module.exports = { predictText, recommendText, converse, getCorpusReport, COURSE_SENTENCES, LEARNING_RESOURCES };
