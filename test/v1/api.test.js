"use strict";
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../dist/apps/server/index');
const { setTimeout: delay } = require('node:timers/promises');
const request = (source = '今日は寒い。') => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 7, seed: 'api-test' });
let app, coordinator, headers, otherHeaders;
async function session() { const response = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { 'x-buront-client': '1' }, payload: {} }); assert.equal(response.statusCode, 200, response.body); return { authorization: `Bearer ${response.json().token}`, cookie: response.headers['set-cookie'].split(';')[0] }; }
// Wait beyond the server's 30-second deadline so a terminal failure can be
// asserted, instead of abandoning a still-valid job after ten seconds.
async function poll(id) { const until = Date.now() + 35000; while (Date.now() < until) { const response = await app.inject({ method: 'GET', url: `/api/v1/generations/${id}`, headers }); const job = response.json(); if (['completed', 'cancelled', 'failed'].includes(job.state)) return job; await delay(50); } throw new Error('job timeout'); }
before(async () => { const service = await createApp(); app = service.app; coordinator = service.coordinator; await app.ready(); await service.startup; assert.equal(coordinator.ready, true); headers = await session(); otherHeaders = await session(); });
after(async () => { await app?.close(); });
test('T-22 only built web files; Host/Origin/token/session boundaries', async () => {
  for (const url of ['/.git/config', '/.env', '/data/log-corpus.json', '/docs/architecture.md', '/server.js', '/%2e%2e/server.js']) assert.equal((await app.inject({ url })).statusCode, 404, url);
  assert.equal((await app.inject({ url: '/api/v1/status' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/review' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/review/ratings', payload: {} })).statusCode, 401);
  const review = await app.inject({ url: '/api/v1/review', headers });
  assert.ok([200, 404].includes(review.statusCode));
  if (review.statusCode === 200) assert.ok(review.json().items.every(item => !('private' in item) && !('vector' in item) && !('method' in item)));
  assert.equal((await app.inject({ url: '/', headers: { host: 'evil.example' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/', headers: { host: 'localhost', origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/session', payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/v1/status', headers: { ...headers, cookie: otherHeaders.cookie } })).statusCode, 401);
  const response = await app.inject({ url: '/', headers }); assert.equal(response.statusCode, 200); assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
});
test('Capabilities and admission consistently reject unsupported generation settings', async () => {
  const status = (await app.inject({ url: '/api/v1/status', headers })).json();
  const response = await app.inject({ url: '/api/v1/capabilities', headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), status.capabilities);
  assert.equal(status.capabilities.creativeGeneration, false);
  assert.equal(status.capabilities.generationModes.invent, false);
  assert.equal(status.capabilities.tasks.quote, false);
  assert.equal(status.capabilities.contextModes.full, false);
  assert.equal((await app.inject({ url: '/api/v1/capabilities' })).statusCode, 401);
  for (const extra of [{ noveltyMode: 'invent' }, { task: 'quote' }, { contextMode: 'full' }]) {
    const refused = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: { ...request(), ...extra } });
    assert.equal(refused.statusCode, 422); assert.equal(refused.json().error, 'unsupported_generation_mode');
    assert.equal(refused.json().jobId, undefined);
  }
});
test('M4 API separates invalid input, capacity and unavailable capability', async () => {
  for (const body of [{}, request(' '), { ...request(), intensity: '2' }, { ...request(), arbitrary: true }]) assert.equal((await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: body })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: { ...request(), backend: 'model' } })).statusCode, 503);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request('猫'.repeat(50000)) })).statusCode, 413);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/generations', headers: { ...headers, 'content-type': 'application/json' }, payload: Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]) })).statusCode, 400);
});
let completed;
test('T-12/19 generation result has revision, selected ID, replay, matching spans and no private access', async () => {
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request() }); assert.equal(accepted.statusCode, 202, accepted.body);
  assert.equal((await app.inject({ url: `/api/v1/generations/${accepted.json().jobId}`, headers: otherHeaders })).statusCode, 404);
  completed = await poll(accepted.json().jobId); assert.equal(completed.state, 'completed', JSON.stringify(completed));
  assert.equal(completed.clientRevision, 7); const result = completed.result; assert.equal('candidatePool' in result, false); assert.equal(result.candidates.length, 2); assert.ok(result.candidates.find(candidate => candidate.id === result.selectedCandidateId)); assert.ok(result.analysisId);
  const cancelled = await app.inject({ method: 'DELETE', url: `/api/v1/generations/${completed.jobId}`, headers }); assert.equal(cancelled.json().state, 'completed');
});
test('Partial regeneration authenticates analysis and validates locked plan conflicts', async () => {
  const body = { analysisId: completed.result.analysisId, candidateId: completed.result.selectedCandidateId, lockedNodeIds: ['fact-node-0'], operator: 'OP-01', seed: 'new', clientRevision: 7 };
  const candidate = completed.result.candidates.find(candidate => candidate.id === body.candidateId); body.operator = candidate.plan.mainOperator === 'OP-01' ? 'OP-02' : 'OP-01';
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: body })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers: otherHeaders, payload: body })).statusCode, 409);
  delete body.operator; body.lockedNodeIds = ['fact-node-0'];
  const response = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: body }); assert.equal(response.statusCode, 202, response.body);
  const job = await poll(response.json().jobId); assert.equal(job.state, 'completed'); for (const output of job.result.candidates) assert.equal(output.plan.nodes[0].text, candidate.plan.nodes[0].text);
});

test('M3 API completes bounded body proof and preserves its signed partial replay', async () => {
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request('担当者が状況を確認しました。') });
  assert.equal(accepted.statusCode, 202);
  const job = await poll(accepted.json().jobId); assert.equal(job.state, 'completed', JSON.stringify(job));
  const candidate = job.result.candidates[0]; assert.ok(candidate);
  assert.ok(candidate.checks.some(check => check.code === 'S-bounded-rewrite' && check.status === 'pass'));
  assert.ok(job.result.replayManifest.semanticVerification.selectionHash);
  const response = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: { analysisId: job.result.analysisId, candidateId: candidate.id, lockedNodeIds: ['fact-node-0'], seed: 'reparse-partial', clientRevision: 7 } });
  assert.equal(response.statusCode, 202);
  const partial = await poll(response.json().jobId); assert.equal(partial.state, 'completed');
  for (const next of partial.result.candidates) {
    assert.equal(next.plan.nodes.find(node => node.id === 'fact-node-0').text, candidate.plan.nodes.find(node => node.id === 'fact-node-0').text);
    assert.ok(next.checks.some(check => check.code === 'S-bounded-rewrite' && check.status === 'pass'));
  }
  const Ajv2020 = require('ajv/dist/2020').default, { GenerationResultSchema } = require('../../dist/packages/contracts/results');
  const validate = new Ajv2020({ strict: true }).compile(GenerationResultSchema);
  assert.ok(validate(partial.result), JSON.stringify(validate.errors));
});

test('Construction locks reject changed operators synchronously and retain proofs on HTTP round trip', async () => {
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request('怒りが頂点に達した。') });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const job = await poll(accepted.json().jobId); assert.equal(job.state, 'completed', JSON.stringify(job));
  const candidate = job.result.candidates.find(item => item.plan.construction);
  assert.ok(candidate, 'A registered-construction candidate must be available for the lock test');
  const node = candidate.plan.nodes.find(item => item.type === 'FactClause');
  const body = { analysisId: job.result.analysisId, candidateId: candidate.id, lockedNodeIds: [node.id], seed: 'construction-http-lock', clientRevision: 7 };
  const before = coordinator.jobs.size;
  for (const operator of ['REWRITE', 'OP-01']) {
    const conflict = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: { ...body, operator } });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal(conflict.json().error, 'LOCK_CONFLICT'); assert.equal(conflict.json().jobId, undefined);
  }
  assert.equal(coordinator.jobs.size, before, 'A conflict must not enqueue a job');
  for (const operator of [undefined, 'CONSTRUCTION']) {
    const regenerated = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: { ...body, ...(operator ? { operator } : {}) } });
    assert.equal(regenerated.statusCode, 202, regenerated.body);
    const partial = await poll(regenerated.json().jobId); assert.equal(partial.state, 'completed', JSON.stringify(partial));
    assert.ok(partial.result.candidates.length);
    assert.equal('candidatePool' in partial.result, false);
    for (const next of partial.result.candidates) {
      assert.ok(next.plan.construction); assert.equal(next.plan.rewrite, undefined);
      assert.equal(next.plan.nodes.find(item => item.id === node.id).text, node.text);
      assert.ok(next.checks.some(check => check.code === 'S-bounded-construction' && check.status === 'pass'));
    }
  }
});

test('Locked series changes check retained evidence and allow compatible changes', async () => {
  async function construction(source) {
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request(source) });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const job = await poll(accepted.json().jobId); assert.equal(job.state, 'completed', JSON.stringify(job));
    const candidate = job.result.candidates.find(item => item.plan.construction);
    assert.ok(candidate, source); return { job, candidate };
  }
  const incompatible = await construction('私はとても悲しかった。');
  const locked = incompatible.candidate.plan.nodes[0];
  assert.ok(locked.evidenceIds.some(id => !coordinator.assets.evidence.find(item => item.id === id).series.includes('katuru')));
  const before = coordinator.jobs.size;
  const rejected = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: {
    analysisId: incompatible.job.result.analysisId, candidateId: incompatible.candidate.id, lockedNodeIds: [locked.id], series: 'katuru', seed: 'series-conflict', clientRevision: 7,
  } });
  assert.equal(rejected.statusCode, 409, rejected.body); assert.equal(rejected.json().error, 'LOCK_CONFLICT');
  assert.equal(coordinator.jobs.size, before);
  for (const source of ['とても悲しかった', '私が確認した。とても悲しかった']) {
    const { job, candidate } = await construction(source);
    const node = candidate.plan.nodes.find(item => item.text.includes('深い悲しみ'));
    assert.ok(node); assert.ok(node.evidenceIds.every(id => coordinator.assets.evidence.find(item => item.id === id).series.includes('katuru')));
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: {
      analysisId: job.result.analysisId, candidateId: candidate.id, lockedNodeIds: [node.id], series: 'katuru', seed: 'series-compatible', clientRevision: 7,
    } });
    assert.equal(accepted.statusCode, 202, accepted.body);
    const partial = await poll(accepted.json().jobId); assert.equal(partial.state, 'completed', JSON.stringify(partial));
    assert.ok(partial.result.candidates.length, source);
    for (const next of partial.result.candidates) {
      assert.equal(next.plan.nodes.find(item => item.id === node.id).text, node.text);
      assert.equal(next.plan.construction.seriesId, 'katuru');
      assert.ok(next.evidence.every(evidence => coordinator.assets.evidence.find(item => item.id === evidence.id).series.includes('katuru')));
    }
  }
});

test('Legacy HTTP conversion returns verified construction candidates without the internal pool', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/convert', headers, payload: { text: '怒りが頂点に達した。', level: 2, seed: 'construction-legacy' } });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json(); assert.equal('candidatePool' in result, false);
  assert.ok(result.candidates.length > 0 && result.candidates.length <= 3);
  assert.ok(result.candidates.some(candidate => candidate.plan.construction && candidate.checks.some(check => check.code === 'S-bounded-construction' && check.status === 'pass')));
  assert.ok(result.suggestions.every(candidate => candidate.verificationStatus === 'passed'));
});

test('T-20 cancellation during source analysis cannot publish a late completed result', async () => {
  const originalAnalyze = coordinator.python.analyze.bind(coordinator.python);
  let entered, release;
  const reanalyzing = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  coordinator.python.analyze = async (text, ...args) => {
    if (text === '監査担当者が状況を確認しました。') { entered(); await blocked; }
    return originalAnalyze(text, ...args);
  };
  try {
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request('監査担当者が状況を確認しました。') });
    const id = accepted.json().jobId;
    await Promise.race([reanalyzing, delay(10000).then(() => { throw new Error('uncached source analysis not reached'); })]);
    const cancelled = await app.inject({ method: 'DELETE', url: `/api/v1/generations/${id}`, headers }); assert.equal(cancelled.json().state, 'cancelled');
    release(); await delay(50);
    const job = await poll(id); assert.equal(job.state, 'cancelled'); assert.equal(job.result, undefined);
  } finally { release(); coordinator.python.analyze = originalAnalyze; }
});
test('T-20 queued/running cancellation and completion have a single terminal state', async () => {
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request('確認しています。'.repeat(300)) }); assert.equal(accepted.statusCode, 202);
  const id = accepted.json().jobId;
  const cancellation = await app.inject({ method: 'DELETE', url: `/api/v1/generations/${id}`, headers }); assert.equal(cancellation.json().state, 'cancelled');
  await delay(100); assert.equal((await poll(id)).state, 'cancelled');
  const health = await app.inject({ url: '/api/v1/status', headers }); assert.equal(health.statusCode, 200);
});
test('T-21 finite queue and one running request per session; status stays responsive', async () => {
  const first = coordinator.enqueue('queue-0', request('確認しています。'.repeat(300)));
  const queued = Array.from({ length: 8 }, (_, i) => coordinator.enqueue(`queue-${i + 1}`, request()));
  assert.throws(() => coordinator.enqueue('queue-extra', request()), /QUEUE_FULL/);
  assert.throws(() => coordinator.enqueue('queue-0', request()), /QUEUE_FULL/);
  const time = Date.now(); assert.equal((await app.inject({ url: '/api/v1/status', headers })).statusCode, 200); assert.ok(Date.now() - time < 1000);
  for (const job of [first, ...queued]) { coordinator.cancel(job.session, job.id); assert.equal(job.state, 'cancelled'); }
  await delay(100);
});
test('Only explicit preferences are stored; blind comparisons omit source method/rank/scores', async () => {
  const comparison = await app.inject({ method: 'POST', url: '/api/v1/comparisons', headers, payload: { jobId: completed.jobId } }); assert.equal(comparison.statusCode, 200); const pair = comparison.json(); assert.equal(pair.private, undefined); assert.equal(pair.scores, undefined);
  const label = { comparisonId: pair.comparisonId, annotatorId: 'reviewer', dimension: 'S', choice: 'both_bad', reason: '比較評価の契約試験' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/preferences', headers, payload: label })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/preferences', headers: otherHeaders, payload: label })).statusCode, 400);
  const exported = (await app.inject({ url: '/api/v1/export', headers })).json(); assert.equal(exported.preferences.length, 1); assert.equal(exported.history.length, 0);
  assert.equal(exported.comparisons[0].private.featureVersion, 'output-text-dense-v2');
  assert.equal(Object.keys(exported.comparisons[0].private.features[0]).length, 44);
  await app.inject({ method: 'DELETE', url: '/api/v1/history', headers }); assert.equal((await app.inject({ url: '/api/v1/export', headers })).json().preferences.length, 0);
});

test('A3 HTTP body dictionary requests remain reviewable and unapplied', async () => {
  // Previous cancellation tests intentionally stop the analyzer. Warm its model
  // before timing a dictionary job, just as the suite's initial startup does.
  await coordinator.python.start();
  for(const to of ['冷え込み','冷気','佐藤が田中を助けた。']) {
    const response=await app.inject({method:'POST',url:'/api/v1/generations',headers,payload:{...request(),customRules:[{id:'synonym',from:'寒さ',to,priority:0}]}});
    assert.equal(response.statusCode,202);const job=await poll(response.json().jobId);assert.equal(job.state,'completed');
    assert.equal(job.result.candidates.length,0);assert.ok(job.result.reviewCandidates.length);assert.equal(job.result.shortfallReason,'dictionary_needs_review');
    assert.ok(job.result.reviewCandidates.every(c=>c.verificationStatus==='needs_review'&&!c.text.includes(to)));
  }
});

test('Typed rhetorical body composition survives HTTP generation, locked regeneration and replay', async () => {
  const source = '速度が重要なので、私はこの方法を選びました。';
  const status = (await app.inject({ url: '/api/v1/capabilities', headers })).json();
  assert.equal(status.typedRhetoricalComposition, true);
  const accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: { ...request(source), intensity: 3 } });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const job = await poll(accepted.json().jobId); assert.equal(job.state, 'completed', JSON.stringify(job));
  const candidate = job.result.candidates.find(item => item.plan.structural);
  assert.ok(candidate, JSON.stringify(job.result)); assert.equal(candidate.verificationStatus, 'passed');
  assert.ok(candidate.checks.some(check => check.code === 'S-structural-program' && check.status === 'pass'));
  assert.equal(candidate.scores.S, null); assert.equal(candidate.scores.Q, null);
  assert.equal('candidatePool' in job.result, false);
  const body = { analysisId: job.result.analysisId, candidateId: candidate.id, lockedNodeIds: candidate.plan.nodes.map(node => node.id), operator: 'STRUCTURAL', seed: 'structural-http-lock', clientRevision: 7 };
  const rejected = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: { ...body, operator: 'REWRITE' } });
  assert.equal(rejected.statusCode, 409);
  const regenerated = await app.inject({ method: 'POST', url: '/api/v1/regenerations', headers, payload: body });
  assert.equal(regenerated.statusCode, 202, regenerated.body);
  const partial = await poll(regenerated.json().jobId); assert.equal(partial.state, 'completed', JSON.stringify(partial));
  assert.ok(partial.result.candidates.length > 0);
  for (const next of partial.result.candidates) {
    assert.equal(next.text, candidate.text);
    assert.deepEqual(next.plan.nodes, candidate.plan.nodes);
    assert.ok(next.checks.some(check => check.code === 'S-structural-program' && check.status === 'pass'));
  }
  const Ajv2020 = require('ajv/dist/2020').default, { GenerationResultSchema } = require('../../dist/packages/contracts/results');
  const validate = new Ajv2020({ strict: true }).compile(GenerationResultSchema);
  assert.ok(validate(partial.result), JSON.stringify(validate.errors));
});
