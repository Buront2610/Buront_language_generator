'use strict';
// Independent B3 development probes. Once read these are ordinary regressions,
// never sealed data, human S/Q labels, or proof of physical/style quality.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Ajv2020 = require('ajv/dist/2020').default;
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { sourceDocument, slice, hash } = require('../../dist/packages/core/source');
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
const requestFor = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 3, series: 'all', backend: 'structured', clientRevision: 0, seed: 'independent-b3-regression', ...extra });
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); references = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function build(source, extra = {}) {
  if (!cache.has(source)) cache.set(source, await python.analyze(source));
  const request = requestFor(source, extra), analysis = structuredClone(cache.get(source));
  const ir = extractFacts(sourceDocument(source), analysis, request);
  return { source, request, analysis, ir, relations: recognizeRhetoricalRelations(ir), plans: makeStructuralPlans(ir, request, assets, makeRewritePlans(ir, request, assets)) };
}
function rehash(plan, ir, mutation) { const changed = structuredClone(plan); mutation(changed); refreshStructuralPlan(ir, changed); return changed; }
function fullCheck(ir, plan, rendered = renderStructural(ir, plan)) { return verification(validateCandidate(ir, plan, rendered.text, rendered.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles)); }
function blocks(built, kind) { return built.plans.flatMap(plan => plan.structural.blocks).filter(block => !kind || block.relation.kind === kind); }
function checked(built) { for (const plan of built.plans) { assert.equal(validateStructural(built.ir, plan, references), true, built.source); assert.equal(fullCheck(built.ir, plan), 'passed', built.source); } }

test('independent B3: unseen domains and past verbs bind actual events without claiming success', async () => {
  for (const [source, expected] of [
    ['私はまだ未熟ですが、古文書を翻訳しました。', '古文書を翻訳した'],
    ['私は天文学の素人ですが、衛星を撮影しました。', '衛星を撮影した'],
    ['私は接客が苦手ですが、客の要望を聞き取った。', '客の要望を聞き取った'],
    ['私は不器用だが、花瓶を割った。', '花瓶を割った'],
    ['私は初心者だが、試合に負けた。', '試合に負けた'],
  ]) {
    const built = await build(source); assert.ok(blocks(built, 'modest-achievement').length, source); checked(built);
    for (const plan of built.plans) { const text = renderStructural(built.ir, plan).text; assert.ok(text.includes(expected), text); assert.ok(!/褒められた|賞賛|優勝|大成功|一番最強/u.test(text), text); }
    for (const block of blocks(built, 'modest-achievement')) {
      assert.notEqual(block.relation.achievementKind, 'completed-deed');
      const binding = block.relation.eventBinding; assert.ok(binding);
      assert.ok(built.ir.tokens.some(token => token.id === binding.predicateTokenId && token.dep === 'ROOT'));
      assert.ok(binding.completionTokenIds.length > 0);
    }
  }
});

test('independent B3: actor ownership distinguishes matrix actors from embedded descriptions', async () => {
  for (const source of [
    '私は接客が苦手ですが、妹が客の要望を聞き取った。',
    '私は接客が苦手ですが、私たちが客の要望を聞き取った。',
    '私は接客が苦手ですが、私と店長が客の要望を聞き取った。',
    '私は接客が苦手ですが、私の同僚が客の要望を聞き取った。',
    '私は接客が苦手ですが、店長が挨拶し、私は客の要望を聞き取った。',
  ]) { const built = await build(source); assert.equal(blocks(built, 'modest-achievement').length, 0, source); }
  const built = await build('私は初心者だが、妹が育てた花を撮影した。'); assert.ok(built.plans.length); checked(built);
  for (const block of blocks(built, 'modest-achievement')) {
    const embedded = block.relation.conditions.find(condition => built.ir.tokens[condition.predicateTokenId].lemma === '育てる'); assert.ok(embedded);
    assert.equal(embedded.illocution, 'mentioned-proposition'); assert.equal(embedded.preservation, 'embedded-scope');
    assert.ok(!block.relation.eventBinding.actorTokenIds.some(id => built.ir.tokens[id].text === '妹'));
  }
});

test('independent B3: reported, quoted, desired, planned, failed and commanded events are not completed self events', async () => {
  for (const source of [
    '私は初心者だが、衛星を撮影したと報告した。', '私は初心者だが、衛星を撮影したと聞いた。',
    '私は初心者だが、衛星を撮影したと思った。', '私は初心者だが、衛星を撮影したらしい。',
    '「私は初心者だが、衛星を撮影した」と彼は言った。', '私は「初心者だ」と言われたが、衛星を撮影した。',
    '私は初心者だが、衛星を撮影したかった。', '私は初心者だが、明日衛星を撮影する。',
    '私は初心者だが、衛星を撮影する予定だった。', '私は初心者だが、衛星を撮影できたはずだ。',
    '私は初心者だが、衛星を撮影したわけではない。', '私は初心者だが、衛星を撮影できなかった。',
    '私は初心者だが、衛星を撮影しろ。',
  ]) { const built = await build(source); assert.equal(blocks(built, 'modest-achievement').length, 0, source); }
});

test('independent B3: assessment predicates and possessors own their polarity and speaker', async () => {
  for (const source of [
    '私は未熟だったころを覚えていないが、説明を終えました。', '私は知らないことがない専門家だが、説明を終えました。',
    '私は初心者を教える先生だが、説明を終えました。', '私は苦手な野菜を残さない主義だが、説明を終えました。',
    '私は素人ではないが、説明を終えました。', '私は初心者ではないと自負しているが、説明を終えました。',
    '私の弟は未熟だが、私は説明を終えました。', '弟は未熟だが、私は説明を終えました。',
    '太郎の話し方は未熟ですが、私は説明を終えました。', '弟の話し方は未熟ですが、私は説明を終えました。',
    '先生の発音は未熟ですが、私は説明を終えました。', '話すのが苦手なのは私ではないが、説明を終えました。',
  ]) { const built = await build(source); assert.equal(blocks(built, 'modest-achievement').length, 0, source); }
  for (const source of ['私は説明が未熟ですが、説明を終えました。', '太郎に説明するのは苦手ですが、私は質問に答えました。', '私はJavaScriptが得意ではありませんが、修正を終えました。']) {
    const built = await build(source); assert.ok(blocks(built, 'modest-achievement').length, source); checked(built);
  }
});

test('independent B3: paired ordinary matrix controls expose evaluand ownership without report-verb masking', async () => {
  for (const [positive, negative] of [
    ['私は未熟ですが、私は説明を終えました。', '弟は未熟ですが、私は説明を終えました。'],
    ['私は未熟ですが、私は説明を終えました。', '私の弟は未熟ですが、私は説明を終えました。'],
    ['私は料理が苦手ですが、私は説明を終えました。', '弟は料理が苦手ですが、私は説明を終えました。'],
    ['私は得意ではありませんが、私は説明を終えました。', '助手は得意ではありませんが、私は説明を終えました。'],
    ['私は苦手ですが、私は説明を終えました。', '弟は苦手ですが、私は説明を終えました。'],
    ['私は苦手ですが、私は説明を終えました。', '弟も苦手ですが、私は説明を終えました。'],
    ['私は不器用ですが、私は説明を終えました。', '私の弟は不器用ですが、私は説明を終えました。'],
    ['私は初心者ですが、私は説明を終えました。', '家族は初心者ですが、私は説明を終えました。'],
    ['私は未熟ですが、私は説明を終えました。', '部長は未熟ですが、私は説明を終えました。'],
  ]) {
    const control = await build(positive); assert.ok(blocks(control, 'modest-achievement').length, positive); checked(control);
    const attack = await build(negative); assert.equal(blocks(attack, 'modest-achievement').length, 0, negative);
  }
  // Neither a possessed generic noun nor an untyped bare topic proves speaker
  // identity. No positive-output demand is made for 私の話し方 or 数学 here.
});

test('independent B3: degree wrappers bind their own evaluand and cannot borrow a narrator from outside it', async () => {
  for (const [positive, negative] of [
    ['私は得意というほどではないが、説明を終えました。', '弟は得意というほどではないが、私は説明を終えました。'],
    ['私は得意だとは言えないが、説明を終えました。', '私は弟が得意だとは言えないが、説明を終えました。'],
    ['私が得意と言えるほどではありませんが、私は説明を終えました。', '私は弟が得意だと言えるほどではありませんが、説明を終えました。'],
    ['私は自信があるわけではないが、説明を終えました。', '弟に自信があるわけではないが、私は説明を終えました。'],
  ]) {
    const control = await build(positive); assert.ok(blocks(control, 'modest-achievement').length, positive); checked(control);
    const attack = await build(negative); assert.equal(blocks(attack, 'modest-achievement').length, 0, negative);
  }
});

test('independent B3: nested assessments remain literal mentioned material', async () => {
  for (const source of ['私は人前で話すのが苦手だが、式典の司会を務めた。', '私は譜面を読むことに慣れていないが、一曲演奏した。']) {
    const built = await build(source); assert.ok(built.plans.length); checked(built);
    for (const block of blocks(built, 'modest-achievement')) {
      const assessment = block.relation.slots.find(slot => slot.role === 'modesty');
      const content = block.relation.conditions.filter(condition => assessment.factIds.includes(condition.factId)); assert.ok(content.length >= 2);
      for (const condition of content) { assert.equal(condition.illocution, 'mentioned-proposition'); assert.equal(condition.preservation, 'literal-copy'); }
      const pieces = block.pieces.filter(piece => piece.role === 'modesty'); assert.equal(pieces.length, 1); assert.equal(pieces[0].kind, 'source'); assert.deepEqual(pieces[0].sourceSpan, assessment.span);
    }
  }
});

test('independent B3: productive ability and ambiguous e-row polite stems never become performed actions', async () => {
  for (const [source, expected] of [
    ['私は初心者ですが、字幕を読めました。', '字幕を読めた'],
    ['私は初心者ですが、海峡を泳げました。', '海峡を泳げた'],
    ['私は初心者ですが、古文書を読むことができました。', '古文書を読むことができた'],
  ]) { const built = await build(source); assert.ok(built.plans.length, source); checked(built); for (const plan of built.plans) assert.ok(renderStructural(built.ir, plan).text.includes(expected)); }
  for (const [source, expected] of [
    ['時間があるので、私はググれます。', /ググれ(?:る|ます)/u],
    ['時間があったので、私はググれました。', /ググれ(?:た|ました)/u],
    ['時間があるので、私はググれません。', /ググれ(?:ない|ません)/u],
    ['時間がなかったので、私はググれませんでした。', /ググれ(?:なかった|ませんでした)/u],
  ]) { const built = await build(source); checked(built); for (const plan of built.plans) assert.match(renderStructural(built.ir, plan).text, expected, source); }
});

test('independent B3: causal nested judgments are not certified as their embedded assertions', async () => {
  const source = '彼が犯人だと判断するのは早すぎたので、調査を続けた。';
  const built = await build(source); checked(built);
  for (const block of blocks(built, 'reason-claim')) {
    const mentioned = block.relation.conditions.find(condition => built.ir.tokens[condition.predicateTokenId].lemma === '犯人'); assert.ok(mentioned);
    assert.notEqual(mentioned.illocution, 'assertion', source); assert.notEqual(mentioned.preservation, 'asserted', source);
  }
  for (const source of ['事故を防ぐために、速度を落とした。', '子供が泣かないために、私は声を落とした。', '誰にも怒られないために、私は記録を消した。', '検査が正確であるために、二人で測定した。', '警報が鳴ったので、すぐ避難せよ。']) {
    const built = await build(source); assert.equal(blocks(built, 'reason-claim').length, 0, source);
  }
});

test('independent B3: wide explanatory negation cannot become a negative claim with an asserted cause', async () => {
  for (const [controlSource, wideSource] of [
    ['雨が降ったので、私は休まなかった。', '雨が降ったので、私は休んだのではない。'],
    ['雨が降ったから、私は休まなかった。', '雨が降ったから、私は休んだというわけではない。'],
    ['理由が分からないので、反対していません。', '理由が分からないので、反対しているのではありません。'],
    ['料金が高かったため、私は帰らなかった。', '料金が高かったため、私は帰ったのではない。'],
    ['私は休んだ。雨が降ったからだ。', '私は休んだ。雨が降ったからではない。'],
    ['私は休んだ。雨が降ったためだ。', '私は休んだ。雨が降ったためではない。'],
  ]) {
    const control = await build(controlSource); assert.ok(blocks(control, 'reason-claim').length, controlSource); checked(control);
    const wide = await build(wideSource); assert.equal(blocks(wide, 'reason-claim').length, 0, wideSource);
  }
  // This independently asserted reason is itself a negative proposition; the
  // guard must bind the scope of negation, not blacklist all のではない text.
  const safe = await build('私が逃げたのではないため、彼は謝罪した。'); assert.ok(blocks(safe, 'reason-claim').length); checked(safe);
  for (const plan of safe.plans) assert.match(renderStructural(safe.ir, plan).text, /逃げたのではないから/u);
});

test('independent B3: denial of one explanation stays intact beside the stated real explanation', async () => {
  const first = '理由が分からないので反対しているのではありません。';
  const built = await build(first + '費用が増えると分かっているので反対しています。');
  assert.ok(built.plans.length); checked(built);
  for (const plan of built.plans) {
    assert.ok(renderStructural(built.ir, plan).text.startsWith(first));
    assert.ok(plan.structural.blocks.every(block => block.sourceSpan.start >= [...first].length));
  }
});

test('independent B3: a carrier request does not consume an independently transformable preceding cause', async () => {
  const cause = '雨が降ったので、私は駅で待ちました。', request = 'この橋が安全だという根拠になる記録を読ませてください。';
  const left = await build(cause), right = await build(request);
  assert.ok(blocks(left, 'reason-claim').length); assert.ok(blocks(right, 'evidence-request').length); checked(left); checked(right);
  const mixed = await build(cause + request); assert.ok(mixed.plans.length); checked(mixed);
  assert.ok(mixed.plans.some(plan => plan.structural.blocks.some(block => block.relation.kind === 'reason-claim')
    && plan.structural.blocks.some(block => block.relation.sourceForm === 'carrier-evidence-request')));
  for (const block of blocks(mixed).filter(block => block.relation.sourceForm === 'carrier-evidence-request')) assert.equal(block.sourceSpan.start, [...cause].length);
});

test('independent B3: trailing causes retain claim modality and reason direction', async () => {
  for (const [source, expected] of [
    ['私は待機できました。風が強かったためです。', '風が強かったから、私は待機できた。'],
    ['私は戻れませんでした。門が閉じていたためです。', '門が閉じていたから、私は戻れなかった。'],
  ]) {
    const built = await build(source); assert.ok(built.plans.length); checked(built);
    assert.ok(built.plans.some(plan => renderStructural(built.ir, plan).text === expected));
    for (const block of blocks(built, 'reason-claim')) assert.equal(block.operatorId, 'reason-explanation');
  }
});

test('independent B3: carrier requests preserve the full requested object, action and modifiers', async () => {
  for (const [source, fragments] of [
    ['この橋が安全だという根拠になる記録を読ませてください。', ['読ませてくれるか', 'この橋が安全だという根拠になる記録を']],
    ['この橋が安全だと判断した点検表を読ませてください。', ['読ませてくれるか', 'この橋が安全だと判断した点検表を']],
    ['この橋が安全だという根拠になる記録を太郎に見せてください。', ['太郎に見せてくれるか', 'この橋が安全だという根拠になる記録を']],
    ['この橋が安全だという根拠になる記録と写真を見せてください。', ['見せてくれるか', 'この橋が安全だという根拠になる記録と写真を']],
    ['担当者から受け取った、この橋が安全だという根拠になる記録を私にも読ませてください。', ['私にも読ませてくれるか', '担当者から受け取った、この橋が安全だという根拠になる記録を']],
    ['この橋が安全だという証拠として、点検表を見せてください。', ['この橋が安全だという証拠として、', '見せてくれるか', '点検表を']],
  ]) {
    const built = await build(source); assert.ok(built.plans.length, source); checked(built);
    for (const plan of built.plans) { const text = renderStructural(built.ir, plan).text; for (const fragment of fragments) assert.ok(text.includes(fragment), text); assert.ok(!text.includes('証拠があるのか'), text); }
    for (const block of blocks(built, 'evidence-request')) {
      assert.equal(block.relation.sourceForm, 'carrier-evidence-request');
      const carrier = block.relation.slots.find(slot => slot.role === 'carrier'); assert.ok(carrier);
      for (const condition of block.relation.conditions.filter(condition => carrier.factIds.includes(condition.factId))) { assert.equal(condition.illocution, 'mentioned-proposition'); assert.equal(condition.preservation, 'literal-copy'); }
    }
  }
});

test('independent B3: negated, reported and compound request cues cannot fabricate evidence purpose', async () => {
  for (const source of [
    'この橋が安全だという根拠にはならない記録を見せてください。', 'この橋が安全だという証拠を否定する記録を見せてください。',
    'この橋が安全だという根拠になるかもしれない記録を見せてください。', 'この橋が安全だと判断しなかった点検表を見せてください。',
    'この橋が安全か確かめたくないので、点検表を見せてください。', 'この橋が安全か確かめたので、点検表を見せてください。',
    'この橋が安全か確かめたくなかったので、点検表を見せてください。', 'この橋が安全か確かめたくはないので、点検表を見せてください。',
    'この橋が安全か確かめたいと言われたので、点検表を見せてください。', 'この橋が安全だという証拠としては使わずに、点検表を見せてください。',
    'この橋が安全だという根拠になる記録を見せてから比較してください。', 'この橋が安全だという根拠になる記録を見せずに判断してください。',
    'この橋が安全だという根拠になる昨日の記録だけは見せないでください。',
    '担当者は、この橋が安全だという根拠になる記録を見せてくださいと言った。', '「この橋が安全だという根拠になる記録を見せてください」と書いた。',
    'この橋が安全だという根拠になる記録を見せられません。', 'この橋が安全だという根拠になる記録を見せたい。', 'この橋が安全だという根拠になる記録を読め。',
  ]) { const built = await build(source); assert.ok(!built.relations.some(relation => relation.sourceForm === 'carrier-evidence-request'), source); assert.ok(!blocks(built).some(block => block.relation.sourceForm === 'carrier-evidence-request'), source); }
});

test('independent B3: conditional request prefixes remain outside the moved carrier or safely abstain', async () => {
  for (const source of ['太郎が来たら、この橋が安全だという根拠になる記録を見せてください。', 'もし可能なら、この橋が安全だという根拠になる記録を見せてください。']) {
    const built = await build(source); checked(built);
    const prefix = source.slice(0, source.indexOf('、') + 1);
    for (const plan of built.plans) assert.ok(renderStructural(built.ir, plan).text.startsWith(prefix), source);
  }
});

test('independent B3: quoted and quantitative carrier material remains literal without assertion promotion', async () => {
  for (const [source, retained] of [
    ['担当者が「この橋は安全だ」と判断した点検表を読ませてください。', '「この橋は安全だ」'],
    ['「この橋は安全だ」という根拠になる点検表を読ませてください。', '「この橋は安全だ」'],
    ['使用者が3人以下だったという根拠になる記録を見せてください。', '3人以下'],
    ['使用量が1.5kg以下だったと判断した記録を見せてください。', '1.5kg以下'],
    ['気温が-2.5℃だったという証拠として、記録を見せてください。', '-2.5℃'],
    ['この橋が安全だという根拠になる記録を一つだけ見せてください。', '一つだけ見せて'],
  ]) {
    const built = await build(source); assert.ok(built.plans.length, source); checked(built);
    for (const plan of built.plans) { assert.ok(renderStructural(built.ir, plan).text.includes(retained)); assert.ok(structuralQuantityPreserved(built.ir, plan)); }
    for (const block of blocks(built, 'evidence-request')) for (const condition of block.relation.conditions) assert.notEqual(condition.illocution, 'assertion');
  }
});

test('independent B3: affirmative verification and carrier controls make scope refusals diagnostic', async () => {
  for (const [positive, negative, forbidden] of [
    ['在庫が減ったという話を確かめたいので、検品記録を提示してください。', '在庫が減ったという話を確かめたくないので、検品記録を提示してください。', 'carrier-evidence-request'],
    ['この橋が安全だという根拠になる記録を見せてください。', '太郎に、この橋が安全だという根拠になる記録を見せてください。', 'carrier-evidence-request'],
    ['この橋が安全だという根拠になる記録を見せてください。', '太郎が来たら、この橋が安全だという根拠になる記録を見せてください。', 'carrier-evidence-request'],
    ['この橋が安全だという根拠になる記録を見せてください。', 'この橋が安全だという根拠にはならない記録を見せてください。', 'carrier-evidence-request'],
  ]) {
    const control = await build(positive); assert.ok(blocks(control).some(block => block.relation.sourceForm === forbidden), positive); checked(control);
    const attack = await build(negative); assert.ok(!blocks(attack).some(block => block.relation.sourceForm === forbidden), negative);
  }
});

test('independent B3: reporting attribution and nonpast future assertions survive shared-scope changes', async () => {
  for (const source of ['田中が確認したと佐藤が言った。', '田中が確認したと佐藤が報告した。']) {
    const built = await build(source), fact = built.ir.facts.find(value => value.predicateLemma === '確認'); assert.ok(fact);
    assert.equal(fact.attribution.kind, 'hearsay', source);
    assert.equal(built.ir.entities.find(value => value.id === fact.attribution.speaker)?.text, '佐藤', source);
  }
  for (const source of ['準備が終わったので、私は翌日出発します。', '店が開くので、私はお昼に買います。']) {
    const built = await build(source); checked(built);
    for (const block of blocks(built, 'reason-claim')) assert.equal(block.operatorId, 'reason-explanation', source);
    for (const plan of built.plans) assert.doesNotMatch(renderStructural(built.ir, plan).text, /という事実|ということ/u, source);
  }
});

test('independent B3: passive, causative negatives and na-adjective copulas survive grammar changes', async () => {
  for (const [source, expected] of [
    ['道が凍結したので、私は上司に呼ばれませんでした。', '呼ばれなかった'],
    ['道が凍結したので、私は行かせられませんでした。', '行かせられなかった'],
    ['門が閉まったので、私は中へ入れませんでした。', '入れなかった'],
    ['風が強いので、私は海を渡れません。', '渡れない'],
    ['この操作は簡単ですので、私は試しました。', '簡単だから'],
    ['この道は静かですから、私は選びました。', '静かだから'],
    ['私は体調が悪くないので、会場まで歩きました。', '悪くないから'],
  ]) { const built = await build(source); assert.ok(built.plans.length, source); checked(built); for (const plan of built.plans) { const text = renderStructural(built.ir, plan).text; assert.ok(text.includes(expected), text); assert.doesNotMatch(text, /ませんだった|簡単から|静かから|悪くないだから/u); } }
});

test('independent B3: rehashing new event and evidence role metadata cannot launder invented claims', async () => {
  for (const source of ['私は人前で話すのが苦手だが、式典の司会を務めた。', 'この橋が安全だという根拠になる記録を読ませてください。']) {
    const built = await build(source); const plan = built.plans[0]; assert.ok(plan);
    const common = [
      block => { block.relation.provenance.inputHash = '0'.repeat(64); },
      block => { block.relation.conditions[0].sourceRole = 'asserted-event'; block.relation.conditions[0].illocution = 'assertion'; block.relation.conditions[0].preservation = 'asserted'; },
      block => { block.relation.slots[0].tokenIds.pop(); },
      block => { block.relation.conditions[0].attribution.speaker = '妹'; },
      block => { block.pieces.push({ kind: 'form', formId: 'phantom-praise', text: '全員が絶賛した。', anchor: 0, evidenceIds: block.evidenceIds }); },
      block => { block.evidenceIds.reverse(); },
    ];
    const specific = plan.structural.blocks[0].relation.eventBinding ? [
      block => { block.relation.eventBinding.predicateTokenId = block.relation.conditions[0].predicateTokenId; },
      block => { block.relation.eventBinding.completionTokenIds = []; },
      block => { block.relation.eventBinding.actorTokenIds = [99999]; },
      block => { block.relation.eventBinding.embeddedPredicateTokenIds = [99999]; },
    ] : [
      block => { block.relation.evidenceRequest.actionKind = 'presentation'; },
      block => { block.relation.evidenceRequest.targetSpan.end--; },
      block => { block.relation.evidenceRequest.actionSpan.start++; },
      block => { block.relation.evidenceRequest.cueTokenIds = []; },
      block => { block.relation.evidenceRequest.carrierSpan.start++; },
      block => { block.relation.evidenceRequest.caseSpan.end--; },
      block => { block.evidenceIds.pop(); },
    ];
    for (const mutate of [...common, ...specific]) {
      const changed = rehash(plan, built.ir, value => { mutate(value.structural.blocks[0]); const relation = value.structural.blocks[0].relation; relation.id = `rhetorical-${hash(Object.fromEntries(Object.entries(relation).filter(([key]) => key !== 'id'))).slice(0, 24)}`; });
      assert.equal(validateStructural(built.ir, changed, references), false, source);
      assert.notEqual(fullCheck(built.ir, changed), 'passed', source);
    }
  }
});

test('independent B3: old versions and unknown semantic fields fail strict schemas and immutable rebinding', async () => {
  const built = await build('この橋が安全だという根拠になる記録を読ませてください。'); const plan = built.plans[0]; assert.ok(plan);
  const ajv = new Ajv2020({ strict: true }), programSchema = ajv.compile(StructuralProgramSchema), relationSchema = ajv.compile(RhetoricalRelationSchema);
  assert.ok(programSchema(plan.structural)); assert.ok(relationSchema(plan.structural.blocks[0].relation));
  for (const mutate of [
    value => { value.structural.version = 2; }, value => { value.structural.blocks[0].relation.version = 2; },
    value => { value.structural.blocks[0].relation.evidenceRequest.assertedTruth = true; },
    value => { value.structural.blocks[0].relation.conditions[0].inventedSpeaker = '王'; },
    value => { value.structural.search.policy = 'bounded-relation-composition-v2'; },
  ]) { const changed = rehash(plan, built.ir, mutate); assert.equal(programSchema(changed.structural), false); assert.equal(validateStructural(built.ir, changed, references), false); }
});

test('independent B3: role-local quantities, scalar spans, locked replay and final output proofs stay effective', async () => {
  const built = await build('🦉費用が1.5万円以下だったので、私は券を2枚買いました。'); assert.ok(built.plans.length); checked(built);
  for (const plan of built.plans) {
    const rendered = renderStructural(built.ir, plan); assert.ok(structuralQuantityPreserved(built.ir, plan));
    assert.ok(rendered.text.includes('1.5万円以下')); assert.ok(rendered.text.includes('2枚'));
    assert.equal([...rendered.text].filter(char => char === '🦉').length, 1);
    assert.equal(rendered.spans.map(span => slice(rendered.text, span.span)).join(''), rendered.text);
    const bad = structuredClone(rendered.spans); bad[0].sourceSpan.start++; assert.notEqual(fullCheck(built.ir, plan, { text: rendered.text, spans: bad }), 'passed');
  }
  const carrier = await build('この橋が安全だという根拠になる記録を読ませてください。');
  const result = generate(carrier.request, carrier.analysis, assets); finishSemanticVerification(result, {});
  const candidate = result.candidates.find(value => value.plan.structural); assert.ok(candidate);
  for (const item of result.candidates) { assert.equal(item.scores.S, null); assert.equal(item.scores.Q, null); }
  const replayed = replayGeneration(result.replayManifest, carrier.analysis, assets); finishSemanticVerification(replayed, {});
  assert.deepEqual(replayed.candidates.map(value => [value.id, value.text, value.spans]), result.candidates.map(value => [value.id, value.text, value.spans]));
  for (const mutate of [value => { value.structural.version = 2; }, value => { value.structural.blocks[0].relation.evidenceRequest.targetSpan.start++; }]) {
    const changed = rehash(candidate.plan, carrier.ir, mutate);
    assert.throws(() => generate(carrier.request, carrier.analysis, assets, { lockedPlan: changed, lockedNodeIds: candidate.plan.nodes.map(node => node.id) }), /LOCK_CONFLICT/);
  }
  candidate.text += '全員が証拠だと認めた。'; finishSemanticVerification(result, {});
  assert.equal(candidate.verificationStatus, 'rejected'); assert.ok(!result.candidates.some(value => value.id === candidate.id));
});
