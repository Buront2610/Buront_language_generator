'use strict';
// Same-input audit using an explicitly pinned engine snapshot and asset file.
// No learned style/quality score or human taste assessment is inferred.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const args = Object.fromEntries(process.argv.slice(2).map((value, index, values) => value.startsWith('--') ? [value.slice(2), values[index + 1]] : []).filter(item => item.length));
for (const name of ['engine-root', 'assets', 'out', 'revision']) if (!args[name]) throw new Error(`Missing --${name}`);
const root = path.resolve(args['engine-root']);
const output = path.resolve(args.out);
const casesPath = path.resolve(args.cases ?? path.join(__dirname, '../artifacts/grounded-discourse-20261002/cases.json'));
const assetPath = path.resolve(args.assets);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const inputSet = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const { PythonClient } = require(path.join(root, 'dist/packages/runtime/python-client'));
const { loadAssets } = require(path.join(root, 'dist/packages/core/assets'));
const { generate } = require(path.join(root, 'dist/packages/core/engine'));
const { verifyGeneratedResult } = require(path.join(root, 'dist/packages/runtime/semantic-verification'));
function engineHashes() {
  const files = [];
  for (const folder of ['dist/packages', 'services/japanese-analysis']) {
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory() && !['__pycache__', 'generated'].includes(entry.name)) walk(file);
        else if (entry.isFile() && /\.(?:js|py|json)$/u.test(entry.name)) files.push(file);
      }
    };
    walk(path.join(root, folder));
  }
  return Object.fromEntries(files.sort().map(file => [path.relative(root, file), sha256(fs.readFileSync(file))]));
}
function candidateSummary(candidate) {
  const edits = candidate.plan.rewrite?.edits ?? candidate.plan.construction?.edits ?? [];
  return {
    id: candidate.id,
    text: candidate.text,
    operator: candidate.plan.mainOperator,
    family: candidate.plan.family,
    verificationStatus: candidate.verificationStatus,
    scores: candidate.scores,
    novelty: candidate.novelty.classification,
    checks: candidate.checks.map(check => `${check.code}:${check.status}`),
    edits: edits.map(edit => ({ ruleId: edit.ruleId, constructionId: edit.constructionId, from: edit.from, to: edit.to })),
  };
}
function summarize(result, pool) {
  return {
    selectedCandidateId: result.selectedCandidateId,
    displayed: result.candidates.map(candidateSummary),
    fallback: result.fallback,
    shortfallReason: result.shortfallReason,
    poolCount: pool.length,
    poolConstructionCount: pool.filter(candidate => candidate.plan.construction).length,
    semanticVerification: result.replayManifest.semanticVerification,
  };
}
(async () => {
  process.chdir(root);
  const assets = loadAssets(assetPath);
  const python = new PythonClient(root);
  const rows = [];
  const meta = {
    startedAt: new Date().toISOString(),
    testedRevision: args.revision,
    testedEngineBuild: JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8')),
    isolation: 'Engine snapshot isolated from the active checkout and hashed before/after; baseline came from a Git archive. Assets are separately frozen bytes.',
    engineHashesStart: engineHashes(),
    datasetId: assets.datasetId,
    assetFileHash: sha256(fs.readFileSync(assetPath)),
    assetManifest: assets.manifest,
    datasetEngineNote: 'assetManifest.engine is historical asset provenance, not the tested engine identity; see testedRevision and testedEngineBuild.',
    inputSetHash: sha256(fs.readFileSync(casesPath)),
    settings: inputSet.settings,
    node: process.version,
    method: 'All displayed candidates in engine order, source/outputs actually parsed with GiNZA. Automated verification plus model qualitative inspection; no human taste evaluation.',
  };
  try {
    meta.parser = await python.start();
    for (const item of inputSet.cases) {
      const row = { ...item, results: [] };
      try {
        const analysis = await python.analyze(item.source);
        row.sourceAnalysisHash = sha256(JSON.stringify(analysis));
        for (const intensity of inputSet.settings.intensities) {
          const request = { ...inputSet.settings, source: item.source, intensity };
          delete request.intensities;
          delete request.experimentalOperators; // Historical setting is the engine default, not a request field.
          try {
            const start = performance.now();
            const generated = generate(request, analysis, assets);
            const generationMs = performance.now() - start;
            const pool = generated.candidatePool ?? generated.candidates;
            const result = await verifyGeneratedResult(generated, python, analysis);
            row.results.push({ intensity, generationMs: +generationMs.toFixed(3), ...summarize(result, pool) });
            console.log(JSON.stringify({ id: item.id, intensity, texts: result.candidates.map(candidate => candidate.text), fallback: result.fallback, shortfallReason: result.shortfallReason }));
          } catch (error) {
            row.results.push({ intensity, error: { message: error.message } });
          }
        }
      } catch (error) {
        row.error = { message: error.message };
      }
      rows.push(row);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output + '.partial', JSON.stringify({ meta, rows }, null, 2) + '\n');
    }
    meta.engineHashesEnd = engineHashes();
    meta.stableEngine = JSON.stringify(meta.engineHashesStart) === JSON.stringify(meta.engineHashesEnd);
    meta.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify({ meta, rows }, null, 2) + '\n');
    fs.unlinkSync(output + '.partial');
    console.log(JSON.stringify({ completed: true, rows: rows.length, stableEngine: meta.stableEngine, output }));
    if (!meta.stableEngine || rows.some(row => row.error || row.results.some(result => result.error))) process.exitCode = 1;
  } finally { python.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
