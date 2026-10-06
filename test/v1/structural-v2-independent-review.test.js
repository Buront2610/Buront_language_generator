'use strict';
// Independently selected v2 probes. These are known regression cases once read;
// they are not a sealed holdout, human S/Q labels, or evidence of style quality.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Ajv2020 = require('ajv/dist/2020').default;
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { sourceDocument, slice } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { makeRewritePlans } = require('../../dist/packages/core/rewrite');
const { makeStructuralPlans } = require('../../dist/packages/core/structural-planning');
const { recognizeRhetoricalRelations } = require('../../dist/packages/core/rhetorical-recognition');
const { renderStructural, refreshStructuralPlan } = require('../../dist/packages/core/structural-realization');
const { validateStructural, structuralQuantityPreserved } = require('../../dist/packages/core/structural-validation');
const { validateCandidate, verification } = require('../../dist/packages/core/validator');
const { generate } = require('../../dist/packages/core/engine');
const { finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { replayGeneration } = require('../../dist/packages/core/replay');
const { StructuralProgramSchema, RhetoricalRelationSchema } = require('../../dist/packages/contracts/results');
let python, assets, references; const cache = new Map();
const requestFor = source => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 3, series: 'all', backend: 'structured', clientRevision: 0, seed: 'independent-v2-review' });
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); references = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function build(source) {
  if (!cache.has(source)) cache.set(source, await python.analyze(source));
  const request = requestFor(source), analysis = structuredClone(cache.get(source));
  const ir = extractFacts(sourceDocument(source), analysis, request);
  return { source, request, analysis, ir, plans: makeStructuralPlans(ir, request, assets, makeRewritePlans(ir, request, assets)) };
}
function rehash(plan, ir, mutation) { const changed = structuredClone(plan); mutation(changed); refreshStructuralPlan(ir, changed); return changed; }
function fullCheck(ir, plan, rendered = renderStructural(ir, plan)) {
  return verification(validateCandidate(ir, plan, rendered.text, rendered.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles));
}

test('independent v2: passive and causative negative polite past never produce hybrid ませんだった', async () => {
  const failures = [];
  for (const source of [
    '雨が降っていたので、彼に叱られませんでした。',
    '雨が降っていたので、仕事をさせられませんでした。',
  ]) {
    const { ir, plans } = await build(source);
    for (const plan of plans) {
      const text = renderStructural(ir, plan).text;
      if (/ませんだった/u.test(text)) failures.push({ source, text, accepted: validateStructural(ir, plan, references) });
      // Abstention is safe if this analyzed auxiliary chain is unsupported.
      assert.ok(!text.includes('叱られた。') && !text.includes('させられた。'), text);
    }
  }
  assert.deepEqual(failures, []);
});

test('independent v2: lexical potentials outside the example vocabulary cannot use fact nominalization', async () => {
  const failures = [];
  for (const source of [
    '雨が降っていたので、私は休めませんでした。',
    '水が増えたので、私は泳げます。',
    '水が増えたので、私は泳げました。',
    '道が塞がったので、私は通れませんでした。',
    '収入が減ったので、家賃を払えませんでした。',
    '電池が入ったので、この装置は使えます。',
    '練習したので、私は勝てます。',
    '練習したので、私は長く走れます。',
    '電車が止まったため、私は行けませんでした。',
  ]) {
    const { ir, plans } = await build(source);
    for (const plan of plans) for (const block of plan.structural.blocks) {
      if (block.relation.kind !== 'reason-claim') continue;
      if (block.operatorId !== 'reason-explanation') failures.push({ source, text: renderStructural(ir, plan).text, accepted: validateStructural(ir, plan, references) });
    }
  }
  assert.deepEqual(failures, []);
});

test('independent v2: hearsay, conditional, negated and quoted evidence context stays literal', async () => {
  for (const source of [
    '彼は賛成したと言ったが、この予測の根拠を教えてください。',
    '条件を満たせば賛成するが、この予測の根拠を教えてください。',
    '私は説明を聞いていないが、この装置が安全だという証拠を示してください。',
    '私は説明を聞いたと思うが、この装置が安全だという証拠を示してください。',
    '「彼は来る」と聞きましたが、この主張の根拠を教えてください。',
  ]) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    for (const plan of plans) {
      const block = plan.structural.blocks.find(value => value.relation.slots.some(slot => slot.role === 'context')); assert.ok(block, source);
      const context = block.relation.slots.find(slot => slot.role === 'context');
      const rendered = renderStructural(ir, plan);
      assert.ok(rendered.text.startsWith(slice(source, context.span)), rendered.text);
      assert.equal(fullCheck(ir, plan), 'passed', source);
      for (const condition of block.relation.conditions.filter(value => value.illocution === 'literal-context')) assert.equal(condition.preservation, 'literal-copy');
    }
    for (const mutate of [
      plan => { plan.structural.blocks[0].pieces.find(piece => piece.role === 'context').sourceSpan.end--; },
      plan => { plan.structural.blocks[0].pieces.push(structuredClone(plan.structural.blocks[0].pieces.find(piece => piece.role === 'context'))); },
      plan => { plan.structural.blocks[0].relation.conditions.filter(value => value.illocution === 'literal-context').forEach(value => { value.preservation = 'asserted'; value.illocution = 'assertion'; }); },
    ]) assert.equal(validateStructural(ir, rehash(plans[0], ir, mutate), references), false);
  }
});

test('independent v2: uncertain and negated adnominal targets remain exact mentioned targets', async () => {
  for (const source of ['太郎が犯人かもしれない根拠を見せてください。', '太郎が犯人ではない証拠を見せてください。', '太郎の写真が本物である根拠を教えてください。']) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    for (const plan of plans) {
      const block = plan.structural.blocks[0], target = block.relation.slots.find(slot => ['target','carrier'].includes(slot.role));
      assert.equal(block.relation.targetMode, 'nominal'); assert.equal(block.relation.targetLink, 'adnominal');
      assert.ok(renderStructural(ir, plan).text.includes(slice(source, target.span)));
      for (const condition of block.relation.conditions.filter(value => target.factIds.includes(value.factId))) {
        assert.equal(condition.illocution, 'mentioned-proposition'); assert.equal(condition.preservation, 'literal-copy');
      }
      assert.equal(fullCheck(ir, plan), 'passed');
    }
  }
});

test('independent v2: request recipients, deadlines, count limits and negative speech acts never disappear', async () => {
  for (const source of [
    '彼が来たという証拠を太郎に見せてください。',
    '彼が来たという証拠を私に見せてください。',
    '彼が来たという証拠を明日見せてください。',
    '彼が来たという証拠を一つだけ見せてください。',
    '彼が来たという証拠を見せないでください。',
    '彼が来たという証拠はまだありますか。',
    '彼が来たという証拠が欲しくありません。',
  ]) {
    const { ir, plans } = await build(source);
    if (source.endsWith('見せてください。')) {
      assert.ok(plans.length, source);
      for (const plan of plans) {
        const block = plan.structural.blocks[0];
        assert.equal(block.relation.sourceForm, 'carrier-evidence-request');
        const request = block.relation.slots.find(slot => slot.role === 'request');
        assert.ok(renderStructural(ir, plan).text.includes(slice(source, request.span)));
        assert.ok(structuralQuantityPreserved(ir, plan)); assert.equal(fullCheck(ir, plan), 'passed');
      }
    } else {
      assert.ok(!recognizeRhetoricalRelations(ir).some(relation => relation.kind === 'evidence-request'), source);
      assert.equal(plans.length, 0, source);
    }
  }
});

test('independent v2: changed actor, coordinated actors and nonactual self accomplishments are withheld', async () => {
  for (const source of [
    '私は詳しくないが、太郎は設定を直せた。',
    '私は得意ではないが、私と太郎が機械を直した。',
    '私は得意ではないが、私の弟が機械を直した。',
    '私は得意ではないが、太郎が運び、私は機械を直した。',
    '私は得意ではないが、私は機械を直せなかった。',
    '私は得意ではないが、機械を直したつもりだ。',
    '私は得意ではないが、機械を直したはずだ。',
  ]) {
    const { plans } = await build(source);
    assert.ok(plans.every(plan => plan.structural.blocks.every(block => block.relation.kind !== 'modest-achievement')), source);
  }
});

test('independent v2: role binding preserves two explicit actors and scalar spans around astral characters', async () => {
  for (const source of ['太郎が来たので、花子は帰った。', '🦀料金が500円なので、私は切符を2枚買った。']) {
    const { ir, plans } = await build(source); assert.ok(plans.length);
    for (const plan of plans) {
      const rendered = renderStructural(ir, plan); assert.equal(fullCheck(ir, plan, rendered), 'passed');
      assert.equal(rendered.spans.map(span => slice(rendered.text, span.span)).join(''), rendered.text);
      for (const span of rendered.spans.filter(value => value.origin === 'source_fact')) assert.equal(slice(rendered.text, span.span), slice(source, span.sourceSpan));
      if (source.startsWith('太郎')) { assert.match(rendered.text, /太郎が来た/u); assert.match(rendered.text, /花子は帰った/u); }
      else assert.equal([...rendered.text].filter(char => char === '🦀').length, 1);
      const badSpans = structuredClone(rendered.spans); badSpans[0].sourceSpan.start++;
      assert.notEqual(fullCheck(ir, plan, { text: rendered.text, spans: badSpans }), 'passed');
    }
  }
});

test('independent v2: decimals, signs, comparisons and target quantities are role-local invariants', async () => {
  for (const [source, retained] of [
    ['雨が降っていたので、私は1.5kgの荷物を運んだ。', '1.5kg'],
    ['雨が降っていたので、私は-5℃の倉庫で待った。', '-5℃'],
    ['雨が降っていたので、私は3人以下しか通さなかった。', '3人以下しか'],
    ['10人以上が合格したという根拠を示してください。', '10人以上'],
    ['A社がB社より2倍速いという根拠を示してください。', 'A社がB社より2倍'],
  ]) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    for (const plan of plans) { assert.ok(renderStructural(ir, plan).text.includes(retained)); assert.ok(structuralQuantityPreserved(ir, plan)); assert.equal(fullCheck(ir, plan), 'passed'); }
  }
});

test('independent v2: old schema versions and extra semantic claims fail both schema and program proofs', async () => {
  const { ir, plans } = await build('部品が届いたので、私は修理できます。'); assert.ok(plans.length);
  const ajv = new Ajv2020({ strict: true }), programSchema = ajv.compile(StructuralProgramSchema), relationSchema = ajv.compile(RhetoricalRelationSchema);
  assert.ok(programSchema(plans[0].structural)); assert.ok(relationSchema(plans[0].structural.blocks[0].relation));
  for (const mutation of [
    plan => { plan.structural.version = 1; },
    plan => { plan.structural.version = 2; },
    plan => { plan.structural.search.policy = 'bounded-relation-composition-v1'; },
    plan => { plan.structural.blocks[0].relation.version = 1; },
    plan => { plan.structural.blocks[0].relation.inventedAchievement = 'completed'; },
  ]) {
    const changed = rehash(plans[0], ir, mutation);
    assert.equal(programSchema(changed.structural), false); assert.equal(validateStructural(ir, changed, references), false);
  }
});

test('independent v2: rehashing cannot launder source provenance, modality, evidence or output span claims', async () => {
  const { ir, plans } = await build('部品が届いたので、私は明日修理できる。'); assert.ok(plans.length);
  for (const mutation of [
    plan => { plan.structural.blocks[0].relation.provenance.inputHash = '0'.repeat(64); },
    plan => { plan.structural.blocks[0].relation.conditions.forEach(value => { value.preservation = 'asserted'; value.realization = 'actual'; value.prospective = false; }); },
    plan => { plan.structural.blocks[0].pieces.find(value => value.kind === 'source').sourceSpan.start++; },
    plan => { plan.structural.blocks[0].pieces.find(value => value.kind === 'form').text = '絶対に成功した。'; },
    plan => { plan.structural.blocks[0].evidenceIds.reverse(); },
    plan => { plan.structural.blocks[0].relation.slots.reverse(); },
  ]) assert.equal(validateStructural(ir, rehash(plans[0], ir, mutation), references), false);
  const modifiedReferences = new Map(references), id = plans[0].evidenceIds[0];
  modifiedReferences.set(id, references.get(id) + '無関係な追記'); assert.equal(validateStructural(ir, plans[0], modifiedReferences), false);
});

test('independent v2: final output verification and locked replay reject post-plan tampering', async () => {
  const built = await build('電池が切れたので、私は充電器を借りました。');
  const result = generate(built.request, built.analysis, assets); finishSemanticVerification(result, {});
  const candidate = result.candidates.find(value => value.plan.structural); assert.ok(candidate);
  const replayed = replayGeneration(result.replayManifest, built.analysis, assets); finishSemanticVerification(replayed, {});
  assert.deepEqual(replayed.candidates.map(value => [value.id, value.text, value.spans]), result.candidates.map(value => [value.id, value.text, value.spans]));
  const lockedNodeIds = candidate.plan.nodes.map(node => node.id);
  for (const mutation of [
    plan => { plan.structural.version = 1; },
    plan => { plan.structural.blocks[0].relation.conditions[0].attribution.speaker = '太郎'; },
    plan => { plan.structural.blocks[0].pieces.push({ kind: 'form', formId: 'invented', text: '全員が褒めた。', anchor: 0, evidenceIds: [] }); },
  ]) {
    const changed = rehash(candidate.plan, built.ir, mutation);
    assert.throws(() => generate(built.request, built.analysis, assets, { lockedPlan: changed, lockedNodeIds }), /LOCK_CONFLICT/);
  }
  candidate.text += '全員が褒めた。'; finishSemanticVerification(result, {});
  assert.equal(candidate.verificationStatus, 'rejected'); assert.equal(candidate.scores.C, 0);
  assert.ok(!result.candidates.some(value => value.id === candidate.id));
});

test('independent v2: ambiguous desired-state ために never invents a causal relation', async () => {
  for (const source of [
    '家族が安全であるために、防犯設備を整えました。',
    '部屋が清潔であるために、毎日掃除します。',
    '誰にも見えないために、物陰に隠れました。',
    '家族が安全なために、防犯設備を整えました。',
    '家族が安全でいるために、防犯設備を整えました。',
    '部屋が清潔なために、毎日掃除します。',
    '間違いがないために、私は書類を確認しました。',
    '問題がないために、私は動作確認を行いました。',
    '迷わないために、私は地図を持ちました。',
    '誰にも見られないために、物陰に隠れました。',
  ]) {
    const { ir, plans } = await build(source);
    assert.ok(!recognizeRhetoricalRelations(ir).some(relation => relation.kind === 'reason-claim'), source);
    assert.ok(plans.every(plan => plan.structural.blocks.every(block => block.relation.kind !== 'reason-claim')), source);
  }
  for (const source of ['子供が安全だったため、私は外へ出た。', '部屋が清潔だったため、私は掃除しなかった。']) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    assert.ok(plans.some(plan => plan.structural.blocks.some(block => block.relation.sourceForm === 'causal-tame')));
    assert.ok(plans.every(plan => validateStructural(ir, plan, references)));
  }
});
