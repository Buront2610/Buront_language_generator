'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const baseline = require('../fixtures/structural-budget-baseline.json');
const { compileAssets } = require('../../dist/packages/core/assets');
const { sourceDocument, hash } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { makeRewritePlans } = require('../../dist/packages/core/rewrite');
const { makeStructuralPlans } = require('../../dist/packages/core/structural-planning');
const { validateStructural, structuralQuantityPreserved } = require('../../dist/packages/core/structural-validation');
const { renderStructural } = require('../../dist/packages/core/structural-realization');
const { tileAnalysis } = require('../../scripts/benchmark-rewrite-scopes');
let assets, references; const cache = new Map();
before(() => { assets = compileAssets(); references = new Map(assets.evidence.map(item => [item.id, item.text])); });
function build(repeats) {
  if (cache.has(repeats)) return cache.get(repeats);
  // Synthetic tiling isolates the planning contract; API performance uses a
  // separate real full-input GiNZA parse and the production deadline.
  const sample = tileAnalysis(baseline, [...baseline.source].length * repeats);
  const request = { source: sample.source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'structural-budget-regression' };
  const ir = extractFacts(sourceDocument(sample.source), sample.analysis, request);
  const plans = makeStructuralPlans(ir, request, assets, makeRewritePlans(ir, request, assets));
  const result = { ir, plans, request, sample }; cache.set(repeats, result); return result;
}
test('small-input structural programs are byte-equivalent to the pre-budget B3 plans', () => {
  const row = baseline.rows.find(row => row.repeats === 3), { plans } = build(row.repeats);
  assert.deepEqual(plans.map(hash), row.planHashes);
  assert.deepEqual(plans.map(plan => hash(plan.nodes.map(node => node.text).join(''))), row.textHashes);
});
test('long-input budget retains grammar and lexical programs unchanged, with complete source mappings', () => {
  const row = baseline.rows.find(row => row.repeats === 87), { ir, plans, request } = build(row.repeats);
  assert.ok([...request.source].length > 2000); assert.ok(row.planHashes.length > 2); assert.equal(plans.length, 2);
  assert.deepEqual(plans.map(hash), row.planHashes.slice(0, 2));
  assert.equal(plans[0].structural.localEdits.length, 0); assert.ok(plans[1].structural.localEdits.length > 0);
  for (const plan of plans) {
    assert.equal(validateStructural(ir, plan, references), true); assert.equal(structuralQuantityPreserved(ir, plan), true);
    assert.ok(plan.structural.blocks.length <= 8);
    let cursor = 0;
    for (const node of plan.nodes) { assert.equal(node.sourceSpan.start, cursor); cursor = node.sourceSpan.end; }
    assert.equal(cursor, [...request.source].length);
    const rendered = renderStructural(ir, plan);
    assert.equal(rendered.spans.map(span => [...rendered.text].slice(span.span.start, span.span.end).join('')).join(''), rendered.text);
  }
});
test('retained budgeted plans still reject mutated source facts, tokens and evidence', () => {
  const { ir, plans } = build(87), plan = plans[0];
  assert.equal(validateStructural(ir, plan, references), true);
  const changedFact = structuredClone(ir); changedFact.facts[0].polarity = 'negative';
  assert.equal(validateStructural(changedFact, plan, references), false);
  const changedToken = structuredClone(ir); changedToken.tokens.find(token => token.text === 'から').dep = 'case';
  assert.equal(validateStructural(changedToken, plan, references), false);
  const changedEvidence = new Map(references); const id = plan.structural.blocks[0].evidenceIds[0]; changedEvidence.set(id, changedEvidence.get(id) + 'changed');
  assert.equal(validateStructural(ir, plan, changedEvidence), false);
  assert.equal(validateStructural(ir, plan, references), true);
});
