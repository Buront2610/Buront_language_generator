"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { compileAssets, deduplicateRetrievalEvidence, Retrieval } = require('../../dist/packages/core/assets');
const { splitBeforeGeneration } = require('../../dist/packages/evaluation/dataset');

const entry = (id, text, sourceType, extra = {}) => ({ id, text, sourceType, postId: '', series: [], family: 'fixture', ...extra });
const fixtureAssets = (evidence) => ({ datasetId: 'fixture', manifest: {}, evidence, lexicon: [], operations: [], series: [] });

test('compiled assets retain source units, spans and provisional context without relabelling originals', () => {
  const assets = compileAssets();
  const logs = require('../../data/log-corpus.json');
  const quotes = require('../../data/quote-corpus.json');
  assert.equal(assets.originalPosts.length, logs.posts.length);
  assert.ok(assets.originalPosts.every(post => post.unitType === 'whole_post' && post.positiveExample));
  assert.equal(assets.evidence.filter(item => item.sourceType === 'original_post').length, logs.sentences.length);
  assert.ok(assets.evidence.filter(item => item.sourceType === 'original_post').every(item => item.positiveExample && item.unitType === 'sentence'));
  const originalById = new Map(assets.originalPosts.map(item => [item.id, item]));
  for (const quote of [...quotes.headings, ...quotes.excerpts]) {
    const compiled = assets.evidence.find(item => item.id === quote.id);
    assert.deepEqual(compiled.sourcePostIds, quote.sourcePostIds);
    assert.equal(compiled.variantGroupId, quote.variantGroupId);
    assert.equal(compiled.leakageGroupId, quote.leakageGroupId);
    assert.deepEqual(compiled.emphasizedSpans, quote.emphasizedSpans);
    for (const postId of quote.leakagePostIds) assert.equal(originalById.get(postId).leakageGroupId, compiled.leakageGroupId);
  }
  const ambiguous = assets.evidence.find(item => item.text === '○○美');
  assert.equal(ambiguous.contextStatus, 'ambiguous');
  assert.equal(ambiguous.postId, '');
  assert.ok(!assets.evidence.some(item => /^(赤字|太字|黒字)[・.]/u.test(item.text)));
});

test('quote title, typography variant and emphasis produce one indexed representative', () => {
  const records = [
    entry('q1', '光の力', 'quote_heading', { variantGroupId: 'v1', samplingWeight: 1 / 3 }),
    entry('q2', '光の力で進む', 'quote_excerpt', { variantGroupId: 'v1', samplingWeight: 1 / 3 }),
    entry('q3', '光の力で進む！', 'quote_excerpt', { variantGroupId: 'v1', samplingWeight: 1 / 3 }),
  ];
  const canonical = deduplicateRetrievalEvidence(records);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].samplingWeight, 1);
  assert.deepEqual(new Set(canonical[0].memberIds), new Set(['q1', 'q2', 'q3']));
  const retrieval = new Retrieval(fixtureAssets(records));
  assert.equal(retrieval.search('光', 'all', 'usage').length, 1);
  assert.equal(retrieval.search('光', 'all', 'novelty').length, 1);
  assert.equal(retrieval.search('光', 'all', 'content').length, 0);
});

test('a quote duplicate and legend cannot inflate original source support', () => {
  const records = [
    entry('s1', '光の力で進む', 'original_post', { postId: 'p1', sourcePostIds: ['p1'], positiveExample: true }),
    entry('q1', '光の力で進む', 'quote_heading', { variantGroupId: 'v1' }),
    entry('q2', '光の力で進む！', 'quote_excerpt', { variantGroupId: 'v1' }),
    entry('legend', '赤字・・光の力で進む', 'quote_excerpt'),
  ];
  const assets = fixtureAssets(records);
  const retrieval = new Retrieval(assets);
  for (const purpose of ['content', 'usage', 'novelty']) {
    const matches = retrieval.search('光', 'all', purpose);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceType, 'original_post');
  }
  assert.equal(assets.evidence.length, 4, 'index deduplication does not erase source records');
});

test('holdout exclusion follows source and leakage groups through quote aliases', () => {
  const assets = fixtureAssets([
    entry('original_sentence', '騎士の盾', 'original_post', { postId: 'p1', leakageGroupId: 'g1' }),
    entry('heading', '別の比喩', 'quote_heading', { leakageGroupId: 'g1', variantGroupId: 'v1', leakagePostIds: ['p1', 'p2'] }),
    entry('unrelated', '別の騎士', 'original_post', { postId: 'p3', leakageGroupId: 'g3' }),
  ]);
  for (const excluded of ['p1', 'p2', 'heading', 'g1', 'v1']) {
    const retrieval = new Retrieval(assets, new Set([excluded]));
    assert.deepEqual(retrieval.search('盾', 'all', 'usage'), []);
    assert.deepEqual(retrieval.search('比喩', 'all', 'usage'), []);
    assert.equal(retrieval.search('騎士', 'all', 'content')[0].id, 'unrelated');
  }
});

test('split-before-generation connects variants and uncertain source candidates before allocation', () => {
  const split = splitBeforeGeneration([
    { id: 'a', text: '甲の装備', postId: 'p1', threadId: '', family: 'a', leakageGroupId: 'shared' },
    { id: 'b', text: '乙の速度', postId: '', threadId: '', family: 'b', leakageGroupId: 'shared', variantGroupId: 'variant' },
    { id: 'c', text: '丙の精神', postId: '', threadId: '', family: 'c', variantGroupId: 'variant', leakagePostIds: ['p2'] },
    { id: 'd', text: '丁の報告', postId: 'p2', threadId: '', family: 'd' },
  ]);
  assert.equal(split.groups, 1);
  assert.equal(new Set(split.examples.map(item => item.group)).size, 1);
  assert.equal(new Set(split.examples.map(item => item.split)).size, 1);
  assert.ok(split.frozenBeforeGeneration);
  assert.match(split.method, /quote-variant-leakage/);
});
