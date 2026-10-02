'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceDocument, outputProtectedValues, hash, slice } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { makeRewritePlans } = require('../../dist/packages/core/rewrite');
const { validateCandidate, realize } = require('../../dist/packages/core/validator');
const { compileAssets } = require('../../dist/packages/core/assets');
const base = require('../../artifacts/pr3-review-repair-20261002/rewrite-scopes-base-analysis.json');

test('output literal extraction has its own scalar bound and shares exact input extraction', () => {
  for (const text of ['😀ＡＢＣ_12は-1.5kg以上、１２人から３人に。', '「１００円を払う」 >>123は test@example.com https://example.com/abc?q=2 。', '二百円、2026年10月2日、午後3時。', 'あ'.repeat(4987) + '😀100円から200円に']) {
    assert.deepEqual(outputProtectedValues(text), sourceDocument(text).protectedValues);
  }
  assert.throws(() => sourceDocument('あ'.repeat(5001)), /INVALID_SOURCE/);
  assert.deepEqual(outputProtectedValues('😀'.repeat(12000)), []);
  for (const text of ['あ'.repeat(12001), '\ud800', '', ' \n']) assert.throws(() => outputProtectedValues(text), /INVALID_OUTPUT/);
  const before = outputProtectedValues('あ'.repeat(6000) + '１００円を');
  assert.equal(before[0].span.start, 6000);
  assert.notEqual(hash(before.map(item => [item.kind, item.raw, item.role, item.comparator ?? null])), hash(outputProtectedValues('あ'.repeat(6000) + '２００円を').map(item => [item.kind, item.raw, item.role, item.comparator ?? null])));
});

test('independent quantity proof accepts legal expansion past input cap and rejects changed literals', () => {
  // A deliberately synthetic padding fixture isolates the output proof. The
  // parser tokens cover the short attested clause, not a claimed real long parse.
  const prefix = 'あ'.repeat(4990) + '100円を', source = prefix + base.source;
  const offset = [...prefix].length;
  assert.equal([...source].length, 5000);
  const analysis = { ...base.analysis, tokens: base.analysis.tokens.map(token => ({ ...token, span: { start: token.span.start + offset, end: token.span.end + offset } })), sentences: [{ start: 0, end: 5000 }] };
  const request = { source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0 };
  const ir = extractFacts(sourceDocument(source), analysis, request), assets = compileAssets();
  const plan = makeRewritePlans(ir, request, assets).find(plan => plan.nodes.map(node => node.text).join('').length > 5000);
  assert.ok(plan);
  const references = new Map(assets.evidence.map(item => [item.id, item.text])), evidence = new Set(references.keys());
  const validate = value => { const { text, spans } = realize(value, ir); return validateCandidate(ir, value, text, spans, evidence, undefined, references, assets.seriesProfiles); };
  assert.equal(validate(plan).every(check => check.status === 'pass'), true);
  const corrupt = structuredClone(plan); corrupt.nodes[0].text = corrupt.nodes[0].text.replace('100円', '200円');
  assert.equal(validate(corrupt).find(check => check.code === 'V-quantity').status, 'fail');
});

// Include unmatched surrogates even though request admission rejects them: the
// general scalar-slicing utility must retain its existing behavior as well.
test('BMP slice fast path preserves scalar slicing including astral and malformed strings', () => {
  for (const text of ['日本語ＡＢＣ', 'a😀b𠮷c', '\ud800a\udc00', 'a\udc00b', '']) for (const start of [-20, -1, 0, 1, 2, 4, 20]) for (const end of [-20, -1, 0, 1, 3, 5, 20]) {
    assert.equal(slice(text, { start, end }), [...text].slice(start, end).join(''));
  }
});

test('linear realization preserves cumulative scalar spans across all node boundaries', () => {
  for (const parts of [['私', 'は😀', '強い'], ['a\ud83d', '', '\ude00b'], ['\ud83d', '\ude00', '𠮷'], ['', 'a', '']]) {
    const nodes = parts.map((text, i) => ({ id: `n${i}`, type: 'RhetoricalClause', text, factIds: [], evidenceIds: [] }));
    let text = ''; const spans = [];
    for (const node of nodes) { const start = [...text].length; text += node.text; if (node.text) spans.push({ span: { start, end: [...text].length }, nodeId: node.id, origin: 'rhetoric', sourceSpan: undefined, factIds: [], evidenceIds: [] }); }
    assert.deepEqual(realize({ nodes }), { text, spans });
  }
});
