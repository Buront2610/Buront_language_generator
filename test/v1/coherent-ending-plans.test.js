'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { makeRewritePlans } = require('../../dist/packages/core/rewrite');
const { validateRewrite, renderEdits } = require('../../dist/packages/core/rewrite-validation');
const { rewriteRuleById } = require('../../dist/packages/core/rewrite-rules');
const { finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { replayGeneration } = require('../../dist/packages/core/replay');
const request = (source, intensity = 2) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity, series: 'all', backend: 'structured', clientRevision: 0, seed: 'coherent-endings-test' });
let python, assets, references;
const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); references = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function run(source, intensity = 2, options = {}) { if (!cache.has(source)) cache.set(source, await python.analyze(source)); return generate(request(source, intensity), cache.get(source), assets, options); }
const edits = candidate => candidate.plan.rewrite?.edits ?? candidate.plan.construction?.lexicalEdits ?? [];
const endings = candidate => edits(candidate).filter(edit => rewriteRuleById.get(edit.ruleId)?.kind === 'ending');
const insistence = candidate => endings(candidate).filter(edit => rewriteRuleById.get(edit.ruleId)?.mode === 'insistence');
const paragraph = '荷物を確認しました。予定を変更します。準備は十分です。今日は早く出発します。';
const plain = '荷物を確認した\n予定を変更する\n準備は十分だ\n今日は早く出発する';

test('plain forms cover the permitted paragraph; only added insistence consumes the one/two budget', async () => {
  for (const intensity of [2, 3]) {
    const result = await run(paragraph, intensity), pool = result.candidatePool;
    assert.ok(pool.some(candidate => candidate.text === plain));
    assert.ok(pool.some(candidate => endings(candidate).length === 0 && candidate.text.includes('準備は十分です')));
    for (const candidate of pool) {
      assert.equal(candidate.verificationStatus, 'passed');
      assert.ok([0, 4].includes(endings(candidate).length), candidate.text);
      assert.ok(insistence(candidate).length <= (intensity === 3 ? 2 : 1));
      assert.ok(validateRewrite(result.ir, candidate.plan, references));
      assert.equal(candidate.scores.S, null); assert.equal(candidate.scores.Q, null);
    }
    assert.ok(pool.some(candidate => insistence(candidate).length === (intensity === 3 ? 2 : 1)));
    finishSemanticVerification(result, {});
    assert.ok(result.candidates.some(candidate => candidate.text === plain));
    assert.ok(result.candidates.every(candidate => candidate.verificationStatus === 'passed'));
  }
});

test('neutral conversion preserves negation and past tense beyond the former shared cap', async () => {
  const result = await run('準備は十分でした。予定は変更しません。確認はしていませんでした。今日は参加しませんでした。');
  const candidate = result.candidatePool.find(item => endings(item).length === 4 && !insistence(item).length);
  assert.ok(candidate);
  assert.equal(candidate.text, '準備は十分だった\n予定は変更しない\n確認はしていなかった\n今日は参加しなかった');
  assert.ok(validateRewrite(result.ir, candidate.plan, references));
  finishSemanticVerification(result, {});
  assert.ok(result.candidates.every(item => item.checks.every(check => check.status === 'pass')));
});

test('quotation and uncertain scopes retain original forms while safe narrator clauses can share plain forms', async () => {
  const source = '田中は「準備は十分です」と言った。予定は変更するかもしれません。荷物を確認しました。明日出発します。';
  const result = await run(source);
  const plainCandidate = result.candidatePool.find(item => item.text.includes('荷物を確認した\n明日出発する') && !insistence(item).length);
  assert.ok(plainCandidate);
  for (const candidate of result.candidatePool) {
    assert.ok(candidate.text.includes('「準備は十分です」'));
    assert.ok(candidate.text.includes('予定は変更するかもしれません'));
    assert.ok(validateRewrite(result.ir, candidate.plan, references));
  }
});

test('document plain choices compose with reason prefixes, lexical edits, and protected values', async () => {
  const source = 'この方法を確認しました。速度が重要だからです。料金は500円です。準備は十分です。';
  const result = await run(source);
  const candidate = result.candidatePool.find(item => item.plan.construction && item.text.includes('何故なら速さとスピードが重要だからだ') && !insistence(item).length);
  assert.ok(candidate);
  assert.match(candidate.text, /料金は500円だ/u);
  assert.match(candidate.text, /準備は十分だ/u);
  assert.equal(endings(candidate).length, 4);
  assert.equal(candidate.verificationStatus, 'passed');
  finishSemanticVerification(result, {});
  assert.ok(result.candidates.every(item => item.checks.find(check => check.code === 'V-quantity').status === 'pass'));
});

test('the independent proof rejects excessive emphasis even in an otherwise consistent plain program', async () => {
  const result = await run(paragraph), original = result.candidatePool.find(item => item.text === plain);
  const plan = structuredClone(original.plan);
  plan.rewrite.edits = plan.rewrite.edits.map(edit => {
    if (!edit.ruleId.startsWith('ending-plain-')) return edit;
    const rule = rewriteRuleById.get(edit.ruleId.replace('ending-plain-', 'ending-insistence-'));
    return { ...edit, ruleId: rule.id, to: rule.to, evidenceIds: [rule.evidenceId] };
  });
  for (const node of plan.nodes) {
    const local = plan.rewrite.edits.filter(edit => edit.nodeId === node.id);
    node.text = renderEdits(paragraph, node, local); node.evidenceIds = [...new Set(local.flatMap(edit => edit.evidenceIds))];
  }
  plan.evidenceIds = [...new Set(plan.rewrite.edits.flatMap(edit => edit.evidenceIds))];
  assert.equal(validateRewrite(result.ir, plan, references), false);
  assert.ok(validateRewrite(result.ir, original.plan, references));
});

test('replay and locked nodes retain the complete source-bound ending program', async () => {
  const result = await run(paragraph); finishSemanticVerification(result, {});
  const parent = result.candidates.find(item => item.text === plain); assert.ok(parent);
  const replay = replayGeneration(result.replayManifest, cache.get(paragraph), assets); finishSemanticVerification(replay, {});
  assert.deepEqual(replay.candidates.map(item => [item.id, item.text, item.spans]), result.candidates.map(item => [item.id, item.text, item.spans]));
  const lockedNodeIds = parent.plan.nodes.map(node => node.id);
  const locked = await run(paragraph, 2, { lockedPlan: parent.plan, lockedNodeIds, replayParent: result.replayManifest, parentCandidateId: parent.id });
  finishSemanticVerification(locked, {});
  assert.ok(locked.candidates.length);
  for (const candidate of locked.candidates) assert.equal(candidate.text, plain);
});

test('cached source proposals do not share mutable edits between returned plans', async () => {
  const result = await run(paragraph), plans = makeRewritePlans(result.ir, request(paragraph), assets);
  const first = plans[0].rewrite.edits.find(edit => edit.ruleId.startsWith('punctuation-'));
  const other = plans.slice(1).flatMap(plan => plan.rewrite.edits).find(edit => edit.ruleId === first.ruleId && edit.sourceSpan.start === first.sourceSpan.start);
  assert.ok(other); assert.notEqual(first, other); assert.notEqual(first.sourceSpan, other.sourceSpan); assert.notEqual(first.evidenceIds, other.evidenceIds);
});
