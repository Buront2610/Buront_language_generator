'use strict';
// Reproduce the PR3 long-input regression with fixed assets and isolated builds.
// Usage (build the working tree first):
// node scripts/benchmark-rewrite-scopes.js --variant fixed=dist \
//   --reference reviewed=b5c2d96 --reference base=f87567a \
//   --variant-timeout fixed=120000 --variant-timeout base=120000
// --reference builds a git revision in a temporary directory (requires git/tar).
// --variant accepts an existing dist directory. Both are copied before testing.
// Synthetic tiling isolates generation; it is NOT a real parse of the long input.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const write = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');
const elapsed = since => Math.round((performance.now() - since) * 1000) / 1000;
const baseSource = '私は最強だ';

function tileAnalysis(base, characters) {
  const width = [...base.source].length;
  if (!Number.isInteger(characters / width)) throw new Error('Length must be a multiple of the base source length');
  const tokens = [], sentences = [];
  for (let index = 0; index < characters / width; index++) {
    const offset = index * width, firstId = tokens.length;
    const ids = new Map(base.analysis.tokens.map((token, i) => [token.id, firstId + i]));
    for (const token of base.analysis.tokens) tokens.push({ ...token, id: ids.get(token.id), head: ids.get(token.head), span: { start: token.span.start + offset, end: token.span.end + offset } });
    sentences.push(...base.analysis.sentences.map(span => ({ start: span.start + offset, end: span.end + offset })));
  }
  return { source: base.source.repeat(characters / width), analysis: { ...base.analysis, tokens, sentences } };
}

function scopeInstrumentation(dist) {
  const counts = { total: 0, byCaller: {}, functionCalls: {} };
  let caller = 'other';
  const file = path.join(dist, 'packages/core/grammar-scope.js');
  if (fs.existsSync(file)) {
    const module = require(file), original = module.propositionScopes;
    module.propositionScopes = function (...args) {
      counts.total++;
      counts.byCaller[caller] = (counts.byCaller[caller] || 0) + 1;
      return original.apply(this, args);
    };
  }
  for (const [moduleName, functionName] of [['facts', 'extractFacts'], ['rewrite', 'makeRewritePlans'], ['rewrite-validation', 'validateRewrite'], ['constructions', 'makeConstructionPlans']]) {
    const filename = path.join(dist, `packages/core/${moduleName}.js`);
    if (!fs.existsSync(filename)) continue;
    const module = require(filename), original = module[functionName];
    if (typeof original !== 'function') continue;
    module[functionName] = function (...args) {
      const parent = caller; caller = functionName;
      counts.functionCalls[functionName] = (counts.functionCalls[functionName] || 0) + 1;
      try { return original.apply(this, args); } finally { caller = parent; }
    };
  }
  return { counts, reset() { counts.total = 0; counts.byCaller = {}; counts.functionCalls = {}; } };
}

async function worker(job) {
  if (job.type === 'parse') {
    const { PythonClient } = require(path.join(job.dist, 'packages/runtime/python-client'));
    const client = new PythonClient(root);
    let runtime, startupMs, parseStart;
    try {
      const startup = performance.now(); runtime = await client.start(); startupMs = elapsed(startup);
      parseStart = performance.now();
      const analysis = await client.analyze(job.source, Date.now() + job.parserTimeoutMs);
      const parserMs = elapsed(parseStart);
      write(job.analysisFile, { source: job.source, analysis });
      return { status: 'ok', startupMs, parserMs, runtime, analysisHash: sha(analysis), tokens: analysis.tokens.length, sentences: analysis.sentences.length };
    } catch (error) {
      return { status: 'error', error: error.message, startupMs, ...(parseStart === undefined ? {} : { elapsedParserMs: elapsed(parseStart) }), runtime };
    } finally { client.close(); }
  }
  const instrument = scopeInstrumentation(job.dist);
  const { generate } = require(path.join(job.dist, 'packages/core/engine'));
  const { validateAnalysis } = require(path.join(job.dist, 'packages/contracts'));
  const assets = read(job.assetsFile), base = read(job.baseFile);
  const sample = job.type === 'synthetic' ? tileAnalysis(base, job.characters) : read(job.analysisFile);
  validateAnalysis(sample.analysis, sample.source);
  const request = source => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'rewrite-scope-benchmark-v1' });
  // Warm imports, schemas, JIT entry points and the shared-asset retrieval index.
  generate(request(base.source), base.analysis, assets, { engineVersion: 'benchmark-fixed-metadata' });
  instrument.reset();
  process.send?.({ type: 'started' });
  const start = performance.now();
  const result = generate(request(sample.source), sample.analysis, assets, { engineVersion: 'benchmark-fixed-metadata' });
  const generationMs = elapsed(start), pool = result.candidatePool ?? result.candidates;
  return {
    status: 'ok', generationMs, propositionScopesCalls: instrument.counts,
    tokens: sample.analysis.tokens.length, sentences: sample.analysis.sentences.length,
    facts: result.ir.facts.length, selectedCount: result.candidates.length, poolCount: pool.length,
    selectedTextHashes: result.candidates.map(item => sha(item.text)),
    selectedTextsHash: sha(result.candidates.map(item => item.text)),
    poolTextsHash: sha(pool.map(item => item.text)), poolHash: sha(pool), irHash: sha(result.ir),
    semanticResultHash: sha({ candidates: result.candidates, candidatePool: pool, reviewCandidates: result.reviewCandidates, fallback: result.fallback, shortfallReason: result.shortfallReason, ir: result.ir }),
    selectedCandidateId: result.selectedCandidateId, candidateSetHash: result.replayManifest.candidateSetHash,
    shortfallReason: result.shortfallReason,
  };
}

function runWorker(job, jobFile, timeoutMs) {
  write(jobFile, job);
  return new Promise(resolve => {
    const start = performance.now(), child = fork(__filename, ['--worker', jobFile], { cwd: root, silent: true });
    let stderr = '', done = false, generationStarted = false;
    // Initialization has its own bounded allowance; generation receives the full budget.
    let timer = setTimeout(() => finish({ status: 'timeout', phase: 'initialization', timeoutMs: 60000 }), 60000);
    const finish = result => {
      if (done) return; done = true; clearTimeout(timer); child.kill('SIGKILL');
      resolve({ ...result, workerWallMs: elapsed(start), ...(stderr ? { stderr: stderr.slice(-2000) } : {}) });
    };
    if (job.type === 'parse') { clearTimeout(timer); timer = setTimeout(() => finish({ status: 'timeout', phase: 'parser-worker', timeoutMs }), timeoutMs); }
    child.stderr.on('data', value => { stderr += value.toString(); });
    child.on('message', value => {
      if (value.type === 'started') { generationStarted = true; clearTimeout(timer); timer = setTimeout(() => finish({ status: 'timeout', phase: 'generation', timeoutMs, propositionScopesCalls: null, hashes: null }), timeoutMs); }
      if (value.type === 'result') finish(value.result);
    });
    child.on('error', error => finish({ status: 'error', error: error.message }));
    child.on('exit', (code, signal) => { if (!done) finish({ status: 'error', error: `Worker exited ${code ?? signal}`, generationStarted }); });
  });
}

function parseOptions(args) {
  const options = { variants: [], references: [], variantTimeouts: {}, lengths: [1200, 2400, 3000, 5000], repeats: 1, timeoutMs: 30000, parserTimeoutMs: 30000, output: path.join(root, 'artifacts/pr3-review-repair-20261002/rewrite-scopes-benchmark.json'), parse: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], value = () => { if (!args[i + 1]) throw new Error(`Missing value for ${arg}`); return args[++i]; };
    if (arg === '--variant') options.variants.push(value());
    else if (arg === '--reference') options.references.push(value());
    else if (arg === '--lengths') options.lengths = value().split(',').map(Number);
    else if (arg === '--repeats') options.repeats = Number(value());
    else if (arg === '--timeout-ms') options.timeoutMs = Number(value());
    else if (arg === '--variant-timeout') {
      const spec = value(), separator = spec.indexOf('=');
      if (separator < 1) throw new Error('--variant-timeout requires label=milliseconds');
      options.variantTimeouts[spec.slice(0, separator)] = Number(spec.slice(separator + 1));
    }
    else if (arg === '--parser-timeout-ms') options.parserTimeoutMs = Number(value());
    else if (arg === '--output') options.output = path.resolve(value());
    else if (arg === '--base-analysis') options.baseAnalysis = path.resolve(value());
    else if (arg === '--skip-parser') options.parse = false;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.variants.length) options.variants.push('fixed=dist');
  for (const value of [...options.lengths, options.repeats, options.timeoutMs, options.parserTimeoutMs, ...Object.values(options.variantTimeouts)]) if (!Number.isInteger(value) || value <= 0) throw new Error('Numeric options must be positive integers');
  if (options.lengths.some(value => value > 5000 || value % [...baseSource].length)) throw new Error('Lengths must be multiples of five within the 5000-character API limit');
  return options;
}

function snapshotBuild(spec, index, temporary, reference) {
  const separator = spec.indexOf('='), label = spec.slice(0, separator), value = spec.slice(separator + 1);
  if (separator < 1 || !value) throw new Error('Variants/references require label=value');
  const folder = path.join(temporary, `build-${index}`);
  fs.mkdirSync(folder);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  let commit = null;
  if (reference) {
    commit = execFileSync('git', ['rev-parse', '--verify', `${value}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    const archive = execFileSync('git', ['archive', commit, 'packages', 'apps/server', 'scripts/v1', 'tsconfig.json', 'package.json'], { cwd: root, maxBuffer: 50 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', folder], { input: archive });
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(folder, 'tsconfig.json')], { cwd: folder, timeout: 120000, stdio: 'pipe' });
  } else fs.cpSync(path.resolve(root, value), path.join(folder, 'dist'), { recursive: true });
  const dist = path.join(folder, 'dist');
  const codeFiles = fs.readdirSync(path.join(dist, 'packages/core')).filter(file => file.endsWith('.js')).sort();
  const codeHash = sha(codeFiles.map(file => [file, sha(fs.readFileSync(path.join(dist, 'packages/core', file), 'utf8'))]));
  return { label, source: reference ? value : path.relative(root, path.resolve(root, value)), commit, codeHash, dist };
}

async function main() {
  const options = parseOptions(process.argv.slice(2)), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'buront-rewrite-scopes-'));
  const folder = path.dirname(options.output); fs.mkdirSync(folder, { recursive: true });
  console.error(`Benchmark workspace: ${temporary}`);
  const builds = [...options.variants.map(value => [value, false]), ...options.references.map(value => [value, true])].map(([spec, reference], i) => snapshotBuild(spec, i, temporary, reference));
  if (new Set(builds.map(build => build.label)).size !== builds.length) throw new Error('Build labels must be unique');
  const { compileAssets } = require(path.join(builds[0].dist, 'packages/core/assets'));
  const { hash } = require(path.join(builds[0].dist, 'packages/core/source'));
  const assets = compileAssets(root);
  // All builds receive the exact same compiled asset JSON and dataset ID. Strip
  // ONLY build identifiers before computing that shared ID; retain data/config.
  assets.manifest.engine = { sourceHash: 'benchmark-fixed-engine-metadata' };
  assets.manifest.toolCommit = 'benchmark-fixed-engine-metadata';
  assets.datasetId = hash(assets.manifest);
  const assetsFile = path.join(temporary, 'assets.json'); write(assetsFile, assets);
  const baseFile = path.join(folder, 'rewrite-scopes-base-analysis.json');
  const evidence = {
    schemaVersion: 1, capturedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, execArgv: process.execArgv, heapLimitBytes: require('node:v8').getHeapStatistics().heap_size_limit },
    configuration: { lengths: options.lengths, repeats: options.repeats, generationTimeoutMs: options.timeoutMs, variantTimeouts: options.variantTimeouts, parserTimeoutMs: options.parserTimeoutMs, baseSource, request: { task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'rewrite-scope-benchmark-v1' } },
    method: {
      synthetic: 'Tile one saved real GiNZA response; remap every token ID, dependency head, token span and sentence span. This synthetic long-input analysis is NOT a full-input GiNZA parse.',
      real: 'Parse the actual concatenated long source via production PythonClient/service.py. Startup is separate. Generation receives that unedited full-input analysis.',
      generation: 'Fresh worker per build/size/repetition, one five-character warmup; measured generate() excludes parser, module imports, fixture loading, validation of the fixture, asset compilation and warmup. Includes engine validation; excludes the later semantic-reparse verification stage.',
      scopes: 'Count exported propositionScopes() invocations across generate(), with caller attribution; zero on revisions without grammar-scope.js. Timed-out synchronous workers are killed and have no exact count or output hash.',
      equality: 'Same frozen assets/config/analysis for each variant. Hash full ordered pool and displayed candidates, checks, plans, spans, IR and fallback, excluding replay/build metadata. Compare reviewed vs fixed; pre-PR base is timing context only.',
    },
    builds: builds.map(({ dist, ...build }) => build), assets: { sha256: sha(assets), datasetId: assets.datasetId, manifest: assets.manifest },
    parser: { base: null, fullInputs: [] }, syntheticRows: [], realRows: [], equivalence: [],
  };
  const save = () => write(options.output, evidence);
  let sequence = 0;
  const run = (job, timeout) => runWorker(job, path.join(temporary, `job-${sequence++}.json`), timeout);
  if (options.baseAnalysis) {
    const base = read(options.baseAnalysis);
    if (base.source !== baseSource) throw new Error('Saved base source must be 私は最強だ');
    write(baseFile, base); evidence.parser.base = { status: 'saved', sourceFile: path.relative(root, options.baseAnalysis), analysisHash: sha(base.analysis), parserVersion: base.analysis.parserVersion };
  } else {
    evidence.parser.base = await run({ type: 'parse', dist: builds[0].dist, source: baseSource, analysisFile: baseFile, parserTimeoutMs: options.parserTimeoutMs }, options.parserTimeoutMs + 50000);
    if (evidence.parser.base.status !== 'ok') { save(); throw new Error('Could not capture real base analysis'); }
  }
  const base = read(baseFile);
  evidence.parser.base = { ...evidence.parser.base, source: baseSource, fixtureFile: path.relative(root, baseFile), fixtureSha256: sha(base) };
  save();
  for (const characters of options.lengths) {
    for (let repetition = 1; repetition <= options.repeats; repetition++) for (const build of builds) {
      const result = await run({ type: 'synthetic', dist: build.dist, characters, assetsFile, baseFile }, options.variantTimeouts[build.label] ?? options.timeoutMs);
      const row = { build: build.label, characters, repetition, ...result }; evidence.syntheticRows.push(row); save();
      console.error(JSON.stringify({ workload: 'synthetic', ...row }));
    }
    if (!options.parse) continue;
    const analysisFile = path.join(temporary, `real-${characters}.json`);
    const parsed = await run({ type: 'parse', dist: builds[0].dist, source: baseSource.repeat(characters / [...baseSource].length), analysisFile, parserTimeoutMs: options.parserTimeoutMs }, options.parserTimeoutMs + 50000);
    evidence.parser.fullInputs.push({ characters, ...parsed }); save();
    console.error(JSON.stringify({ workload: 'real-parser', characters, ...parsed }));
    if (parsed.status !== 'ok') continue;
    for (let repetition = 1; repetition <= options.repeats; repetition++) for (const build of builds) {
      const result = await run({ type: 'real', dist: build.dist, characters, assetsFile, baseFile, analysisFile }, options.variantTimeouts[build.label] ?? options.timeoutMs);
      const row = { build: build.label, characters, repetition, ...result }; evidence.realRows.push(row); save();
      console.error(JSON.stringify({ workload: 'real-generation', ...row }));
    }
  }
  for (const [workload, rows] of [['synthetic', evidence.syntheticRows], ['real', evidence.realRows]]) for (const characters of options.lengths) for (let repetition = 1; repetition <= options.repeats; repetition++) {
    const reviewed = rows.find(row => row.build === 'reviewed' && row.characters === characters && row.repetition === repetition && row.status === 'ok');
    const fixed = rows.find(row => row.build === 'fixed' && row.characters === characters && row.repetition === repetition && row.status === 'ok');
    const fields = ['selectedTextsHash', 'poolTextsHash', 'poolHash', 'irHash', 'semanticResultHash', 'candidateSetHash'];
    evidence.equivalence.push({ workload, characters, repetition, compared: !!(reviewed && fixed), ...(reviewed && fixed ? { equal: fields.every(field => reviewed[field] === fixed[field]), fields: Object.fromEntries(fields.map(field => [field, reviewed[field] === fixed[field]])) } : { reason: 'Both reviewed and fixed must complete; a timeout does not establish equivalence' }) });
  }
  save();
  console.log(JSON.stringify({ output: path.relative(root, options.output), syntheticRows: evidence.syntheticRows.length, realRows: evidence.realRows.length, equivalence: evidence.equivalence }));
  if (evidence.equivalence.some(row => row.compared && !row.equal)) process.exitCode = 1;
}

if (process.argv[2] === '--worker') {
  worker(read(process.argv[3])).then(result => process.send?.({ type: 'result', result }), error => process.send?.({ type: 'result', result: { status: 'error', error: error.message } }));
} else if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { tileAnalysis };
