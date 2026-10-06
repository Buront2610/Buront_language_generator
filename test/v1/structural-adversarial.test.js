'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { extractFacts } = require('../../dist/packages/core/facts');
const { sourceDocument, hash, outputProtectedValues } = require('../../dist/packages/core/source');
const { makeRewritePlans } = require('../../dist/packages/core/rewrite');
const planning = require('../../dist/packages/core/structural-planning');
const { refreshStructuralPlan, renderStructural, originalStructuralNodes } = require('../../dist/packages/core/structural-realization');
const { validateStructural, structuralQuantityPreserved } = require('../../dist/packages/core/structural-validation');
const { validateRewrite } = require('../../dist/packages/core/rewrite-validation');
const { validateConstruction } = require('../../dist/packages/core/constructions');
const { realize, validateCandidate, verification } = require('../../dist/packages/core/validator');
const { recognizeRhetoricalRelations } = require('../../dist/packages/core/rhetorical-recognition');
const { generate } = require('../../dist/packages/core/engine');
const { finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { ruleQuality } = require('../../dist/packages/core/evaluation');

let python, assets, references;
const analyses = new Map();
const requestFor = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 3, series: 'all', backend: 'structured', clientRevision: 0, ...extra });
before(async () => {
  python = new PythonClient(); await python.start(); assets = compileAssets();
  references = new Map(assets.evidence.map(item => [item.id, item.text]));
});
after(() => python?.close());
async function build(source, extra = {}) {
  if (!analyses.has(source)) analyses.set(source, await python.analyze(source));
  const request = requestFor(source, extra), analysis = structuredClone(analyses.get(source));
  const ir = extractFacts(sourceDocument(source), analysis, request), rewrites = makeRewritePlans(ir, request, assets);
  return { source, ir, request, rewrites, plans: planning.makeStructuralPlans(ir, request, assets, rewrites) };
}
function assertRejected(ir, plan, message) {
  assert.equal(validateStructural(ir, plan, references), false, message);
  const rendered = realize(plan, ir);
  assert.notEqual(verification(validateCandidate(ir, plan, rendered.text, rendered.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles)), 'passed', message);
}
function forge(original, ir, mutate) {
  const value = structuredClone(original); mutate(value); refreshStructuralPlan(ir, value); return value;
}

test('live GiNZA structural recipes preserve varied ordinary arguments, numbers and negation', async () => {
  for (const source of [
    '雨が降っていたので、私は駅で待ちました。',
    '料金が500円なので、私は切符を2枚買いました。',
    '部屋が暗かったので、私は窓を開けました。',
    '私は資料を提出しませんでした。期限が過ぎていたからだ。',
    '大したことはしていない。機械を動かしただけだ。',
    '自慢ではありません。私は古い時計を直しました。',
    '金額が1000円以下なので、私は注文しませんでした。',
    '彼が資料を捨てたという証拠はありますか？',
    '箱に3個以上入っていないという根拠はありますか？',
  ]) {
    const { ir, plans } = await build(source); assert.ok(plans.length >= 2, source);
    for (const plan of plans) {
      assert.equal(validateStructural(ir, plan, references), true, plan.nodes.map(node => node.text).join(''));
      assert.equal(structuralQuantityPreserved(ir, plan), true, source);
      const rendered = realize(plan, ir);
      assert.equal(verification(validateCandidate(ir, plan, rendered.text, rendered.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles)), 'passed', source);
      assert.ok(!/しませんだった|ですという|ましたという/u.test(rendered.text), rendered.text);
      if (source.includes('提出しませんでした')) assert.match(rendered.text, /提出しなかった/u);
      if (source.startsWith('箱に')) assert.match(rendered.text, /3個以上入っていない/u);
    }
  }
});

test('quantity proof is per original role even when unequal quantities reverse global order', async () => {
  const { ir, plans } = await build('料金が500円なので、私は切符を2枚買いました。');
  const plan = plans.find(plan => plan.structural.blocks[0].operatorId === 'reason-explanation'); assert.ok(plan);
  const text = renderStructural(ir, plan).text;
  assert.ok(text.indexOf('2枚') < text.indexOf('500円'));
  assert.notDeepEqual(outputProtectedValues(ir.source.raw).map(value => value.raw), outputProtectedValues(text).map(value => value.raw));
  assert.ok(structuralQuantityPreserved(ir, plan));
  for (const mutate of [
    plan => { plan.structural.blocks[0].pieces.find(piece => piece.kind === 'source' && piece.role === 'claim').sourceSpan.start++; },
    plan => { plan.structural.blocks[0].pieces.push({ kind: 'form', formId: 'forged-quantity', text: '3枚', anchor: 0, evidenceIds: plan.evidenceIds }); },
    plan => { const pieces = plan.structural.blocks[0].pieces; const claim = pieces.find(piece => piece.kind === 'source' && piece.role === 'claim'); const reason = pieces.find(piece => piece.kind === 'source' && piece.role === 'reason'); [claim.sourceSpan, reason.sourceSpan] = [reason.sourceSpan, claim.sourceSpan]; },
  ]) {
    const forged = forge(plan, ir, mutate); assertRejected(ir, forged); assert.equal(structuralQuantityPreserved(ir, forged), false);
  }
});

test('serialized roles, full relation conditions, provenance and rhetorical intent are never proof', async () => {
  const { ir, plans } = await build('雨が降っていたので、私は駅で待ちました。'); const plan = plans[0]; assert.ok(plan);
  const mutators = [
    block => { [block.relation.slots[0].role, block.relation.slots[1].role] = [block.relation.slots[1].role, block.relation.slots[0].role]; },
    block => { block.relation.slots[0].role = 'adversary'; },
    block => { block.relation.slots[0].tokenIds.pop(); },
    block => { block.relation.slots[0].factIds = block.relation.slots[1].factIds; },
    block => { block.relation.slots[0].span.end--; },
    block => { block.relation.conditions.pop(); },
    block => { block.relation.conditions[0].conditional = true; },
    block => { block.relation.conditions[0].polarity = 'negative'; },
    block => { block.relation.conditions[0].attribution.speaker = '太郎'; },
    block => { delete block.relation.conditions[0].preservation; },
    block => { block.relation.conditions[0].preservation = 'literal-copy'; },
    block => { block.relation.version = 1; },
    block => { block.relation.provenance.parserVersion = 'forged'; },
    block => { block.relation.provenance.inputHash = 'forged'; },
    block => { block.relation.sourceForm = 'trailing-reason'; },
    block => { block.intent.targetFactIds = []; },
    block => { block.intent.premiseFactIds = []; },
    block => { block.intent.act = 'invented_rebuttal'; },
  ];
  for (const mutate of mutators) assertRejected(ir, forge(plan, ir, value => mutate(value.structural.blocks[0])));
});

test('injected actors, reversed relations, dropped/duplicated premises, forged grammar and quotes fail after rehash', async () => {
  const { ir, plans } = await build('雨が降っていたので、私は駅で待ちました。'); const plan = plans[0];
  for (const mutate of [
    pieces => { pieces.find(piece => piece.kind === 'form' && piece.formId.startsWith('grammar:')).text = '待たなかった'; },
    pieces => { pieces.find(piece => piece.kind === 'form' && piece.formId === 'explanatory-turn').text = 'お前が悪いので'; },
    pieces => { pieces.find(piece => piece.kind === 'form' && piece.formId === 'source-cause-close').text = 'からではない。'; },
    pieces => { pieces.push(structuredClone(pieces.find(piece => piece.kind === 'source'))); },
    pieces => { pieces.splice(pieces.findIndex(piece => piece.kind === 'source' && piece.role === 'reason'), 1); },
    pieces => { pieces.reverse(); },
    pieces => { pieces[0].role = 'invented-speaker'; },
    pieces => { pieces.push({ kind: 'form', formId: 'forged-quote', text: '「みんなが褒めた」', anchor: 0, evidenceIds: plan.evidenceIds }); },
  ]) assertRejected(ir, forge(plan, ir, value => mutate(value.structural.blocks[0].pieces)));
});

test('rendering ignores submitted node text and verifier rejects forged node/evidence/narrative contracts', async () => {
  const { ir, plans } = await build('私は原因を見つけた。雨が降っていたので、ここで待ちました。私は確認しました。'); const plan = plans[0];
  const expected = renderStructural(ir, plan);
  for (const mutate of [
    plan => { plan.nodes[0].text = 'お前が3個盗んだ。'; },
    plan => { plan.nodes[0].id = 'rhetorical-node-forged'; },
    plan => { plan.nodes[0].factIds = []; },
    plan => { plan.nodes[0].sourceSpan.end--; },
    plan => { plan.nodes[0].mention = 'rhetorical_reference'; },
    plan => { plan.nodes[0].evidenceIds = ['forged']; },
    plan => { plan.nodes.pop(); },
    plan => { plan.nodes.push(structuredClone(plan.nodes[0])); },
    plan => { plan.narrative.units[0].role = 'conditional'; },
    plan => { plan.narrative.displayOrder.reverse(); },
    plan => { plan.intentPlan.targetFacts = []; },
    plan => { plan.family = 'invented'; },
    plan => { plan.evidenceIds.reverse(); },
    plan => { plan.forbiddenEffects.pop(); },
  ]) {
    const forged = structuredClone(plan); mutate(forged); forged.id = hash({ ...forged, id: '' }).slice(0, 24);
    assert.equal(renderStructural(ir, forged).text, expected.text);
    assert.deepEqual(renderStructural(ir, forged).spans, expected.spans);
    assertRejected(ir, forged);
  }
});

test('local edits retain original source-order node bindings and cannot borrow permissions from a moved safe clause', async () => {
  const source = '私は原因を見つけた。雨が降っていたので、私は駅で待ちました。「私は確認した。」';
  const { ir, plans } = await build(source), plan = plans.find(plan => plan.structural.localEdits.length >= 2); assert.ok(plan);
  const originals = originalStructuralNodes(ir);
  for (const edit of plan.structural.localEdits) {
    const original = originals.find(node => node.id === edit.nodeId); assert.ok(original);
    assert.ok(original.sourceSpan.start <= edit.sourceSpan.start && edit.sourceSpan.end <= original.sourceSpan.end);
  }
  const quoteNode = originals.find(node => node.text.includes('「')); assert.ok(quoteNode);
  const quotePosition = [...source.slice(0, source.lastIndexOf('私'))].length;
  for (const mutate of [
    plan => { plan.structural.localEdits[0].nodeId = plan.structural.blocks[0].nodeId; },
    plan => { plan.structural.localEdits[0].nodeId = originals[1].id; },
    plan => { const edit = plan.structural.localEdits[0]; edit.nodeId = quoteNode.id; edit.sourceSpan = { start: quotePosition, end: quotePosition + 1 }; },
    plan => { plan.structural.localEdits[0].to = 'お前'; },
    plan => { plan.structural.localEdits.push(structuredClone(plan.structural.localEdits[0])); },
    plan => { plan.structural.localEdits[0].evidenceIds = plan.structural.blocks[0].evidenceIds; },
  ]) assertRejected(ir, forge(plan, ir, mutate));
});

test('versions, search bounds, intensity, series and unexpected program mixtures fail closed', async () => {
  const { ir, plans } = await build('雨が降っていたので、私は駅で待ちました。'); const plan = plans[0];
  for (const mutate of [
    plan => { plan.structural.version = 1; },
    plan => { plan.structural.version = 2; },
    plan => { plan.structural.search.policy = 'unbounded'; },
    plan => { plan.structural.search.maxBlocks = 9; },
    plan => { plan.structural.search.maxPlans = 13; },
    plan => { plan.structural.search.freeText = true; },
    plan => { plan.structural.intensity = 1; },
    plan => { plan.structural.seriesId = 'unknown'; },
    plan => { plan.structural.seriesId = 'roto'; },
    plan => { plan.structural.blocks.push(structuredClone(plan.structural.blocks[0])); },
    plan => { plan.structural.blocks[0].sourceSpan.start++; },
    plan => { plan.structural.blocks[0].realizationId = 'free-text'; },
    plan => { plan.mainOperator = 'REWRITE'; },
    plan => { plan.experimental = false; },
    ...['rewrite', 'construction', 'surface', 'rhetoric', 'rhetoricEdits'].map(key => plan => { plan[key] = key === 'rhetoricEdits' ? [] : {}; }),
  ]) assertRejected(ir, forge(plan, ir, mutate));
  const strongest = plans.find(plan => plan.structural.blocks[0].realizationId === 'premise-then-fact-conclusion'); assert.ok(strongest);
  assertRejected(ir, forge(strongest, ir, value => { value.structural.intensity = 2; }));
  assert.equal(validateRewrite(ir, { ...plan, mainOperator: 'REWRITE', rewrite: { version: 1, seriesId: 'all', intensity: 3, edits: [] } }, references), false);
  assert.equal(validateConstruction(ir, { ...plan, mainOperator: 'CONSTRUCTION', construction: { version: 2, seriesId: 'all', intensity: 3, edits: [], lexicalEdits: [] } }, references), false);
});

test('source example identity, distinct provenance, evidence text and selected-series licensing are rechecked', async () => {
  const { ir, plans } = await build('彼が資料を捨てたという証拠はありますか？', { series: 'roto' }); assert.ok(plans.length);
  const plan = plans[0], ids = plan.structural.blocks[0].evidenceIds; assert.equal(ids.length, 2);
  const missing = new Map(references); missing.delete(ids[0]); assert.equal(validateStructural(ir, plan, missing), false);
  const changed = new Map(references); changed.set(ids[0], 'これは無関係な出典です。'); assert.equal(validateStructural(ir, plan, changed), false);
  const fabricated = new Map(references); fabricated.set(ids[0], references.get(ids[0]) + '架空の出典追記'); assert.equal(validateStructural(ir, plan, fabricated), false, 'keeping the attested needle is not enough');
  for (const mutate of [
    plan => { plan.structural.blocks[0].evidenceIds = [ids[0], ids[0]]; },
    plan => { plan.structural.blocks[0].evidenceIds = ids.slice(0, 1); },
    plan => { plan.structural.blocks[0].evidenceIds = ['post_00016_82d78e65bd643a54_22', ids[0]]; },
    plan => { plan.structural.seriesId = 'night'; },
    plan => { plan.structural.blocks[0].pieces.find(piece => piece.kind === 'form').evidenceIds = ['forged']; },
  ]) assertRejected(ir, forge(plan, ir, mutate));
  const restricted = await build('雨が降っていたので、私は駅で待ちました。', { series: 'katuru' }); assert.ok(restricted.plans.length);
  const forbiddenEdit = { nodeId: 'fact-node-0', sourceSpan: { start: 10, end: 11 }, ruleId: 'narrator-watashi', from: '私', to: '俺', evidenceIds: ['post_00016_82d78e65bd643a54_22'] };
  const position = [...restricted.source.slice(0, restricted.source.indexOf('私'))].length; forbiddenEdit.sourceSpan = { start: position, end: position + 1 };
  assertRejected(restricted.ir, forge(restricted.plans[0], restricted.ir, value => { value.structural.localEdits.push(forbiddenEdit); }));
});

test('exact evidence text is rechecked for local edits and at final candidate verification', async () => {
  const { source, ir, request, plans } = await build('雨が降っていたので、私は駅で待ちました。');
  const plan = plans.find(plan => plan.structural.localEdits.length); assert.ok(plan);
  assert.equal(validateStructural(ir, plan), true, 'internal no-reference verification remains supported');
  const lexicalId = plan.structural.localEdits[0].evidenceIds[0];
  const forgedReferences = new Map(references); forgedReferences.set(lexicalId, references.get(lexicalId) + '架空の出典追記');
  assert.equal(validateStructural(ir, plan, forgedReferences), false);
  const result = generate(request, structuredClone(analyses.get(source)), assets);
  const candidate = result.candidatePool.find(candidate => candidate.plan.structural); assert.ok(candidate);
  assert.equal(candidate.verificationStatus, 'passed');
  candidate.evidence[0].text += '架空の出典追記';
  const verified = finishSemanticVerification(result, {});
  assert.equal(candidate.checks.find(check => check.code === 'S-structural-program').status, 'fail');
  assert.equal(candidate.verificationStatus, 'rejected');
  assert.ok(!verified.candidates.includes(candidate));
});

test('engine reuses fresh bounded proofs for scores without bypassing other required checks', async () => {
  const seen = new Set();
  for (const source of ['雨が降っていたので、私は駅で待ちました。', '私の怒りが頂点に達しました。']) {
    const { request } = await build(source);
    const result = generate(request, structuredClone(analyses.get(source)), assets);
    for (const candidate of result.candidatePool) {
      const { plan } = candidate, code = plan.structural ? 'V-structural' : plan.construction ? 'V-construction' : plan.rewrite ? 'V-rewrite' : null;
      if (!code) continue;
      seen.add(code);
      const proof = candidate.checks.find(check => check.code === code); assert.ok(proof?.required);
      assert.equal(candidate.scores.C, proof.status === 'pass' ? 1 : 0);
      if (proof.status === 'pass') assert.deepEqual({ C: candidate.scores.C, R: candidate.scores.R }, ruleQuality(result.ir, plan));
    }
    const dictionaryRequest = { ...request, customRules: [{ id: 'arbitrary-body-change', from: '私', to: 'お前', priority: 1 }] };
    const unknown = generate(dictionaryRequest, structuredClone(analyses.get(source)), assets);
    assert.ok(unknown.candidatePool.some(candidate => candidate.scores.C === 1));
    assert.ok(unknown.candidatePool.every(candidate => candidate.checks.some(check => check.code === 'V-dictionary' && check.status === 'unknown')));
    assert.equal(unknown.candidates.length, 0, 'a passing bounded score never overrides another required unknown check');
  }
  assert.deepEqual([...seen].sort(), ['V-construction', 'V-rewrite', 'V-structural']);
});

test('source-bound recognition refuses conditional, modal, quoted and unrelated premises', async () => {
  for (const source of [
    '雨が降れば、私は駅で待ちます。',
    '雨が降っているかもしれないので、私は駅で待った。',
    '雨が降っていたので、私は駅で待つつもりだ。',
    '雨が降っているので、窓を閉めなければならない。',
    '雨が降っているので、窓を閉めるはずだ。',
    '「雨が降っていたので、私は駅で待った。」',
    '彼は雨が降っていたので駅で待ったと言った。',
    '大したことはしていない。太郎は機械を動かしただけだ。',
    '大したことはしていない。機械を動かさなかっただけだ。',
    '彼が資料を捨てた。証拠はありますか？',
    '彼が資料を捨てたという証拠はありませんか？',
  ]) {
    const { ir, plans } = await build(source); assert.equal(plans.length, 0, source);
    assert.equal(recognizeRhetoricalRelations(ir).length, 0, source);
  }
});

test('evidence request shell cannot promote, deny, quote or change its mentioned target', async () => {
  for (const source of ['彼が資料を捨てたという証拠はありますか？', '私が戻らないという証拠を見せてください。']) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    const plan = plans[0]; assert.ok(validateStructural(ir, plan, references));
    for (const mutate of [
      block => { block.pieces.find(piece => piece.kind === 'form').text = 'という事実。'; },
      block => { block.pieces.find(piece => piece.kind === 'form').text = 'という証拠はない。'; },
      block => { block.relation.conditions.find(condition => condition.illocution === 'mentioned-proposition').illocution = 'assertion'; },
      block => { block.relation.slots.find(slot => ['target','carrier'].includes(slot.role)).role = 'claim'; },
      block => { block.pieces = block.pieces.filter(piece => piece.kind !== 'source'); },
      block => { block.pieces.find(piece => piece.kind === 'source').sourceSpan.end--; },
    ]) assertRejected(ir, forge(plan, ir, value => mutate(value.structural.blocks[0])));
  }
});

test('explicit contrast prefixes in evidence requests remain source-bound and appear exactly once', async () => {
  for (const source of [
    '便利なのは分かった。しかし安全だという証拠を見せてほしい。',
    'しかし、太郎が来たという証拠はありますか。',
  ]) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    for (const plan of plans) {
      assert.ok(validateStructural(ir, plan, references), source);
      assert.ok(structuralQuantityPreserved(ir, plan), source);
      assert.equal(renderStructural(ir, plan).text.split('しかし').length - 1, 1);
    }
    const original = plans[0];
    const prefixRole = original.structural.blocks[0].relation.sourceForm === 'carrier-evidence-request' ? 'context' : 'contrast-prefix';
    for (const mutate of [
      block => { block.pieces = block.pieces.filter(piece => piece.role !== prefixRole); },
      block => { block.pieces.push(structuredClone(block.pieces.find(piece => piece.role === prefixRole))); },
      block => { block.pieces.find(piece => piece.role === prefixRole).sourceSpan.end++; },
      block => { if (prefixRole === 'context') block.relation.slots = block.relation.slots.filter(slot => slot.role !== 'context'); else block.relation.markers = block.relation.markers.filter(marker => marker.role !== 'contrast-prefix'); },
    ]) assertRejected(ir, forge(original, ir, value => mutate(value.structural.blocks[0])));
  }
});

test('malformed serialized structural programs return false rather than throwing', async () => {
  const { ir, plans } = await build('雨が降っていたので、私は駅で待ちました。'); const original = plans[0];
  for (const value of [undefined, null, false, {}, [], { structural: null }, { structural: [] }]) {
    assert.equal(validateStructural(ir, value, references), false);
    assert.equal(structuralQuantityPreserved(ir, value), false);
  }
  for (const mutate of [
    plan => { plan.structural.blocks = null; },
    plan => { plan.structural.blocks = [null]; },
    plan => { plan.structural.localEdits = null; },
    plan => { plan.structural.blocks[0].relation = null; },
    plan => { plan.structural.blocks[0].sourceSpan.start = NaN; },
    plan => { plan.structural.blocks[0].pieces = null; },
    plan => { plan.structural.blocks[0].evidenceIds = {}; },
    plan => { plan.structural.localEdits = [null]; },
    plan => { plan.nodes = null; },
    plan => { plan.backTranslation = {}; },
  ]) {
    const plan = structuredClone(original); mutate(plan);
    assert.equal(validateStructural(ir, plan, references), false);
  }
});

test('fresh independent validation never calls the planner or reuses stale source conditions', async t => {
  const { ir, plans } = await build('雨が降っていたので、私は駅で待ちました。'); const plan = plans[0];
  const spy = t.mock.method(planning, 'makeStructuralPlans', () => { throw new Error('PLANNER_MUST_NOT_RUN'); });
  assert.equal(validateStructural(ir, plan, references), true); assert.equal(spy.mock.callCount(), 0);
  const root = ir.tokens.find(token => token.dep === 'ROOT'); root.morphology.push('Inflection=五段;仮定形-一般');
  assert.equal(validateStructural(ir, plan, references), false);
  root.morphology.pop(); assert.equal(validateStructural(ir, plan, references), true);
  ir.facts[0].polarity = ir.facts[0].polarity === 'positive' ? 'negative' : 'positive';
  assert.equal(validateStructural(ir, plan, references), false);
});

test('bounded multi-block composition uses each adopted source unit exactly once and keeps overflow unchanged', async () => {
  const unit = '雨が降っていたので、私は駅で待ちました。';
  const { ir, plans } = await build(unit.repeat(9)); assert.ok(plans.length && plans.length <= 12);
  for (const plan of plans) {
    assert.equal(plan.structural.blocks.length, 8); assert.equal(validateStructural(ir, plan, references), true);
    const output = renderStructural(ir, plan).text;
    assert.ok(output.endsWith(unit) || output.endsWith(unit.replace('私', '俺')));
    assert.equal(plan.nodes.filter(node => node.type === 'FactClause').reduce((sum, node) => sum + node.sourceSpan.end - node.sourceSpan.start, 0), [...ir.source.raw].length);
  }
});

test('v2 actual-cause tame keeps state, negative claim, comparative quantities and direction', async () => {
  for (const source of [
    '冷蔵庫が故障したため、私は弁当を買いました。',
    '電車が止まったため、到着が30分遅れました。',
    '料金が1000円以上だったため、私は注文しませんでした。',
  ]) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    assert.ok(plans.some(plan => plan.structural.blocks.some(block => block.relation.sourceForm === 'causal-tame')), source);
    for (const plan of plans) {
      assert.ok(validateStructural(ir, plan, references), source); assert.ok(structuralQuantityPreserved(ir, plan));
      if (source.includes('しませんでした')) assert.match(renderStructural(ir, plan).text, /注文しなかった/u);
    }
  }
  for (const source of ['私は夕食を作るため、早く帰った。', '私は試験に合格するため、毎日勉強している。', '私は部品を買うために店へ行きました。']) {
    const { plans } = await build(source);
    assert.ok(plans.every(plan => plan.structural.blocks.every(block => block.relation.kind !== 'reason-claim')), source);
  }
});

test('v2 future and potential claims retain source modality and cannot become fact nominalizations', async () => {
  for (const [source, retained] of [
    ['会議が長引いたので、私は明日資料を送ります。', /明日資料を送る/u],
    ['部品が届いたので、私は修理できます。', /修理できる/u],
  ]) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    for (const plan of plans) {
      assert.ok(validateStructural(ir, plan, references), source);
      const block = plan.structural.blocks.find(block => block.relation.kind === 'reason-claim'); assert.ok(block);
      assert.ok(block.relation.conditions.some(condition => condition.preservation === 'modality-preserved'), source);
      assert.equal(block.operatorId, 'reason-explanation');
      const text = renderStructural(ir, plan).text; assert.match(text, retained); assert.doesNotMatch(text, /という事実|ということ/u);
      assertRejected(ir, forge(plan, ir, value => { value.structural.blocks[0].relation.conditions.forEach(condition => { condition.preservation = 'asserted'; condition.prospective = false; condition.realization = 'actual'; }); }));
      assertRejected(ir, forge(plan, ir, value => { value.structural.blocks[0].operatorId = 'reason-nominalized-conclusion'; value.structural.blocks[0].realizationId = 'premise-then-fact-conclusion'; }));
    }
  }
});

test('v2 same-sentence self-limitation and past ability retain limitation rather than inventing achievement', async () => {
  for (const [source, retained] of [
    ['自慢ではないが、私は資料を期限内に提出した。', /自慢ではない/u],
    ['私は詳しくないが、私はこの設定を直せた。', /詳しくない/u],
    ['私は専門家ではありません。設定を直すことができました。', /専門家ではない/u],
  ]) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    for (const plan of plans) {
      assert.ok(validateStructural(ir, plan, references), source);
      const text = renderStructural(ir, plan).text; assert.match(text, retained);
      assert.doesNotMatch(text, /それほどでもない|みんな|褒め|最強|尊敬/u);
      if (source.includes('直せた')) assert.match(text, /直せた/u);
      if (source.includes('できました')) assert.match(text, /できた/u);
    }
  }
  for (const source of [
    '大したことはしていないが、明日は修理できる。',
    '私は専門家ではない。太郎が問題を解決できた。',
    '私は詳しくないが、私は直せなかった。',
    '自慢ではないが、私は修理できるはずだった。',
  ]) {
    const { plans } = await build(source);
    assert.ok(plans.every(plan => plan.structural.blocks.every(block => block.relation.kind !== 'modest-achievement')), source);
  }
});

test('v2 nominal evidence targets remain nonasserted source terms and retain their modifiers', async () => {
  for (const source of ['この予測の根拠を教えてください。', 'その主張の証拠を見せてください。']) {
    const { ir, plans } = await build(source); assert.ok(plans.length, source);
    for (const plan of plans) {
      assert.ok(validateStructural(ir, plan, references), source);
      const block = plan.structural.blocks.find(block => block.relation.kind === 'evidence-request'); assert.ok(block);
      assert.equal(block.relation.targetMode, 'nominal');
      const target = block.relation.slots.find(slot => ['target','carrier'].includes(slot.role)); assert.ok(target);
      const targetText = [...source].slice(target.span.start, target.span.end).join('');
      assert.ok(renderStructural(ir, plan).text.includes(targetText));
      assert.ok(!block.relation.conditions.some(condition => target.factIds.includes(condition.factId) && condition.illocution === 'assertion'));
      assertRejected(ir, forge(plan, ir, value => { value.structural.blocks[0].relation.targetMode = 'proposition'; }));
      assertRejected(ir, forge(plan, ir, value => { value.structural.blocks[0].relation.targetLink = 'quotative'; }));
    }
  }
});

test('v2 concessive evidence context is literal-only even when an ordinary lexical rule would otherwise fit', async () => {
  const source = '私は説明を聞きましたが、この装置が安全だという証拠を示してください。';
  const { ir, plans } = await build(source); assert.ok(plans.length, source);
  for (const plan of plans) {
    assert.ok(validateStructural(ir, plan, references), source);
    const block = plan.structural.blocks.find(block => block.relation.slots.some(slot => slot.role === 'context')); assert.ok(block);
    const context = block.relation.slots.find(slot => slot.role === 'context');
    const text = [...source].slice(context.span.start, context.span.end).join('');
    assert.ok(renderStructural(ir, plan).text.startsWith(text));
    assert.ok(block.relation.conditions.some(condition => condition.preservation === 'literal-copy' && condition.illocution === 'literal-context'));
    assert.ok(plan.structural.localEdits.every(edit => edit.sourceSpan.start >= context.span.end || edit.sourceSpan.end <= context.span.start));
    assertRejected(ir, forge(plan, ir, value => { value.structural.localEdits.push({ nodeId: 'fact-node-0', ruleId: 'narrator-watashi', from: '私', to: '俺', sourceSpan: { start: 0, end: 1 }, evidenceIds: ['post_00016_82d78e65bd643a54_22'] }); }));
    assertRejected(ir, forge(plan, ir, value => { value.structural.blocks[0].pieces = value.structural.blocks[0].pieces.filter(piece => piece.role !== 'context'); }));
    assertRejected(ir, forge(plan, ir, value => { value.structural.blocks[0].relation.conditions.filter(condition => condition.illocution === 'literal-context').forEach(condition => { condition.preservation = 'asserted'; condition.illocution = 'assertion'; }); }));
  }
});

test('actionless acquisition desire is not weakened to an existence question', async () => {
  for (const source of ['説明は聞いた。しかしこの方法が確実だという証拠が欲しい。', 'しかし、太郎が来なかったという証拠が欲しいです。']) {
    const { ir, plans } = await build(source);
    assert.ok(!recognizeRhetoricalRelations(ir).some(relation => relation.kind === 'evidence-request'));
    assert.equal(plans.length, 0);
  }
});
