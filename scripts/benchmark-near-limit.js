'use strict';
// Build first. All engine variants use the same frozen assets and analyses.
// node scripts/benchmark-near-limit.js --reference c7631ae --output artifacts/near-limit-20261002/benchmark.json
// Optional --skip-baseline skips the expensive native eager-query runs.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { fork, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { tileAnalysis } = require('./benchmark-rewrite-scopes');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const ms = start => Math.round((performance.now() - start) * 1000) / 1000;
const request = source => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'rewrite-scope-benchmark-v1' });
// Reconstructed authored workload, not a captured user document. Whole
// paragraphs are repeated; no sentence or protected literal is truncated.
const paragraph = '私は朝に資料を確認しました。担当者は報告書を提出しました。予算は100円です。作業はまだ完了していません。\n責任者は「明日に確認する」と話しました。私は結果を記録しました。\n\n';
const prose = paragraph.repeat(Math.floor(5000 / [...paragraph].length));
const semanticView = result => ({ candidates: result.candidates, candidatePool: result.candidatePool, reviewCandidates: result.reviewCandidates, fallback: result.fallback, shortfallReason: result.shortfallReason, ir: result.ir });
function resultSummary(result) {
  const pool = result.candidatePool ?? result.candidates;
  return { selectedCount: result.candidates.length, poolCount: pool.length, shortfallReason: result.shortfallReason, semanticHash: sha(semanticView(result)), irHash: sha(result.ir), poolLanguageHash: sha(pool.map(c => ({ id: c.id, text: c.text, plan: c.plan, spans: c.spans, evidence: c.evidence, novelty: c.novelty, scores: c.scores }))), candidates: pool.map(c => ({ outputScalars: [...c.text].length, nodes: c.plan.nodes.length, checks: c.checks.map(check => [check.code, check.status]), status: c.verificationStatus })) };
}
async function worker(job) {
  const v8 = require('node:v8');
  const environment = { heapLimitBytes: v8.getHeapStatistics().heap_size_limit, execArgv: process.execArgv };
  if (job.kind === 'parse') {
    const { PythonClient } = require(path.join(job.dist, 'packages/runtime/python-client'));
    const client = new PythonClient(root);
    try { const start = performance.now(); const runtime = await client.start(), startupMs = ms(start), parsed = performance.now(); const analysis = await client.analyze(job.source); write(job.output, { source: job.source, analysis }); return { status: 'ok', startupMs, parserMs: ms(parsed), tokens: analysis.tokens.length, sentences: analysis.sentences.length, analysisHash: sha(analysis), runtime }; }
    finally { client.close(); }
  }
  if (job.kind === 'api') {
    const { createApp } = require(path.join(job.dist, 'apps/server/index'));
    const started = performance.now(), service = await createApp({ root: job.runtimeRoot });
    const { app, coordinator } = service;
    let sample, peakCombinedRssBytes = 0, peakPythonRssBytes = 0;
    const stages = [], analyses = [];
    try {
      await app.ready(); await service.startup;
      if (!coordinator.ready) throw new Error('API_STARTUP_FAILED');
      const startupMs = ms(started), run = coordinator.pool.run.bind(coordinator.pool), analyze = coordinator.python.analyze.bind(coordinator.python);
      coordinator.pool.run = async (...args) => { const start = performance.now(); try { return await run(...args); } finally { stages.push({ stage: 'result' in args[0] ? 'independent-proof' : 'engine', ms: ms(start) }); } };
      coordinator.python.analyze = async (...args) => { const start = performance.now(); try { return await analyze(...args); } finally { analyses.push({ scalars: [...args[0]].length, ms: ms(start) }); } };
      const memory = () => { let pythonRss = 0; try { pythonRss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${coordinator.python.child.pid}/status`, 'utf8'))?.[1] ?? 0) * 1024; } catch {} peakPythonRssBytes = Math.max(peakPythonRssBytes, pythonRss); peakCombinedRssBytes = Math.max(peakCombinedRssBytes, process.memoryUsage().rss + pythonRss); };
      sample = setInterval(memory, 25); memory();
      const session = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { 'x-buront-client': '1' }, payload: {} });
      const headers = { authorization: `Bearer ${session.json().token}`, cookie: session.headers['set-cookie'].split(';')[0] };
      const start = performance.now(), accepted = await app.inject({ method: 'POST', url: '/api/v1/generations', headers, payload: request(job.source) });
      if (accepted.statusCode !== 202) return { status: 'admission_failed', code: accepted.statusCode, body: accepted.body };
      let response;
      do { await new Promise(resolve => setTimeout(resolve, 25)); response = (await app.inject({ url: `/api/v1/generations/${accepted.json().jobId}`, headers })).json(); } while (!['completed', 'failed', 'cancelled'].includes(response.state) && performance.now() - start < 45000);
      memory();
      const result = response.result;
      return { status: response.state, error: response.error, apiAssetsHash: sha(coordinator.assets), apiDatasetId: coordinator.assets.datasetId, declaredEngineVersion: result?.replayManifest.engineVersion, startupMs, apiWallMs: ms(start), coordinatorMs: response.elapsedMs, stages, analyses, environment, maxRssBytes: process.resourceUsage().maxRSS * 1024, peakPythonRssBytes, peakCombinedRssBytes, ...(result ? { ...resultSummary(result), semanticVerification: result.replayManifest.semanticVerification, analysisIdPresent: !!result.analysisId, publicPoolHidden: !('candidatePool' in result) } : {}) };
    } finally { clearInterval(sample); await app.close(); }
  }
  const { generate } = require(path.join(job.dist, 'packages/core/engine'));
  const { validateAnalysis } = require(path.join(job.dist, 'packages/contracts'));
  const assets = read(job.assets), base = read(job.base), sample = job.synthetic ? tileAnalysis(base, job.scalars) : read(job.analysis);
  validateAnalysis(sample.analysis, sample.source);
  generate(request(base.source), base.analysis, assets, { engineVersion: 'benchmark-fixed-metadata' });
  process.send?.({ type: 'started' });
  const start = performance.now(), result = generate(request(sample.source), sample.analysis, assets, { engineVersion: 'benchmark-fixed-metadata' });
  const generationMs = ms(start); write(job.output, result);
  return { status: 'ok', generationMs, environment, maxRssBytes: process.resourceUsage().maxRSS * 1024, memory: process.memoryUsage(), sourceScalars: [...sample.source].length, tokens: sample.analysis.tokens.length, sentences: sample.analysis.sentences.length, ...resultSummary(result) };
}
function run(job, workspace, heap) {
  const file = path.join(workspace, `job-${Math.random().toString(16).slice(2)}.json`); write(file, job);
  return new Promise(resolve => {
    const start = performance.now(), child = fork(__filename, ['--worker', file], { silent: true, cwd: root, execArgv: heap ? [`--max-old-space-size=${heap}`] : [] });
    let stderr = '', settled = false;
    const timer = setTimeout(() => finish({ status: 'timeout', timeoutMs: 120000 }), 120000);
    function finish(result) { if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL'); resolve({ ...result, workerWallMs: ms(start), ...(stderr ? { stderr: stderr.slice(-1500) } : {}) }); }
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('message', message => { if (message.type === 'result') finish(message.result); });
    child.on('error', error => finish({ status: 'error', error: error.message }));
    child.on('exit', (code, signal) => finish({ status: 'error', code, signal }));
  });
}
async function main() {
  const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const output = path.resolve(root, option('--output', 'artifacts/near-limit-20261002/benchmark.json')), reference = option('--reference', 'c7631ae');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'buront-near-limit-'));
  const fixed = path.join(workspace, 'fixed'); fs.mkdirSync(fixed); fs.cpSync(path.join(root, 'dist'), path.join(fixed, 'dist'), { recursive: true }); fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixed, 'node_modules'));
  const baseline = path.join(workspace, 'baseline'); fs.mkdirSync(baseline); fs.symlinkSync(path.join(root, 'node_modules'), path.join(baseline, 'node_modules'));
  const commit = execFileSync('git', ['rev-parse', `${reference}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  const archive = execFileSync('git', ['archive', commit, 'packages', 'apps/server', 'scripts/v1', 'tsconfig.json', 'package.json'], { cwd: root, maxBuffer: 50000000 }); execFileSync('tar', ['-x', '-C', baseline], { input: archive });
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(baseline, 'tsconfig.json')], { cwd: baseline });
  const fixedDist = path.join(fixed, 'dist'), baselineDist = path.join(baseline, 'dist');
  const { compileAssets } = require(path.join(fixedDist, 'packages/core/assets'));
  const assets = compileAssets(root); assets.manifest.engine = { sourceHash: 'benchmark-fixed-engine-metadata' }; assets.manifest.toolCommit = 'benchmark-fixed-engine-metadata'; assets.datasetId = sha(assets.manifest);
  const assetsFile = path.join(workspace, 'assets.json'); write(assetsFile, assets);
  const base = path.join(root, 'artifacts/pr3-review-repair-20261002/rewrite-scopes-base-analysis.json');
  const workloads = { repeated: '私は最強だ'.repeat(1000), prose };
  const workloadsFile = path.join(path.dirname(output), 'workloads.json');
  write(workloadsFile, { schemaVersion: 1, workloads: Object.fromEntries(Object.entries(workloads).map(([name, source]) => [name, { source, sourceScalars: [...source].length, sourceHash: sha(source) }])) });
  const evidence = { schemaVersion: 1, capturedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model }, baseline: commit, fixedCoreHash: sha(fs.readdirSync(path.join(fixedDist, 'packages/core')).filter(name => name.endsWith('.js')).sort().map(name => [name, sha(fs.readFileSync(path.join(fixedDist, 'packages/core', name), 'utf8'))])), workspace, assetsHash: sha(assets), baseHash: sha(read(base)), method: { engine: 'Fresh child process, one five-character warmup; parser/import/index warmup excluded. maxRss includes process initialization; default V8 heap unless explicitly labeled 4096MiB.', equality: 'Same frozen assets, request and full-input analysis. Full candidate pool includes plans, spans, evidence, all novelty fields and scores. Expected real-limit correction only changes false V-quantity rejection and consequent presentation.', synthetic: 'Five-character real-analysis tile with remapped IDs/heads/spans/sentence boundaries; NOT a real full-input parse.', prose: 'Authored multi-paragraph factual passage repeated intact to near 5,000; not a representative-user performance guarantee.', api: 'Production Fastify injection + Coordinator + Python parser + worker + independent bounded semantic proof; default 30,000ms coordinator deadline. Bounded rewrites are independently rechecked, not output-reparsed. Node RSS includes worker; combined peak samples Node+Python every25ms. Startup separately reported.' }, workloads: { file: path.basename(workloadsFile), sha256: sha(fs.readFileSync(workloadsFile, 'utf8')) }, parser: [], engine: [], api: [], equality: [] };
  const save = () => write(output, evidence), rows = new Map();
  const analyses = {};
  for (const [name, source] of Object.entries(workloads)) { const file = path.join(workspace, `${name}.json`), row = await run({ kind: 'parse', dist: fixedDist, source, output: file }, workspace); evidence.parser.push({ workload: name, sourceScalars: [...source].length, ...row }); if (row.status === 'ok') analyses[name] = file; save(); }
  for (const item of [{ name: 'synthetic1200', synthetic: true, scalars: 1200 }, { name: 'synthetic5000', synthetic: true, scalars: 5000 }, ...Object.keys(analyses).map(name => ({ name, analysis: analyses[name] }))]) {
    for (const [label, dist, heap] of [['fixed', fixedDist], ...(!args.includes('--skip-baseline') ? [['baseline', baselineDist], ...(item.name === 'synthetic5000' ? [['baseline-large-heap', baselineDist, 4096]] : [])] : [])]) {
      const resultFile = path.join(workspace, `${item.name}-${label}.json`), row = await run({ kind: 'engine', ...item, dist, assets: assetsFile, base, output: resultFile }, workspace, heap);
      evidence.engine.push({ workload: item.name, build: label, ...row }); if (row.status === 'ok') rows.set(`${item.name}-${label}`, resultFile); console.error(JSON.stringify({ workload: item.name, build: label, status: row.status, ms: row.generationMs, rss: row.maxRssBytes })); save();
    }
    const actualFile = rows.get(`${item.name}-fixed`), expectedFile = rows.get(`${item.name}-baseline`) ?? rows.get(`${item.name}-baseline-large-heap`);
    if (actualFile && expectedFile) {
      const actual = read(actualFile), expected = read(expectedFile), exact = sha(semanticView(actual)) === sha(semanticView(expected));
      const poolLanguageEqual = resultSummary(actual).poolLanguageHash === resultSummary(expected).poolLanguageHash;
      const difference = expected.candidatePool.map((c, i) => ({ candidate: i, changes: c.checks.filter((check, j) => check.status !== actual.candidatePool[i]?.checks[j]?.status).map(check => check.code) })).filter(item => item.changes.length);
      let correctedSemanticEqual = false;
      if (!exact && item.name === 'repeated' && poolLanguageEqual && difference.every(item => item.changes.every(code => code === 'V-quantity'))) {
        const corrected = structuredClone(expected);
        const { select } = require(path.join(fixedDist, 'packages/core/evaluation'));
        const { verification } = require(path.join(fixedDist, 'packages/core/validator'));
        for (const candidate of corrected.candidatePool) {
          for (const check of candidate.checks) if (check.code === 'V-quantity' && check.status === 'fail') check.status = 'pass';
          candidate.verificationStatus = verification(candidate.checks);
        }
        corrected.candidates = select(corrected.candidatePool, 'blend', 'rewrite-scope-benchmark-v1');
        corrected.reviewCandidates = corrected.candidatePool.filter(candidate => candidate.verificationStatus === 'needs_review').slice(0, 3);
        corrected.fallback = corrected.candidates.length ? null : corrected.fallback;
        corrected.shortfallReason = corrected.candidates.length === 3 ? null : corrected.candidates.length ? 'candidate_shortage' : corrected.shortfallReason;
        correctedSemanticEqual = sha(semanticView(corrected)) === sha(semanticView(actual));
      }
      evidence.equality.push({ workload: item.name, exactSemanticResult: exact, poolLanguageAndNoveltyEqual: poolLanguageEqual, checkDifferences: difference, expectedQuantityCorrectionOnly: correctedSemanticEqual }); save();
    }
  }
  const runtimeRoot = path.join(workspace, 'runtime'); fs.mkdirSync(runtimeRoot);
  for (const name of ['data', 'assets', 'services', '.venv', 'apps']) if (fs.existsSync(path.join(root, name))) fs.symlinkSync(path.join(root, name), path.join(runtimeRoot, name));
  fs.copyFileSync(path.join(root, 'build-info.json'), path.join(runtimeRoot, 'build-info.json'));
  evidence.apiRuntimeBuildInfo = read(path.join(runtimeRoot, 'build-info.json'));
  for (const [name, source] of Object.entries(workloads)) { const row = await run({ kind: 'api', dist: fixedDist, runtimeRoot, source }, workspace); evidence.api.push({ workload: name, sourceScalars: [...source].length, ...row }); console.error(JSON.stringify({ api: name, status: row.status, ms: row.coordinatorMs, candidates: row.selectedCount, error: row.error })); save(); }
  evidence.passed = evidence.parser.every(row => row.status === 'ok') && evidence.engine.filter(row => row.build === 'fixed').every(row => row.status === 'ok') && evidence.equality.every(row => row.exactSemanticResult || row.expectedQuantityCorrectionOnly) && evidence.api.every(row => row.status === 'completed' && row.selectedCount > 0);
  save();
  console.log(JSON.stringify({ output, workspace, passed: evidence.passed, equality: evidence.equality, api: evidence.api.map(row => ({ workload: row.workload, status: row.status, ms: row.coordinatorMs, candidates: row.selectedCount })) }));
  if (!evidence.passed) process.exitCode = 1;
}
if (require.main === module && process.argv[2] === '--worker') worker(read(process.argv[3])).then(result => process.send?.({ type: 'result', result }), error => process.send?.({ type: 'result', result: { status: 'error', error: error.message, stack: error.stack } }));
else if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { paragraph, prose, worker };
