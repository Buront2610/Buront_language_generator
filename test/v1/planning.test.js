'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { verifyGeneratedResult, semanticAnalyses } = require('../../dist/packages/runtime/semantic-verification');
const { compileAssets, retrievalFor } = require('../../dist/packages/core/assets');
const { sourceDocument, slice, hash } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { generate } = require('../../dist/packages/core/engine');
const { replayGeneration } = require('../../dist/packages/core/replay');
const { makePlans } = require('../../dist/packages/core/creation');
const { planIntent, planNarrative } = require('../../dist/packages/core/planning');
const { frameRhetoric, validateSurface } = require('../../dist/packages/core/series');
const { rhetoricalCore, evaluateNovelty } = require('../../dist/packages/core/evaluation');
const { compareSemantics, finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { validateCandidate, realize, verification } = require('../../dist/packages/core/validator');
const request = (source, options = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 1, seed: 'planning-regression', ...options });
let python, assets;
const analyzed = new Map();
const analyze = async text => { if (!analyzed.has(text)) analyzed.set(text, await python.analyze(text)); return analyzed.get(text); };
const irFor = async text => extractFacts(sourceDocument(text), await analyze(text), request(text));
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); });
after(() => python?.close());

test('T-03 explicit passive participants have semantic roles; ambiguous potential stays unknown', async () => {
  const passive = (await irFor('田中に佐藤が助けられた。')).facts[0];
  assert.equal(passive.voice, 'passive');
  assert.equal(passive.arguments.find(argument => argument.role === 'agent').text, '田中');
  assert.equal(passive.arguments.find(argument => argument.role === 'patient').text, '佐藤');
  assert.equal(passive.tense, 'past');
  const potential = (await irFor('私は明日食べられる。')).facts[0];
  assert.equal(potential.voice, 'unknown'); assert.equal(potential.resolution, 'partial');
});

test('T-04 temporal scope distinguishes past negation, ongoing work, and the name Tanaka', async () => {
  const completed = (await irFor('田中が確認した。')).facts[0]; assert.equal(completed.completion, 'completed');
  const past = (await irFor('担当者が確認しませんでした。')).facts[0];
  const present = (await irFor('担当者が確認しません。')).facts[0];
  assert.equal(past.polarity, 'negative'); assert.equal(past.tense, 'past'); assert.equal(present.tense, 'nonpast');
  for (const text of ['担当者が確認しています。', '担当者が確認していました。']) assert.equal((await irFor(text)).facts[0].completion, 'ongoing');
});

test('M3 explicit anchors retain numeric target, utterance, use and fact bindings', async () => {
  const text = '>>123に同意する。ありがとう。', ir = await irFor(text), anchor = ir.anchors[0];
  assert.equal(anchor.raw, '>>123'); assert.equal(anchor.target, '123'); assert.equal(anchor.usage, 'agreement');
  assert.equal(slice(text, anchor.utteranceSpan), '>>123に同意する。'); assert.ok(anchor.factIds.length);
  assert.equal(planNarrative(ir, 'status_order').strategy, 'source_order');
});

test('M3 independent sentences get a stable status order and exactly one primary fact mention', async () => {
  const text = '私は明日確認する。佐藤は修理していない。田中が復旧した。', analysis = await analyze(text);
  const result = generate(request(text), analysis, assets);
  const plans = makePlans(result.ir, request(text, { contextMode: 'full' }), assets);
  const narrative = plans.find(plan => plan.narrative.strategy === 'status_order').narrative;
  assert.deepEqual(narrative.units.map(unit => unit.role), ['prospect', 'unresolved', 'achievement']);
  assert.deepEqual(narrative.displayOrder, ['unit-2', 'unit-1', 'unit-0']);
  assert.ok(result.candidates.length);
  for (const plan of plans) {
    const nodes = plan.nodes.filter(node => node.type === 'FactClause');
    assert.equal(nodes.length, 3); assert.ok(nodes.every(node => node.mention === 'primary'));
    assert.deepEqual(nodes.flatMap(node => node.factIds).sort(), result.ir.facts.map(fact => fact.id).sort());
    assert.equal([...nodes].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start).map(node => node.text).join(''), text);
    const draft = realize(plan, result.ir);
    assert.equal(verification(validateCandidate(result.ir, plan, draft.text, draft.spans, new Set(assets.evidence.map(item => item.id)), new Set(plan.nodes.filter(node => node.type === 'RhetoricalClause').map(node => node.text)), new Map(assets.evidence.map(item => [item.id, item.text])), assets.seriesProfiles)), 'passed');
  }
});

test('M3 pronouns, quotes, causal links and omitted participants keep source order', async () => {
  for (const text of ['田中が復旧した。それを佐藤が確認する。', '田中が「明日確認する」と言った。佐藤が修理した。', '田中が修理した。その後、佐藤が確認する。', '田中が修理した。明日確認する。']) {
    const ir = await irFor(text), plan = planNarrative(ir, 'status_order');
    assert.equal(plan.strategy, 'source_order', text); assert.deepEqual(plan.displayOrder, plan.sourceOrder);
  }
});

test('M1 explicit speech acts choose a factual target and never invent an addressee', async () => {
  for (const [text, act] of [['私は感謝する。', 'gratitude'], ['私は危険を警告する。', 'warning'], ['私は提案に反対する。', 'rebuttal'], ['田中が復旧した。佐藤は修理していない。', 'unresolved']]) {
    const ir = await irFor(text), intent = planIntent(ir);
    assert.equal(intent.act, act, text); assert.equal(intent.addressee, null); assert.equal(intent.targetFacts.length, 1);
    assert.ok(intent.forbiddenEffects.includes('invent_opponent'));
    if (act === 'unresolved') { const plans = makePlans(ir, request(text), assets); assert.ok(plans.every(plan => plan.backTranslation.includes('修理') && !plan.backTranslation.includes('復旧'))); }
  }
});

test('M3 every series has corpus-backed vocabulary and frames; citations stay inside the series', async () => {
  const text = '今日は寒い。', analysis = await analyze(text);
  assert.equal(assets.seriesProfiles.length, 10);
  for (const series of assets.series) {
    const result = generate(request(text, { series: series.id }), analysis, assets);
    if (!result.candidates.length) { assert.equal(result.fallback.text, text); continue; }
    for (const candidate of result.candidates) {
      assert.equal(candidate.plan.rewrite.seriesId, series.id);
      if (series.id !== 'all') for (const id of candidate.plan.evidenceIds) assert.ok(assets.evidence.find(item => item.id === id).series.includes(series.id), `${series.id}: ${id}`);
      assert.ok(candidate.checks.every(check => check.status === 'pass'));
    }
  }
});

test('M3 lexical evidence matches a whole word, not the sword character inside serious', () => {
  const sword = assets.lexicon.find(lexeme => lexeme.lemma === '剣');
  const corpus = require('../../data/log-corpus.json');
  for (const id of sword.evidenceIds) assert.ok(corpus.sentences.find(sentence => sentence.id === id).tokens.includes('剣'));
  assert.ok(!sword.evidenceIds.some(id => assets.evidence.find(item => item.id === id).text === '真剣な喧嘩の事をタイマンって言うべ？'));
});

test('M3 repeated source facts are preserved and are not scored as generated rhetoric repetition', async () => {
  const text = '担当者が状況を確認しました。'.repeat(30), analysis = await analyze(text);
  const result = await verifyGeneratedResult(generate(request(text), analysis, assets), python, analysis);
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) {
    assert.equal(candidate.scores.R, 1);
    assert.equal(candidate.plan.nodes.length,30); assert.equal((candidate.text.match(/担当者が状況を確認/g)||[]).length,30); assert.ok(candidate.plan.rewrite.edits.filter(e=>e.ruleId.startsWith('ending-')).length<=1);
  }
});

test('Legacy relation frames still reject forged provenance; frame-only changes have identical novelty', async () => {
  const text = '今日は寒い。';
  const ir = await irFor(text); const plan = makePlans(ir, request(text, { series: 'roto' }), assets)[0]; const candidate = { plan };
  const references = new Map(assets.evidence.map(item => [item.id, item.text]));
  const { surface } = candidate.plan;
  assert.ok(validateSurface(surface, candidate.plan.nodes.find(node => node.id === 'main-quote').text, assets.seriesProfiles, references));
  assert.equal(validateSurface({ ...surface, profileHash: 'forged' }, frameRhetoric(surface.coreText, surface.constructionId), assets.seriesProfiles, references), false);
  const alternate = structuredClone(candidate); alternate.plan.surface.constructionId = 'plain'; alternate.plan.surface.evidenceIds = [];
  alternate.plan.nodes.find(node => node.id === 'main-quote').text = frameRhetoric(surface.coreText, 'plain');
  assert.equal(rhetoricalCore(candidate), rhetoricalCore(alternate));
  assert.deepEqual(evaluateNovelty(candidate, assets, retrievalFor(assets), []), evaluateNovelty(alternate, assets, retrievalFor(assets), []));
});

test('M3 changed narrative order and status labels cannot be self-certified', async () => {
  const text = '私は明日確認する。佐藤は修理していない。田中が復旧した。', ir = await irFor(text);
  const original = makePlans(ir, request(text, { contextMode: 'full' }), assets)[0];
  const allowed = new Set(original.nodes.filter(node => node.type === 'RhetoricalClause').map(node => node.text));
  const check = plan => { const draft = realize(plan, ir); return validateCandidate(ir, plan, draft.text, draft.spans, new Set(assets.evidence.map(item => item.id)), allowed, new Map(assets.evidence.map(item => [item.id, item.text])), assets.seriesProfiles); };
  const forged = structuredClone(original); forged.narrative.displayOrder.reverse(); assert.equal(check(forged).find(check => check.code === 'V-plan').status, 'fail');
  const label = structuredClone(original); label.nodes.find(node => node.id === 'label-unit-1').text = '【成果】\n'; assert.equal(check(label).find(check => check.code === 'V-rhetoric').status, 'fail');
});

test('M3 independent reanalysis rejects every fixed design counterexample using real parsed source and output', async () => {
  for (const row of require('../fixtures/design-counterexamples.json')) {
    const checks = compareSemantics(await irFor(row.source), await irFor(row.candidate));
    assert.ok(checks.some(check => check.status === 'fail'), `${row.id}: ${JSON.stringify(checks)}`);
  }
});

test('M3 independent checks identify roles, scoped polarity, negative tense and missing reported speaker', async () => {
  const examples = [
    ['田中が佐藤を助けた。', '佐藤が田中を助けた。', 'S-roles'],
    ['田中は承認した。佐藤は承認していない。', '田中は承認していない。佐藤は承認した。', 'S-polarity'],
    ['担当者が確認しませんでした。', '担当者が確認しません。', 'S-temporal'],
    ['田中が確認したと佐藤が言った。', '田中が確認した。', 'S-attribution'],
  ];
  for (const [source, output, code] of examples) assert.equal(compareSemantics(await irFor(source), await irFor(output)).find(check => check.code === code).status, 'fail', code);
  const uncertain = await irFor('それはできなくはない。');
  assert.equal(compareSemantics(uncertain, uncertain).find(check => check.code === 'S-polarity').status, 'unknown');
});

test('M3 bounded body proof is explicit and reproduced on replay without claiming a reparse', async () => {
  const text = '担当者が状況を確認しました。', analysis = await analyze(text);
  const result = generate(request(text), analysis, assets);
  const analyses = await semanticAnalyses(result, python, analysis);
  assert.equal(Object.keys(analyses).length, 0);
  const verified = finishSemanticVerification(result, analyses);
  // Punctuation-only and plain-ending variants also have bounded edit proofs.
  assert.ok(verified.candidates.length >= 1 && verified.candidates.length <= 3);
  assert.ok(verified.candidates.every(candidate => candidate.checks.some(check => check.code === 'S-bounded-rewrite' && check.status === 'pass')));
  const replayed = await verifyGeneratedResult(replayGeneration(verified.replayManifest, analysis, assets), python, analysis);
  assert.equal(hash(replayed.replayManifest.semanticVerification), hash(verified.replayManifest.semanticVerification));
  const literalText = '今日は寒い。', literalAnalysis = await analyze(literalText);
  const literal = generate(request(literalText), literalAnalysis, assets);
  assert.deepEqual(await semanticAnalyses(literal, { analyze: () => { throw new Error('unnecessary parser call'); } }, literalAnalysis), {});
});
