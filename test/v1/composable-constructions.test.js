'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { validateConstruction, makeConstructionPlans } = require('../../dist/packages/core/constructions');
const { constructionEditsConflict } = require('../../dist/packages/core/construction-edits');
const { validateRewrite, renderEdits } = require('../../dist/packages/core/rewrite-validation');
const { rewriteRuleById, permitsRewrite } = require('../../dist/packages/core/rewrite-rules');
const { finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { replayGeneration } = require('../../dist/packages/core/replay');
const { realize, validateCandidate, verification } = require('../../dist/packages/core/validator');
const { slice, hash } = require('../../dist/packages/core/source');
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'composable-test', ...extra });
const source = '私はこの方法を選んだ。速度が重要だからだ。';
const isReason = candidate => candidate.plan.construction?.edits.some(edit => edit.constructionId === 'explicit-reason');
const hasVelocity = candidate => (candidate.plan.rewrite?.edits ?? candidate.plan.construction?.lexicalEdits ?? []).some(edit => edit.ruleId === 'velocity-doubling');
let python, assets, refs;
const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); refs = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function run(text = source, extra = {}, options = {}) { if (!cache.has(text)) cache.set(text, await python.analyze(text)); return generate(request(text, extra), cache.get(text), assets, options); }

test('real GiNZA exposes separately valid lexical-only, reason-only, and lexical-plus-reason plans from one original source', async () => {
  const result = await run(), pool = result.candidatePool;
  const lexical = pool.find(candidate => !isReason(candidate) && hasVelocity(candidate));
  // Construction-only is an explicit ablation through the same planner/proof,
  // not a claim that production always displays every valid subset.
  const reasonPlan = makeConstructionPlans(result.ir, request(source), assets, [])[0];
  const reason = { plan: reasonPlan, ...realize(reasonPlan, result.ir) };
  reason.verificationStatus = verification(validateCandidate(result.ir, reasonPlan, reason.text, reason.spans, new Set(refs.keys()), undefined, refs, assets.seriesProfiles));
  const combined = pool.find(candidate => isReason(candidate) && hasVelocity(candidate));
  assert.ok(lexical); assert.ok(reason); assert.ok(combined);
  assert.ok(validateRewrite(result.ir, lexical.plan, refs));
  assert.equal(reason.text, '私はこの方法を選んだ。何故なら速度が重要だからだ。');
  assert.match(combined.text, /何故なら速さとスピードが重要だからだ/u);
  for (const candidate of [lexical, reason, combined]) assert.equal(candidate.verificationStatus, 'passed');
  const construction = combined.plan.construction.edits.find(edit => edit.constructionId === 'explicit-reason');
  assert.deepEqual(construction.operation, { kind: 'prefix_source_body', prefix: '何故なら', bodySourceSpan: construction.bindings.find(binding => binding.slot === 'reason').span, permittedLocalEdits: 'independently_verified_rewrites' });
  assert.equal(construction.from, ''); assert.equal(construction.to, '何故なら');
  assert.equal(construction.sourceSpan.start, construction.sourceSpan.end);
  assert.equal(construction.relation.provenance.inputHash, result.inputHash);
  assert.ok(construction.bindings.find(binding => binding.slot === 'reason').text.includes('速度'));
  const velocity = combined.plan.construction.lexicalEdits.find(edit => edit.ruleId === 'velocity-doubling');
  assert.ok(permitsRewrite(result.ir, combined.plan.nodes.find(node => node.id === velocity.nodeId).sourceSpan, velocity.sourceSpan, rewriteRuleById.get(velocity.ruleId)));
  assert.ok(validateConstruction(result.ir, combined.plan, refs));
  const prefixSpan = combined.spans.find(span => slice(combined.text, span.span) === '何故なら');
  assert.deepEqual(prefixSpan.sourceSpan, construction.sourceSpan);
  const lexicalSpan = combined.spans.find(span => slice(combined.text, span.span) === '速さとスピード');
  assert.deepEqual(lexicalSpan.sourceSpan, velocity.sourceSpan);
  for (const span of combined.spans.filter(span => span.origin === 'source_fact')) assert.equal(slice(combined.text, span.span), slice(source, span.sourceSpan));
  assert.equal(combined.spans.map(span => slice(combined.text, span.span)).join(''), combined.text);
});

test('composition does not broaden lexical permission and preserves explicit protected values', async () => {
  for (const text of ['私はこの方法を選んだ。速度が３倍だからだ。', '私はこの方法を選んだ。全然失敗しなかったからだ。']) {
    const result = await run(text);
    for (const candidate of result.candidatePool.filter(isReason)) {
      assert.ok(validateConstruction(result.ir, candidate.plan, refs));
      for (const edit of candidate.plan.construction.lexicalEdits) assert.ok(permitsRewrite(result.ir, candidate.plan.nodes.find(node => node.id === edit.nodeId).sourceSpan, edit.sourceSpan, rewriteRuleById.get(edit.ruleId)));
      if (text.includes('３倍')) assert.match(candidate.text, /３倍/u);
    }
  }
  const result = await run('私はこの方法を選んだ。確実だからだ。');
  assert.ok(result.candidatePool.some(isReason));
  assert.ok(result.candidatePool.every(candidate => !candidate.text.includes('確定的'))); // standalone matcher does not permit this context
});

test('independent proof rejects operation/body/relation/prefix tampering and true overlapping replacements', async () => {
  const result = await run(), original = result.candidatePool.find(candidate => isReason(candidate) && hasVelocity(candidate));
  for (const mutate of [
    plan => { plan.construction.version = 1; },
    plan => { plan.construction.edits[0].constructionVersion = 1; },
    plan => { plan.construction.edits[0].operation.kind = 'replace'; },
    plan => { plan.construction.edits[0].operation.prefix += '私が正しい'; },
    plan => { plan.construction.edits[0].operation.bodySourceSpan.start = 0; },
    plan => { plan.construction.edits[0].operation.permittedLocalEdits = 'anything'; },
    plan => { plan.construction.edits[0].sourceSpan.end++; },
    plan => { plan.construction.edits[0].to += '何故なら'; },
    plan => { plan.construction.edits[0].relation.provenance.inputHash = '0'.repeat(64); },
    plan => { plan.construction.edits[0].relation.evidenceTokens[0].tokenId++; },
    plan => { plan.construction.edits[0].relation.conditions[0].polarity = 'negative'; },
    plan => { plan.construction.edits.push(structuredClone(plan.construction.edits[0])); },
    plan => { plan.construction.lexicalEdits.push(structuredClone(plan.construction.lexicalEdits.find(edit => edit.ruleId === 'velocity-doubling'))); },
    plan => { plan.construction.lexicalEdits.find(edit => edit.ruleId === 'velocity-doubling').to += '追加'; },
  ]) { const forged = structuredClone(original.plan); mutate(forged); assert.equal(validateConstruction(result.ir, forged, refs), false); }
  const frame = original.plan.construction.edits[0], lexical = original.plan.construction.lexicalEdits.find(edit => edit.ruleId === 'velocity-doubling');
  assert.equal(constructionEditsConflict(frame, lexical), false); // shared start is a legal prefix before a body word
  assert.equal(constructionEditsConflict(lexical, lexical), true);
  assert.equal(constructionEditsConflict(frame, { ...frame, operation: { kind: 'replace' }, sourceSpan: lexical.sourceSpan }), true);
});

test('composed programs and detailed source spans survive final verification, locks, deterministic replay and reject forged locks', async () => {
  const result = await run(); finishSemanticVerification(result, {});
  const parent = result.candidates.find(candidate => isReason(candidate) && hasVelocity(candidate)); assert.ok(parent);
  const replay = replayGeneration(result.replayManifest, cache.get(source), assets); finishSemanticVerification(replay, {});
  assert.deepEqual(replay.candidates.map(candidate => [candidate.id, candidate.spans]), result.candidates.map(candidate => [candidate.id, candidate.spans]));
  const lockedNodeIds = parent.plan.nodes.map(node => node.id);
  const obsolete = structuredClone(parent.plan); obsolete.construction.version = 1;
  await assert.rejects(() => run(source, {}, { lockedPlan: obsolete, lockedNodeIds }), /LOCK_CONFLICT/);
  const regenerated = await run(source, {}, { lockedPlan: parent.plan, lockedNodeIds, replayParent: result.replayManifest, parentCandidateId: parent.id });
  finishSemanticVerification(regenerated, {}); assert.ok(regenerated.candidates.some(candidate => candidate.text === parent.text));
  const lockedReplay = replayGeneration(regenerated.replayManifest, cache.get(source), assets); finishSemanticVerification(lockedReplay, {});
  assert.equal(lockedReplay.replayManifest.candidateSetHash, regenerated.replayManifest.candidateSetHash);
  const forged = structuredClone(regenerated.replayManifest); forged.regeneration.lockedPlan.construction.edits[0].operation.prefix += '偽';
  assert.throws(() => replayGeneration(forged, cache.get(source), assets), /REPLAY_LOCK_MISMATCH/);
});

test('diagnostic stages distinguish source recognition, scope/form limits, conflict, verification and final selection', async () => {
  const plain = await run('私は本を読んだ。'); assert.ok(plain.diagnostics.some(item => item.stage === 'relation_not_recognized'));
  const scope = await run('電車にする？安いからだ。'); assert.ok(scope.diagnostics.some(item => item.constructionId === 'explicit-reason' && item.stage === 'scope_blocked'));
  const form = await run('この傘は軽い。しかし値段は高い。'); assert.ok(form.diagnostics.some(item => item.constructionId === 'explicit-contrast' && item.stage === 'recognized')); assert.ok(form.diagnostics.some(item => item.stage === 'unsupported_form'));
  const conflict = await run('すでに時間切れです。'); assert.ok(conflict.diagnostics.some(item => item.stage === 'edit_conflict'));
  const result = await run(); finishSemanticVerification(result, {});
  assert.ok(result.diagnostics.some(item => item.stage === 'not_selected'));
  for (const event of result.diagnostics.filter(item => ['selected', 'not_selected', 'verified'].includes(item.stage))) {
    assert.ok(event.candidateId && event.planId);
    if (event.stage === 'selected') assert.ok(result.candidates.some(candidate => candidate.id === event.candidateId && candidate.plan.id === event.planId));
  }
  const rejected = await run(); const candidate = rejected.candidatePool.find(isReason); candidate.plan.construction.edits[0].to += '偽';
  finishSemanticVerification(rejected, {});
  assert.ok(rejected.diagnostics.some(item => item.stage === 'verification_rejected' && item.candidateId === candidate.id && item.planId === candidate.plan.id));
  assert.ok(!rejected.diagnostics.some(item => item.stage === 'selected' && item.candidateId === candidate.id && item.planId === candidate.plan.id));
});
