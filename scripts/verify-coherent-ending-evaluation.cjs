'use strict';
// Readback verification for compact public artifacts, without rerunning engines.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const root = path.resolve(process.argv[2] ?? 'artifacts/coherent-ending-plans-20261006');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const reports = [];
for (const name of fs.readdirSync(root).filter(name => name.endsWith('-comparison.json.gz')).sort()) {
  const bytes = fs.readFileSync(path.join(root, name)), value = JSON.parse(zlib.gunzipSync(bytes));
  const { beforeMeta: before, afterMeta: after } = value.summary;
  assert(before.stableEngine && after.stableEngine, `${name}: engine mutation`);
  for (const key of ['inputSetHash', 'assetFileHash', 'datasetId', 'evaluationScriptHash', 'settings', 'parser']) assert(same(before[key], after[key]), `${name}: meta mismatch ${key}`);
  for (const meta of [before, after]) assert(digest(JSON.stringify(meta.engineHashes)) === meta.engineHash, `${name}: engine hash manifest mismatch`);
  const seen = new Set(), stats = { before: { requests: 0, candidates: 0, displayed: 0, partialCandidates: 0, partialSelected: 0, partialTop: 0 }, after: { requests: 0, candidates: 0, displayed: 0, partialCandidates: 0, partialSelected: 0, partialTop: 0 } };
  for (const row of value.rows) {
    assert(!seen.has(row.id), `${name}: duplicate case ${row.id}`); seen.add(row.id);
    assert(typeof row.source === 'string' && row.sourceAnalysisHash, `${name}: missing full source or analysis hash`);
    assert(row.results.length === before.settings.intensities.length, `${name}: incomplete intensities ${row.id}`);
    for (const result of row.results) {
      assert(same(result.before.plainTailOpportunities, result.after.plainTailOpportunities) && same(result.opportunities, result.before.plainTailOpportunities), `${name}: opportunity mismatch`);
      assert(result.selectedTextOrderChanged === !same(result.before.selected.map(c => c.text), result.after.selected.map(c => c.text)), `${name}: changed-order flag`);
      for (const side of ['before', 'after']) {
        const run = result[side], total = stats[side]; total.requests++; total.candidates += run.candidates.length; total.displayed += run.selected.length;
        assert(run.intensity === result.intensity && !run.error, `${name}: request error/intensity mismatch`);
        const pool = new Map(run.candidates.map(c => [`${c.id}:${c.planId}`, c]));
        assert(pool.size === run.candidates.length, `${name}: duplicate candidate identity`);
        assert(run.selectedCandidateId === (run.selected[0]?.id ?? null), `${name}: selected ID mismatch`);
        for (const [i, selected] of run.selected.entries()) {
          const candidate = pool.get(`${selected.id}:${selected.planId}`);
          assert(candidate && candidate.text === selected.text && candidate.ordinal === i + 1, `${name}: selected text/order mismatch`);
          assert(candidate.verificationStatus === 'passed' && candidate.allChecksPass, `${name}: selected verification failed`);
        }
        for (const candidate of run.candidates) {
          assert(digest(JSON.stringify(candidate.edits)) === candidate.editSignature, `${name}: edit signature mismatch`);
          assert(candidate.allChecksPass === candidate.checkSignature.every(check => check[1] === 'pass'), `${name}: check summary mismatch`);
          assert(candidate.sqNull && candidate.scores.S === null && candidate.scores.Q === null, `${name}: S/Q unexpectedly trained`);
          assert(candidate.ordinal === null || run.selected[candidate.ordinal - 1]?.planId === candidate.planId, `${name}: invalid ordinal`);
          const coverage = candidate.endingCoverage;
          assert(coverage.eligibleTailCount === run.plainTailOpportunities.length, `${name}: eligible count mismatch`);
          assert(coverage.remainingTailCount === coverage.eligibleTailCount - coverage.overwrittenTailIds.length, `${name}: remaining count mismatch`);
          assert(coverage.remainingTailCount === coverage.convertedTailIds.length + coverage.unchangedTailIds.length, `${name}: tail accounting mismatch`);
          assert(coverage.endingEditCount === coverage.plainEditCount + coverage.insistenceEditCount, `${name}: ending count mismatch`);
          assert(coverage.insistenceOverCap === (coverage.insistenceEditCount > coverage.insistenceCap), `${name}: cap mismatch`);
          if (coverage.classification === 'preserve') assert(!coverage.endingEditCount && !coverage.partialUnchangedTailIds.length, `${name}: preserve misclassified`);
          if (coverage.classification === 'partial') {
            assert(candidate.boundedProof && coverage.endingEditCount > 0 && coverage.partialUnchangedTailIds.length > 0, `${name}: invalid partial metric`);
            total.partialCandidates++; total.partialSelected += Number(candidate.ordinal !== null); total.partialTop += Number(candidate.ordinal === 1);
          }
        }
      }
    }
  }
  for (const side of ['before', 'after']) {
    assert(value.summary[side].cases === value.rows.length, `${name}: case summary mismatch`);
    for (const [key, count] of Object.entries(stats[side])) assert(value.summary[side][key] === count, `${name}: ${side} ${key} summary mismatch`);
  }
  reports.push({ file: name, bytes: bytes.length, sha256: digest(bytes), cases: value.rows.length, before: stats.before, after: stats.after, verified: true });
}
assert(reports.length > 0, 'No compact comparisons found');
console.log(JSON.stringify({ schemaVersion: 1, verified: true, comparisons: reports }, null, 2));
