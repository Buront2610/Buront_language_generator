'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const MiniSearch = require('minisearch');
const { boundedExactSearch } = require('../../dist/packages/core/bounded-search');
const { tokenize } = require('../../dist/packages/core/assets');

function compare(documents, queries, fields = ['text']) {
  const expected = new MiniSearch({ fields, storeFields: ['series'], tokenize });
  const actual = boundedExactSearch(fields, tokenize);
  expected.addAll(documents); actual.addAll(documents);
  for (const query of queries) for (const series of ['all', 'a', 'b', 'none']) {
    const options = { prefix: false, filter: item => series === 'all' || item.series.includes(series) };
    // Check every document, exact floating-point score, raw matched fields and
    // term ordering, not only nearest IDs or selected generated candidates.
    assert.deepEqual(actual.search(query, options), expected.search(query, options), `${fields}/${series}/${query.slice(0, 60)}`);
    assert.deepEqual(actual.search(query, options), expected.search(query, options), 'repeat lookup cannot mutate cached postings');
  }
}

test('bounded retrieval preserves native exact OR scores, order, repeated terms and series filters', () => {
  const documents = [
    { id: 'b', text: '私は最強だ。盾と剣。', family: '戦士', series: ['b'] },
    { id: 'a', text: '私は最強だ。盾と剣。', family: '戦士', series: ['a'] },
    { id: 'c', text: '剣は盾。私は確認した。', family: '最強', series: ['a', 'b'] },
    { id: 'd', text: '最強の剣と１００円、ABC。', family: '盾', series: [] },
    { id: 'e', text: '家族は悲しい。😀ＡＢＣを確認。', family: '私', series: ['a'] },
  ];
  for (const fields of [['text'], ['family', 'text']]) compare(documents, ['', '。😀', '非該当', '私は最強だ', '剣 盾 私 剣 盾 最強', '😀ＡＢＣ １００円', '私は最強だ'.repeat(1000)], fields);
});

test('bounded retrieval remains exact when the per-query term cache fills', () => {
  const words = ['確認', '強い', '悲しい', '盾', '剣', '報告', '最強', 'abc', '１２', '明日', '家族', '必要'];
  let state = 42;
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  const documents = Array.from({ length: 200 }, (_, i) => ({ id: `d${i}`, text: Array.from({ length: 8 }, () => words[random(words.length)]).join(' ') + ` term${i % 50}`, family: words[random(words.length)], series: [i % 2 ? 'a' : 'b'] }));
  const queries = Array.from({ length: 8 }, () => Array.from({ length: 18 }, () => words[random(words.length)]).join(' '));
  queries.push(Array.from({ length: 120 }, (_, i) => `term${i % 50}`).join(' '));
  compare(documents, queries, ['family', 'text']);
});

test('bounded exact executor rejects unsupported options instead of approximating', () => {
  const index = boundedExactSearch(['text'], tokenize);
  for (const options of [{ prefix: true }, { prefix: () => true }, { prefix: 1 }, { prefix: null }, { fuzzy: true }, { combineWith: 'AND' }, { boostTerm: () => 2 }]) assert.throws(() => index.search('盾', options), /UNSUPPORTED_EXACT_SEARCH_OPTIONS/);
  assert.throws(() => index.search({ queries: ['盾'] }), /UNSUPPORTED_EXACT_SEARCH_OPTIONS/);
});
