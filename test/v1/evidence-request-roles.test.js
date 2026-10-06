'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { sourceDocument, slice } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { replayGeneration } = require('../../dist/packages/core/replay');
const { validateStructural } = require('../../dist/packages/core/structural-validation');
const { recognizeCarrierEvidenceRequests, realizeCarrierEvidencePieces, carrierEvidenceOperator } = require('../../dist/packages/core/evidence-request-roles');
const request = source => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 3, series: 'all', backend: 'structured', clientRevision: 0, seed: 'evidence-role-contract' });
let python, assets, refs; const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); refs = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function analyze(source) { if (!cache.has(source)) cache.set(source, await python.analyze(source)); return cache.get(source); }
async function irFor(source) { return extractFacts(sourceDocument(source), await analyze(source), request(source)); }
const witnesses = carrierEvidenceOperator.examples.map(example => example.id);
const render = (ir, relation) => slice(ir.source.raw, { start: 0, end: relation.sourceSpan.start })
  + realizeCarrierEvidencePieces(ir, relation, 'request-then-carrier', witnesses).map(piece => piece.kind === 'source' ? slice(ir.source.raw, piece.sourceSpan) : piece.text).join('')
  + slice(ir.source.raw, { start: relation.sourceSpan.end, end: [...ir.source.raw].length });
const exposed = [
  ['受付の応援を頼む案には賛成です。ただ、午前中に来訪者が増えたという根拠になった来訪記録を見せてください。', '受付の応援を頼む案には賛成です。ただ、見せてくれるか、午前中に来訪者が増えたという根拠になった来訪記録を。'],
  ['受付を手伝う人を増やすことには同意します。朝の時間帯の訪問が増えたと判断した元の来訪記録を確認させてください。', '受付を手伝う人を増やすことには同意します。確認させてくれるか、朝の時間帯の訪問が増えたと判断した元の来訪記録を。'],
  ['清掃の回数を減らすことには反対です。汚れが少なくなったという説明の裏付けとして、先月の点検表を出してください。', '清掃の回数を減らすことには反対です。汚れが少なくなったという説明の裏付けとして、出してくれるか、先月の点検表を。'],
  ['掃除をする頻度は下げたくありません。汚れが減ったという話を確かめたいので、前の月の点検記録を提示してください。', '掃除をする頻度は下げたくありません。汚れが減ったという話を確かめたいので、提示してくれるか、前の月の点検記録を。'],
  ['工具の交換を進めることには異論ありません。その前に、故障が増えていると分かるメーカーの点検報告書を読ませてください。', '工具の交換を進めることには異論ありません。その前に、読ませてくれるか、故障が増えていると分かるメーカーの点検報告書を。'],
  ['道具を取り替える方針は受け入れます。ただ、着手するより先に、故障件数が増えた根拠となる製造元の検査報告を確認させてください。', '道具を取り替える方針は受け入れます。ただ、着手するより先に、確認させてくれるか、故障件数が増えた根拠となる製造元の検査報告を。'],
];

test('dependency-bound requested carriers retain all six exposed actions, named objects, purposes and prior stances', async () => {
  for (const [source, expected] of exposed) {
    const ir = await irFor(source), relations = recognizeCarrierEvidenceRequests(ir);
    assert.equal(relations.length, 1, source);
    const relation = relations[0]; assert.equal(relation.version, 3); assert.equal(render(ir, relation), expected);
    assert.equal(relation.sourceForm, 'carrier-evidence-request');
    const metadata = relation.evidenceRequest;
    assert.ok(metadata.targetSpan.end <= metadata.carrierSpan.end);
    assert.equal(slice(source, metadata.terminalSpan), 'ください');
    assert.equal(slice(source, metadata.caseSpan), 'を');
    assert.equal(relation.slots.filter(slot => slot.role === 'carrier').length, 1);
    assert.ok(relation.conditions.every(condition => condition.preservation === 'literal-copy'));
    assert.ok(relation.conditions.some(condition => condition.illocution === 'mentioned-proposition' && condition.sourceRole === 'mentioned-target'));
    assert.ok(relation.conditions.some(condition => condition.illocution === 'request' && condition.sourceRole === 'request-shell'));
  }
});

test('full engine independently verifies action-preserving carrier generation, without promoting the target or dropping request action', async () => {
  for (const [source, expected] of exposed) {
    const result = generate(request(source), await analyze(source), assets);
    const candidates = result.candidatePool.filter(candidate => candidate.plan.structural?.blocks.some(block => block.operatorId === 'carrier-evidence-request'));
    assert.ok(candidates.length, source);
    assert.ok(candidates.some(candidate => candidate.text === expected), source);
    for (const candidate of candidates) {
      assert.equal(candidate.verificationStatus, 'passed', candidate.text);
      assert.equal(validateStructural(result.ir, candidate.plan, refs), true);
      assert.equal(candidate.scores.S, null); assert.equal(candidate.scores.Q, null);
      assert.doesNotMatch(candidate.text, /どういう証拠がある|論破|勝利/u);
    }
  }
});

test('carrier nouns are open vocabulary while claim, quotation, negative target and post-object recipient remain literal', async () => {
  const cases = [
    ['交換の必要性が分かる資料を見せてください。', '見せてくれるか、交換の必要性が分かる資料を。'],
    ['この予測の根拠を教えてください。', '教えてくれるか、この予測の根拠を。'],
    ['作業を減らす案には賛成ですけれど、点検を週一回にしても安全だと判断した理由を説明してください。', '作業を減らす案には賛成ですけれど、説明してくれるか、点検を週一回にしても安全だと判断した理由を。'],
    ['利用者が減ったという根拠となる受付票を山田さんに提示してください。', '山田さんに提示してくれるか、利用者が減ったという根拠となる受付票を。'],
    ['気温が下がったことの裏付けとして、庭の花の写真を見せてください。', '気温が下がったことの裏付けとして、見せてくれるか、庭の花の写真を。'],
    ['回収が済んだと分かる宅配会社の控えを読ませてください。', '読ませてくれるか、回収が済んだと分かる宅配会社の控えを。'],
    ['在庫が足りないという根拠となる仕入先の一覧表を出してください。', '出してくれるか、在庫が足りないという根拠となる仕入先の一覧表を。'],
    ['「故障が増えた」という根拠になったメーカーの報告書を読ませてください。', '読ませてくれるか、「故障が増えた」という根拠になったメーカーの報告書を。'],
    ['「雨が降れば、故障が増える」という根拠になる資料を見せてください。', '見せてくれるか、「雨が降れば、故障が増える」という根拠になる資料を。'],
    ['雨が降れば故障が増えるという根拠になる資料を見せてください。', '見せてくれるか、雨が降れば故障が増えるという根拠になる資料を。'],
  ];
  for (const [source, expected] of cases) {
    const ir = await irFor(source), relations = recognizeCarrierEvidenceRequests(ir);
    assert.equal(relations.length, 1, source); assert.equal(render(ir, relations[0]), expected);
    const result = generate(request(source), await analyze(source), assets);
    const candidate = result.candidatePool.find(candidate => candidate.text === expected);
    assert.ok(candidate, source); assert.equal(candidate.verificationStatus, 'passed'); assert.equal(validateStructural(result.ir, candidate.plan, refs), true);
  }
});

test('evidence carrier recognition refuses unattached cues, negated judgment, missing requests, quoted speakers and unsupported actions', async () => {
  for (const source of [
    'メーカーの点検報告書を読ませてください。',
    '日本語が分かる人の資料を見せてください。',
    'この橋が安全か確かめたくないので、点検表を見せてください。',
    '太郎に、この橋が安全だという根拠になる昨日の記録を見せてください。',
    '太郎が来たら、この橋が安全だという根拠になる記録を見せてください。',
    '根拠は不要です。メーカーの点検報告書を見せてください。',
    '故障が増えた根拠にはならない記録を見せてください。',
    '故障が増えたと判断していない元の記録を見せてください。',
    '故障が増えた根拠となる記録を見せないでください。',
    '佐伯さんは故障が増えた根拠となる記録を見せてくださいと言いました。',
    '「故障が増えた根拠となる記録を見せてください」と佐伯さんが言いました。',
    '故障が増えた根拠となる記録を捨ててください。',
    '必要なら故障が増えた根拠となる記録を見せてください。',
    '故障が増えた根拠となる記録を見せました。',
  ]) assert.equal(recognizeCarrierEvidenceRequests(await irFor(source)).length, 0, source);
});

test('carrier role spans, mentioned-target attribution, action identity and component provenance cannot be forged', async () => {
  const source = exposed[4][0], result = generate(request(source), await analyze(source), assets);
  const original = result.candidatePool.find(candidate => candidate.plan.structural?.blocks.some(block => block.operatorId === 'carrier-evidence-request'));
  assert.ok(original);
  const mutators = [
    block => { block.relation.evidenceRequest.targetSpan.start++; },
    block => { block.relation.evidenceRequest.carrierSpan.start++; },
    block => { block.relation.evidenceRequest.actionSpan.start++; },
    block => { block.relation.evidenceRequest.actionKind = 'presentation'; },
    block => { block.relation.evidenceRequest.cueTokenIds.pop(); },
    block => { block.relation.conditions.find(condition => condition.sourceRole === 'mentioned-target').illocution = 'assertion'; },
    block => { block.relation.conditions.find(condition => condition.sourceRole === 'mentioned-target').preservation = 'asserted'; },
    block => { block.pieces.find(piece => piece.kind === 'form' && piece.formId === 'source-action-request-question').text = 'できる。'; },
    block => { block.evidenceIds = block.evidenceIds.slice(1); },
  ];
  for (const mutate of mutators) {
    const plan = structuredClone(original.plan), block = plan.structural.blocks.find(block => block.operatorId === 'carrier-evidence-request');
    mutate(block); assert.equal(validateStructural(result.ir, plan, refs), false);
  }
  const ir = await irFor(source), relation = recognizeCarrierEvidenceRequests(ir)[0];
  assert.equal(realizeCarrierEvidencePieces(ir, relation, 'request-then-carrier', witnesses.slice(1)), undefined);
  for (const series of ['nega', 'yorusama', 'night']) {
    const restricted = generate({ ...request(source), series }, await analyze(source), assets);
    assert.ok(restricted.candidatePool.every(candidate => !candidate.plan.structural?.blocks.some(block => block.operatorId === 'carrier-evidence-request')), series);
  }
});


test('carrier programs preserve quantity/source coverage and exact nodes through final verification, locking and replay', async () => {
  const source = '清掃の回数を減らすことには反対です。汚れが少なくなったという説明の裏付けとして、先月の点検表2枚を出してください。';
  const analysis = await analyze(source), result = generate(request(source), analysis, assets);
  finishSemanticVerification(result, {});
  const parent = result.candidates.find(candidate => candidate.plan.structural?.blocks.some(block => block.operatorId === 'carrier-evidence-request'));
  assert.ok(parent); assert.ok(parent.text.includes('先月の点検表2枚を'));
  assert.equal(parent.verificationStatus, 'passed');
  assert.equal(parent.spans.map(span => slice(parent.text, span.span)).join(''), parent.text);
  for (const span of parent.spans.filter(span => span.origin === 'source_fact')) assert.equal(slice(parent.text, span.span), slice(source, span.sourceSpan));
  const replay = replayGeneration(result.replayManifest, analysis, assets); finishSemanticVerification(replay, {});
  assert.deepEqual(replay.candidates.map(candidate => [candidate.id, candidate.text, candidate.spans]), result.candidates.map(candidate => [candidate.id, candidate.text, candidate.spans]));
  const lockedNodeIds = parent.plan.nodes.map(node => node.id), locked = generate(request(source), analysis, assets, { lockedPlan: parent.plan, lockedNodeIds, operator: 'STRUCTURAL' });
  finishSemanticVerification(locked, {}); assert.ok(locked.candidates.length);
  for (const candidate of locked.candidates) { assert.equal(candidate.text, parent.text); assert.deepEqual(candidate.plan.structural, parent.plan.structural); }
  const obsolete = structuredClone(parent.plan); obsolete.structural.version = 2;
  assert.throws(() => generate(request(source), analysis, assets, { lockedPlan: obsolete, lockedNodeIds }), /LOCK_CONFLICT/);
  const forged = structuredClone(parent.plan); forged.structural.blocks[0].relation.evidenceRequest.actionKind = 'inspection-permission';
  assert.throws(() => generate(request(source), analysis, assets, { lockedPlan: forged, lockedNodeIds }), /LOCK_CONFLICT/);
});

test('positive desire and benefactive request terminals retain the explicitly requested action, including inspection permission', async () => {
  const cases = [
    ['便利なのは分かった。しかし安全だという証拠を見せてほしい。', '便利なのは分かった。しかし見せてくれるか、安全だという証拠を。', 'ほしい'],
    ['値段には納得しています。ただ、消費電力が減るという測定結果を教えてもらえますか。', '値段には納得しています。ただ、教えてくれるか、消費電力が減るという測定結果を。', 'もらえますか'],
    ['評判が良いことは聞いていますが、この浄水器が水質を改善するという試験結果を教えてください。', '評判が良いことは聞いていますが、教えてくれるか、この浄水器が水質を改善するという試験結果を。', 'ください'],
    ['口コミが好評なのは承知しています。ただ、このろ過装置で水がきれいになると判断した検証データを見せてもらえますか。', '口コミが好評なのは承知しています。ただ、見せてくれるか、このろ過装置で水がきれいになると判断した検証データを。', 'もらえますか'],
    ['手間を省く方向には異論はありませんが、確認を一週間に一度へ変えて問題がないとする裏付けを出してください。', '手間を省く方向には異論はありませんが、出してくれるか、確認を一週間に一度へ変えて問題がないとする裏付けを。', 'ください'],
    ['故障が増えたという根拠となる記録を見せて欲しいです。', '見せてくれるか、故障が増えたという根拠となる記録を。', '欲しいです'],
    ['故障が増えたという根拠となる記録を読ませていただけますか。', '読ませてくれるか、故障が増えたという根拠となる記録を。', 'いただけますか'],
    ['故障が増えたという根拠となる記録を確認させてほしい。', '確認させてくれるか、故障が増えたという根拠となる記録を。', 'ほしい'],
  ];
  for (const [source, expected, terminal] of cases) {
    const ir = await irFor(source), relations = recognizeCarrierEvidenceRequests(ir); assert.equal(relations.length, 1, source);
    const relation = relations[0]; assert.equal(slice(source, relation.evidenceRequest.terminalSpan), terminal); assert.equal(render(ir, relation), expected);
    const result = generate(request(source), await analyze(source), assets), candidate = result.candidatePool.find(candidate => candidate.text === expected);
    assert.ok(candidate, source); assert.equal(candidate.verificationStatus, 'passed'); assert.equal(validateStructural(result.ir, candidate.plan, refs), true);
    assert.ok(result.candidatePool.every(candidate => !candidate.plan.structural?.blocks.some(block => block.operatorId === 'targeted-evidence-question')), source);
    const actualAction = slice(source, relation.evidenceRequest.actionSpan); assert.ok(expected.includes(actualAction), source);
    assert.equal(relation.evidenceRequest.actionKind, /(?:読ませ|確認させ)/u.test(actualAction) ? 'inspection-permission' : 'presentation');
    const forged = structuredClone(candidate.plan); forged.structural.blocks[0].relation.evidenceRequest.terminalSpan.start++;
    assert.equal(validateStructural(result.ir, forged, refs), false);
  }
});

test('expanded terminals do not infer actions, accept negative wishes, or turn reported, past and non-request shells into requests', async () => {
  for (const source of [
    '故障が増えたという証拠が欲しい。',
    '太郎が来たという証拠を見せてほしい？',
    '太郎が来たという証拠を見せて欲しいです？',
    '故障が増えたという根拠となる記録を見せてほしくない。',
    '故障が増えたという根拠となる記録を見せて欲しくありません。',
    '故障が増えたという根拠となる記録を見せてもらえます。',
    '故障が増えたという根拠となる記録を見せてもらえましたか。',
    '故障が増えたという根拠となる記録を見せてほしかった。',
    '故障が増えたという根拠となる記録を見せてほしいと言いました。',
    '「故障が増えたという根拠となる記録を見せてもらえますか」と佐伯さんが聞きました。',
    '昨日のファイルを読ませていただけますか。',
    'この橋が安全だという結果を教えてください。',
    '太郎が来たら、この橋が安全だという試験結果を教えてもらえますか。',
  ]) assert.equal(recognizeCarrierEvidenceRequests(await irFor(source)).length, 0, source);
});

test('independent causal and modesty units compose with following carrier requests without consuming their source or quantities', async () => {
  const cases = [
    ['部品が届いたので、装置を2台修理しました。汚れが減ったという説明の裏付けとして、先月の点検表3枚を出してください。', 'reason-claim', ['装置を2台', '点検表3枚']],
    ['計算は得意ではありませんが、精算書を2枚確認しました。汚れが減ったという説明の裏付けとして、先月の点検表3枚を出してください。', 'modest-achievement', ['精算書を2枚', '点検表3枚']],
  ];
  for (const [source, precedingKind, quantities] of cases) {
    const ir = await irFor(source), relation = recognizeCarrierEvidenceRequests(ir)[0]; assert.ok(relation, source);
    assert.equal(relation.sourceSpan.start, ir.sentences[1].start);
    assert.ok(relation.slots.every(slot => slot.span.start >= ir.sentences[1].start));
    assert.ok(relation.conditions.every(condition => ir.tokens.find(token => token.id === condition.predicateTokenId).span.start >= ir.sentences[1].start));
    const result = generate(request(source), await analyze(source), assets);
    const combined = result.candidatePool.filter(candidate => candidate.plan.structural?.blocks.some(block => block.relation.kind === precedingKind)
      && candidate.plan.structural.blocks.some(block => block.operatorId === 'carrier-evidence-request'));
    assert.ok(combined.length, source);
    for (const candidate of combined) {
      assert.equal(candidate.verificationStatus, 'passed'); assert.equal(validateStructural(result.ir, candidate.plan, refs), true);
      for (const quantity of quantities) assert.ok(candidate.text.includes(quantity), candidate.text);
      const blocks = candidate.plan.structural.blocks;
      for (let index = 1; index < blocks.length; index++) assert.ok(blocks[index - 1].sourceSpan.end <= blocks[index].sourceSpan.start);
    }
    const parent = combined[0], lockedNodeIds = parent.plan.nodes.map(node => node.id);
    const locked = generate(request(source), await analyze(source), assets, { lockedPlan: parent.plan, lockedNodeIds, operator: 'STRUCTURAL' });
    assert.ok(locked.candidates.some(candidate => candidate.text === parent.text));
  }
});
