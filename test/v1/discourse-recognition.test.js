'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { sourceDocument, slice } = require('../../dist/packages/core/source');
const { extractFacts } = require('../../dist/packages/core/facts');
const { propositionScopes, isPastAuxiliary } = require('../../dist/packages/core/grammar-scope');
const { createDiscourseRecognizer, realizeDiscourseRelation } = require('../../dist/packages/core/discourse-constructions');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { validateConstruction } = require('../../dist/packages/core/constructions');
const { verifyGeneratedResult } = require('../../dist/packages/runtime/semantic-verification');
const captured = require('../fixtures/ginza-discourse-past.json');
const contextBoundaries = require('../fixtures/ginza-discourse-context-boundaries.json');
const desire = require('../fixtures/ginza-discourse-desire.json');
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'discourse-recognition', ...extra });
const modest = result => result.candidatePool.filter(candidate => candidate.plan.construction?.edits.some(edit => edit.constructionId === 'modest-achievement'));
const positive = new Set(captured.cases.slice(0, 5).map(row => row.source));
let python, assets, references;
const live = new Map();
before(async () => {
  python = new PythonClient(); await python.start(); assets = compileAssets();
  references = new Map(assets.evidence.map(item => [item.id, item.text]));
  for (const fixture of [...captured.cases, ...contextBoundaries.cases, ...desire.cases]) live.set(fixture.source, await python.analyze(fixture.source));
});
after(() => python?.close());

function recognize(source, analysis, events = []) {
  const ir = extractFacts(sourceDocument(source), analysis, request(source));
  const nodes = ir.sentences.map((span, index) => ({ id: `fact-node-${index}`, type: 'FactClause', sourceSpan: span, text: slice(source, span), factIds: ir.facts.filter(fact => span.start <= fact.predicateSpan.start && fact.predicateSpan.end <= span.end).map(fact => fact.id), evidenceIds: [] }));
  const recognizer = createDiscourseRecognizer(ir, propositionScopes(ir.source, ir), event => events.push(event));
  return { ir, nodes, relations: nodes.flatMap(node => recognizer(node).map(relation => ({ node, relation }))) };
}

test('past auxiliary fixtures are unchanged real GiNZA production responses', () => {
  assert.equal(captured.provenance.producer, 'services/japanese-analysis/service.py');
  assert.equal(captured.provenance.pythonVersion, '3.11.15');
  for (const fixture of [...captured.cases, ...contextBoundaries.cases, ...desire.cases]) assert.deepEqual(live.get(fixture.source), fixture.analysis, fixture.source);
});

test('one past helper recognizes た and voiced past だ while excluding terminal copula だ', () => {
  for (const source of ['大したことはしていない。荷物を届けただけだ。', '大したことはしていない。荷物を運んだだけだ。']) {
    const analysis = live.get(source), auxiliaries = analysis.tokens.filter(token => token.morphology.some(value => value.includes('助動詞-タ;')));
    assert.equal(auxiliaries.length, 1); assert.equal(isPastAuxiliary(auxiliaries[0]), true);
    if (source.includes('運ん')) assert.equal(auxiliaries[0].lemma, 'だ');
    const copula = analysis.tokens.find(token => token.morphology.some(value => value.includes('助動詞-ダ;')));
    assert.equal(copula.text, 'だ'); assert.equal(isPastAuxiliary(copula), false);
    const { ir, relations } = recognize(source, analysis);
    const fact = ir.facts.find(value => ['届ける', '運ぶ'].includes(value.predicateLemma));
    assert.equal(fact.tense, 'past'); assert.equal(fact.completion, 'completed');
    const relation = relations.find(value => value.relation.kind === 'modest-achievement').relation;
    assert.equal(relation.evidenceTokens.find(value => value.role === 'past').tokenId, auxiliaries[0].id);
    assert.equal(relation.evidenceTokens.find(value => value.role === 'copula').tokenId, copula.id);
  }
  const nonpast = recognize('大したことはしていない。荷物を運ぶだけだ。', live.get('大したことはしていない。荷物を運ぶだけだ。'));
  assert.equal(nonpast.ir.facts.find(value => value.predicateLemma === '運ぶ').tense, 'nonpast');
  const conditionals = require('../fixtures/ginza-grammar-scope.json').cases.flatMap(row => row.analysis.tokens).filter(token => token.morphology.some(value => /^Inflection=助動詞-タ;仮定形/u.test(value)));
  assert.ok(conditionals.length); assert.ok(conditionals.every(token => !isPastAuxiliary(token)));
});

test('captured and live limited achievements include voiced past while safety guards abstain', () => {
  for (const fixture of captured.cases) for (const analysis of [fixture.analysis, live.get(fixture.source)]) {
    const events = [], recognized = recognize(fixture.source, analysis, events);
    const relations = recognized.relations.filter(value => value.relation.kind === 'modest-achievement');
    const result = generate(request(fixture.source), analysis, assets);
    if (positive.has(fixture.source)) {
      assert.equal(relations.length, 1, fixture.source); assert.ok(modest(result).length, fixture.source);
      assert.ok(events.some(event => event.kind === 'modest-achievement' && event.outcome === 'recognized'));
      for (const candidate of modest(result)) {
        assert.match(candidate.text, /^それほどでもない/u);
        assert.ok(validateConstruction(result.ir, candidate.plan, references), fixture.source);
        const edit = candidate.plan.construction.edits.find(value => value.constructionId === 'modest-achievement');
        assert.equal(edit.constructionVersion, 2); assert.equal(edit.operation.kind, 'replace');
        assert.deepEqual(edit.relation, relations[0].relation);
      }
    } else {
      assert.equal(relations.length, 0, fixture.source); assert.equal(modest(result).length, 0, fixture.source);
      assert.ok(events.some(event => event.kind === 'modest-achievement' && ['scope_blocked', 'relation_not_recognized'].includes(event.outcome)), fixture.source);
    }
  }
});

test('desire AUX morphology does not masquerade as past, while real past desire keeps its tense', () => {
  for (const fixture of desire.cases) for (const analysis of [fixture.analysis, live.get(fixture.source)]) {
    const desireAux = analysis.tokens.filter(token => token.morphology.some(value => /^Inflection=助動詞-タイ(?:;|$)/u.test(value)));
    assert.ok(desireAux.length, fixture.source); assert.ok(desireAux.every(token => !isPastAuxiliary(token)), fixture.source);
    const { ir } = recognize(fixture.source, analysis);
    const fact = ir.facts.find(value => ['運ぶ', '届ける'].includes(value.predicateLemma));
    // In negative desire GiNZA attaches the speaker to the separate negative
    // predicate; do not pretend it is an argument of the action predicate.
    assert.ok(ir.tokens.some(token => token.lemma === '私' && token.pos === 'PRON' && token.span.start >= ir.sentences[1].start), fixture.source);
    if (fixture.source.includes('たいだけ')) {
      assert.equal(fact.tense, 'nonpast'); assert.equal(fact.completion, 'unknown');
      assert.equal(analysis.tokens.some(isPastAuxiliary), false);
    } else if (fixture.source.includes('たかった')) {
      assert.equal(fact.tense, 'past'); assert.equal(analysis.tokens.filter(isPastAuxiliary).length, 1);
    }
    if (/たくな(?:い|かった)/u.test(fixture.source)) assert.ok(ir.facts.some(value => value.polarity === 'negative' && value.sourceSpan.start >= ir.sentences[1].start), fixture.source);
  }
});

test('present, past and negative first-person desires do not license a completed-deed modesty frame', () => {
  for (const fixture of desire.cases) for (const analysis of [fixture.analysis, live.get(fixture.source)]) {
    const events = [], { relations } = recognize(fixture.source, analysis, events);
    assert.deepEqual(relations, [], fixture.source);
    const result = generate(request(fixture.source), analysis, assets);
    assert.equal(modest(result).length, 0, fixture.source);
    assert.ok(result.candidatePool.every(candidate => !candidate.text.includes('それほどでもない')), fixture.source);
    if (fixture.source.includes('たかった')) assert.ok(events.some(event => event.kind === 'modest-achievement' && event.outcome === 'scope_blocked' && event.reason === 'desiderative_action_not_achievement'));
  }
});

test('recognition records only source clauses, evidence and conditions before registered form selection', () => {
  const fixture = require('../fixtures/ginza-discourse-contrast.json').cases[0];
  const { ir, relations } = recognize(fixture.source, fixture.analysis);
  const { node, relation } = relations.find(value => value.relation.kind === 'explicit-contrast');
  assert.equal(relation.certainty, 'explicit');
  assert.deepEqual(relation.provenance, { inputHash: ir.source.inputHash, parserVersion: ir.parserVersion });
  assert.deepEqual(relation.clauses.map(value => value.role), ['antecedent', 'contrast']);
  assert.ok(relation.conditions.length >= 2);
  assert.ok(relation.conditions.every(value => value.attribution.kind === 'narrator' && !value.conditional && !value.speculative && !value.ambiguous));
  for (const clause of relation.clauses) assert.deepEqual(clause.tokenIds, ir.tokens.filter(token => clause.span.start <= token.span.start && token.span.end <= clause.span.end).map(token => token.id));
  for (const evidence of relation.evidenceTokens) assert.deepEqual(evidence.span, ir.tokens[evidence.tokenId].span);
  assert.equal('to' in relation, false); assert.equal('operation' in relation, false); assert.equal('constructionId' in relation, false);
  assert.deepEqual(realizeDiscourseRelation(ir, node, relation, 2), []);
  const [edit] = realizeDiscourseRelation(ir, node, relation, 3);
  assert.equal(edit.from, 'しかし'); assert.equal(edit.to, 'だが'); assert.equal(edit.operation.kind, 'replace');
});

test('reason recognition retains source body separately from its prefix realization', () => {
  const fixture = require('../fixtures/ginza-discourse-reason.json').cases[0];
  const { ir, relations } = recognize(fixture.source, fixture.analysis);
  const { node, relation } = relations.find(value => value.relation.kind === 'explicit-reason');
  const body = relation.clauses.find(value => value.role === 'reason');
  const [edit] = realizeDiscourseRelation(ir, node, relation, 2);
  assert.equal(edit.from, ''); assert.equal(edit.to, '何故なら');
  assert.deepEqual(edit.sourceSpan, { start: body.span.start, end: body.span.start });
  assert.deepEqual(edit.operation.bodySourceSpan, body.span);
  assert.equal(edit.operation.permittedLocalEdits, 'independently_verified_rewrites');
  assert.equal(edit.bindings.find(value => value.slot === 'reason').text, slice(fixture.source, body.span));
});

test('missing contextual facts fail closed instead of leaving incomplete relation conditions', () => {
  const fixture = require('../fixtures/ginza-discourse-reason.json').cases[0];
  const { ir, nodes } = recognize(fixture.source, fixture.analysis);
  const missing = structuredClone(ir); missing.facts.shift();
  const recognizer = createDiscourseRecognizer(missing, propositionScopes(missing.source, missing));
  assert.deepEqual(nodes.flatMap(recognizer), []);
});

test('newline-only antecedents cannot bypass reason or contrast scope guards', () => {
  for (const fixture of contextBoundaries.cases) for (const analysis of [fixture.analysis, live.get(fixture.source)]) {
    assert.ok(analysis.sentences.some(span => !slice(fixture.source, span).trim()), 'GiNZA must expose the whitespace-only sentence');
    const events = [], { relations } = recognize(fixture.source, analysis, events);
    assert.deepEqual(relations, [], fixture.source);
    const kind = fixture.source.includes('しかし') ? 'explicit-contrast' : 'explicit-reason';
    assert.ok(events.some(event => event.kind === kind && event.outcome === 'scope_blocked'), fixture.source);
    const result = generate(request(fixture.source, { intensity: 3 }), analysis, assets);
    assert.equal(result.candidatePool.filter(candidate => candidate.plan.construction?.edits.some(edit => edit.constructionId === kind)).length, 0, fixture.source);
  }
});

test('relation evidence, source provenance and observed conditions must independently rebind', () => {
  const source = '大したことはしていない。荷物を運んだだけだ。';
  const result = generate(request(source), live.get(source), assets), original = modest(result)[0];
  assert.ok(original);
  for (const mutate of [
    relation => { relation.kind = 'explicit-reason'; },
    relation => { relation.clauses[1].span.end--; },
    relation => { relation.clauses[1].tokenIds.pop(); },
    relation => { relation.evidenceTokens.find(value => value.role === 'past').tokenId = relation.evidenceTokens.find(value => value.role === 'copula').tokenId; },
    relation => { relation.conditions[1].tense = 'nonpast'; },
    relation => { relation.conditions[0].conditional = true; },
    relation => { relation.provenance.inputHash = '0'.repeat(64); },
    relation => { relation.provenance.parserVersion = 'untrusted-parser'; },
  ]) {
    const forged = structuredClone(original.plan);
    mutate(forged.construction.edits.find(value => value.constructionId === 'modest-achievement').relation);
    assert.equal(validateConstruction(result.ir, forged, references), false);
  }
});

test('both unvoiced and voiced past modesty survive final live semantic verification', async () => {
  for (const source of ['大したことはしていない。荷物を届けただけだ。', '大したことはしていない。荷物を運んだだけだ。']) {
    const analysis = live.get(source), result = generate(request(source), analysis, assets);
    const verified = await verifyGeneratedResult(result, python, analysis);
    assert.ok(verified.candidates.some(candidate => candidate.plan.construction?.edits.some(edit => edit.constructionId === 'modest-achievement')), source);
  }
});
