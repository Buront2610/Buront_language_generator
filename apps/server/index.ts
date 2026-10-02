import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Coordinator } from '../../packages/runtime/coordinator';
import { validateRequest, validatePreference, validateRegeneration } from '../../packages/contracts';
import type { GenerationRequest, Preference } from '../../packages/contracts';
import type { HistoryEntry } from '../../packages/core/evaluation';
import { features, rhetoricalCore, featureVersion } from '../../packages/core/evaluation';
import { hash } from '../../packages/core/source';
import { generationCapabilities, unsupportedGenerationMode } from '../../packages/core/capabilities';
import { lockedEvidenceCompatible } from '../../packages/core/lock-compatibility';
import { publicFile } from '../../packages/runtime/public-files';
import { reviewRoutes } from '../../packages/runtime/review-routes';

type Session = { id: string; token: string; touched: number; history: HistoryEntry[]; preferences: Preference[]; comparisons: Map<string, any> };
export async function createApp(options: { root?: string; deadlineMs?: number } = {}) {
  const root = options.root ?? process.cwd(), publicRoot = path.join(root, 'apps/web/dist');
  const app = Fastify({ bodyLimit: 80000, logger: false, requestTimeout: 35000, ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } } });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 80000 }, (_request, body, done) => {
    try { const decoded = new TextDecoder('utf-8', { fatal: true }).decode(body as Buffer); done(null, JSON.parse(decoded, (key, value) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('INVALID_JSON_KEY'); return value; })); }
    catch { done(new Error('INVALID_JSON')); }
  });
  const coordinator = new Coordinator(root, options.deadlineMs); const sessions = new Map<string, Session>();
  let startupError = false;
  const startup = coordinator.start().catch(() => { startupError = true; });
  const sessionFor = (request: any): Session | undefined => {
    const id = /(?:^|;\s*)buront_session=([a-f0-9]+)/u.exec(request.headers.cookie || '')?.[1];
    const session = id ? sessions.get(id) : undefined;
    const token = request.headers.authorization?.replace(/^Bearer /u, '');
    if (!session || typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(session.token) || !timingSafeEqual(Buffer.from(token), Buffer.from(session.token))) return undefined;
    if (Date.now() - session.touched > 30 * 60000) { coordinator.deleteSession(session.id); sessions.delete(session.id); return undefined; }
    session.touched = Date.now(); return session;
  };
  app.addHook('onRequest', async (request, reply) => {
    const authority = request.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/u.test(authority)) return reply.code(403).send({ error: 'INVALID_HOST' });
    if (request.headers.origin && request.headers.origin !== `http://${authority}`) return reply.code(403).send({ error: 'INVALID_ORIGIN' });
    if (request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'CROSS_SITE_REQUEST' });
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.url.startsWith('/api/') && request.url !== '/api/v1/session') { const session = sessionFor(request); if (!session) return reply.code(401).send({ error: 'SESSION_REQUIRED' }); reply.header('Set-Cookie', `buront_session=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`); }
  });
  app.setErrorHandler((error, _request, reply) => reply.code((error as any).statusCode === 413 ? 413 : 400).send({ error: (error as any).statusCode === 413 ? 'BODY_TOO_LARGE' : 'INVALID_REQUEST' }));
  app.post('/api/v1/session', async (request, reply) => {
    if (request.headers['x-buront-client'] !== '1') return reply.code(403).send({ error: 'CLIENT_HEADER_REQUIRED' });
    for (const session of sessions.values()) if (Date.now() - session.touched > 30 * 60000) { sessions.delete(session.id); coordinator.deleteSession(session.id); }
    const existingId = /(?:^|;\s*)buront_session=([a-f0-9]+)/u.exec(request.headers.cookie || '')?.[1];
    const existing = existingId ? sessions.get(existingId) : undefined;
    if (existing) { existing.touched = Date.now(); return { token: existing.token, expiresIn: 1800 }; }
    if (sessions.size >= 128) return reply.code(429).send({ error: 'SESSION_CAPACITY' });
    const session: Session = { id: randomBytes(24).toString('hex'), token: randomBytes(32).toString('hex'), touched: Date.now(), history: [], preferences: [], comparisons: new Map() };
    sessions.set(session.id, session); reply.header('Set-Cookie', `buront_session=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);
    return { token: session.token, expiresIn: 1800 };
  });
  const status = () => ({ ready: coordinator.ready && coordinator.python.available, startupError, capabilities: { ...generationCapabilities(), structured: coordinator.ready && coordinator.python.available, model: false, semanticSearch: false, learnedStyle: !!coordinator.assets.evaluators?.S, learnedQuoteability: !!coordinator.assets.evaluators?.Q, partialRegeneration: true },
    versions: { datasetId: coordinator.assets.datasetId, parser: coordinator.python.versions, engine: 'structured-v1' }, limits: { sourceScalars: 5000, bodyBytes: 80000, queue: 8, sessionRunning: 1, deadlineMs: 30000, resultCount: 20, ttlMinutes: 30 }, series: coordinator.assets.series, experimental: true });
  app.get('/api/v1/status', status); app.get('/api/status', status);
  app.get('/api/v1/capabilities', () => status().capabilities);
  reviewRoutes(app, root);
  const enqueue = (session: Session, body: any, reply: any, options = {}) => {
    try { validateRequest(body); if (unsupportedGenerationMode(body)) return reply.code(422).send({ error: 'unsupported_generation_mode', capabilities: status().capabilities }); const job = coordinator.enqueue(session.id, body, session.history.filter(item => item.task === body.task && item.series === body.series && item.mode === body.noveltyMode), options); reply.code(202); return coordinator.view(job); }
    catch (error) { const message = (error as Error).message; return reply.code(message === 'QUEUE_FULL' ? 429 : message === 'CAPABILITY_UNAVAILABLE' ? 503 : 400).send({ error: message.split(':')[0] }); }
  };
  app.post('/api/v1/generations', async (request, reply) => enqueue(sessionFor(request)!, request.body, reply));
  app.get<{ Params: { id: string } }>('/api/v1/generations/:id', async (request, reply) => { const job = coordinator.get(sessionFor(request)!.id, request.params.id); return job ? coordinator.view(job) : reply.code(404).send({ error: 'JOB_NOT_FOUND' }); });
  app.delete<{ Params: { id: string } }>('/api/v1/generations/:id', async (request, reply) => { const job = coordinator.cancel(sessionFor(request)!.id, request.params.id); return job ? coordinator.view(job) : reply.code(404).send({ error: 'JOB_NOT_FOUND' }); });
  app.post('/api/v1/regenerations', async (request, reply) => {
    if (!validateRegeneration(request.body)) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const body = request.body as any, session = sessionFor(request)!;
    coordinator.refreshAssets();
    const job = coordinator.get(session.id, body.analysisId.split('.')[0]);
    if (!job || !coordinator.verifyAnalysis(job, body.analysisId)) return reply.code(409).send({ error: 'ANALYSIS_EXPIRED_OR_ASSET_CHANGED' });
    const candidate = job.result!.candidates.find(candidate => candidate.id === body.candidateId);
    if (!candidate || body.lockedNodeIds.some((id: string) => !candidate.plan.nodes.some(node => node.id === id))) return reply.code(409).send({ error: 'LOCK_CONFLICT' });
    // Mirror the engine's plan-independent lock rule before queue admission.
    if (body.lockedNodeIds.length && body.operator && body.operator !== candidate.plan.mainOperator) return reply.code(409).send({ error: 'LOCK_CONFLICT' });
    if (!lockedEvidenceCompatible(candidate.plan, body.lockedNodeIds, body.series ?? job.request.series, coordinator.assets)) return reply.code(409).send({ error: 'LOCK_CONFLICT' });
    if (Number(job.result!.replayManifest.replayDepth ?? 0) >= 19) return reply.code(409).send({ error: 'REPLAY_DEPTH_LIMIT' });
    return enqueue(session, { ...job.request, seed: body.seed, series: body.series ?? job.request.series, clientRevision: body.clientRevision }, reply, { lockedPlan: candidate.plan, lockedNodeIds: body.lockedNodeIds, operator: body.operator, replayParent: job.result!.replayManifest, parentCandidateId: candidate.id });
  });
  app.post('/api/convert', async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['text', 'level', 'customRules', 'seed', 'contextMode', 'series', 'era'].includes(key))) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const mapped: GenerationRequest = { source: body.text, task: 'rewrite', contextMode: body.contextMode ?? 'faithful', noveltyMode: 'blend', intensity: body.level ?? 2,
      series: body.series ?? body.era ?? 'all', backend: 'structured', clientRevision: 0, ...(body.seed !== undefined ? { seed: body.seed } : {}),
      customRules: Array.isArray(body.customRules) ? body.customRules.map((rule: any, i: number) => rule && typeof rule === 'object' ? { id: rule.id ?? `legacy-${i}`, priority: rule.priority ?? 0, ...rule } : rule) : body.customRules ?? [] };
    const accepted = enqueue(sessionFor(request)!, mapped, reply) as any;
    if (!accepted?.jobId) return accepted;
    const job = coordinator.get(sessionFor(request)!.id, accepted.jobId)!;
    await new Promise<void>(resolve => { const timer = setInterval(() => { if (['completed', 'failed', 'cancelled'].includes(job.state)) { clearInterval(timer); resolve(); } }, 20); });
    if (job.state !== 'completed') return reply.code(503).send({ error: job.error ?? job.state });
    const result = job.result!, selected = result.candidates.find(candidate => candidate.id === result.selectedCandidateId);
    const comparisons = selected ? [{ input: mapped.source, output: selected.text, validation: { passed: true, checks: selected.checks, verificationStatus: selected.verificationStatus } }] : [];
    return reply.code(200).send({ ...result, text: selected?.text ?? result.fallback!.text, comparisons,
      candidates: result.candidates.map(candidate => ({ ...candidate, comparisons: [{ input: mapped.source, output: candidate.text, validation: { passed: true, checks: candidate.checks, verificationStatus: candidate.verificationStatus } }] })), suggestions: result.candidates, summary: { passedCount: result.candidates.length } });
  });
  app.post('/api/v1/comparisons', async (request, reply) => {
    const body = request.body as any, session = sessionFor(request)!;
    if (!body || Object.keys(body).some(key => key !== 'jobId') || typeof body.jobId !== 'string') return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const job = coordinator.get(session.id, body.jobId), candidates = job?.result?.candidates;
    if (!candidates || candidates.length < 2) return reply.code(409).send({ error: 'INSUFFICIENT_CANDIDATES' });
    const reverse = randomBytes(1)[0] % 2 === 1, pair = reverse ? [candidates[1], candidates[0]] : candidates.slice(0, 2), id = randomUUID();
    const comparison = { comparisonId: id, source: job!.request.source, left: pair[0].text, right: pair[1].text, private: { left: pair[0].id, right: pair[1].id, features: pair.map(features), featureVersion, datasetId: job!.datasetId, group: hash(job!.request.source), split: 'pilot' } };
    session.comparisons.set(id, comparison); if (session.comparisons.size > 200) session.comparisons.delete(session.comparisons.keys().next().value!);
    return { comparisonId: id, source: comparison.source, left: comparison.left, right: comparison.right };
  });
  app.post('/api/v1/preferences', async (request, reply) => { const session = sessionFor(request)!; if (!validatePreference(request.body) || !session.comparisons.has((request.body as Preference).comparisonId)) return reply.code(400).send({ error: 'INVALID_PREFERENCE' }); session.preferences.push(request.body as Preference); session.preferences = session.preferences.slice(-600); return { saved: true }; });
  app.post('/api/v1/history', async (request, reply) => {
    const body = request.body as any, session = sessionFor(request)!;
    if (!body || Object.keys(body).some(key => !['jobId', 'candidateId'].includes(key))) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const job = coordinator.get(session.id, body.jobId), candidate = job?.result?.candidates.find(candidate => candidate.id === body.candidateId);
    if (!candidate) return reply.code(404).send({ error: 'CANDIDATE_NOT_FOUND' });
    session.history.push({ text: candidate.text, rhetoric: rhetoricalCore(candidate), family: candidate.plan.family, mapping: hash(candidate.plan.mapping), task: job!.request.task, series: job!.request.series, mode: job!.request.noveltyMode }); session.history = session.history.slice(-80); return { saved: true, count: session.history.length };
  });
  app.delete('/api/v1/history', async request => { const session = sessionFor(request)!; session.history = []; session.preferences = []; session.comparisons.clear(); coordinator.deleteSession(session.id); return { deleted: true }; });
  app.get('/api/v1/export', async request => { const session = sessionFor(request)!; return { schemaVersion: 1, containsUserText: true, history: session.history, comparisons: [...session.comparisons.values()], preferences: session.preferences }; });
  app.get('/*', async (request, reply) => {
    let url: string; try { url = decodeURIComponent(request.url.split('?')[0]); } catch { return reply.code(400).send(); }
    const relative = url === '/' ? 'index.html' : url.slice(1);
    if (!/^(index\.html|assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg))$/u.test(relative)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const file = publicFile(publicRoot, relative);
    try {
      if (!file) return reply.code(404).send();
      const resolved = file;
      return reply.type(relative.endsWith('.html') ? 'text/html; charset=utf-8' : relative.endsWith('.js') ? 'application/javascript; charset=utf-8' : relative.endsWith('.css') ? 'text/css; charset=utf-8' : 'image/svg+xml').send(fs.createReadStream(resolved));
    } catch { return reply.code(404).send({ error: 'WEB_BUILD_REQUIRED' }); }
  });
  app.addHook('onClose', async () => { await coordinator.close(); sessions.clear(); });
  return { app, coordinator, startup };
}
export async function start() { const { app } = await createApp(); await app.listen({ host: '127.0.0.1', port: process.env.PORT === undefined ? 4173 : Number(process.env.PORT) }); console.log(`ブロント語生成器: ${app.server.address() && `http://127.0.0.1:${(app.server.address() as any).port}`}`); process.once('SIGINT', () => { void app.close(); }); process.once('SIGTERM', () => { void app.close(); }); return app; }
