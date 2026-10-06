'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { validateStructural } = require('../../dist/packages/core/structural-validation');
const { replayGeneration } = require('../../dist/packages/core/replay');
const { slice } = require('../../dist/packages/core/source');
const { clauseInflection } = require('../../dist/packages/core/rhetorical-grammar');
const { embeddableClause } = require('../../dist/packages/core/rhetorical-grammar');
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 3, series: 'all', backend: 'structured', clientRevision: 0, seed: 'structural-generation', ...extra });
let python, assets, refs; const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); refs = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function run(source, extra = {}, options = {}) { if (!cache.has(source)) cache.set(source, await python.analyze(source)); return generate(request(source, extra), cache.get(source), assets, options); }
const structural = result => result.candidatePool.filter(candidate => candidate.plan.structural);

test('typed operators reshape ordinary novel-vocabulary clauses and compose independent local mechanisms', async () => {
  for (const source of ['速度が重要なので、私はこの方法を選びました。', '電池が切れたので、私は充電器を借りました。', '私は夕食を作った。野菜が余っていたからだ。']) {
    const result = await run(source), candidates = structural(result);
    assert.ok(candidates.length >= 2, source);
    assert.ok(candidates.every(candidate => candidate.verificationStatus === 'passed'));
    assert.ok(candidates.every(candidate => candidate.scores.S === null && candidate.scores.Q === null));
    assert.ok(candidates.every(candidate => validateStructural(result.ir, candidate.plan, refs)));
    for (const candidate of candidates) {
      assert.ok(candidate.plan.structural.blocks.every(block => block.intent.act === 'justify-assertion'));
      assert.equal(candidate.spans.map(span => slice(candidate.text, span.span)).join(''), candidate.text);
      for (const span of candidate.spans.filter(span => span.origin === 'source_fact')) assert.equal(slice(candidate.text, span.span), slice(source, span.sourceSpan));
    }
    if (source.startsWith('速度')) assert.ok(candidates.some(candidate => /俺はこの方法を選んだ。何故かというと速さとスピードが重要だからだ。/u.test(candidate.text)));
  }
});

test('document composition combines supplied modesty, reason and evidence-target roles without inventing dialogue', async () => {
  const source = '大したことではありません。私は報告書を提出しました。速度が重要なので、この方法を選びました。しかし私が失敗したという証拠はありますか。';
  const result = await run(source), candidates = structural(result);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.some(candidate => candidate.plan.structural.blocks.length === 3), candidates.map(candidate => candidate.text).join('\n'));
  assert.ok(candidates.every(candidate => candidate.verificationStatus === 'passed'));
  assert.ok(candidates.some(candidate => candidate.text.includes('どういう証拠')));
  assert.ok(candidates.some(candidate => candidate.text.includes('速さとスピード')));
  assert.ok(candidates.every(candidate => !candidate.text.includes('称賛') && !candidate.text.includes('論破')));
});

test('clause embedding preserves past, negative, aspect and copula grammar across inflection classes', async () => {
  for (const [source, expected] of [
    ['雨が降ったので、窓を閉めました。', '窓を閉めた。'],
    ['道が空いていたので、駅に行きました。', '駅に行った。'],
    ['道が空いていたので、私は走りました。', '私は走った。'],
    ['私は資料を提出しませんでした。期限が過ぎていたからだ。', '私は資料を提出しなかったという'],
    ['自慢ではありません。私は報告書を提出しました。', '自慢ではない'],
    ['自慢ではない。私は荷物を運びました。', '私は荷物を運んだ'],
    ['この店が便利ですから、私はここを選びました。', '便利だから'],
    ['作業が重要でしたから、私は残りました。', '重要だったから'],
    ['この店が便利ではありませんから、私は別の店を選びました。', '便利ではないから'],
    ['私は不器用ですが、私はこの時計を直しました。', '私は不器用だ'],
    ['料理は苦手ですけど、夕食を作れました。', '料理は苦手だ'],
    ['料理は得意ではありませんが、夕食を作れました。', '料理は得意ではない'],
  ]) {
    const result = await run(source), candidates = structural(result);
    assert.ok(candidates.some(candidate => candidate.text.includes(expected)), source + ': ' + candidates.map(candidate => candidate.text).join('|'));
    assert.ok(candidates.every(candidate => candidate.verificationStatus === 'passed'));
    assert.ok(candidates.every(candidate => !/(?:ませんだった|だだ|ですからだ|苦手が|不器用が|便利から)/u.test(candidate.text)));
  }
});

test('structural source evidence respects intensity and selected series without borrowed provenance', async () => {
  const source = '私が失敗したという証拠はありますか。';
  assert.equal(structural(await run(source, { intensity: 2 })).length, 0);
  assert.ok(structural(await run(source, { series: 'night' })).length > 0);
  assert.equal(structural(await run(source, { series: 'gg' })).length, 0);
  const result = await run(source, { series: 'night' });
  for (const candidate of structural(result)) {
    assert.ok(candidate.evidence.every(item => assets.evidence.find(value => value.id === item.id).series.includes('night')));
    assert.equal(candidate.verificationStatus, 'passed');
  }
});

test('embedding morphology distinguishes na-adjectives, inflected adjectives and unresolved polite tails', async () => {
  for (const [source, expected] of [
    ['料理は苦手です。', '料理は苦手だ'],
    ['料理は苦手でした。', '料理は苦手だった'],
    ['この店は便利です。', 'この店は便利だ'],
    ['この店は便利でした。', 'この店は便利だった'],
    ['私は料理が好きです。', '私は料理が好きだ'],
    ['価格が高いです。', '価格が高い'],
    ['価格が高かったです。', '価格が高かった'],
    ['この店は便利ではありません。', 'この店は便利ではない'],
    ['この店は便利ではありませんでした。', 'この店は便利ではなかった'],
    ['価格は高くありません。', '価格は高くない'],
    ['価格は高くありませんでした。', '価格は高くなかった'],
    ['彼に叱られませんでした。', '彼に叱られなかった'],
    ['仕事をさせられませんでした。', '仕事をさせられなかった'],
  ]) {
    const result = await run(source), body = { start: 0, end: [...source].length - 1 };
    const inflection = clauseInflection(result.ir, body); assert.ok(inflection, source);
    const embedded = slice(source, { start: 0, end: inflection.sourceSpan.start }) + inflection.text;
    assert.equal(embedded, expected, source);
    assert.ok(embeddableClause(embedded));
  }
  for (const text of ['叱られませんでした', '高いでした', '便利でしょう', '帰りましょう', '示してください']) assert.equal(embeddableClause(text), false, text);
});

test('final independent validation, complete-node locks and replay retain exact structural programs', async () => {
  const source = '速度が重要なので、私はこの方法を選びました。';
  const result = await run(source); finishSemanticVerification(result, {});
  const parent = result.candidates.find(candidate => candidate.plan.structural); assert.ok(parent);
  const replay = replayGeneration(result.replayManifest, cache.get(source), assets); finishSemanticVerification(replay, {});
  assert.deepEqual(replay.candidates.map(candidate => [candidate.id, candidate.text, candidate.spans]), result.candidates.map(candidate => [candidate.id, candidate.text, candidate.spans]));
  const lockedNodeIds = parent.plan.nodes.map(node => node.id);
  const locked = await run(source, {}, { lockedPlan: parent.plan, lockedNodeIds, operator: 'STRUCTURAL' }); finishSemanticVerification(locked, {});
  assert.ok(locked.candidates.some(candidate => candidate.text === parent.text));
  for (const candidate of locked.candidates) for (const id of lockedNodeIds) assert.deepEqual(candidate.plan.nodes.find(node => node.id === id), parent.plan.nodes.find(node => node.id === id));
  const forged = structuredClone(parent.plan); forged.structural.blocks[0].intent.targetFactIds = [];
  await assert.rejects(run(source, {}, { lockedPlan: forged, lockedNodeIds }), /LOCK_CONFLICT/);
  const obsolete = structuredClone(parent.plan); obsolete.structural.version = 0;
  await assert.rejects(run(source, {}, { lockedPlan: obsolete, lockedNodeIds }), /LOCK_CONFLICT/);
});

test('bounded document search caps blocks, plans, output and preserves remaining background', async () => {
  const source = Array.from({ length: 12 }, (_, i) => `道路${i}が空いていたので、私は駅${i}に行きました。`).join('');
  const result = await run(source), candidates = structural(result);
  assert.ok(candidates.length > 0 && candidates.length <= 12);
  assert.ok(result.candidatePool.length <= 36);
  for (const candidate of candidates) {
    assert.equal(candidate.plan.structural.blocks.length, 8);
    assert.ok(candidate.text.includes('道路11が空いていたので、'));
    assert.ok([...candidate.text].length <= 12000);
    assert.equal(candidate.verificationStatus, 'passed');
  }
});

test('v2 broader rhetorical relations survive full generation and independent final verification', async () => {
  for (const [source, kind, retained] of [
    ['費用が500円以下だったため、切符を2枚買いました。', 'reason-claim', /500円以下/u],
    ['準備が終わったので、私は明日資料を送ります。', 'reason-claim', /明日資料を送る/u],
    ['部品が届いたので、私は修理できます。', 'reason-claim', /修理できる/u],
    ['私は詳しくないが、私はこの設定を直せた。', 'modest-achievement', /詳しくない/u],
    ['私は専門家ではありません。設定を直すことができました。', 'modest-achievement', /直すことができた/u],
    ['料理は得意ではないが、夕食を作ることはできた。', 'modest-achievement', /作ることはできた/u],
    ['この予測の根拠を教えてください。', 'evidence-request', /この予測の根拠/u],
    ['私は説明を聞きましたが、この装置が安全だという証拠を示してください。', 'evidence-request', /^私は説明を聞きましたが、/u],
  ]) {
    const result = await run(source), candidates = structural(result); finishSemanticVerification(result, {});
    assert.ok(candidates.length > 0, source);
    for (const candidate of candidates) {
      assert.equal(candidate.verificationStatus, 'passed', source + ': ' + candidate.text);
      assert.ok(candidate.checks.some(check => check.code === 'S-structural-program' && check.status === 'pass'));
      assert.ok(candidate.plan.structural.blocks.some(block => block.relation.kind === kind));
      assert.match(candidate.text, retained);
      assert.equal(candidate.scores.S, null); assert.equal(candidate.scores.Q, null);
      assert.doesNotMatch(candidate.text, /ませんだった|みんなが褒め|最強|論破/u);
    }
  }
});

test('v2 literal-context evidence programs preserve target and exact locks through replay', async () => {
  const source = '私は説明を聞きましたが、この装置が安全だという証拠を示してください。';
  const result = await run(source); finishSemanticVerification(result, {});
  const parent = result.candidates.find(candidate => candidate.plan.structural); assert.ok(parent);
  const replay = replayGeneration(result.replayManifest, cache.get(source), assets); finishSemanticVerification(replay, {});
  assert.deepEqual(replay.candidates.map(candidate => [candidate.id, candidate.text, candidate.spans]), result.candidates.map(candidate => [candidate.id, candidate.text, candidate.spans]));
  const lockedNodeIds = parent.plan.nodes.map(node => node.id);
  const locked = await run(source, {}, { lockedPlan: parent.plan, lockedNodeIds, operator: 'STRUCTURAL' }); finishSemanticVerification(locked, {});
  assert.ok(locked.candidates.length);
  for (const candidate of locked.candidates) {
    assert.equal(candidate.text, parent.text);
    assert.deepEqual(candidate.plan.structural, parent.plan.structural);
    assert.ok(candidate.text.startsWith('私は説明を聞きましたが、'));
    assert.ok(candidate.plan.structural.blocks[0].relation.conditions.some(condition => condition.illocution === 'mentioned-proposition'));
  }
  const obsolete = structuredClone(parent.plan); obsolete.structural.version = 1;
  await assert.rejects(run(source, {}, { lockedPlan: obsolete, lockedNodeIds }), /LOCK_CONFLICT/);
});
