'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { sourceDocument, slice } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { propositionScopes, isPastAuxiliary } = require('../../dist/packages/core/grammar-scope');
const { recognizeRhetoricalRelations } = require('../../dist/packages/core/rhetorical-recognition');
const request = source => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0 });
let python;
const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); });
after(() => python?.close());
async function recognize(source) {
  if (!cache.has(source)) cache.set(source, await python.analyze(source));
  const ir = extractFacts(sourceDocument(source), cache.get(source), request(source));
  return { ir, relations: recognizeRhetoricalRelations(ir) };
}
const slotText = (ir, relation, role) => slice(ir.source.raw, relation.slots.find(slot => slot.role === role).span);

function checkSourceProof(ir, relation) {
  assert.equal(relation.version, 3);
  assert.match(relation.id, /^rhetorical-[a-f0-9]{24}$/u);
  assert.deepEqual(relation.provenance, { inputHash: ir.source.inputHash, parserVersion: ir.parserVersion });
  assert.equal('to' in relation, false);
  assert.equal('series' in relation, false);
  assert.equal('constructionId' in relation, false);
  for (const part of [...relation.slots, ...relation.markers]) {
    assert.deepEqual(part.tokenIds, ir.tokens.filter(token => part.span.start <= token.span.start && token.span.end <= part.span.end).map(token => token.id));
    assert.ok(relation.sourceSpan.start <= part.span.start && part.span.end <= relation.sourceSpan.end);
  }
  for (const slot of relation.slots) assert.deepEqual(slot.factIds, ir.facts.filter(fact => slot.span.start <= fact.predicateSpan.start && fact.predicateSpan.end <= slot.span.end).map(fact => fact.id));
  const pieces = [...relation.slots, ...relation.markers.filter(marker => !relation.slots.some(slot => slot.span.start <= marker.span.start && marker.span.end <= slot.span.end))].sort((a, b) => a.span.start - b.span.start);
  let cursor = relation.sourceSpan.start;
  for (const piece of pieces) { assert.equal(piece.span.start, cursor, `gap or duplication in ${JSON.stringify(pieces)}`); cursor = piece.span.end; }
  assert.equal(cursor, relation.sourceSpan.end);
  assert.equal(pieces.map(piece => slice(ir.source.raw, piece.span)).join(''), slice(ir.source.raw, relation.sourceSpan));
  for (const condition of relation.conditions) {
    const fact = ir.facts.find(fact => fact.id === condition.factId);
    assert.ok(fact);
    for (const field of ['polarity', 'tense', 'realization', 'completion', 'voice', 'attribution', 'resolution']) assert.deepEqual(condition[field], fact[field]);
    const scope = propositionScopes(ir.source, ir).find(scope => scope.predicate.id === condition.predicateTokenId);
    for (const field of ['conditional','speculative','prospective','ambiguous','reportedContent']) assert.equal(condition[field], scope[field]);
    assert.ok(condition.sourceRole);
    if (condition.preservation === 'asserted') assert.equal(condition.realization, 'actual');
  }
  assert.deepEqual(recognizeRhetoricalRelations(ir).find(row => row.id === relation.id), relation);
}

test('live causal clauses use grammatical から and split ので across varied content', async () => {
  for (const [source, reason, claim] of [
    ['雨が降ったから、私は帰った。', '雨が降った', '私は帰った'],
    ['店が安いので、私は弁当を買った。', '店が安い', '私は弁当を買った'],
    ['電車は便利だから、私は電車を選んだ。', '電車は便利だ', '私は電車を選んだ'],
    ['資料が届かなかったので、会議を延期した。', '資料が届かなかった', '会議を延期した'],
    ['価格が重要なので、私は弁当を買った。', '価格が重要', '私は弁当を買った'],
    ['雨なので、帰った。', '雨', '帰った'],
    ['費用が500円だったから、切符を買った。', '費用が500円だった', '切符を買った'],
    ['道が空いていたから早く着いた。', '道が空いていた', '早く着いた'],
  ]) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'reason-claim');
    assert.ok(relation, source); assert.equal(relation.sourceForm, 'causal-clause');
    assert.equal(slotText(ir, relation, 'reason'), reason); assert.equal(slotText(ir, relation, 'claim'), claim);
    assert.ok(relation.conditions.every(value => value.illocution === 'assertion'));
    if (source.includes('なので')) assert.equal(slice(source, relation.markers.find(value => value.role === 'cause-link-copula').span), 'な');
    checkSourceProof(ir, relation);
  }
});

test('trailing explanations keep both source bodies and record removed cause/copula tails', async () => {
  for (const [source, claim, reason] of [
    ['帰った。雨が降っていたからだ。', '帰った', '雨が降っていた'],
    ['私は残った。電車が来ないからです。', '私は残った', '電車が来ない'],
    ['この店に決めた。値段が安いからだ。', 'この店に決めた', '値段が安い'],
    ['私は電車を選んだ。速度が重要だからだ。', '私は電車を選んだ', '速度が重要だ'],
  ]) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'reason-claim');
    assert.ok(relation, source); assert.equal(relation.sourceForm, 'trailing-reason');
    assert.equal(slotText(ir, relation, 'claim'), claim); assert.equal(slotText(ir, relation, 'reason'), reason);
    assert.ok(relation.markers.some(value => value.role === 'explanatory-copula'));
    checkSourceProof(ir, relation);
  }
});

test('cause recognition rejects source/time particles, questions, uncertainty, reports and unsafe boundaries', async () => {
  for (const source of [
    '駅から帰った。', '午後三時からだ。', '出発時刻が変わった。午後三時からだ。',
    '出発地点が変わった。駅からだ。', '安いからだ。', '雨が降った。私は帰った。',
    '雨が降ってから、私は帰った。', '荷物を運んでから、私は帰った。',
    '帰宅時刻は遅かった。荷物を運んでからだ。',
    '帰るため荷物を用意した。', '雨が降れば、私は帰る。',
    '雨が降ったから、私は帰ったのか。', '雨が降ったから、私は帰った？',
    'たぶん雨が降ったから、私は帰った。', '雨が降ったらしいので、私は帰った。',
    '雨が降ったかもしれないので、私は帰った。', '雨が降ったので、帰ったと思う。',
    '雨が降ったと太郎が言ったから、私は帰った。', '雨が降ったという話なので、私は帰った。',
    '「雨が降ったから、私は帰った。」', '雨が降ったから、私は帰ったと言った。',
    '（雨が降ったから、私は帰った。）', '“雨が降ったから、私は帰った。”',
    '雨が降ったに違いないから、帰った。', '雨が降ったに決まっているから、帰った。',
    '雨が降った可能性があるから、帰った。', '雨が降った気がするから、帰った。',
    'もし雨が降っていたら帰ったからだ。',
    '私は雨が降ったから帰った。', '雨が降ったからであって、寒かったからではない。',
    '電車にする？安いからだ。', '帰ったかもしれない。雨だからだ。',
    '帰った。雨が降ったからだと思う。', '帰った。雨が降ったからではない。',
    '帰った。雨が降ったからだ？', '帰った。何故なら雨が降ったからだ。',
    '帰った？\n雨が降ったからだ。', '太郎は帰ったと言った。雨が降っていたからだ。',
  ]) assert.equal((await recognize(source)).relations.filter(row => row.kind === 'reason-claim').length, 0, source);
});

test('opening modesty recognizes grammatical variants and a bounded class of actual self accomplishments', async () => {
  for (const source of [
    '大したことはしていない。私は機械を動かしただけだ。',
    '大したことはしていません。私は荷物を運んだ。',
    '大したことではない。私は原因を見つけた。',
    '大したことではありません。私は機械を直しただけです。',
    '大したことじゃありません。僕は荷物を届けた。',
    '自慢ではない。私は問題を解決した。',
    '自慢じゃない。俺は報告書を完成した。',
    '自慢ではありません。私は報告書を提出しました。',
    '私は大したことはしていない。荷物を運んだ。',
    '大したことはしていない。機械を動かしただけだ。',
    '自慢じゃない。荷物を運んだだけだ。',
  ]) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'modest-achievement');
    assert.ok(relation, source); assert.equal(relation.sourceForm, 'opening-modesty');
    assert.equal(slotText(ir, relation, 'achievement'), source.split('。')[1]);
    const past = relation.markers.find(value => value.role === 'past');
    assert.ok(past); assert.ok(isPastAuxiliary(ir.tokens[past.tokenIds[0]]));
    const explicit = /私|僕|俺/u.test(source);
    assert.equal(relation.agentResolution, explicit ? 'explicit-first-person' : 'source-omitted');
    if (source.includes('だけ')) assert.equal(slice(source, relation.markers.find(value => value.role === 'limit').span), 'だけ');
    checkSourceProof(ir, relation);
  }
});

test('modesty does not assign accomplishment, narrator ownership, or certainty to ambiguous action', async () => {
  for (const source of [
    '大したことはしていない。', '機械を直した。', '自慢ではない。荷物を運んだ。',
    '大したことではない。機械を直した。', '太郎の話だ。大したことはしていない。荷物を運んだだけだ。',
    '大したことはしていない。太郎は機械を動かしただけだ。',
    '大したことはしていない。彼が機械を動かしただけだ。',
    '大したことはしていない。私と太郎が機械を動かしただけだ。',
    '大したことはしていない。私は太郎と機械を動かしただけだ。',
    '大したことはしていない。太郎が原因を見つけて機械を動かしただけだ。',
    '大したことはしていない。機械を動かしただけだと思う。',
    '大したことはしていない。私は機械を動かすだけだ。',
    '大したことはしていない。私は機械を動かさなかっただけだ。',
    '大したことはしていない。私は機械を動かしているだけだ。',
    '大したことはしていない。私は機械を動かしたかっただけだ。',
    '大したことはしていない。私は機械を動かしたいだけだ。',
    '大したことはしていない。私は荷物を運んだだけだ？',
    '大したことはしていない。私は荷物を運んだだけらしい。',
    '大したことではない。私は機械を直したに違いない。',
    '大したことはしていない。私は明日荷物を運ぶだけだ。',
    '大したことはしていない。私は荷物を運んだと話した。',
    '「大したことはしていない。」私は荷物を運んだだけだ。',
    '大したことはしていない。荷物を運んだら帰っただけだ。',
    '太郎は大したことはしていない。私は荷物を運んだだけだ。',
    '私の自慢ではない。荷物を運んだだけだ。',
  ]) assert.equal((await recognize(source)).relations.filter(row => row.kind === 'modest-achievement').length, 0, source);
});

test('evidence question embeds source proposition as mentioned content, not an assertion or adversary', async () => {
  for (const [source, target, request] of [
    ['太郎が資料を改ざんしたという証拠はありますか。', '太郎が資料を改ざんした', '証拠はあります'],
    ['値段が高いという根拠はあるのか。', '値段が高い', '根拠はあるの'],
    ['この案が安全だという証拠はありますか。', 'この案が安全だ', '証拠はあります'],
    ['太郎が来なかったという証拠はありますか？', '太郎が来なかった', '証拠はあります'],
    ['太郎が来たという証拠はあるのですか。', '太郎が来た', '証拠はあるのです'],
    ['問題を解決したという証拠はあるか。', '問題を解決した', '証拠はある'],
    ['費用が500円だったという根拠はありますか。', '費用が500円だった', '根拠はあります'],
  ]) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'evidence-request');
    assert.ok(relation, source); assert.equal(relation.sourceForm, 'embedded-evidence-question');
    assert.equal(slotText(ir, relation, 'target'), target); assert.equal(slotText(ir, relation, 'request'), request);
    assert.ok(relation.conditions.some(value => value.illocution === 'mentioned-proposition'));
    assert.ok(relation.conditions.some(value => value.illocution === 'question' && value.nonDeclarative));
    assert.ok(relation.conditions.every(value => value.illocution !== 'assertion'));
    assert.equal('agentResolution' in relation, false); assert.equal('opponent' in relation, false);
    checkSourceProof(ir, relation);
  }
});

test('evidence recognition abstains on bare evidence, declaratives, reporting shells and uncertain targets', async () => {
  for (const source of [
    '証拠はありますか。', '太郎が来た。証拠はありますか。', 'それが証拠ですか。',
    '太郎が来たという証拠はあります。', '太郎が来たという証拠はない。',
    '太郎が来たという証拠はないのか。', '太郎が来たという証拠はありましたか。',
    '太郎が来たという証拠はありますかと聞いた。', '「太郎が来たという証拠はありますか。」',
    '太郎が来たらしいという証拠はありますか。', '太郎が来たかもしれないという証拠はありますか。',
    '太郎が来たと花子が話したという証拠はありますか。',
    '太郎が来たと思うという根拠はあるのか。',
    '太郎が来たに違いないという証拠はありますか。',
    '誰が来たという証拠はありますか。', 'それが危険だという証拠はありますか。',
    '太郎が明日来るという証拠はありますか。', '太郎が来れば帰るという根拠はあるのか。',
    '太郎が来たという確かな証拠はありますか。',
    '太郎が来たという証拠は私が持っていますか。',
  ]) assert.equal((await recognize(source)).relations.filter(row => row.kind === 'evidence-request').length, 0, source);
});

test('dependency corruption cannot license relations by a source sentence string alone', async () => {
  for (const [source, select, alter] of [
    ['雨が降ったから、私は帰った。', ir => ir.tokens.find(token => token.text === 'から'), token => { token.dep = 'case'; token.pos = 'ADP'; }],
    ['雨なので、帰った。', ir => ir.tokens.find(token => token.text === 'で'), token => { token.dep = 'aux'; }],
    ['帰った。雨が降ったからだ。', ir => ir.tokens.find(token => token.text === 'から'), token => { token.dep = 'case'; }],
    ['大したことではない。私は荷物を運んだ。', ir => ir.tokens.find(token => token.text === '大した'), token => { token.dep = 'advmod'; }],
    ['太郎が来たという証拠はありますか。', ir => ir.tokens.find(token => token.text === 'いう'), token => { token.dep = 'acl'; }],
    ['太郎が来たという証拠はありますか。', ir => ir.tokens.find(token => token.text === '証拠'), token => { token.dep = 'obj'; }],
  ]) {
    const { ir, relations } = await recognize(source); assert.equal(relations.length, 1, source);
    const corrupted = structuredClone(ir); alter(select(corrupted));
    assert.deepEqual(recognizeRhetoricalRelations(corrupted), [], source);
  }
});

test('whole relation must be adopted and all grammatical conditions must bind to facts', async () => {
  for (const source of ['雨が降ったから、私は帰った。', '帰った。雨が降っていたからだ。', '自慢ではない。私は荷物を運んだ。', '太郎が来たという証拠はありますか。']) {
    const { ir, relations } = await recognize(source); assert.equal(relations.length, 1, source);
    for (const change of [
      copy => { copy.topicOnly = true; },
      copy => { copy.adoptedSpans = [{ start: 1, end: [...source].length }]; },
      copy => { copy.omittedSpans = [{ start: 1, end: 2 }]; },
      copy => { copy.facts.shift(); },
      copy => { copy.facts[0].realization = 'unknown'; },
      copy => { copy.facts[0].polarity = 'unknown'; },
      copy => { copy.facts[0].attribution = { kind: 'hearsay', speaker: null }; },
    ]) {
      const copy = structuredClone(ir); change(copy);
      assert.deepEqual(recognizeRhetoricalRelations(copy), [], source);
    }
    const changed = structuredClone(ir); changed.parserVersion += ':changed';
    const rebound = recognizeRhetoricalRelations(changed);
    assert.equal(rebound.length, 1); assert.notEqual(rebound[0].id, relations[0].id);
  }
});

test('relations carry every source predicate condition, including nested clause scopes', async () => {
  const source = '太郎が修理した機械が動いたから、私は喜んだ。';
  const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'reason-claim');
  assert.ok(relation);
  assert.equal(relation.conditions.length, propositionScopes(ir.source, ir).length);
  assert.ok(relation.conditions.length >= 3);
  checkSourceProof(ir, relation);
});

test('source evidence demands preserve their speech act and explicit contrast prefix', async () => {
  for (const [source, target, shell] of [
    ['便利なのは分かった。しかし安全だという証拠を見せてほしい。', '安全だ', '証拠を見せてほしい'],
    ['太郎が来たという証拠を示してください。', '太郎が来た', '証拠を示してください'],
    ['太郎が来たという証拠を見せてください。', '太郎が来た', '証拠を見せてください'],
    ['太郎が来たという根拠を示してほしい。', '太郎が来た', '根拠を示してほしい'],
  ]) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'evidence-request');
    assert.ok(relation, source); assert.equal(relation.sourceForm, 'carrier-evidence-request');
    assert.equal(slice(source, relation.evidenceRequest.targetSpan), target);
    assert.ok(shell.includes(slotText(ir, relation, 'request')));
    assert.ok(relation.conditions.some(value => value.illocution === 'request'));
    assert.ok(relation.conditions.every(value => ['request','mentioned-proposition','literal-context'].includes(value.illocution)));
    if (source.includes('しかし')) assert.ok(slotText(ir, relation, 'context').includes('しかし'));
    assert.ok(relation.markers.some(value => value.role === 'request-terminal'));
    checkSourceProof(ir, relation);
  }
  const { ir, relations } = await recognize('しかし、太郎が来たという証拠はありますか。');
  const relation = relations.find(row => row.kind === 'evidence-request');
  assert.ok(relation); assert.equal(relation.sourceForm, 'embedded-evidence-question');
  assert.equal(slotText(ir, relation, 'target'), '太郎が来た');
  assert.equal(slice(ir.source.raw, relation.markers.find(value => value.role === 'contrast-prefix').span), 'しかし、');
  checkSourceProof(ir, relation);
});

test('evidence demand grammar rejects past wishes, reports, bare objects and compound contrast', async () => {
  for (const source of [
    'しかし証拠を見せてほしい。', '太郎が来た。証拠が欲しい。',
    '太郎が来たという証拠を見せた。', '太郎が来たという証拠を見せたい。',
    '太郎が来たという証拠を見せてほしかった。', '太郎が来たという証拠が欲しかった。',
    '太郎が来たという証拠が欲しくない。', '太郎が来たという証拠を見せないでください。',
    '太郎が来たという証拠が欲しい？', '太郎が来たという証拠を見せてほしい？',
    '太郎が来たという証拠を見せてほしいと言った。', '太郎が来たという証拠が欲しいと思う。',
    '「太郎が来たという証拠を見せてほしい。」',
    'その予測を教えてください。', 'この数値を裏付ける資料を求める。',
  ]) assert.equal((await recognize(source)).relations.filter(row => row.kind === 'evidence-request').length, 0, source);
});

test('modesty reordering abstains on leading discourse links without rejecting nested relative clauses', async () => {
  for (const connective of ['でも、', 'しかし、', 'だから、', 'それで、', 'それでも、', 'そのため、', 'その結果、', 'そして、', 'ただ、', 'さらに、', 'あと、']) {
    const source = `私は大したことはしていません。${connective}故障した装置を直しました。`;
    const relations = (await recognize(source)).relations.filter(row => row.kind === 'modest-achievement');
    if (['でも、','しかし、','それでも、'].includes(connective)) {
      for (const relation of relations) assert.equal(relation.sourceForm, 'concessive-sentences');
    } else assert.equal(relations.length, 0, source);
  }
  for (const source of [
    '私は大したことはしていません。故障した装置を直しました。',
    '大したことではない。私は太郎が修理した装置を運んだ。',
    '私は大したことはしていません。その結果を確認した。',
  ]) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'modest-achievement');
    assert.ok(relation, source); checkSourceProof(ir, relation);
  }
});

test('causal reordering abstains when either clause has an unrepresented leading discourse link', async () => {
  for (const source of [
    '残るつもりだった。しかし帰った。雨が降っていたからだ。',
    'でも帰った。雨が降っていたからだ。',
    'だから帰った。雨が降っていたからだ。',
    'そのため、帰った。雨が降っていたからだ。',
    '帰った。しかし雨が降っていたからだ。',
    'しかし雨が降ったので、帰った。',
    '雨が降ったので、しかし帰った。',
    '雨が降ったので、でも帰った。',
  ]) assert.equal((await recognize(source)).relations.filter(row => row.kind === 'reason-claim').length, 0, source);
  const { ir, relations } = await recognize('太郎が修理した装置が動いたので、私は喜んだ。');
  const relation = relations.find(row => row.kind === 'reason-claim');
  assert.ok(relation); checkSourceProof(ir, relation);
});

// These were conservative v2 refusals. B3 retains the supplied event/target
// while explicitly avoiding praise and assertion promotion.
test('v3 source event and uncertain requested target remain source-grounded', async () => {
  const event = await recognize('大したことはしていない。私は機械を壊しただけだ。');
  const relation = event.relations.find(row => row.kind === 'modest-achievement'); assert.ok(relation);
  assert.equal(relation.achievementKind, 'completed-event'); checkSourceProof(event.ir, relation);
  const request = await recognize('太郎が来たらしいという証拠を示してください。');
  const evidence = request.relations.find(row => row.kind === 'evidence-request'); assert.ok(evidence);
  assert.equal(evidence.sourceForm, 'carrier-evidence-request');
  assert.ok(evidence.conditions.filter(condition => condition.sourceRole === 'mentioned-target').every(condition => condition.illocution === 'mentioned-proposition' && condition.preservation === 'literal-copy'));
  checkSourceProof(request.ir, evidence);
});

test('nonpast verbal conclusions remain temporally bounded without a small future-word list', async () => {
  for (const source of ['窓口の人がお休みのため、金額の問い合わせには翌日お返事します。', 'いつもの喫茶店が工事で休んでいるため、お昼は職場の食事スペースを使います。', '必要な道具があるので、週末に棚を組み立てます。']) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'reason-claim'); assert.ok(relation, source);
    const claim = relation.slots.find(slot => slot.role === 'claim');
    assert.ok(relation.conditions.some(condition => claim.factIds.includes(condition.factId) && condition.preservation === 'modality-preserved'));
    const choices = require('../../dist/packages/core/rhetorical-operators').relationRealizations(relation, 3);
    assert.ok(choices.length); assert.ok(choices.every(choice => choice.operatorId === 'reason-explanation'));
  }
});

test('explicit future premises keep modality and do not authorize fact nominalization', async () => {
  for (const source of ['この資料は保存する。来週の説明に必要だからだ。', '明日雨が降るから、帰る。']) {
    const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'reason-claim'); assert.ok(relation, source);
    assert.ok(relation.conditions.some(condition => condition.prospective && condition.preservation === 'modality-preserved'));
    const choices = require('../../dist/packages/core/rhetorical-operators').relationRealizations(relation, 3);
    assert.ok(choices.length); assert.ok(choices.every(choice => choice.operatorId === 'reason-explanation'));
    checkSourceProof(ir, relation);
  }
});

test('compound contrast is retained as a full literal carrier-request context', async () => {
  const source = 'しかしながら太郎が来たという証拠を見せてほしい。';
  const { ir, relations } = await recognize(source), relation = relations.find(row => row.kind === 'evidence-request'); assert.ok(relation);
  assert.equal(relation.sourceForm, 'carrier-evidence-request');
  assert.equal(slotText(ir, relation, 'context'), 'しかしながら');
  assert.equal(slotText(ir, relation, 'request'), '見せて'); checkSourceProof(ir, relation);
});
