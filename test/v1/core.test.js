"use strict";
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { sourceDocument, slice, hash } = require('../../dist/packages/core/source');
const { validateRequest, GenerationSchema } = require('../../dist/packages/contracts');
const { applyDictionary } = require('../../dist/packages/core/dictionary');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets, publishAssets, loadAssets, Retrieval } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { makePlans, moraDistance } = require('../../dist/packages/core/creation');
const { validateCandidate, verification, realize } = require('../../dist/packages/core/validator');
const { select, structure, similarity } = require('../../dist/packages/core/evaluation');
const { splitBeforeGeneration } = require('../../dist/packages/evaluation/dataset');
const { chooseModelPlan } = require('../../dist/packages/core/model-backend');
const { BoundedCache } = require('../../dist/packages/runtime/bounded-cache');
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 4, seed: 'contract-test', ...extra });
let python, assets, analysis, baseline;
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); analysis = await python.analyze('田中がAを復旧した。Bは停止中で、私は明日確認する。'); baseline = generate(request('田中がAを復旧した。Bは停止中で、私は明日確認する。'), analysis, assets); });
after(() => python?.close());
test('T-10 scalar maps survive emoji, combining marks, fullwidth and original whitespace', () => {
  fc.assert(fc.property(fc.array(fc.constantFrom('猫', '😀', 'Ａ', 'か\u3099', 'ｶﾞ', ' ', '\n', '\uE000'), { minLength: 1, maxLength: 100 }), chars => {
    const raw = 'X' + chars.join(''); const doc = sourceDocument(raw); assert.equal(doc.raw, raw);
    for (let i = 0; i < doc.scalarToUtf16.length; i++) assert.equal([...raw.slice(0, doc.scalarToUtf16[i])].length, i);
    assert.equal(doc.normalizationMap.length, [...doc.normalized].length);
    for (const span of doc.normalizationMap) assert.ok(span.end > span.start && span.end <= [...raw].length);
  }), { numRuns: 200 });
  assert.throws(() => sourceDocument('\ud800'));
});
test('T-02 quantity sign, exact decimals and role occurrence are preserved without floating-point conversion', () => {
  const values = sourceDocument('１００.００円を３００円に変更。-0.010kg、100円、100円。').protectedValues;
  assert.equal(values[0].decimal, '100.00'); assert.equal(values[0].role, 'を'); assert.equal(values[1].role, 'に');
  assert.ok(values.some(value => value.sign === '-' && value.decimal === '0.010' && value.unit === 'kg'));
  assert.equal(values.filter(value => value.raw === '100円').length, 2);
});
test('Protected comparison and range values retain parent-child occurrences and immutable original text', () => {
  const doc = sourceDocument('😀温度は-5〜10度、予算は１００.００円以上。A100と https://EXAMPLE.com/?q=3&b=2 は原値。');
  assert.ok(Object.isFrozen(doc) && Object.isFrozen(doc.protectedValues));
  assert.throws(() => { doc.raw = '変更'; }, TypeError);
  const range = doc.protectedValues.find(value => value.kind === 'quantity_range');
  assert.equal(range.raw, '-5〜10度');
  const children = doc.protectedValues.filter(value => value.parentId === range.id);
  assert.deepEqual(children.map(value => [value.sign, value.decimal, value.unit, value.role]), [['-', '5', '', 'range_start'], ['+', '10', '度', 'range_end']]);
  assert.equal(doc.protectedValues.find(value => value.raw === '１００.００円以上').comparator, 'ge');
  assert.ok(doc.protectedValues.some(value => value.kind === 'identifier' && value.raw === 'A100'));
  assert.ok(doc.protectedValues.some(value => value.kind === 'url' && value.raw === 'https://EXAMPLE.com/?q=3&b=2'));
  for (const value of doc.protectedValues) assert.equal(slice(doc.raw, value.span), value.raw);
  assert.ok(!sourceDocument('A3〜5').protectedValues.some(value => value.parentId));
});
test('T-11 dictionary chooses longest/priority/ID once; protected source and preallocation cap', () => {
  const rule = (id, from, to, priority = 0) => ({ id, from, to, priority });
  fc.assert(fc.property(fc.integer({ min: 1, max: 100 }), n => assert.equal(applyDictionary('猫'.repeat(n), [rule('a', '猫', '猫猫'), rule('b', '猫猫', '犬')]).text, '犬'.repeat(Math.floor(n / 2)) + (n % 2 ? '猫猫' : ''))));
  assert.equal(applyDictionary('あい', [rule('a', 'あ', 'X', 100), rule('b', 'あい', 'Y')]).text, 'Y');
  assert.equal(applyDictionary('猫', [rule('b', '猫', 'B'), rule('a', '猫', 'A')]).text, 'A');
  assert.equal(applyDictionary('100円', [rule('a', '100', '1100')], [{ start: 0, end: 4 }]).text, '100円');
  assert.throws(() => applyDictionary('猫'.repeat(100), [rule('a', '猫', '犬'.repeat(128))], [], 1000), /CAPACITY/);
});
test('Node schema rejects coercion, extras, duplicate IDs, invalid focus, empty and surrogate text', () => {
  for (const value of [request(' '), request('\ud800'), request('猫', { intensity: '2' }), request('猫', { extra: 1 }), request('猫', { task: 'fiction' }), request('猫', { focusSpans: [{ start: 1, end: 3 }] }), request('猫', { customRules: [null] }), request('猫', { customRules: [{ id: 'a', from: '', to: 'x', priority: 0 }] }), request('猫', { customRules: [{ id: 'a', from: 'x', to: 'x', priority: 0 }, { id: 'a', from: 'x', to: 'y', priority: 0 }] })]) assert.throws(() => validateRequest(value));
  validateRequest(request('😀'.repeat(5000))); assert.throws(() => validateRequest(request('猫'.repeat(5001))));
});
test('Python validates the same exported Draft 2020-12 schema type boundaries', () => {
  const rows = [request('😀'.repeat(5000)), request('猫', { intensity: '2' }), request('猫', { extra: true }), request('猫', { customRules: [null] })];
  const script = "import sys,json,jsonschema;d=json.load(sys.stdin);v=jsonschema.Draft202012Validator(d['schema']);print(json.dumps([v.is_valid(x) for x in d['rows']]))";
  const result = spawnSync(process.env.BURONT_PYTHON || path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['-c', script], { input: JSON.stringify({ schema: GenerationSchema, rows }), encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), [true, false, false, false]);
  const { GenerationResultSchema } = require('../../dist/packages/contracts/results');
  const output = spawnSync(process.env.BURONT_PYTHON || path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ['-c', script], { input: JSON.stringify({ schema: GenerationResultSchema, rows: [baseline, { ...baseline, candidates: Array.from({ length: 4 }, (_, index) => baseline.candidates[index % baseline.candidates.length]) }] }), encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
  assert.equal(output.status, 0, output.stderr); assert.deepEqual(JSON.parse(output.stdout), [true, false]);
});
test('T-07 independent fact scopes keep achievement, unresolved and prospective distinct', () => {
  const facts = baseline.ir.facts;
  assert.equal(facts.length, 3);
  assert.equal(facts.find(fact => fact.predicateLemma === '復旧').completion, 'completed');
  const unresolved = facts.find(fact => fact.predicateLemma === '停止中'); assert.equal(unresolved.completion, 'not_completed'); assert.equal(unresolved.realization, 'actual'); assert.equal(unresolved.arguments[0].text, 'B');
  const future = facts.find(fact => fact.predicateLemma === '確認'); assert.equal(future.realization, 'prospective'); assert.notEqual(future.completion, 'completed');
});
test('T-03/04/08 parser roles, per-predicate polarity and reported speaker are retained', async () => {
  for (const source of ['田中が佐藤を助けた。', '田中は承認した。佐藤は承認していない。', '田中が確認したと佐藤が言った。']) {
    const result = generate(request(source), await python.analyze(source), assets);
    if (source.includes('助けた')) { assert.equal(result.ir.facts[0].arguments.find(arg => arg.role === 'agent').text, '田中'); assert.equal(result.ir.facts[0].arguments.find(arg => arg.role === 'patient').text, '佐藤'); }
    if (source.includes('承認')) { assert.equal(result.ir.facts[0].polarity, 'positive'); assert.equal(result.ir.facts[1].polarity, 'negative'); }
    if (source.includes('言った')) { const fact = result.ir.facts.find(fact => fact.predicateLemma === '確認'); assert.equal(fact.attribution.kind, 'hearsay'); assert.equal(result.ir.entities.find(entity => entity.id === fact.attribution.speaker).text, '佐藤'); }
    for (const candidate of result.candidates) {
      assert.ok(candidate.checks.filter(check=>['V-roles','V-polarity','V-attribution'].includes(check.code)).every(check=>check.status==='pass'));
      if(source.includes('助けた')) assert.match(candidate.text,/田中が佐藤を助けた/u);
      if(source.includes('承認')) { assert.match(candidate.text,/田中は承認した/u); assert.match(candidate.text,/佐藤は承認していない/u); }
    }
  }
});
test('T-13 bounded applicable operators, no forced means/end operation and untrained S/Q', () => {
  const plans = makePlans(baseline.ir, request(baseline.ir.source.raw), assets);
  assert.ok(plans.length > 0 && plans.length <= 12); assert.deepEqual(new Set(plans.map(plan => plan.mainOperator)), new Set(['OP-01', 'OP-02', 'OP-06']));
  assert.ok(plans.every(plan => plan.rhetoric.relation === 'stoppage' && plan.rhetoric.factId === baseline.ir.facts.find(fact => fact.predicateLemma === '停止中').id));
  assert.ok(baseline.candidates.length >= 2 && baseline.candidates.length <= 3);
  for (const candidate of baseline.candidates) { assert.equal(candidate.scores.S, null); assert.equal(candidate.scores.Q, null); assert.ok(candidate.plan.backTranslation); assert.equal(candidate.spans.at(-1).span.end, [...candidate.text].length); }
});
test('T-01..08 tampered factual text and rhetoric labels cannot self-certify a pass', () => {
  for (const row of require('../fixtures/design-counterexamples.json')) {
    const ir = { ...baseline.ir, source: sourceDocument(row.source), adoptedSpans: [{ start: 0, end: [...row.source].length }] };
    const plan = structuredClone(baseline.candidates[0].plan); plan.nodes[0] = { ...plan.nodes[0], text: row.candidate, sourceSpan: ir.adoptedSpans[0] };
    const draft = realize(plan), allowed = new Set(plan.nodes.filter(node => node.type === 'RhetoricalClause').map(node => node.text));
    assert.notEqual(verification(validateCandidate(ir, plan, draft.text, draft.spans, new Set(assets.evidence.map(item => item.id)), allowed)), 'passed', row.id);
  }
  const candidate = baseline.candidates[0], forged = structuredClone(candidate.plan); forged.nodes[0].text = 'たとえるなら、佐藤が田中を助けた。';
  const draft = realize(forged); assert.equal(verification(validateCandidate(baseline.ir, forged, draft.text, draft.spans, new Set(assets.evidence.map(item => item.id)))), 'rejected');
});
test('T-12 selector keeps only 0/1/2 valid candidates and invent never pads adaptations', () => {
  for (const count of [0, 1, 2]) {
    const candidates = baseline.candidates.map((candidate, i) => ({ ...candidate, verificationStatus: i < count ? 'passed' : 'needs_review' }));
    assert.equal(select(candidates, 'blend').length, count);
  }
  assert.equal(select(baseline.candidates.map(candidate => ({ ...candidate, novelty: { ...candidate.novelty, classification: 'adaptation' } })), 'invent').length, 0);
});
test('T-24 stage RNG, input/assets/history and candidate set reproduce exactly', () => {
  const repeated = generate(request(baseline.ir.source.raw), analysis, assets); assert.deepEqual(repeated, baseline);
});
test('Partial replay reconstructs trusted parent candidates and rejects forged locked text', () => {
  const { replayGeneration } = require('../../dist/packages/core/replay');
  const parent = baseline.candidates[0];
  const regenerated = generate(request(baseline.ir.source.raw, { seed: 'partial-replay' }), analysis, assets, {
    lockedPlan: parent.plan, lockedNodeIds: ['fact-node-0'], replayParent: baseline.replayManifest, parentCandidateId: parent.id,
  });
  const replayed = replayGeneration(JSON.parse(JSON.stringify(regenerated.replayManifest)), analysis, assets);
  assert.equal(replayed.replayManifest.candidateSetHash, regenerated.replayManifest.candidateSetHash);
  const forged = structuredClone(regenerated.replayManifest);
  forged.regeneration.lockedPlan.nodes[0].text = 'たとえるなら、田中が佐藤を助けた。';
  assert.throws(() => replayGeneration(forged, analysis, assets), /REPLAY_LOCK_MISMATCH/);
  const changed = structuredClone(regenerated.replayManifest); changed.history.push({ text: 'changed' });
  assert.throws(() => replayGeneration(changed, analysis, assets), /REPLAY_HISTORY_MISMATCH/);
});
test('Whitespace and symbols with no dictionary reading still satisfy the analysis contract', async () => {
  const raw = '  100円  \n😀';
  const parsed = await python.analyze(raw);
  assert.ok(parsed.tokens.every(token => typeof token.reading === 'string'));
  for (const token of parsed.tokens) assert.equal(slice(raw, token.span), token.text);
  assert.equal(generate(request(raw), parsed, assets).ir.source.raw, raw);
});
test('T-15 noun replacement has an identical abstract structure, not unique novelty', () => { assert.equal(structure('黄金の鉄の塊'), structure('白銀の木の塊')); assert.equal(similarity(structure('黄金の鉄の塊'), structure('白銀の木の塊')), 1); });
test('T-23 content hashes detect changed text with the same record IDs and count; corrupt assets rejected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buront-assets-'));
  try { const filename = path.join(directory, 'snapshot.json'); const modified = structuredClone(assets); modified.evidence[0].text += '変更'; fs.writeFileSync(filename, JSON.stringify(modified)); assert.throws(() => loadAssets(filename), /ASSET/); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Grouped split prevents thread/family/near duplicate leakage before generation', () => {
  const split = splitBeforeGeneration([{ id: 'a', text: '今日は寒い', postId: 'p1', threadId: 't1', family: 'f1' }, { id: 'b', text: '今日は暖かい', postId: 'p2', threadId: 't1', family: 'f2' }, { id: 'c', text: '別の話題', postId: 'p3', threadId: 't3', family: 'f2' }]);
  assert.equal(split.groups, 1); assert.equal(new Set(split.examples.map(example => example.split)).size, 1);
});
test('Finite cache evicts by bytes/count and inactive TTL', () => {
  let now = 0; const cache = new BoundedCache(2, 80, 10, () => now); cache.set('a', 'a'); cache.set('b', 'b'); cache.get('a'); cache.set('c', 'c'); assert.equal(cache.get('b'), undefined); now = 11; assert.equal(cache.size, 0); assert.equal(cache.set('huge', 'x'.repeat(100)), false);
});
test('Optional model rejects prose, fabricated IDs and excessive retries', async () => {
  let attempts = 0; await assert.rejects(chooseModelPlan({}, [baseline.candidates[0].plan], async () => { attempts++; return '{"planId":"invented"}'; }, new AbortController().signal), /INVALID_MODEL/); assert.equal(attempts, 2);
  const response = await chooseModelPlan({}, [baseline.candidates[0].plan], async () => JSON.stringify({ planId: baseline.candidates[0].plan.id }), new AbortController().signal); assert.equal(response.replay.deterministic, false);
  assert.equal(moraDistance('タテ', 'タネ'), 1); assert.equal(moraDistance('キャク', 'キャク'), 0);
});
test('Register changes retain negative tense, quoted text and URL originals', async () => {
  const { realizeRegister, equivalentRegister } = require('../../dist/packages/core/surface');
  assert.equal(realizeRegister('確認しませんでした。'), '確認しなかった。');
  assert.equal(realizeRegister('「確認しました」 https://example.com/しました'), '「確認しました」 https://example.com/しました');
  assert.equal(equivalentRegister('確認しませんでした。', '確認した。'), false);
  const source = '担当者が状況を確認しました。';
  const result = generate(request(source), await python.analyze(source), assets);
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) { assert.ok(/^担当者が状況を確認(?:しました|した(?:からな)?)$/u.test(candidate.text)); assert.equal(candidate.spans[0].origin, 'paraphrase'); }
});
test('Faithful mode retains source order and every fact span without appended rhetoric', () => {
  const result = generate(request(baseline.ir.source.raw), analysis, assets);
  assert.ok(result.candidates.length > 0);
  for (const candidate of result.candidates) {
    assert.ok(candidate.text.startsWith(candidate.plan.nodes[0].text));
    assert.doesNotMatch(candidate.text, /たとえるなら、|に見立てる/u);
    const nodes = candidate.plan.nodes.filter(node => node.type === 'FactClause').sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
    assert.equal(nodes.length, 3);
    assert.equal(nodes.map(node => slice(baseline.ir.source.raw, node.sourceSpan)).join(''), baseline.ir.source.raw);
    assert.ok(require('../../dist/packages/core/rewrite-validation').validateRewrite(baseline.ir, candidate.plan));
    assert.ok(candidate.checks.every(check => check.status === 'pass'));
  }
});
test('Unsupported quote/full/invent modes return explicit capability failure without plans', async () => {
  const source = '田中が修理した。今日は寒い。', parsed = await python.analyze(source);
  for (const extra of [{ task: 'quote', focusSpans: [{ start: 8, end: [...source].length }] }, { contextMode: 'full' }, { noveltyMode: 'invent' }]) {
    const result = generate(request(source, extra), parsed, assets);
    assert.deepEqual(result.candidates, []); assert.deepEqual(result.reviewCandidates, []);
    assert.equal(result.shortfallReason, 'unsupported_generation_mode');
    assert.equal(result.fallback.text, source); assert.equal(result.replayManifest.generated, 0);
  }
});
test('Canonical permits adaptations; untransformable topics and invent mode abstain', async () => {
  const source='ナイト', analysis=await python.analyze(source);
  for(const noveltyMode of ['canonical','blend','invent']) {
    const result=generate(request(source,{noveltyMode}),analysis,assets);
    assert.equal(result.candidates.length,0);assert.equal(result.fallback.text,source);
  }
  const text='私は確認した。', parsed=await python.analyze(text);
  const adapted=generate(request(text,{noveltyMode:'canonical'}),parsed,assets);
  assert.ok(adapted.candidates.length);assert.ok(adapted.candidates.every(c=>c.novelty.classification==='adaptation'));
  assert.equal(generate(request(text,{noveltyMode:'invent'}),parsed,assets).candidates.length,0);
});

test('Connective and reference tags cannot conceal an unsupported factual assertion', () => {
  const candidate = baseline.candidates[0], plan = structuredClone(candidate.plan); plan.nodes.push({ id: 'smuggled', type: 'Connective', text: '佐藤が承認した。', factIds: [], evidenceIds: [] });
  const draft = realize(plan), allowed = new Set(candidate.plan.nodes.filter(node => node.type === 'RhetoricalClause').map(node => node.text));
  assert.equal(verification(validateCandidate(baseline.ir, plan, draft.text, draft.spans, new Set(assets.evidence.map(item => item.id)), allowed)), 'rejected');
  for (const extra of [{ id: 'literal-smuggling', type: 'ProtectedLiteral', text: '佐藤が承認した。', factIds: [], evidenceIds: [] }, { ...candidate.plan.nodes[0], id: 'duplicate-event' }]) {
    const forged = structuredClone(candidate.plan); forged.nodes.push(extra); const realized = realize(forged);
    assert.equal(verification(validateCandidate(baseline.ir, forged, realized.text, realized.spans, new Set(assets.evidence.map(item => item.id)), allowed)), 'rejected');
  }
});
