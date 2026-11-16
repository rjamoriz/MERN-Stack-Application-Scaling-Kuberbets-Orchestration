'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  predictText, recommendText, converse, getCorpusReport, COURSE_SENTENCES, LEARNING_RESOURCES
} = require('./course-nlp.cjs');

test('literal corpus has no missing/duplicate sentences and reports training counts', () => {
  const report = getCorpusReport();
  assert.ok(report.sentenceCount >= 24 && report.sentenceCount <= 36);
  assert.equal(report.sentenceCount, COURSE_SENTENCES.length);
  assert.equal(new Set(COURSE_SENTENCES).size, report.sentenceCount);
  assert.equal(report.duplicateCount, 0);
  assert.equal(report.missingCount, 0);
  assert.ok(report.tokenCount > report.sentenceCount);
  assert.ok(report.vocabularySize > 20);
});

test('partial completion preserves original prefix, case and whitespace', () => {
  const result = predictText('WE   learn   Re');
  assert.equal(result.contextLength, 2);
  assert.equal(result.suggestions[0].word, 'react');
  assert.equal(result.suggestions[0].text, 'WE   learn   react ');
  assert.equal(predictText('  TeN').suggestions[0].text, '  tensorflow ');
  assert.equal(predictText('react c').suggestions[0].text, 'react components ');
});

test('trailing-space prediction uses longest context and one-word backoff', () => {
  const longest = predictText('we learn ');
  assert.equal(longest.contextLength, 2);
  assert.equal(longest.suggestions.length, 3);
  assert.equal(predictText('unseen react ').contextLength, 1);
  assert.ok(predictText('react ').suggestions.some(item => item.word === 'components'));
  assert.equal(predictText('react components ').suggestions[0].word, 'receive');
});

test('normalization covers every candidate before truncation, not just displayed top three', () => {
  const result = predictText('we learn ');
  // Two distinct sentences continue "we learn" with "react"; five others occur once.
  assert.deepEqual(result.suggestions.map(({ word, count, probability }) => ({ word, count, probability })), [
    { word: 'react', count: 2, probability: 2 / 7 },
    { word: 'api', count: 1, probability: 1 / 7 },
    { word: 'clustering', count: 1, probability: 1 / 7 }
  ]);
  assert.ok(result.suggestions.reduce((sum, item) => sum + item.probability, 0) < 1);
  assert.equal(predictText('we learn re').suggestions[0].probability, 1);
});

test('empty/OOV contexts do not invent completions or cross sentence boundaries', () => {
  for (const input of ['', '   ', 'quux ', 'unseen zz', 'react. ', 'we learn! ', 'react\n ']) {
    assert.deepEqual(predictText(input).suggestions, [], input);
  }
  const result = predictText('we learn. react ');
  assert.equal(result.contextLength, 1);
  assert.ok(result.suggestions.every(item => item.text.startsWith('we learn. react ')));
});

test('TF-IDF retrieves each topic, excludes zeroes, and returns bounded cosine scores', () => {
  for (const resource of LEARNING_RESOURCES) {
    const { model, items } = recommendText(resource.id);
    assert.equal(model, 'tfidf-cosine');
    assert.equal(items[0].id, resource.id);
    assert.ok(items.length <= 3);
    assert.ok(items.every(item => item.score > 0 && item.score <= 1));
    assert.ok(items[0].matchedTerms.includes(resource.id));
  }
  assert.deepEqual(recommendText('quux zzyzx').items, []);
  assert.deepEqual(recommendText('the and a').items, []);
});

test('TF-IDF fit is stable across repeated requests and ignores unseen query terms', () => {
  const before = recommendText('react hooks');
  recommendText('privacy data');
  assert.deepEqual(recommendText('react hooks'), before);
  assert.deepEqual(recommendText('react hooks zzyzx'), before);
});

test('rule-based conversation passes explicit follow-up context without global state', () => {
  const first = converse('recommend a lesson');
  assert.equal(first.intent, 'recommendation');
  assert.equal(first.context, 'awaiting-topic');
  const second = converse('react', first.context);
  assert.equal(second.intent, 'recommendation');
  assert.match(second.reply, /React/);
  assert.equal(second.context, null);
  assert.equal(converse('react').intent, 'unknown');
  assert.match(converse('recommend a lesson about clustering').reply, /Clustering/);
});

test('greeting/help/reset override follow-up, and unsupported requests are explicit', () => {
  for (const [message, intent] of [['hello', 'greeting'], ['help', 'help'], ['reset', 'reset']]) {
    const result = converse(message, 'awaiting-topic');
    assert.equal(result.intent, intent);
    assert.equal(result.context, null);
  }
  assert.equal(converse('write a poem').intent, 'unknown');
  assert.equal(converse('zzyzx', 'awaiting-topic').intent, 'unknown');
  assert.throws(() => converse('react', 'invalid'), TypeError);
});
