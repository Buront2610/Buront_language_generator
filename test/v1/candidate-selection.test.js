'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { select, diversityProfile, diversityText, similarity } = require('../../dist/packages/core/evaluation');
const { semanticTexts, finishSemanticVerification } = require('../../dist/packages/core/semantic');
const { generationCapabilities, unsupportedGenerationMode } = require('../../dist/packages/core/capabilities');
const { sourceDocument } = require('../../dist/packages/core/source');
const { realize } = require('../../dist/packages/core/validator');

const source = '状況を確認した。';
function candidate(id, { family = id, phrase = `表現${id}`, operator = 'REWRITE', auxiliary = [], background = '', score = null } = {}) {
  const plan = { id, intent: 'observation', mainOperator: operator, auxiliaryOperators: auxiliary, family,
    mapping: { source: 'source', target: 'target', relation: 'test' }, backTranslation: source,
    evidenceIds: [], forbiddenEffects: [], experimental: true,
    nodes: [{ id: 'fact', type: 'FactClause', text: source, sourceSpan: { start: 0, end: [...source].length }, factIds: [], evidenceIds: [] },
      { id: 'rhetoric', type: 'RhetoricalClause', text: background + phrase, factIds: [], evidenceIds: [] }] };
  const output = realize(plan);
  return { id, ...output, plan, checks: [], verificationStatus: 'passed', verificationScope: 'test', evidence: [],
    scores: { S: score, Q: score, C: 1, R: 1 }, novelty: { classification: 'adaptation', text: 0.2, structure: 0.2, concept: null, nearestIds: [], datasetId: 'test', historySnapshot: 'test', window: 'test' } };
}
function constructionCandidate(id, family, phrase, background, operator = 'CONSTRUCTION', auxiliary = []) {
  const item = candidate(id, { family, phrase, background, operator, auxiliary });
  item.plan.construction = { version: 1, seriesId: 'all', intensity: 2, lexicalEdits: [], edits: [{ constructionId: family, from: source, to: phrase }] };
  return item;
}
function result(pool, provisional = pool.slice(0, 3)) {
  const raw = sourceDocument(source);
  return { inputHash: raw.inputHash, clientRevision: 0, selectedCandidateId: provisional[0]?.id ?? null, candidates: provisional, reviewCandidates: [], candidatePool: pool,
    shortfallReason: null, fallback: null,
    ir: { source: raw, parserVersion: 'test', facts: [], entities: [], sentences: [{ start: 0, end: [...source].length }], anchors: [], times: [], conditions: [], relations: [], adoptedSpans: [{ start: 0, end: [...source].length }], omittedSpans: [], topicOnly: false, tokens: [] },
    replayManifest: { seed: 'promotion', request: { source, noveltyMode: 'blend', task: 'rewrite', contextMode: 'faithful' } } };
}

test('Capabilities explicitly distinguish finite adaptation from unsupported creative modes', () => {
  const capabilities = generationCapabilities();
  assert.equal(capabilities.creativeGeneration, false);
  assert.equal(capabilities.registeredConstruction, true);
  assert.equal(capabilities.finiteRewrite, true);
  assert.deepEqual(capabilities.generationModes, { canonical: true, blend: true, invent: false });
  for (const noveltyMode of ['canonical', 'blend']) assert.equal(unsupportedGenerationMode({ task: 'rewrite', contextMode: 'faithful', noveltyMode }), false);
  for (const overrides of [{ noveltyMode: 'invent' }, { task: 'quote' }, { contextMode: 'full' }]) assert.equal(unsupportedGenerationMode({ task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', ...overrides }), true);
});

test('Selection preserves local construction families despite very long unchanged background', () => {
  const background = Array.from({ length: 100 }, (_, i) => `監査記録${String.fromCharCode(0x5000 + i)}には以前と同じ内容が保存されている。`).join('');
  const pool = [['a', 'family-a', '条件は十分に満たした'], ['b', 'family-b', '確かな裏付けがある'], ['c', 'family-c', '要点を順番に確かめた']].map(([id, family, phrase]) => constructionCandidate(id, family, phrase, background));
  assert.ok(similarity(pool[0].text, pool[1].text) > 0.92);
  assert.equal(select(pool, 'blend', 'fixed').length, 3);
  assert.ok(pool.every(item => item.scores.S === null && item.scores.Q === null));
});

test('Punctuation and narrator variants cannot manufacture diversity', () => {
  const pool = [candidate('a', { phrase: '私は確かめた。' }), candidate('b', { phrase: '俺は確かめた！' }), candidate('c', { phrase: '僕は確かめた\n' })];
  assert.equal(new Set(pool.map(item => diversityProfile(item).whole)).size, 1);
  assert.equal(select(pool, 'blend', 'fixed').length, 1);
  assert.equal(diversityText('それは私。'), diversityText('それは俺！'));
  assert.equal(diversityText('私たちは確認した。'), diversityText('僕たちは確認した。'));
});

test('Diversity considers construction family then operators before wording', () => {
  const best = constructionCandidate('anchor', 'family-a', '確かな判断を伝える', '', 'OP-A'); best.scores = { S: 2, Q: 2, C: 1, R: 1 };
  const sameFamily = constructionCandidate('same-family', 'family-a', 'まるで異なる言葉がある', '', 'OP-B');
  const otherFamily = constructionCandidate('other-family', 'family-b', '確かな判断を伝えた', '', 'OP-A');
  const otherOperators = constructionCandidate('other-operators', 'family-c', '確かな判断を伝えるぞ', '', 'OP-C', ['AUX']);
  const selected = select([best, sameFamily, otherFamily, otherOperators], 'blend', 'fixed');
  assert.equal(selected[0].id, 'anchor');
  assert.equal(selected[1].id, 'other-operators');
  assert.equal(selected[2].id, 'other-family');
});

test('Seed is deterministic, input-order independent, and only changes equal eligible alternatives', () => {
  const pool = Array.from({ length: 6 }, (_, i) => candidate(String(i), { phrase: `選択表現${String.fromCharCode(0x4e20 + i)}` }));
  const ids = (items, seed) => select(items, 'blend', seed).map(item => item.id);
  assert.deepEqual(ids(pool, 'same'), ids([...pool].reverse(), 'same'));
  assert.ok(new Set(Array.from({ length: 20 }, (_, i) => ids(pool, `seed-${i}`).join(','))).size > 1);
  const high = candidate('high', { score: 10 }), low = candidate('low', { score: 0 });
  const rejected = candidate('bad'); rejected.verificationStatus = 'rejected';
  for (let i = 0; i < 20; i++) {
    const selected = select([low, rejected, high], 'blend', String(i));
    assert.equal(selected[0].id, 'high'); assert.ok(!selected.some(item => item.id === 'bad'));
  }
});

test('Independent verification promotes every remaining eligible candidate before final three cap', () => {
  const pool = Array.from({ length: 6 }, (_, i) => candidate(String(i)));
  for (const item of pool.slice(0, 3)) item.text = '検査計画にない出力';
  const verified = finishSemanticVerification(result(pool), {});
  assert.equal(verified.candidates.length, 3);
  assert.deepEqual(new Set(verified.candidates.map(item => item.id)), new Set(['3', '4', '5']));
  assert.equal(verified.replayManifest.semanticVerification.verifiedCount, 6);
  assert.equal(verified.shortfallReason, null);
  assert.equal(verified.fallback, null);
  assert.equal('candidatePool' in verified, false);
  assert.ok(pool.slice(0, 3).every(item => item.verificationStatus === 'rejected' && item.checks.some(check => check.code === 'S-realization' && check.status === 'fail')));
});

test('Independent reparse collects text from pool members outside provisional results', () => {
  const pool = Array.from({ length: 4 }, (_, i) => candidate(String(i)));
  pool[3].plan.nodes[0].text = '状況を別途確認した。';
  assert.ok(semanticTexts(result(pool)).includes('状況を別途確認した。'));
  assert.ok(semanticTexts(result(pool)).includes(source));
});

test('No unverified, rejected, low-quality, or adaptation-only invent alternatives fill slots', () => {
  const pool = Array.from({ length: 4 }, (_, i) => candidate(String(i)));
  pool[0].verificationStatus = 'needs_review'; pool[1].verificationStatus = 'rejected'; pool[2].scores.R = 0;
  assert.deepEqual(select(pool, 'blend').map(item => item.id), ['3']);
  assert.deepEqual(select(pool, 'invent'), []);
});


test('Duplicate candidate IDs cannot discard a valid proof before independent verification', () => {
  const valid = candidate('same'), invalid = candidate('same'); invalid.text += '余分な文';
  const verified = finishSemanticVerification(result([valid, invalid], [invalid]), {});
  assert.equal(verified.candidates.length, 1); assert.equal(verified.candidates[0], valid);
  assert.equal(verified.replayManifest.semanticVerification.verifiedCount, 2);
});

test('Construction programs cannot obtain the finite-rewrite semantic bypass', () => {
  const mixed = candidate('mixed');
  mixed.plan.construction = { version: 1, seriesId: 'all', intensity: 2, edits: [], lexicalEdits: [] };
  mixed.plan.rewrite = { version: 1, seriesId: 'all', intensity: 2, edits: [] };
  const verified = finishSemanticVerification(result([mixed]), {});
  assert.equal(verified.candidates.length, 0);
  assert.ok(mixed.checks.some(check => check.code === 'S-bounded-construction' && check.status === 'fail'));
  assert.ok(!mixed.checks.some(check => check.code === 'S-bounded-rewrite' && check.status === 'pass'));
});


test('New construction family wins over a redundant higher-level construction variant', () => {
  const first = constructionCandidate('first', 'family-a', '最初の独立した語句', ''); first.scores = { S: 2, Q: 2, C: 1, R: 1 };
  const redundant = constructionCandidate('redundant', 'family-a', '別の独立した語句', '');
  const distinct = candidate('distinct', { family: 'family-b', phrase: '最初の独立した語句に続く' });
  assert.equal(select([first, redundant, distinct], 'blend', 'fixed')[1].id, 'distinct');
});
