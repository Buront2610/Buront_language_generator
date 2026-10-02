'use strict';
// Make bounded, versioned evidence chunks from actual before/after audit runs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = Object.fromEntries(process.argv.slice(2).map((value, index, values) => value.startsWith('--') ? [value.slice(2), values[index + 1]] : []).filter(item => item.length));
for (const name of ['before', 'after', 'out']) if (!args[name]) throw new Error(`Missing --${name}`);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const before = read(args.before), after = read(args.after), smoke = args.smoke ? read(args.smoke) : undefined;
const folder = path.resolve(args.out);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const texts = run => run.displayed?.map(candidate => candidate.text) ?? [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const compactRun = run => {
  if (run.error) return { intensity: run.intensity, error: run.error };
  return {
    intensity: run.intensity,
    selectedCandidateId: run.selectedCandidateId,
    displayed: run.displayed.map(candidate => {
      const { checks, ...rest } = candidate;
      return { ...rest, checkCount: checks.length, nonPassingChecks: checks.filter(check => !check.endsWith(':pass')) };
    }),
    fallback: run.fallback,
    shortfallReason: run.shortfallReason,
    poolCount: run.poolCount,
    poolConstructionCount: run.poolConstructionCount,
    verifiedCount: run.semanticVerification?.verifiedCount,
    selectionHash: run.semanticVerification?.selectionHash,
  };
};
function stats(rows) {
  return Object.fromEntries(['ordinary', 'positive_control', 'abstention_control', 'targeted_regression'].map(group => {
    const selected = rows.filter(row => row.group === group);
    return [group, {
      cases: selected.length,
      byIntensity: [2, 3].map(intensity => {
        const runs = selected.map(row => row.results.find(run => run.intensity === intensity)).filter(Boolean);
        const candidates = runs.flatMap(run => run.displayed ?? []);
        return {
          intensity,
          displayedCandidates: candidates.length,
          displayedConstructions: candidates.filter(candidate => candidate.operator === 'CONSTRUCTION').length,
          casesWithDisplayedConstruction: runs.filter(run => run.displayed?.some(candidate => candidate.operator === 'CONSTRUCTION')).length,
          displayedDiscourseConstructions: candidates.filter(candidate => /(?:explicit-(?:reason|contrast)|modest-achievement)-frame/u.test(candidate.family)).length,
          zeroCandidateCases: runs.filter(run => !run.error && !run.displayed.length).length,
          casesWithFewerThanThree: runs.filter(run => !run.error && run.displayed.length < 3).length,
          literalKaraDakaraNaOccurrences: candidates.filter(candidate => /からだからな/u.test(candidate.text)).length,
          allDisplayedVerified: candidates.every(candidate => candidate.verificationStatus === 'passed'),
          allDisplayedSQNull: candidates.every(candidate => candidate.scores.S === null && candidate.scores.Q === null),
          errors: selected.filter(row => row.error).length + runs.filter(run => run.error).length,
        };
      }),
      sameTextOrderAtBothIntensities: selected.filter(row => eq(texts(row.results[0] ?? {}), texts(row.results[1] ?? {}))).length,
    }];
  }));
}
const rows = before.rows.map((old, index) => {
  const next = after.rows[index];
  if (old.id !== next?.id || old.source !== next?.source || old.group !== next?.group) throw new Error(`Case/order mismatch: ${old.id}`);
  return {
    id: old.id,
    group: old.group,
    category: old.category,
    source: old.source,
    sourceAnalysisIdentical: old.sourceAnalysisHash === next.sourceAnalysisHash,
    results: old.results.map((run, i) => ({ intensity: run.intensity, displayedTextOrderChanged: !eq(texts(run), texts(next.results[i])), before: compactRun(run), after: compactRun(next.results[i]) })),
  };
});
const controlled = {
  sameDataset: before.meta.datasetId === after.meta.datasetId,
  sameAssetBytes: before.meta.assetFileHash === after.meta.assetFileHash,
  sameSettings: eq(before.meta.settings, after.meta.settings),
  sameInputsAndOrder: before.meta.inputSetHash === after.meta.inputSetHash,
  sameParserVersion: eq(before.meta.parser, after.meta.parser),
  allSourceAnalysesIdentical: rows.every(row => row.sourceAnalysisIdentical),
  stableBeforeAndAfterEngines: before.meta.stableEngine && after.meta.stableEngine,
};
if (Object.values(controlled).some(value => !value)) throw new Error(`Uncontrolled comparison: ${JSON.stringify(controlled)}`);
fs.mkdirSync(folder, { recursive: true });
for (const name of fs.readdirSync(folder)) if (/^(?:comparison-(?:ordinary|positive_control|abstention_control|targeted_regression)|production-smoke)-\d+\.json$/u.test(name)) fs.unlinkSync(path.join(folder, name));
const write = (filename, value) => {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > 45_000) throw new Error(`Evidence file exceeds 45KB: ${filename}`);
  fs.writeFileSync(path.join(folder, filename), text);
  return { file: filename, bytes: Buffer.byteLength(text), sha256: sha256(text) };
};
const files = [];
for (const [phase, run] of [['before', before], ['after', after], ...(smoke ? [['production-smoke', smoke]] : [])]) files.push(write(`${phase}-metadata.json`, run.meta));
function chunks(items, prefix) {
  let buffer = [], part = 1;
  for (const item of items) {
    if (Buffer.byteLength(JSON.stringify([...buffer, item], null, 2)) > 43_000 && buffer.length) {
      files.push(write(`${prefix}-${part++}.json`, buffer)); buffer = [];
    }
    buffer.push(item);
  }
  if (buffer.length) files.push(write(`${prefix}-${part}.json`, buffer));
}
// Each group is kept separate and each case stays in authored order.
for (const group of ['ordinary', 'positive_control', 'abstention_control', 'targeted_regression']) chunks(rows.filter(row => row.group === group), `comparison-${group}`);
if (smoke) chunks(smoke.rows.map(row => ({ id: row.id, group: row.group, source: row.source, results: row.results.map(compactRun) })), 'production-smoke');
const summary = {
  generatedAt: new Date().toISOString(),
  method: 'Controlled regression comparison plus separately labeled current-dataset smoke. Actual displayed outputs; no human preference/style quality ratings.',
  controlled,
  before: stats(before.rows),
  after: stats(after.rows),
  changedCases: rows.filter(row => row.results.some(run => run.displayedTextOrderChanged)).map(row => row.id),
  productionSmoke: smoke ? { datasetId: smoke.meta.datasetId, sameTestedRevisionAsControlledAfter: smoke.meta.testedRevision === after.meta.testedRevision, sameEngineHashesAsControlledAfter: eq(smoke.meta.engineHashesStart, after.meta.engineHashesStart), stableEngine: smoke.meta.stableEngine, summary: stats(smoke.rows), textOrderDifferentFromControlledAfter: smoke.rows.filter((row, i) => row.results.some((run, j) => !eq(texts(run), texts(after.rows[i].results[j])))).map(row => row.id) } : null,
  artifactFiles: files,
};
write('comparison-summary.json', summary);
console.log(JSON.stringify({ summary: path.join(folder, 'comparison-summary.json'), changedCases: summary.changedCases, files: files.length }));
