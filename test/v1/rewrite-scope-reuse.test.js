'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../fixtures/ginza-grammar-scope.json');
const grammar = require('../../dist/packages/core/grammar-scope');
const { compileAssets } = require('../../dist/packages/core/assets');
const { sourceDocument } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { makeRewritePlans } = require('../../dist/packages/core/rewrite');
const { validateRewrite } = require('../../dist/packages/core/rewrite-validation');
let assets, references;
before(() => {
  assets = compileAssets();
  references = new Map(assets.evidence.map(item => [item.id, item.text]));
});
// Deliberately synthetic scaling input, tiled from an unchanged real analysis.
// The remapped IDs/heads and offsets preserve independent sentence ownership.
function repeated(count) {
  const row = fixtures.cases.find(row => row.source === '私は確認した。');
  const width = [...row.source].length, tokenCount = row.analysis.tokens.length;
  const source = row.source.repeat(count), analysis = { ...structuredClone(row.analysis), tokens: [], sentences: [] };
  for (let i = 0; i < count; i++) {
    const shift = span => ({ start: span.start + i * width, end: span.end + i * width });
    analysis.tokens.push(...row.analysis.tokens.map(token => ({ ...structuredClone(token), id: token.id + i * tokenCount, head: token.head + i * tokenCount, span: shift(token.span) })));
    analysis.sentences.push(...row.analysis.sentences.map(shift));
  }
  const request = { source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0 };
  return { request, ir: extractFacts(sourceDocument(source), analysis, request) };
}

test('full grammar scope construction stays once per planner and once per verifier as edits grow', t => {
  const original = grammar.propositionScopes, calls = [];
  const spy = t.mock.method(grammar, 'propositionScopes', (source, analysis) => { calls.push({ source, analysis }); return original(source, analysis); });
  let previousEdits = 0;
  for (const count of [1, 20, 120]) {
    const { request, ir } = repeated(count);
    calls.length = 0;
    const plans = makeRewritePlans(ir, request, assets);
    assert.equal(calls.length, 1, `planner at ${count} sentences`);
    assert.equal(calls[0].source, ir.source);
    assert.equal(calls[0].analysis, ir);
    const edits = plans.reduce((sum, plan) => sum + plan.rewrite.edits.length, 0);
    assert.ok(edits > previousEdits, 'the workload really adds edit candidates');
    previousEdits = edits;
    for (const plan of plans) {
      calls.length = 0;
      assert.equal(validateRewrite(ir, plan, references), true);
      assert.equal(calls.length, 1, `independent verifier at ${count} sentences`);
      assert.equal(calls[0].source, ir.source);
      assert.equal(calls[0].analysis, ir);
    }
  }
  assert.ok(spy.mock.callCount() > 0);
});

test('a fresh verification pass cannot reuse planner scopes after input grammar changes', () => {
  const { request, ir } = repeated(1);
  const plans = makeRewritePlans(ir, request, assets);
  const plan = plans.find(plan => plan.rewrite.edits.some(edit => edit.ruleId === 'narrator-watashi'));
  assert.ok(plan);
  assert.equal(validateRewrite(ir, plan, references), true);
  // Mutate the same identity to catch accidental WeakMap/IR-owned caches too.
  const predicate = ir.tokens.find(token => token.dep === 'ROOT');
  predicate.morphology.push('Inflection=五段;仮定形-一般');
  assert.equal(validateRewrite(ir, plan, references), false, 'new conditional morphology must be recomputed');
  predicate.morphology.pop();
  assert.equal(validateRewrite(ir, plan, references), true, 'one verification must not pollute another');
});
