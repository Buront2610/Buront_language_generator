'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../fixtures/ginza-grammar-scope.json');
const { validateAnalysis } = require('../../dist/packages/contracts');
const { sourceDocument, slice } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { propositionScopes, scopeForSpan, permitsAssertiveScope } = require('../../dist/packages/core/grammar-scope');
const { rewriteRules, permitsRewrite, rewriteRuleById } = require('../../dist/packages/core/rewrite-rules');
const request = source => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 1 });
function parsed(source) {
  const row = fixtures.cases.find(row => row.source === source);
  assert.ok(row, `Missing real fixture: ${source}`);
  const doc = sourceDocument(source);
  return { analysis: row.analysis, ir: extractFacts(doc, row.analysis, request(source)), scopes: propositionScopes(doc, row.analysis) };
}
function edits(source, kind = 'ending') {
  const { ir } = parsed(source), unit = { start: 0, end: [...source].length }, found = [];
  for (const rule of rewriteRules.filter(rule => rule.kind === kind)) {
    let offset = 0, index;
    while ((index = source.indexOf(rule.from, offset)) >= 0) {
      offset = index + rule.from.length;
      const start = [...source.slice(0, index)].length, span = { start, end: start + [...rule.from].length };
      if (permitsRewrite(ir, unit, span, rule)) found.push({ rule, span, text: slice(source, { start: 0, end: span.start }) + rule.to + slice(source, { start: span.end, end: unit.end }) });
    }
  }
  return found;
}

test('grammar fixtures are unedited real GiNZA service output with valid scalar offsets', () => {
  assert.equal(fixtures.provenance.producer, 'services/japanese-analysis/service.py');
  assert.equal(fixtures.provenance.versions.ginza, '5.2.1');
  assert.equal(fixtures.provenance.pythonVersion, '3.11.15');
  assert.ok(fixtures.cases.length >= 60);
  for (const { source, analysis } of fixtures.cases) {
    validateAnalysis(analysis, source);
    assert.match(analysis.parserVersion, /spacy=.+ginza=.+ja-ginza=/u);
    assert.ok(analysis.tokens.some(token => token.morphology.length > 0));
  }
});

test('lexical らしい and もし substrings do not invent uncertainty or conditions', () => {
  for (const source of ['素晴らしい。', '素晴らしいです。', 'おもしろい。', 'おもしろいです。']) {
    const { ir, scopes } = parsed(source);
    assert.equal(ir.facts.length, 1, source);
    assert.equal(ir.facts[0].realization, 'actual', source);
    assert.equal(ir.facts[0].attribution.kind, 'narrator', source);
    assert.equal(ir.conditions.length, 0, source);
    assert.ok(permitsAssertiveScope(scopes[0]), source);
    assert.ok(edits(source).some(edit => edit.rule.mode === 'insistence'), source);
  }
});

test('real auxiliary hearsay and speculation remain scoped and cannot gain assertive endings', () => {
  for (const source of ['来るらしい。', '来るそうだ。', '来るようだ。', '来るでしょう。', '来るかもしれない。', '来ると思う。', '私は来るはずだ。']) {
    const { ir, scopes } = parsed(source);
    assert.ok(scopes.some(scope => scope.speculative), source);
    assert.ok(ir.facts.every(fact => fact.realization !== 'actual'), source);
    assert.equal(edits(source).length, 0, source);
  }
  assert.equal(parsed('来るらしい。').ir.facts[0].attribution.kind, 'hearsay');
  // The negative auxiliary inside かもしれない modifies possibility, not 来る.
  assert.equal(parsed('来るかもしれない。').ir.facts[0].polarity, 'positive');
});

test('conditional morphology protects antecedent and consequent, without leaking past a contrast', () => {
  for (const source of ['もし来たら、私は確認する。', '来れば休む。', '雨なら休む。', '来る場合は確認する。']) {
    const { ir } = parsed(source);
    assert.equal(ir.facts.length, 2, source);
    assert.ok(ir.facts.every(fact => fact.realization === 'hypothetical'), source);
    assert.equal(edits(source).length, 0, source);
    assert.ok(ir.relations.some(relation => relation.type === 'conditional_on'), source);
  }
  const source = 'もし来たら確認するが、私は今日は休む。', { ir } = parsed(source);
  assert.deepEqual(ir.facts.map(fact => fact.realization), ['hypothetical', 'hypothetical', 'actual']);
  assert.ok(edits(source).some(edit => edit.text.endsWith('休むからな。')));
});

test('negative adjective and copula chains remain negative within their own proposition', () => {
  for (const source of ['危険がない。', '危険ではない。', '危険はなかった。', '悲しくない。', '悲しくないです。']) {
    const { ir } = parsed(source);
    assert.equal(ir.facts.length, 1, source);
    assert.equal(ir.facts[0].polarity, 'negative', source);
    assert.equal(ir.facts[0].realization, 'actual', source);
    assert.ok(edits(source).every(edit => /ない|なかった/u.test(edit.text)), source);
  }
  const facts = parsed('彼は来るが、私は来ない。').ir.facts;
  assert.deepEqual(facts.map(fact => fact.polarity), ['positive', 'negative']);
  for (const source of ['来ないとは限らない。', '来ないわけではない。']) assert.equal(edits(source).length, 0, source);
});

test('quoted/reported/uncertain content stays protected while a separate narrator clause can change', () => {
  for (const source of ['彼が来るらしいが、私は確認した。', '彼は「私は来る」と言ったが、私は確認した。', '来ると聞いたが、私は確認した。']) {
    const { ir, scopes } = parsed(source), split = source.lastIndexOf('私は確認した');
    assert.ok(ir.facts.some(fact => fact.attribution.kind !== 'narrator'), source);
    assert.ok(edits(source).some(edit => edit.span.start >= split && edit.text.endsWith('確認したからな。')), source);
    const narrator = rewriteRuleById.get('narrator-watashi');
    assert.equal(permitsRewrite(ir, { start: 0, end: source.length }, { start: split, end: split + 1 }, narrator), true, source);
    assert.equal(scopeForSpan(scopes, { start: split, end: split + 1 }).attribution, 'narrator');
    if (source.includes('「')) {
      const quoted = source.indexOf('私は来る');
      assert.equal(permitsRewrite(ir, { start: 0, end: source.length }, { start: quoted, end: quoted + 1 }, narrator), false);
    }
  }
  for (const source of ['私は助言したと田中が言った。', '来るとの報告だ。', '彼が来るという話だ。']) {
    assert.equal(edits(source).length, 0, source);
    assert.equal(parsed(source).ir.facts[0].attribution.kind, 'hearsay', source);
  }
});

test('speech acts, questions and imperatives cannot be promoted to assertion', () => {
  for (const source of ['来てください。', '来るのか。', '確認してくれてありがとうございます。']) assert.equal(edits(source).length, 0, source);
});

test('polite conjugation rules cannot cut inside lexical verbs or negate a past-negative suffix', () => {
  for (const source of ['話します。', '話しました。', '許します。', '食べませんでした。', '私は助けませんでした。', '寒かったです。']) {
    const alternatives = edits(source);
    assert.ok(alternatives.every(edit => !/話する|話した|許する|ませんだった|かっただ/u.test(edit.text)), source);
    if (source.includes('ませんでした')) assert.ok(alternatives.every(edit => edit.text.includes('ませんでした')), source);
    assert.ok(alternatives.every(edit => !/まし(?:た|たら)|ませんでしたからな/u.test(edit.text)), source);
  }
  assert.ok(edits('勉強します。').some(edit => edit.text === '勉強する。'));
  assert.ok(edits('私は確認しませんでした。').some(edit => edit.text === '私は確認しなかった。'));
  assert.ok(edits('同じです。').some(edit => edit.text === '同じだ。'));
  assert.equal(parsed('読んだ。').ir.facts[0].tense, 'past');
  assert.ok(edits('読んだ。').every(edit => edit.text.startsWith('読んだ')));
});


test('independent embedded assertion still permits an attested body rewrite', () => {
  const source = '全員に助言したが、雰囲気は悪かった。';
  assert.ok(edits(source, 'word').some(edit => edit.rule.id === 'advice-doubling'));
});


test('conditional と and concessive fixed constructions protect the dependent consequence', () => {
  for (const source of ['来ないととても悲しい。', '来ると休む。', '来たとしてもとても悲しい。', '来てもとても悲しい。', '来たとしたらとても悲しい。', '来るとするととても悲しい。', '来たとしてとても悲しい。']) {
    const { ir } = parsed(source);
    assert.ok(ir.facts.every(fact => fact.realization === 'hypothetical'), source);
    assert.equal(edits(source).length, 0, source);
  }
  for (const source of ['来た時はとても悲しい。', '来た際はとても悲しい。']) {
    assert.ok(parsed(source).ir.facts.every(fact => fact.realization === 'unknown'), source);
    assert.equal(edits(source).length, 0, source);
  }
  // Case-particle と in a complement and noun coordination are not conditional.
  for (const source of ['来ると私は確認した。', '彼と私はとても悲しい。']) {
    assert.ok(parsed(source).ir.facts.every(fact => fact.realization === 'actual'), source);
    assert.ok(edits(source).length, source);
  }
  const source = 'もし来ないととても悲しいが、私は作業した。';
  assert.deepEqual(parsed(source).ir.facts.map(fact => fact.realization), ['hypothetical', 'hypothetical', 'actual']);
  assert.ok(edits(source).some(edit => edit.text.endsWith('作業したからな。')));
});

test('epistemic adverbs are uncertainty operators, never lexical substring guards', () => {
  for (const source of ['多分とても悲しい。', 'たぶんとても悲しい。', 'おそらく怒りが頂点に達した。', '恐らくすでに時間切れだ。', 'きっととても悲しい。', 'もしかするととても悲しい。', 'ひょっとすると時間切れだ。']) {
    assert.ok(parsed(source).ir.facts.every(fact => fact.realization !== 'actual'), source);
    assert.equal(edits(source).length, 0, source);
  }
  const source = '多分野にわたる研究は素晴らしい。';
  assert.ok(parsed(source).ir.facts.every(fact => fact.realization === 'actual'));
  assert.ok(edits(source).length);
});

test('according-to and rumour markers bind source attribution instead of an experiencer', () => {
  for (const source of ['田中によると怒りが頂点に達した。', '田中によれば怒りが頂点に達した。', '報告によるとすでに時間切れだ。', '噂では怒りが頂点に達した。', '田中の話ではとても悲しい。']) {
    const { ir } = parsed(source), fact = ir.facts.at(-1);
    assert.equal(fact.attribution.kind, 'hearsay', source);
    assert.ok(fact.attribution.speaker, source);
    assert.ok(!fact.arguments.some(argument => argument.text === '田中'), source);
    assert.equal(edits(source).length, 0, source);
    if (source.startsWith('田中')) assert.equal(ir.entities.find(entity => entity.id === fact.attribution.speaker).text, '田中');
  }
  const source = '田中によると彼は来たが、私は確認した。', { ir } = parsed(source);
  assert.deepEqual(ir.facts.map(fact => fact.attribution.kind), ['hearsay', 'narrator']);
  assert.ok(edits(source).some(edit => edit.text.endsWith('確認したからな。')));
  // によって marks cause/agency rather than this specific report construction.
  assert.equal(parsed('田中によって怒りが頂点に達した。').ir.facts[0].attribution.kind, 'narrator');
});
