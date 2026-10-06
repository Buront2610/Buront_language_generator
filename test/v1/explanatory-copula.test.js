'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fixtures = [
  require('../fixtures/ginza-explanatory-copula.json'),
  require('../fixtures/ginza-explanatory-copula-safeguards.json'),
];
const cases = fixtures.flatMap(fixture => fixture.cases);
const { validateAnalysis } = require('../../dist/packages/contracts');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { sourceDocument, slice } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { propositionScopes, scopeForSpan } = require('../../dist/packages/core/grammar-scope');
const { rewriteRules, permitsRewrite } = require('../../dist/packages/core/rewrite-rules');
const { makeRewritePlans } = require('../../dist/packages/core/rewrite');
const { validateRewrite } = require('../../dist/packages/core/rewrite-validation');
const { generate } = require('../../dist/packages/core/engine');
const { realize, validateCandidate, verification } = require('../../dist/packages/core/validator');
const regression = '車より電車で行くほうがよいと思う。駐車場を探す必要がなく、到着時刻も読みやすいからだ。';
const request = source => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'explanatory-copula' });
let python, assets, references;
before(async () => {
  python = new PythonClient();
  await python.start();
  assets = compileAssets();
  references = new Map(assets.evidence.map(item => [item.id, item.text]));
});
after(() => python?.close());
function parsed(source) {
  const row = cases.find(row => row.source === source);
  assert.ok(row, `Missing real GiNZA fixture: ${source}`);
  return { analysis: row.analysis, ir: extractFacts(sourceDocument(source), row.analysis, request(source)) };
}
function endings(source) {
  const { ir } = parsed(source), unit = { start: 0, end: [...source].length }, found = [];
  for (const rule of rewriteRules.filter(rule => rule.kind === 'ending')) {
    let offset = 0, index;
    while ((index = source.indexOf(rule.from, offset)) >= 0) {
      offset = index + rule.from.length;
      const start = [...source.slice(0, index)].length, span = { start, end: start + [...rule.from].length };
      if (permitsRewrite(ir, unit, span, rule)) found.push({ rule, span, text: slice(source, { start: 0, end: span.start }) + rule.to + slice(source, { start: span.end, end: unit.end }) });
    }
  }
  return found;
}
function plans(source) {
  const { ir } = parsed(source), result = makeRewritePlans(ir, request(source), assets);
  for (const plan of result) assert.equal(validateRewrite(ir, plan, references), true, source);
  return result;
}

test('causal fixtures reproduce actual GiNZA morphology, dependencies and scalar offsets', async () => {
  for (const fixture of fixtures) {
    assert.equal(fixture.provenance.producer, 'services/japanese-analysis/service.py');
    assert.equal(fixture.provenance.captureScript, 'test/fixtures/capture-ginza-explanatory-copula.py');
  }
  for (const { source, analysis } of cases) {
    validateAnalysis(analysis, source);
    assert.deepEqual(await python.analyze(source), analysis, source);
  }
  const { ir } = parsed(regression), copula = ir.tokens.findLast(token => token.text === 'だ');
  const scope = scopeForSpan(propositionScopes(ir.source, ir), copula.span);
  const causal = scope.associated.find(token => token.text === 'から');
  assert.equal(copula.pos, 'AUX');
  assert.equal(copula.dep, 'aux');
  assert.ok(copula.morphology.includes('Inflection=助動詞-ダ;終止形-一般'));
  assert.equal(causal.pos, 'SCONJ');
  assert.equal(causal.dep, 'mark');
  assert.equal(causal.head, copula.head);
});

test('the railway regression retains its explanation without adding からだからな', async () => {
  for (const analysis of [parsed(regression).analysis, await python.analyze(regression)]) {
    const result = generate(request(regression), analysis, assets);
    assert.ok(result.candidates.length);
    const expected = regression.replace('。', '\n').replace(/。$/u, '');
    assert.ok(result.candidates.some(candidate => candidate.text === expected));
    for (const candidate of result.candidatePool) {
      assert.doesNotMatch(candidate.text, /からだからな/u);
      assert.match(candidate.text, /車より電車で行くほうがよいと思う/u);
      if (candidate.plan.structural) {
        assert.match(candidate.text, /駐車場を探す必要がなく、到着時刻も読みやすいから、車より電車で行くほうがよいと思う/u);
        assert.ok(candidate.plan.structural.blocks.every(block => block.operatorId === 'reason-explanation'));
      } else assert.match(candidate.text, /駐車場を探す必要がなく、到着時刻も読みやすいからだ/u);
      if (candidate.plan.rewrite) assert.equal(validateRewrite(result.ir, candidate.plan, references), true);
    }
  }
});

test('explanatory copulas and their past/negative chains cannot receive another causal suffix', () => {
  for (const source of [
    '来るからだ。', '楽しいからだ。', '雨だからだ。', '雨だったからだ。',
    '来るからだった。', '来るからです。', '来るからでした。', '来るから だ。',
    '必要がないからだ。', '必要がなかったからだ。',
    '来るからではない。', '雨だからではなかった。', '来るからではありません。',
  ]) {
    assert.ok(endings(source).every(edit => edit.rule.mode !== 'insistence'), source);
    for (const plan of plans(source)) assert.ok(plan.rewrite.edits.every(edit => !edit.ruleId.startsWith('ending-insistence-')), source);
  }
});

test('safe plain conversion preserves explanatory past tense and negation', () => {
  for (const [source, expected] of [
    ['来るからです。', '来るからだ。'],
    ['来るからでした。', '来るからだった。'],
    ['来るからではありません。', '来るからではない。'],
  ]) assert.ok(endings(source).some(edit => edit.rule.mode === 'plain' && edit.text === expected), source);
  for (const source of ['必要がないからだ。', '必要がなかったからだ。', '来るからではない。', '雨だからではなかった。']) {
    for (const plan of plans(source)) assert.equal(plan.nodes.map(node => node.text).join(''), source.replace(/。$/u, ''), source);
  }
});

test('ordinary copulas, lexical からだ and case-particle から retain positive controls', () => {
  for (const [source, expected] of [
    ['雨だ。', '雨だからな。'], ['雨です。', '雨だからな。'],
    ['雨だった。', '雨だったからな。'], ['雨でした。', '雨だったからな。'],
    ['空からだ。', '空からだからな。'], ['空からです。', '空からだからな。'],
    ['からだは健康だ。', 'からだは健康だからな。'],
    ['田中から３冊もらった。', '田中から３冊もらったからな。'],
  ]) assert.ok(endings(source).some(edit => edit.rule.mode === 'insistence' && edit.text === expected), source);
  const from = parsed('空からだ。').ir.tokens.find(token => token.text === 'から');
  assert.equal(from.pos, 'ADP');
  assert.equal(from.dep, 'case');
});

test('causal and explanatory clauses do not suppress a separate assertion', () => {
  for (const source of [
    '雨だから安全だ。', '雨だからだが、私は健康だ。',
    '雨だからだ。私は健康だ。', '私は健康だ。雨だからだ。',
    '「雨だからだ」と彼は言った。私は健康だ。',
  ]) {
    const result = plans(source);
    assert.ok(result.some(plan => plan.rewrite.edits.some(edit => edit.ruleId.startsWith('ending-insistence-'))), source);
    for (const plan of result) {
      const text = plan.nodes.map(node => node.text).join('');
      assert.doesNotMatch(text, /雨だからだからな/u, source);
      if (source.includes('「')) assert.ok(text.includes('「雨だからだ」'), source);
    }
  }
});

test('quoted, reported, hypothetical, speculative and question guards still abstain', () => {
  for (const source of [
    '「雨だからだ。」', '（雨だからだ。）', '「雨だからだ。',
    '彼は雨だからだと言った。', '雨だからだと思う。', '雨だからでしょう。',
    'もし雨だからだとしたら、私は確認する。', '雨だからだ？',
  ]) assert.equal(endings(source).length, 0, source);
  for (const source of ['雨だからな。', '来るからな。']) {
    assert.equal(endings(source).length, 0, source);
    for (const plan of plans(source)) assert.doesNotMatch(plan.nodes.map(node => node.text).join(''), /からなからな/u);
  }
});

test('Unicode, participant roles and numeric values remain exact with the protected explanation', () => {
  for (const source of ['😀田中から３冊もらったからだ。', '到着は３時だからだ。']) {
    const result = plans(source);
    assert.ok(result.length, source);
    for (const plan of result) {
      assert.equal(plan.nodes.map(node => node.text).join(''), source.replace(/。$/u, ''), source);
      for (const edit of plan.rewrite.edits) assert.equal(slice(source, edit.sourceSpan), edit.from, source);
    }
  }
});

test('independent validation rejects an internally consistent forged explanatory ending', () => {
  const { ir } = parsed(regression), weakened = structuredClone(ir);
  // Deliberately pretend this causal conjunction is an ordinary case marker.
  // A consistent planner/render control proves rejection is grammatical.
  const causal = weakened.tokens.findLast(token => token.text === 'から');
  causal.pos = 'ADP';
  causal.dep = 'case';
  const forged = makeRewritePlans(weakened, request(regression), assets)
    .find(plan => plan.rewrite.edits.some(edit => edit.ruleId.startsWith('ending-insistence-')));
  assert.ok(forged);
  assert.equal(validateRewrite(weakened, forged, references), true);
  assert.equal(validateRewrite(ir, forged, references), false);
  const output = realize(forged, ir);
  assert.match(output.text, /からだからな/u);
  assert.notEqual(verification(validateCandidate(ir, forged, output.text, output.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles)), 'passed');
});
