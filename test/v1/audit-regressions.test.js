'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { extractFacts } = require('../../dist/packages/core/facts');
const { sourceDocument } = require('../../dist/packages/core/source');
const { validateCandidate, realize, verification } = require('../../dist/packages/core/validator');
const { frameRhetoric } = require('../../dist/packages/core/series');
const { compareSemantics } = require('../../dist/packages/core/semantic');
const { features, rhetoricalCore } = require('../../dist/packages/core/evaluation');
const { planNarrative } = require('../../dist/packages/core/planning');
const { makePlans } = require('../../dist/packages/core/creation');
const { verifyGeneratedResult } = require('../../dist/packages/runtime/semantic-verification');
const { ruleQuality, select, outputFeatures, featureVersion } = require('../../dist/packages/core/evaluation');
const { blindPairs } = require('../../dist/packages/evaluation/dataset');
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'audit-fixed', ...extra });
let python, assets;
const cache = new Map();
const analyze = async text => { if (!cache.has(text)) cache.set(text, await python.analyze(text)); return cache.get(text); };
const irFor = async text => extractFacts(sourceDocument(text), await analyze(text), request(text));
const run = async (text, extra) => generate(request(text, extra), await analyze(text), assets);
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); });
after(() => python?.close());

test('A8 known temporal mismatch survives an unrelated unknown completion', async () => {
  const checks = compareSemantics(await irFor('田中が確認しなかった。今日は寒い。'), await irFor('田中が確認しない。今日は寒い。'));
  assert.equal(checks.find(check => check.code === 'S-temporal').status, 'fail');
  assert.equal(verification(checks), 'rejected');
});

test('A2 changing declared body output cannot approve itself', async () => {
  const result=await run('田中が佐藤を助けた。');assert.ok(result.candidates.length);
  for(const text of ['佐藤が田中を助けた。','佐藤は承認を終えた。','田中が佐藤を助けなかった。']) {
    const plan=structuredClone(result.candidates[0].plan);plan.nodes[0].text=text;
    const draft=realize(plan,result.ir),checks=validateCandidate(result.ir,plan,draft.text,draft.spans,new Set(assets.evidence.map(e=>e.id)),undefined,new Map(assets.evidence.map(e=>[e.id,e.text])),assets.seriesProfiles);
    assert.equal(checks.find(c=>c.code==='V-rewrite').status,'fail');assert.equal(ruleQuality(result.ir,plan).C,0);
  }
});

test('A1 changing source participants changes the rewritten body', async () => {
  const left = await run('田中が佐藤を助けた。'), right = await run('佐藤が田中を助けた。');
  assert.ok(left.candidates.length && right.candidates.length);
  assert.ok(left.candidates.every(a => right.candidates.every(b => rhetoricalCore(a) !== rhetoricalCore(b))));
  assert.ok(left.candidates.every(candidate => candidate.text.includes('田中が佐藤を助けた')));
});

test('A3 free dictionaries do not bypass the bounded body proof', async () => {
  for(const to of ['冷え込み','冷気','実際には佐藤が田中を助けた。']) {
    const result=await run('今日は寒い。',{customRules:[{id:'cold',from:'寒さ',to,priority:0}]});
    assert.equal(result.candidates.length,0);assert.ok(result.reviewCandidates.length);
    assert.equal(result.shortfallReason,'dictionary_needs_review');
    for(const c of result.reviewCandidates){assert.ok(!c.text.includes(to));assert.equal(c.checks.find(x=>x.code==='V-dictionary').status,'unknown')}
  }
});

test('A5 features depend exclusively on actual output and ignore declared operator/input syntax', () => {
  const text = 'これは比較のための同じ出力。';
  assert.deepEqual(features({ text, plan: { mainOperator: 'OP-01', intent: 'achievement', backTranslation: 'x', linguisticFeatures: { 'pos:NOUN': 1 } } }), features({ text, plan: { mainOperator: 'LEGACY', intent: 'unknown', linguisticFeatures: {} } }));
});

test('A7 mixed sentence has separate event units without severing conditions or quotations', async () => {
  const ir = await irFor('田中がAを復旧した。Bは停止中で、私は明日確認する。');
  const narrative = planNarrative(ir, 'status_order');
  assert.deepEqual(narrative.units.map(unit => unit.role), ['achievement', 'unresolved', 'prospect']);
  assert.ok(narrative.units.every(unit => unit.factIds.length === 1));
  for (const text of ['Bが停止したなら、私は確認する。', '田中が「Bは停止中で、私は明日確認する」と言った。']) {
    assert.equal(planNarrative(await irFor(text), 'status_order').units.length, 1);
  }
});

test('A1 operator applicability and source state affect generation, not just metadata', async () => {
  const past = await run('田中が佐藤を助けた。'), negative = await run('田中が佐藤を助けなかった。');
  assert.ok(negative.candidates.length);
  assert.ok(negative.candidates.every(c => c.text.includes('助けなかった')));
  assert.ok(past.candidates.every(c => c.text.includes('助けた')));
  assert.ok(past.candidates.every(c => c.plan.mainOperator !== 'OP-07'));
  const futureIR = await irFor('私は明日確認する。');
  assert.ok(makePlans(futureIR, request(futureIR.source.raw), assets).some(plan => plan.mainOperator === 'OP-07'));
  const topic = await run('猫');
  assert.equal(topic.candidates.length, 0); assert.equal(topic.fallback.text, '猫');
  const reported = await run('田中が佐藤を助けたと鈴木が言った。');
  assert.ok(reported.candidates.length);
  for (const candidate of reported.candidates) {
    assert.equal(candidate.text, '田中が佐藤を助けたと鈴木が言った');
    assert.ok(candidate.plan.rewrite.edits.every(edit => edit.ruleId.startsWith('punctuation-')));
  }
});

test('Legacy A2/A4 inverse grammar rejects role, state, domain and disconnected conclusion mutations', async () => {
  const ir=await irFor('田中が佐藤を助けた。'); const result={ir};
  const base=makePlans(ir,request(ir.source.raw),assets)[0];
  for (const mutate of [
    plan => { plan.rhetoric.participants.reverse(); },
    plan => { plan.rhetoric.polarity = 'negative'; },
    plan => { plan.rhetoric.target = '証拠'; },
    plan => { plan.mapping.source = 'pretend-new-concept'; },
    plan => { plan.surface.coreText = plan.surface.coreText.replace('田中から佐藤', '佐藤から田中'); },
    plan => { plan.surface.coreText = plan.surface.coreText.replace('届いた助力', '届かなかった助力'); },
    plan => { const parts = plan.surface.coreText.split('。'); parts[1] = '逆さの意味が意味して椅子する'; plan.surface.coreText = parts.join('。'); },
  ]) {
    const plan = structuredClone(base); mutate(plan);
    plan.nodes.find(node => node.id === 'main-quote').text = frameRhetoric(plan.surface.coreText, plan.surface.constructionId);
    assert.equal(ruleQuality(result.ir, plan).C, 0);
    assert.equal(ruleQuality(result.ir, plan).R, 0);
  }
});

test('A1/A2 past ongoing actions never become present ongoing or completed rhetoric', async () => {
  for (const [source, expected] of [['田中が佐藤を助けていた。', /助けていた/u], ['担当者が状況を確認していました。', /確認して(?:いました|いた)/u], ['担当者が状況を調べた。', /調べた/u]]) {
    const result = await run(source); assert.ok(result.candidates.length, source);
    for (const candidate of result.candidates) assert.match(candidate.text, expected, source);
  }
});

test('A4 selection respects Pareto preference axes and rejects low-quality novel candidates', async () => {
  const result = await run('私は処理の速度をアピールした。'), base = result.candidates;
  assert.equal(base.length, 3);
  const candidates = base.map((c, i) => ({ ...structuredClone(c), id: String(i), scores: { ...c.scores, S: [100, 2, 1][i], Q: [0, 2, 1][i] } }));
  const selected = select(candidates, 'blend');
  assert.ok(selected.findIndex(c => c.id === '1') < selected.findIndex(c => c.id === '2'));
  assert.ok(selected.findIndex(c => c.id === '0') < selected.findIndex(c => c.id === '2'));
  candidates[0].scores.R = 0;
  assert.ok(!select(candidates, 'blend').some(c => c.id === '0'));
});

test('A5 blind pairs recompute a dense common feature schema regardless of supplied method features', () => {
  const outputs = ['普通の文。', '比較するなら道具より働きだ。', '逆さの意味が意味して椅子する。'].map((text, i) => ({ text, method: ['plain', 'structured', 'incoherent_control'][i], features: i === 1 ? { leaked_method: 1 } : {} }));
  const pairs = blindPairs('原文', outputs, 'group', 'pilot');
  for (const pair of pairs) {
    assert.equal(pair.private.featureVersion, featureVersion);
    assert.deepEqual(pair.private.features, [outputFeatures(pair.left), outputFeatures(pair.right)]);
    assert.equal(Object.keys(pair.private.features[0]).length, 44);
    assert.equal(Object.keys(pair.private.features[1]).length, 44);
  }
  assert.notDeepEqual(outputFeatures(outputs[0].text), outputFeatures(outputs[1].text));
});

test('A5 old feature data/models are refused and no model is trained without real labels', () => {
  const { score } = require('../../dist/packages/core/evaluation');
  assert.throws(() => score({ text: '同じ文。' }, { coefficients: { length: 1 }, intercept: 0 }), /FEATURE_INCOMPATIBLE/);
  const { spawnSync } = require('node:child_process'), path = require('node:path');
  const rows = [
    { comparisons: [{ comparisonId: 'old', private: { features: [{ length: 1 }, { length: 2 }] } }], preferences: [] },
    { comparisons: blindPairs('原文', [{ text: '文一。', method: 'plain', features: {} }, { text: '文二。', method: 'structured', features: {} }], 'group', 'pilot'), preferences: [] },
  ];
  const script = "import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('training','services/japanese-analysis/train_preferences.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nfor data in json.load(sys.stdin):\n try: m.train(data,'S')\n except ValueError as e: print(str(e))";
  const result = spawnSync(process.env.BURONT_PYTHON || path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['-c', script], { input: JSON.stringify(rows), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FEATURE_VERSION_MISMATCH/); assert.match(result.stdout, /HUMAN_LABELS_REQUIRED/);
});

test('A6 discourse selection changes clause order only with eligible corpus evidence', async () => {
  const source = '今日は寒い。', ir = await irFor(source);
  const profiles = assets.seriesProfiles.filter(profile => profile.id !== 'all' && profile.discourse.some(rule => rule.id === 'criterion_first'));
  assert.ok(profiles.length > 0);
  for (const profile of profiles) {
    const plans = makePlans(ir, request(source, { series: profile.id }), assets);
    const reversed = plans.filter(plan => plan.rhetoric.discourse === 'criterion_first');
    assert.ok(reversed.length > 0, profile.id);
    for (const plan of reversed) {
      assert.ok(['OP-02', 'OP-06'].includes(plan.mainOperator));
      assert.ok(plan.surface.coreText.includes('。なぜなら'));
      assert.ok(plan.rhetoric.discourseEvidenceIds.every(id => assets.evidence.find(row => row.id === id).series.includes(profile.id)));
      assert.equal(ruleQuality(ir, plan).C, 1);
    }
  }
});

test('A7 body rewriting keeps linked clauses and every original event', async () => {
  const source = '田中がAを復旧した。Bは停止中で、私は明日確認する。', analysis = await analyze(source);
  const result = await verifyGeneratedResult(generate(request(source), analysis, assets), python, analysis);
  assert.ok(result.candidates.length);
  for (const candidate of result.candidates) {
    assert.match(candidate.text, /Bは停止中で、?(?:私|俺)は明日確認する/u);
    const nodes = candidate.plan.nodes.filter(node => node.type === 'FactClause');
    assert.equal(nodes.length, 3);
    assert.equal(new Set(nodes.flatMap(node => node.factIds)).size, 3);
    assert.ok(!candidate.checks.some(check => check.status === 'fail'));
  }
});
