'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = Object.fromEntries(process.argv.slice(2).map((value, i, all) => value.startsWith('--') ? [value.slice(2), all[i + 1]] : []).filter(item => item.length));
for (const name of ['before-prefix', 'after-prefix', 'out', 'cases-dir']) if (!args[name]) throw new Error(`Missing --${name}`);
const folder = path.resolve(args.out), casesDir = path.resolve(args['cases-dir']);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const displayed = run => (run.candidates ?? []).filter(candidate => candidate.displayedOrdinal !== null).sort((a, b) => a.displayedOrdinal - b.displayedOrdinal);
const texts = run => displayed(run).map(candidate => candidate.text);
const categories = ['person_punctuation', 'ending', 'lexical', 'discourse_marker', 'clause_structure'];
fs.mkdirSync(folder, { recursive: true });
const files = [];
function write(file, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(path.join(folder, file), text);
  files.push({ file, bytes: Buffer.byteLength(text), sha256: digest(text) });
}
function stats(rows, intensities) {
  return {
    cases: rows.length,
    byIntensity: intensities.map(intensity => {
      const runs = rows.map(row => row.results.find(run => run.intensity === intensity)).filter(Boolean);
      const candidates = runs.flatMap(run => run.candidates ?? []), visible = runs.flatMap(displayed);
      const stages = {};
      for (const event of runs.flatMap(run => run.diagnosticEvents ?? [])) stages[event.stage] = (stages[event.stage] ?? 0) + 1;
      return { intensity, poolCandidates: candidates.length, displayedCandidates: visible.length,
        casesWithDiscourseMarker: runs.filter(run => displayed(run).some(candidate => candidate.changeCategories.includes('discourse_marker'))).length,
        casesWithClauseStructure: runs.filter(run => displayed(run).some(candidate => candidate.changeCategories.includes('clause_structure'))).length,
        displayedCategoryCounts: Object.fromEntries(categories.map(kind => [kind, visible.filter(candidate => candidate.changeCategories.includes(kind)).length])),
        poolLexicalAndReason: candidates.filter(candidate => candidate.composition.lexicalAndReason).length,
        poolLexicalInsideReason: candidates.filter(candidate => candidate.composition.lexicalInsideReason).length,
        displayedLexicalInsideReason: visible.filter(candidate => candidate.composition.lexicalInsideReason).length,
        verificationRejected: candidates.filter(candidate => candidate.finalStage === 'verification_rejected').length,
        notSelected: candidates.filter(candidate => candidate.finalStage === 'not_selected').length,
        zeroCandidateCases: runs.filter(run => !run.error && !displayed(run).length).length,
        shortCases: runs.filter(run => !run.error && displayed(run).length < 3).length,
        allDisplayedVerified: visible.every(candidate => candidate.verificationStatus === 'passed'),
        allScoresUntrained: candidates.every(candidate => candidate.scores.S === null && candidate.scores.Q === null),
        allUsedLexicalEditsIndependentlyPermitted: candidates.every(candidate => candidate.lexicalPermission.every(edit => edit.independentlyPermitted)),
        stageEventCounts: stages,
        errors: rows.filter(row => row.error).length + runs.filter(run => run.error).length,
      };
    }),
  };
}
const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), method: 'Same-asset, same-parser before/after audit. Regression, controlled diagnostic and sealed one-shot held-out cases reported separately. Source parsing and bounded proof are not human quality evaluation.', suites: {}, compositionDemo: null, artifactFiles: files };
const runsBySuite = {};
const suiteNames = ['regression', 'controlled', ...(fs.existsSync(`${args['before-prefix']}-exposed.json`) && fs.existsSync(`${args['after-prefix']}-exposed.json`) ? ['exposed'] : []), 'heldout'];
for (const suite of suiteNames) {
  const before = read(`${args['before-prefix']}-${suite}.json`), after = read(`${args['after-prefix']}-${suite}.json`);
  runsBySuite[suite] = { before, after };
  const cases = read(path.join(casesDir, `${suite}-cases.json`));
  const control = {
    sameDataset: before.meta.datasetId === after.meta.datasetId,
    sameAssetBytes: before.meta.assetFileHash === after.meta.assetFileHash,
    sameInputs: before.meta.inputSetHash === after.meta.inputSetHash,
    sameSettings: eq(before.meta.settings, after.meta.settings),
    sameParser: eq(before.meta.parser, after.meta.parser),
    stableEngines: before.meta.stableEngine && after.meta.stableEngine,
    sameCasesOrder: before.rows.length === after.rows.length && before.rows.every((row, i) => row.id === after.rows[i].id && row.source === after.rows[i].source),
    sameSourceAnalyses: before.rows.every((row, i) => row.sourceAnalysisHash === after.rows[i]?.sourceAnalysisHash),
  };
  if (Object.values(control).some(value => !value)) throw new Error(`Uncontrolled ${suite}: ${JSON.stringify(control)}`);
  write(`${suite}-cases.json`, cases);
  for (const [name, run] of [['before', before], ['after', after]]) write(`${suite}-${name}-metadata.json`, run.meta);
  const comparisons = before.rows.map((row, i) => ({ id: row.id, group: row.group, category: row.category, source: row.source,
    results: row.results.map((run, j) => ({ intensity: run.intensity, displayedTextOrderChanged: !eq(texts(run), texts(after.rows[i].results[j])), before: run, after: after.rows[i].results[j] })) }));
  // Typed records keep all outputs and diagnostics while bounding each file.
  // Join records on id, intensity and phase; candidate planId disambiguates
  // equal emitted texts. No failed or nonselected candidate is discarded.
  for (const file of fs.readdirSync(folder)) if (new RegExp(`^${suite}-comparison-\\d+\\.json$`, 'u').test(file)) fs.unlinkSync(path.join(folder, file));
  const records = [], caseArtifactFiles = {};
  for (const row of comparisons) {
    const { results, ...input } = row;
    records.push({ type: 'input', ...input });
    for (const run of results) {
      const compact = value => { const { candidates, diagnosticEvents, ...rest } = value; return rest; };
      records.push({ type: 'run', id: row.id, intensity: run.intensity, displayedTextOrderChanged: run.displayedTextOrderChanged,
        before: compact(run.before), after: compact(run.after) });
      for (const phase of ['before', 'after']) {
        for (const candidate of run[phase].candidates ?? []) records.push({ type: 'candidate', id: row.id, intensity: run.intensity, phase, candidate });
        for (const diagnostic of run[phase].diagnosticEvents ?? []) records.push({ type: 'construction_diagnostic', id: row.id, intensity: run.intensity, phase, diagnostic });
      }
    }
  }
  let chunk = [], part = 1;
  const flush = () => {
    const file = `${suite}-comparison-${part++}.json`;
    for (const id of new Set(chunk.map(record => record.id))) (caseArtifactFiles[id] ??= []).push(file);
    write(file, chunk); chunk = [];
  };
  for (const record of records) {
    if (chunk.length && Buffer.byteLength(JSON.stringify([...chunk, record], null, 2)) > 43000) flush();
    if (Buffer.byteLength(JSON.stringify([record], null, 2)) > 43000) throw new Error(`Single record exceeds bounded chunk: ${suite}/${record.id}/${record.type}`);
    chunk.push(record);
  }
  if (chunk.length) flush();
  summary.suites[suite] = { evaluationRole: suite === 'heldout' ? 'final_one_shot_holdout' : suite === 'exposed' ? 'initial_holdout_now_exposed_regression' : suite, controlled: control, caseArtifactFiles, before: stats(before.rows, before.meta.settings.intensities), after: stats(after.rows, after.meta.settings.intensities),
    byOriginalGroup: Object.fromEntries([...new Set(before.rows.map(row => row.group))].map(group => [group, { before: stats(before.rows.filter(row => row.group === group), before.meta.settings.intensities), after: stats(after.rows.filter(row => row.group === group), after.meta.settings.intensities) }])),
    changedCaseIds: comparisons.filter(row => row.results.some(run => run.displayedTextOrderChanged)).map(row => row.id),
    unchangedCaseIds: comparisons.filter(row => row.results.every(run => !run.displayedTextOrderChanged)).map(row => row.id),
  };
}
const controlled = runsBySuite.controlled;
function demoRun(run) {
  const row = run.rows.find(item => item.id === 'C01'), result = row.results.find(item => item.intensity === 3);
  const choose = predicate => result.candidates.filter(candidate => candidate.verificationStatus === 'passed' && predicate(candidate)).sort((a, b) => (a.displayedOrdinal ?? 99) - (b.displayedOrdinal ?? 99) || a.edits.length - b.edits.length)[0] ?? null;
  return { source: row.source, intensity: 3,
    lexicalOnly: choose(candidate => candidate.composition.lexicalOnly),
    reasonOnly: choose(candidate => candidate.composition.reasonOnly) ?? result.reasonOnlyAblations?.find(item => item.independentConstructionProof && item.verificationStatus === 'passed') ?? null,
    combined: choose(candidate => candidate.composition.lexicalInsideReason),
  };
}
summary.compositionDemo = { before: demoRun(controlled.before), after: demoRun(controlled.after),
  standaloneLexical: controlled.after.rows.find(row => row.id === 'C05'),
  note: 'Same-source C01: lexical-only and combined are production pool candidates with displayed ordinal (null means valid but not displayed). Reason-only is an explicitly labeled isolated valid ablation, excluded from production selection. Lexical-only may include punctuation/person rules. C05 independently demonstrates the standalone lexical rule.' };
write('composition-demo.json', summary.compositionDemo);
write('holdout-seal.json', read(path.join(casesDir, 'holdout-seal.json')));
if (fs.existsSync(path.join(casesDir, 'holdout-distinctness.json'))) write('holdout-distinctness.json', read(path.join(casesDir, 'holdout-distinctness.json')));
if (fs.existsSync(path.join(casesDir, 'baseline-replay.json'))) write('baseline-replay.json', read(path.join(casesDir, 'baseline-replay.json')));
if (fs.existsSync(path.join(folder, 'frozen-asset-manifest.json'))) { const file = 'frozen-asset-manifest.json', text = fs.readFileSync(path.join(folder, file)); files.push({ file, bytes: text.length, sha256: digest(text) }); }
if (fs.existsSync(path.join(casesDir, 'code-freeze.json'))) write('code-freeze.json', read(path.join(casesDir, 'code-freeze.json')));
if (args.smoke) {
  const smoke = read(args.smoke), controlledAfter = runsBySuite.regression.after;
  const sameEngines = eq(smoke.meta.engineHashesStart, controlledAfter.meta.engineHashesStart) && smoke.meta.stableEngine;
  if (!sameEngines || smoke.meta.inputSetHash !== controlledAfter.meta.inputSetHash || !eq(smoke.meta.parser, controlledAfter.meta.parser)) throw new Error('Production smoke engine/input/parser mismatch');
  for (const file of fs.readdirSync(folder)) if (/^production-smoke-\d+\.json$/u.test(file)) fs.unlinkSync(path.join(folder, file));
  write('production-smoke-metadata.json', smoke.meta);
  const rows = smoke.rows.map((row, i) => ({ id: row.id, source: row.source, sourceAnalysisIdentical: row.sourceAnalysisHash === controlledAfter.rows[i].sourceAnalysisHash,
    results: row.results.map((run, j) => ({ intensity: run.intensity, displayedTextOrderIdentical: eq(texts(run), texts(controlledAfter.rows[i].results[j])),
      displayed: displayed(run).map(candidate => ({ id: candidate.id, text: candidate.text, displayedOrdinal: candidate.displayedOrdinal, changeCategories: candidate.changeCategories, verificationStatus: candidate.verificationStatus, scores: candidate.scores })),
      poolCount: run.candidates.length, poolSha256: digest(JSON.stringify(run.candidates)), diagnosticEventCount: run.diagnosticEvents?.length ?? 0,
      fallback: run.fallback, shortfallReason: run.shortfallReason, error: run.error ?? null })) }));
  let chunk = [], part = 1;
  for (const row of rows) {
    if (chunk.length && Buffer.byteLength(JSON.stringify([...chunk, row], null, 2)) > 43000) { write(`production-smoke-${part++}.json`, chunk); chunk = []; }
    chunk.push(row);
  }
  if (chunk.length) write(`production-smoke-${part}.json`, chunk);
  summary.productionSmoke = { datasetId: smoke.meta.datasetId, sameFrozenEngine: sameEngines, allSourceAnalysesIdentical: rows.every(row => row.sourceAnalysisIdentical),
    summary: stats(smoke.rows, smoke.meta.settings.intensities),
    displayedTextOrderDifferences: rows.filter(row => row.results.some(run => !run.displayedTextOrderIdentical)).map(row => row.id),
    scope: 'Separate final-production-asset smoke on the35 regression sources only; not pooled into the fixed-asset comparison or heldout evaluation. Full displayed outputs retained; repeated nondisplayed pool bodies represented by hashes.' };
}
// Avoid a self-referential hash in the index.
fs.writeFileSync(path.join(folder, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ output: folder, suites: Object.fromEntries(Object.entries(summary.suites).map(([name, suite]) => [name, { cases: suite.after.cases, changed: suite.changedCaseIds.length, unchanged: suite.unchangedCaseIds.length }])), compositionVariants: Object.fromEntries(['lexicalOnly', 'reasonOnly', 'combined'].map(key => [key, !!summary.compositionDemo.after[key]])), artifacts: files.length }));
