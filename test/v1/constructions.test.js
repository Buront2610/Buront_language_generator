'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { validateConstruction, constructionRegistry, makeConstructionPlans } = require('../../dist/packages/core/constructions');
const { realize, validateCandidate, verification } = require('../../dist/packages/core/validator');
const { verifyGeneratedResult } = require('../../dist/packages/runtime/semantic-verification');
const { replayGeneration } = require('../../dist/packages/core/replay');
const { hash } = require('../../dist/packages/core/source');
const constructionFixtures = ['punctuation', 'safeguards', 'idempotence'].flatMap(kind => require(`../fixtures/ginza-construction-${kind}.json`).cases);
let python, assets, references;
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'construction-regression', ...extra });
const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); references = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function run(source, extra = {}) {
  if (!cache.has(source)) cache.set(source, await python.analyze(source));
  return generate(request(source, extra), cache.get(source), assets);
}
const constructed = result => result.candidatePool.filter(candidate => candidate.plan.construction);
async function liveAndCaptured(source) {
  const fixture = constructionFixtures.find(row => row.source === source);
  assert.ok(fixture, `Missing real construction fixture: ${source}`);
  return [await run(source), generate(request(source), fixture.analysis, assets)];
}

test('anger construction binds emotion, peak, participant and inflection rather than matching one phrase', async () => {
  for (const [source, expected] of [
    ['私の怒りが頂点に達した。', '俺の怒りが有頂天になった'],
    ['私の怒りは頂点に達しました。', '俺の怒りは有頂天になった'],
    ['太郎の怒りが頂点に達した。', '太郎の怒りが有頂天になった'],
    ['怒りは頂点に達する。', '怒りは有頂天になる'],
  ]) {
    const result = await run(source), candidates = constructed(result);
    assert.ok(candidates.some(candidate => candidate.text === expected), source);
    for (const candidate of candidates) {
      assert.equal(candidate.plan.mainOperator, 'CONSTRUCTION');
      assert.equal(candidate.plan.rewrite, undefined);
      assert.equal(candidate.verificationStatus, 'passed');
      assert.equal(candidate.novelty.classification, 'adaptation');
      assert.ok(validateConstruction(result.ir, candidate.plan, references));
      const edit = candidate.plan.construction.edits[0];
      assert.equal(edit.bindings.find(item => item.slot === 'emotion').text, '怒り');
      assert.equal(edit.bindings.find(item => item.slot === 'degree').text, '頂点');
      assert.equal(edit.features.tense, source.includes('達する') ? 'nonpast' : 'past');
      if (!source.includes('の怒り')) assert.ok(!edit.bindings.some(item => item.slot === 'experiencer'));
    }
  }
});

test('registered sadness and expiry preserve explicit degree, state, experiencer and tense', async () => {
  for (const [source, expected] of [
    ['私はとても悲しかった。', '俺は深い悲しみに包まれた'],
    ['太郎は大変悲しかったです。', '太郎は深い悲しみに包まれた'],
    ['とても悲しいです。', '深い悲しみに包まれている'],
    ['すでに時間切れです。', '時既に時間切れだ'],
    ['もう時間切れだった。', '時既に時間切れだった'],
    ['既に時間切れ。', '時既に時間切れ'],
  ]) {
    const result = await run(source);
    assert.ok(constructed(result).some(candidate => candidate.text === expected), source);
    assert.ok(constructed(result).every(candidate => validateConstruction(result.ir, candidate.plan, references)));
  }
});

test('live and captured GiNZA assertions accept safe terminal punctuation sequences and newlines', async () => {
  for (const [body, expected] of [
    ['怒りが頂点に達した', '怒りが有頂天になった'],
    ['とても悲しかった', '深い悲しみに包まれた'],
    ['すでに時間切れだ', '時既に時間切れだ'],
  ]) for (const ending of ['！', '！！', '!', '!!', '！！\n', '!!\n', '。\n']) {
    const source = body + ending;
    for (const result of await liveAndCaptured(source)) {
      const candidates = constructed(result);
      assert.ok(candidates.some(candidate => candidate.text === expected + ending.replace('。', '')), JSON.stringify(source));
      assert.ok(candidates.every(candidate => validateConstruction(result.ir, candidate.plan, references)), JSON.stringify(source));
      assert.ok(candidates.every(candidate => candidate.plan.construction.edits[0].from === body), JSON.stringify(source));
    }
  }
});

test('repeated punctuation does not bypass question, quotation, conditional or modality protections', async () => {
  for (const source of [
    '怒りが頂点に達した！？', '怒りが頂点に達した?!', '怒りが頂点に達した！！？',
    '「怒りが頂点に達した！！」', '（怒りが頂点に達した！！）', '怒りが頂点に達したら帰る！！',
    '怒りが頂点に達したかもしれない！！', 'とても悲しかったら帰る!!', 'とても悲しいらしい！！',
    'すでに時間切れだ！？', '「すでに時間切れだ！！」', 'すでに時間切れだったら帰る!!', 'もう時間切れかもしれない！！',
  ]) for (const result of await liveAndCaptured(source)) {
    assert.equal(constructed(result).length, 0, source);
  }
});

test('time-expired is idempotent under a real GiNZA output-to-input round trip', async () => {
  const first = await run('すでに時間切れだ。'), original = constructed(first).find(candidate => candidate.text === '時既に時間切れだ');
  assert.ok(original);
  for (const source of [original.text, original.text + '。', '時既に時間切れだった。', '時 既に時間切れだ。']) {
    for (const result of await liveAndCaptured(source)) {
      assert.equal(constructed(result).length, 0, source);
      assert.ok(result.candidatePool.every(candidate => !/時\s*時既に/u.test(candidate.text)), source);
    }
  }
});

test('an existing time-expired construction only blocks its own local span', async () => {
  for (const source of ['時既に時間切れだ。既に時間切れだ。', '既に時間切れだ。時既に時間切れだ。']) {
    for (const result of await liveAndCaptured(source)) {
      const candidates = constructed(result);
      assert.ok(candidates.length, source);
      assert.ok(candidates.some(candidate => candidate.text === '時既に時間切れだ\n時既に時間切れだ'), source);
      for (const candidate of candidates) {
        assert.equal(candidate.plan.construction.edits.length, 1, source);
        assert.equal(candidate.plan.construction.edits[0].sourceSpan.start, source.startsWith('時') ? 9 : 0, source);
        assert.equal(candidate.text.match(/時既に時間切れだ/gu).length, 2, source);
        assert.ok(!candidate.text.includes('時時'), source);
        assert.ok(validateConstruction(result.ir, candidate.plan, references), source);
      }
    }
  }
});

test('independent construction validation rejects an otherwise matching duplicate-time edit', async () => {
  const source = '時既に時間切れだ。', result = await run(source), weakened = structuredClone(result.ir);
  // This deliberately broken dependency emulates the old binder ignoring 時.
  // The control below proves rejection is not due to an inconsistent plan/render.
  const prefix = weakened.tokens.find(token => token.text === '時');
  prefix.head = prefix.id;
  const plan = makeConstructionPlans(weakened, request(source), assets, [])[0];
  assert.ok(plan);
  assert.equal(validateConstruction(weakened, plan, references), true);
  assert.equal(validateConstruction(result.ir, plan, references), false);
  const output = realize(plan, result.ir);
  assert.ok(output.text.includes('時時既に時間切れだ'));
  assert.notEqual(verification(validateCandidate(result.ir, plan, output.text, output.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles)), 'passed');
});

test('negative, hypothetical, uncertain, reported, quoted and prospective propositions abstain', async () => {
  for (const source of [
    '怒りが頂点に達していない。', '怒りが頂点に達するかもしれない。', '怒りが頂点に達したら帰る。',
    '怒りが頂点に達した？', '怒りが頂点に達したと太郎が言った。', '明日には怒りが頂点に達する予定だ。',
    '「怒りが頂点に達した。」と太郎は言った。', '（怒りが頂点に達した。）', '「怒りが頂点に達した。',
    '私はとても悲しくない。', '私はとても悲しいらしい。', 'とても悲しかったら帰る。',
    'すでに時間切れではない。', 'もう時間切れかもしれない。', 'すでに時間切れだったら帰る。',
  ]) {
    const result = await run(source);
    assert.equal(constructed(result).length, 0, source);
    assert.ok(result.candidates.every(candidate => !/有頂天|深い悲しみ|時既に/u.test(candidate.text)), source);
  }
});

test('shared words do not authorize stronger emotion, different subjects or an invented expiry', async () => {
  for (const source of ['温度が頂点に達した。', '少し腹を立てた。', '私は少し悲しかった。', 'とても嬉しかった。', 'あと3秒で時間切れだ。', '時間切れだった。']) {
    assert.equal(constructed(await run(source)).length, 0, source);
  }
});

test('sadness does not recast a stimulus or competing topic as its experiencer', async () => {
  for (const source of ['私は彼の死がとても悲しかった。', 'この知らせはとても悲しい。', 'この映画はとても悲しかった。', '太郎はこの知らせがとても悲しい。', '私は彼がとても悲しい。', '太郎の顔はとても悲しい。', '太郎にとってとても悲しい。', '彼の死にとても悲しい。', '私だけがとても悲しい。']) {
    const result = await run(source);
    assert.equal(constructed(result).length, 0, source);
    assert.ok(result.candidates.every(candidate => !candidate.text.includes('悲しみに包まれ')), source);
  }
  for (const source of ['彼はとても悲しい。', '太郎はとても悲しかった。']) assert.ok(constructed(await run(source)).length, source);
});

test('intensity and original-post series are eligibility conditions, not random evidence decoration', async () => {
  assert.equal(constructed(await run('怒りが頂点に達した。', { intensity: 1 })).length, 0);
  const entry = constructionRegistry.find(item => item.id === 'anger-peak'), evidence = assets.evidence.find(item => item.id === entry.evidenceId);
  const absent = assets.series.find(series => series.id !== 'all' && !evidence.series.includes(series.id));
  assert.ok(absent);
  assert.equal(constructed(await run('怒りが頂点に達した。', { series: absent.id })).length, 0);
  for (const series of evidence.series) assert.ok(constructed(await run('怒りが頂点に達した。', { series })).length);
});

test('Unicode offsets and protected source values remain exact across combined lexical and semantic edits', async () => {
  const source = '😀予算は１００.００円。私の怒りは頂点に達しました。';
  const result = await run(source), candidate = constructed(result)[0];
  assert.ok(candidate);
  assert.match(candidate.text, /😀予算は１００\.００円/u);
  assert.match(candidate.text, /俺の怒りは有頂天になった/u);
  for (const edit of candidate.plan.construction.edits) {
    assert.equal([...source].slice(edit.sourceSpan.start, edit.sourceSpan.end).join(''), edit.from);
    for (const bound of edit.bindings) assert.equal([...source].slice(bound.span.start, bound.span.end).join(''), bound.text);
  }
  assert.equal(candidate.spans.at(-1).span.end, [...candidate.text].length);
  assert.ok(validateConstruction(result.ir, candidate.plan, references));
});

test('tampered slots, features, provenance, edit ranges and output cannot self-certify', async () => {
  const result = await run('私の怒りは頂点に達しました。'), original = constructed(result)[0];
  const changes = [
    plan => { plan.construction.edits[0].constructionVersion = 2; },
    plan => { plan.construction.edits[0].realizationId = 'unchecked-form'; },
    plan => { plan.construction.edits[0].bindings[0].tokenIds = [999]; },
    plan => { plan.construction.seriesId = 'roto'; },
    plan => { plan.family = 'fake-diversity'; },
    plan => { plan.nodes[0].factIds = []; },
    plan => { plan.nodes[0].sourceSpan.start++; },
    plan => { delete plan.narrative; },
    plan => { delete plan.intentPlan; },
    plan => { plan.construction.edits[0].to = '佐藤の怒りは有頂天になった'; },
    plan => { plan.construction.edits[0].from = '温度が頂点に達した'; },
    plan => { plan.construction.edits[0].features.polarity = 'negative'; },
    plan => { plan.construction.edits[0].features.tense = 'nonpast'; },
    plan => { plan.construction.edits[0].features.attribution.kind = 'hearsay'; },
    plan => { plan.construction.edits[0].bindings[0].text = '温度'; },
    plan => { plan.construction.edits[0].bindings[0].span.start++; },
    plan => { plan.construction.edits[0].sourceSpan.start++; },
    plan => { plan.construction.edits[0].factId = 'fact-forged'; },
    plan => { plan.construction.edits[0].constructionId = 'anything-goes'; },
    plan => { plan.construction.edits[0].evidenceIds = ['not-a-source']; },
    plan => { plan.construction.edits.push(structuredClone(plan.construction.edits[0])); },
    plan => { plan.nodes[0].text += '相手は泣いた'; },
    plan => { plan.construction.lexicalEdits[0].to = '佐藤'; },
  ];
  for (const change of changes) {
    const plan = structuredClone(original.plan); change(plan);
    assert.equal(validateConstruction(result.ir, plan, references), false);
    const output = realize(plan, result.ir);
    assert.notEqual(verification(validateCandidate(result.ir, plan, output.text, output.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles)), 'passed');
  }
  assert.equal(validateConstruction(result.ir, original.plan, new Map()), false);
});

test('final semantic proof rebinds registered construction and strips internal candidate pool', async () => {
  const source = '私の怒りは頂点に達しました。', result = await run(source);
  const verified = await verifyGeneratedResult(result, python, cache.get(source));
  assert.equal(verified.candidatePool, undefined);
  const candidate = verified.candidates.find(candidate => candidate.plan.construction);
  assert.ok(candidate);
  assert.ok(candidate.checks.some(check => check.code === 'S-bounded-construction' && check.status === 'pass'));
  assert.equal(candidate.novelty.classification, 'adaptation');
});

test('construction regeneration locks the complete edit program and deterministically replays it', async () => {
  const source = '私の怒りは頂点に達しました。', parent = await run(source), candidate = constructed(parent)[0];
  const options = { lockedPlan: candidate.plan, lockedNodeIds: ['fact-node-0'], replayParent: parent.replayManifest, parentCandidateId: candidate.id };
  const child = generate(request(source, { seed: 'regenerated' }), cache.get(source), assets, options);
  assert.ok(child.candidates.length);
  for (const result of child.candidates) assert.equal(result.text, candidate.text);
  const replay = replayGeneration(JSON.parse(JSON.stringify(child.replayManifest)), cache.get(source), assets);
  assert.equal(replay.replayManifest.candidateSetHash, child.replayManifest.candidateSetHash);
  const forged = structuredClone(child.replayManifest);
  forged.regeneration.lockedPlan.construction.edits[0].features.polarity = 'negative';
  assert.throws(() => replayGeneration(forged, cache.get(source), assets), /REPLAY_LOCK_MISMATCH/u);
  assert.throws(() => generate(request(source), cache.get(source), assets, { ...options, operator: 'REWRITE' }), /LOCK_CONFLICT/u);
  assert.equal(hash((await run(source)).replayManifest), hash(parent.replayManifest));
});

test('locked source evidence cannot be silently relabeled as a different series', async () => {
  const source = '私はとても悲しかった。', parent = await run(source), candidate = constructed(parent)[0];
  assert.ok(candidate.plan.construction.lexicalEdits.some(edit => edit.ruleId.startsWith('narrator-')));
  const options = { lockedPlan: candidate.plan, lockedNodeIds: ['fact-node-0'], replayParent: parent.replayManifest, parentCandidateId: candidate.id };
  assert.throws(() => generate(request(source, { series: 'katuru' }), cache.get(source), assets, options), /LOCK_CONFLICT/u);
  const same = generate(request(source), cache.get(source), assets, options);
  assert.ok(same.candidates.some(result => result.text === candidate.text));
  const unlocked = generate(request(source, { series: 'katuru' }), cache.get(source), assets);
  assert.ok(unlocked.candidates.some(result => result.plan.construction));
  const rewrite = parent.candidatePool.find(result => result.plan.rewrite && result.plan.rewrite.edits.some(edit => edit.ruleId.startsWith('narrator-')));
  assert.ok(rewrite);
  assert.throws(() => generate(request(source, { series: 'katuru' }), cache.get(source), assets, { lockedPlan: rewrite.plan, lockedNodeIds: ['fact-node-0'] }), /LOCK_CONFLICT/u);
});

test('replay resolves locks from the independently verified parent pool, never provisional results', async () => {
  const source = '私の怒りは頂点に達しました。', parent = await run(source), selected = constructed(parent)[0];
  const child = generate(request(source, { seed: 'pool-replay-child' }), cache.get(source), assets, { lockedPlan: selected.plan, lockedNodeIds: ['fact-node-0'], replayParent: parent.replayManifest, parentCandidateId: selected.id });
  const engine = require('../../dist/packages/core/engine'), originalGenerate = engine.generate;
  try {
    engine.generate = (...args) => {
      const result = originalGenerate(...args);
      if (!args[3]?.lockedPlan) { result.candidates = []; result.selectedCandidateId = null; }
      return result;
    };
    const rebuilt = replayGeneration(structuredClone(child.replayManifest), cache.get(source), assets);
    assert.equal(rebuilt.replayManifest.candidateSetHash, child.replayManifest.candidateSetHash);
    engine.generate = (...args) => {
      const result = originalGenerate(...args);
      if (!args[3]?.lockedPlan) result.candidatePool.find(candidate => candidate.id === selected.id).text += '作り話';
      return result;
    };
    assert.throws(() => replayGeneration(structuredClone(child.replayManifest), cache.get(source), assets), /REPLAY_LOCK_MISMATCH/u);
  } finally { engine.generate = originalGenerate; }
});
