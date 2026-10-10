'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { validateRequest } = require('../../dist/packages/contracts');
const { validateStructural, structuralGrammarVersion } = require('../../dist/packages/core/structural');
const { realize, validateCandidate, verification } = require('../../dist/packages/core/validator');
const { finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { replayGeneration } = require('../../dist/packages/core/replay');
const { hash, slice } = require('../../dist/packages/core/source');
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, experimentalStructural: true, seed: 'structural-development-v1', ...extra });
let python, assets, references, evidenceIds;
const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); references = new Map(assets.evidence.map(item => [item.id, item.text])); evidenceIds = new Set(references.keys()); });
after(() => python?.close());
async function run(source, extra = {}) { if (!cache.has(source)) cache.set(source, await python.analyze(source)); return generate(request(source, extra), cache.get(source), assets); }
const structural = result => result.candidatePool.filter(candidate => candidate.plan.structural);
const moved = result => structural(result).filter(candidate => candidate.plan.structural.bindings.some(binding => binding.realizationId === 'reason-claim'));
const pureMoved = result => moved(result).find(candidate => !candidate.plan.structural.lexicalEdits.length);

test('typed relation alternatives reorder variable clauses, preserving live GiNZA inflected predicates and explicit roles', async () => {
  // Development examples, not training pairs or a literary quality evaluation.
  const cases = [
    ['私は検査を中止した。配管が凍結したからだ。', '配管が凍結したから、私は検査を中止した。'],
    ['私は検査を中止した。配管が凍結していなかったからだ。', '配管が凍結していなかったから、私は検査を中止した。'],
    ['私は検査を中止しなかった。温度が低くなかったからだ。', '温度が低くなかったから、私は検査を中止しなかった。'],
    ['私は検査を中止した。温度が低かったからだ。', '温度が低かったから、私は検査を中止した。'],
    ['私は検査を中止した。配管が原因だったからだ。', '配管が原因だったから、私は検査を中止した。'],
    ['私は検査を中止した。室内が静かだからです。', '室内が静かだから、私は検査を中止した。'],
    ['陶工は窯を封じた。商人が釉薬を隠したからだ。', '商人が釉薬を隠したから、陶工は窯を封じた。'],
  ];
  for (const [source, expected] of cases) {
    const result = await run(source), candidate = pureMoved(result); assert.ok(candidate, source);
    assert.equal(candidate.text, expected); assert.equal(candidate.verificationStatus, 'passed');
    assert.ok(validateStructural(result.ir, candidate.plan, references));
    const program = candidate.plan.structural;
    assert.equal(program.authoring, 'handwritten-source-projection');
    assert.deepEqual(program.sourceOrder, ['fact-node-0', 'fact-node-1']);
    assert.deepEqual(program.emissionOrder, ['fact-node-1', 'fact-node-0']);
    assert.ok(program.clauses.flatMap(clause => clause.slots).some(slot => slot.role === 'predicate'));
    assert.ok(program.clauses.flatMap(clause => clause.slots).some(slot => slot.role === 'operator'));
    assert.deepEqual(program.clauses.flatMap(clause => clause.predicates), result.ir.facts);
    assert.ok(structural(result).some(candidate => candidate.plan.structural.bindings.every(binding => binding.realizationId === 'claim-reason')));
    const final = finishSemanticVerification(result, {});
    assert.ok(final.candidates.some(candidate => candidate.plan.structural?.bindings.some(binding => binding.realizationId === 'reason-claim')), source);
    assert.ok(final.candidates.every(candidate => candidate.scores.S === null && candidate.scores.Q === null));
  }
});

test('rearrangement composes lexical edits inside moved original slots and keeps per-atom source maps', async () => {
  const source = '私は作業を続けた。速度が十分だったからだ。', result = await run(source);
  const candidate = moved(result).find(candidate => candidate.text.includes('速さとスピード') && candidate.text.includes('俺'));
  assert.ok(candidate); assert.ok(validateStructural(result.ir, candidate.plan, references));
  assert.ok(!candidate.plan.structural.lexicalEdits.some(edit => edit.ruleId.startsWith('ending-insistence')));
  assert.ok(candidate.plan.structural.lexicalEdits.some(edit => edit.ruleId === 'velocity-doubling' && slice(source, edit.sourceSpan) === '速度'));
  for (const span of candidate.spans.filter(span => span.origin === 'source_fact')) assert.equal(slice(candidate.text, span.span), slice(source, span.sourceSpan));
  const edited = candidate.spans.find(span => slice(candidate.text, span.span) === '速さとスピード');
  assert.equal(slice(source, edited.sourceSpan), '速度');
  assert.ok(edited.span.start < edited.sourceSpan.start); // physically moved
  assert.equal(candidate.plan.structural.bindings[0].evidenceIds.length, 0); // grammar, not false attestation
});

test('numbers, full predicate operators and Unicode scalar slots survive movement; gaps remain explicitly projected', async () => {
  for (const source of ['私は12本の管を隔離した。配管が3回破裂したからだ。', '私は🧪を隔離した。温度が低かったからだ。', '私は検査を中止した。\n配管が凍結したからだ。']) {
    const result = await run(source), candidate = pureMoved(result); assert.ok(candidate, source);
    assert.equal(candidate.verificationStatus, 'passed');
    for (const clause of candidate.plan.structural.clauses) {
      let cursor = clause.sourceSpan.start;
      for (const slot of clause.slots) { assert.equal(slot.sourceSpan.start, cursor); cursor = slot.sourceSpan.end; }
      assert.equal(cursor, clause.sourceSpan.end);
    }
    for (const value of result.ir.source.protectedValues) assert.ok(candidate.text.includes(value.raw));
    assert.equal((candidate.text.match(/\n/gu) || []).length, (source.match(/\n/gu) || []).length);
    assert.deepEqual(candidate.spans, realize(candidate.plan, result.ir).spans);
  }
});

test('scope guards reject ungrounded movement without disabling safe lexical generalization', async () => {
  for (const source of [
    '彼は本を返した。その本を読み終えたからだ。',
    '田中は鈴木を雇った。前者は人手不足だからだ。',
    '田中は鈴木を雇った。当人が有能だからだ。',
    '田中は鈴木を雇った。同氏が有能だからだ。',
    '私は瓶を買った。前述の容器が必要だからだ。',
    '田中は火曜日に帰った。鈴木が月曜日に倒れたからだ。翌々日、山田が戻った。',
    '私は彼を誘った。しかし彼は断った。彼は忙しいからだ。',
    '機械は壊れた。部品が劣化したからだ。湿度が高かったからだ。',
    '帰った。太郎が来たからだ。',
    '田中は笑った。鈴木が踊ったからだ。歌った。',
    '田中は笑った。鈴木が踊ったからだ。天気は晴れだった。歌った。',
    '田中は笑った。鈴木が踊ったからだ。\n嬉しくなった。',
    '私は検査を中止した。配管が凍結したからだ。それは異常だ。',
  ]) { const result = await run(source); assert.equal(moved(result).length, 0, source); assert.ok(structural(result).length, 'grounded prefix remains possible: ' + source); }
  for (const source of [
    '私は花を眺めた。彼岸花が咲いたからだ。',
    '私は空を仰いだ。星がまたたいたからだ。',
    '私は調査を続けた。事実は不明だったからだ。',
  ]) assert.ok(moved(await run(source)).length, 'word-internal false anaphora: ' + source);
  for (const source of [
    '私は出発した。駅からだ。', '私は予定を変えた。三時からだ。', '私は検査を中止した。配管が凍結した。',
    '私は検査を中止した？配管が凍結したからだ。', '私は検査を中止した。「配管が凍結したからだ。」',
    'もし配管が凍れば私は検査を中止する。温度が低いからだ。', '私は検査を中止するらしい。配管が凍結したからだ。',
  ]) assert.equal(structural(await run(source)).length, 0, source);
});

test('disjoint relations combine in one bounded original-input plan with untouched background coverage', async () => {
  const source = '観測室は稼働中だ。私は検査を中止した。配管が凍結したからだ。研究者は窓を閉めた。風が強かったからだ。報告書は保管中だ。';
  const result = await run(source), candidate = pureMoved(result); assert.ok(candidate);
  assert.equal(candidate.plan.structural.bindings.length, 2);
  assert.equal(candidate.text, '観測室は稼働中だ。配管が凍結したから、私は検査を中止した。風が強かったから、研究者は窓を閉めた。報告書は保管中だ。');
  assert.ok(validateStructural(result.ir, candidate.plan, references));
  assert.ok(structural(result).length <= 14); assert.ok(result.candidatePool.length <= 36);
});

test('independent source proof rejects forged slots, roles, features, recipes, permutations and local edits', async () => {
  const source = '私は12本の管を隔離した。配管が3回破裂したからだ。', result = await run(source), original = pureMoved(result);
  const mutations = [
    plan => { plan.structural.version = 999; },
    plan => { plan.structural.grammarVersion = 'unlicensed'; },
    plan => { plan.structural.clauses[0].slots[0].sourceSpan.end++; },
    plan => { plan.structural.clauses[0].slots[0].tokenIds = [999]; },
    plan => { plan.structural.clauses[0].slots[0].role = 'patient'; },
    plan => { plan.structural.clauses[0].predicates[0].polarity = 'negative'; },
    plan => { plan.structural.clauses[0].predicates[0].tense = 'nonpast'; },
    plan => { plan.structural.clauses[0].predicates[0].arguments[0].text = '他人'; },
    plan => { plan.structural.bindings[0].relation.clauses.reverse(); },
    plan => { plan.structural.bindings[0].relation.evidenceTokens[0].tokenId++; },
    plan => { plan.structural.bindings[0].realizationId = 'invented'; },
    plan => { plan.structural.bindings[0].claimNodeId = plan.structural.bindings[0].reasonNodeId; },
    plan => { plan.structural.bindings.push(structuredClone(plan.structural.bindings[0])); },
    plan => { plan.structural.emissionOrder.reverse(); },
    plan => { plan.nodes.reverse(); },
    plan => { plan.nodes.pop(); },
    plan => { plan.nodes[0].text += '実は'; },
    plan => { plan.nodes[0].text = plan.nodes[0].text.replace('3回', '4回'); },
    plan => { plan.nodes[0].text = plan.nodes[0].text.replace('破裂した', '破裂しなかった'); },
    plan => { plan.structural.lexicalEdits.push({ nodeId: 'fact-node-1', ruleId: 'narrator-watashi', sourceSpan: { start: 0, end: 1 }, from: '私', to: '俺', evidenceIds: ['post_00016_82d78e65bd643a54_22'] }); },
  ];
  for (const mutate of mutations) {
    const plan = structuredClone(original.plan); mutate(plan);
    assert.equal(validateStructural(result.ir, plan, references), false, mutate.toString());
    const { text, spans } = realize(plan, result.ir);
    assert.notEqual(verification(validateCandidate(result.ir, plan, text, spans, evidenceIds, undefined, references, assets.seriesProfiles)), 'passed', mutate.toString());
  }
  const lexical = moved(await run('私は作業を続けた。速度が十分だったからだ。')).find(candidate => candidate.plan.structural.lexicalEdits.length);
  const duplicate = structuredClone(lexical.plan); duplicate.structural.lexicalEdits.push(structuredClone(duplicate.structural.lexicalEdits[0]));
  assert.equal(validateStructural((await run('私は作業を続けた。速度が十分だったからだ。')).ir, duplicate, references), false);
});

test('flag OFF preserves production path and schema/replay fail closed for malformed opt-in/version', async () => {
  const source = '私は検査を中止した。配管が凍結したからだ。';
  for (const extra of [{ experimentalStructural: false }, { experimentalStructural: undefined }, { intensity: 1 }]) {
    const result = await run(source, extra); assert.equal(structural(result).length, 0);
  }
  assert.throws(() => validateRequest(request(source, { experimentalStructural: 'true' })), /INVALID_REQUEST/u);
  const result = await run(source), analysis = cache.get(source);
  assert.equal(result.replayManifest.schemaVersion, 2); assert.equal(result.replayManifest.structuralGrammarVersion, structuralGrammarVersion);
  const replay = replayGeneration(result.replayManifest, analysis, assets);
  assert.equal(replay.replayManifest.candidateSetHash, result.replayManifest.candidateSetHash);
  assert.deepEqual(finishSemanticVerification(replay, {}).candidates, finishSemanticVerification(result, {}).candidates);
  for (const patch of [{ schemaVersion: 1 }, { structuralGrammarVersion: 'unknown' }]) assert.throws(() => replayGeneration({ ...result.replayManifest, ...patch }, analysis, assets), /REPLAY_SCHEMA_OR_GRAMMAR_MISMATCH/u);
  const tampered = await run(source); tampered.replayManifest.request.experimentalStructural = false;
  assert.ok(finishSemanticVerification(tampered, {}).candidates.every(candidate => !candidate.plan.structural));
});

test('experimental fine-tag fallback handles finite-verb UD nominalization without changing default recognition', async () => {
  // Exposed independent case, now a regression: do not report it as unseen.
  const source = '農学者は苗を植え替える。根が容器からはみ出すからだ。';
  const on = await run(source), off = await run(source, { experimentalStructural: false });
  assert.equal(structural(off).length, 0);
  assert.equal(off.candidatePool.filter(candidate => candidate.plan.construction?.edits.some(edit => edit.constructionId === 'explicit-reason')).length, 0);
  assert.equal(pureMoved(on).text, '根が容器からはみ出すから、農学者は苗を植え替える。');
  for (const negative of ['私は出発した。駅からだ。', '私は予定を変えた。三時からだ。', '私は出発した。東京からです。', '私は文字を写した。「はみ出す」からだ。']) assert.equal(structural(await run(negative)).length, 0, negative);
  // Root negative and inflected verb are separate parser predicates. Do not
  // guess their actor/negation linkage merely to improve movement coverage.
  const splitNegative = await run('配達員は鉱石を運ばない。学芸員が倉庫を開けないからだ。');
  assert.equal(moved(splitNegative).length, 0);
});

test('structural diversity fingerprints ignore unchanged background and display licensed operation composition', async () => {
  const { diversityProfile } = require('../../dist/packages/core/evaluation');
  const source = '私は作業を続けた。速度が十分だったからだ。';
  const results = [await run(source), await run(source + '観測所は稼働中')];
  const signatures = result => moved(result).map(candidate => { const { whole, ...profile } = diversityProfile(candidate); return JSON.stringify(profile); }).sort();
  assert.deepEqual(signatures(results[0]), signatures(results[1]));
  for (const result of results) {
    const first = finishSemanticVerification(result, {}).candidates[0];
    assert.ok(first.plan.structural?.bindings.some(binding => binding.realizationId === 'reason-claim'));
    assert.ok(first.plan.structural.lexicalEdits.some(edit => edit.ruleId === 'velocity-doubling'));
    assert.equal(first.scores.S, null); assert.equal(first.scores.Q, null);
  }
});
