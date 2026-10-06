'use strict';
// Verify every indexed evidence chunk and reconstruct pool/display counts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const folder = path.resolve(process.argv[2] ?? 'artifacts/composable-constructions-20261002');
const summary = JSON.parse(fs.readFileSync(path.join(folder, 'summary.json'), 'utf8'));
let recordCount = 0;
for (const file of summary.artifactFiles) {
  const text = fs.readFileSync(path.join(folder, file.file));
  assert.equal(text.length, file.bytes, file.file);
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), file.sha256, file.file);
  if (/-comparison-\d+\.json$/u.test(file.file)) assert.ok(text.length < 45000, `Chunk too large: ${file.file}`);
}
for (const [suite, stats] of Object.entries(summary.suites)) {
  assert.ok(Object.values(stats.controlled).every(Boolean), `Uncontrolled suite ${suite}`);
  const records = summary.artifactFiles.filter(file => file.file.startsWith(`${suite}-comparison-`)).flatMap(file => JSON.parse(fs.readFileSync(path.join(folder, file.file), 'utf8')));
  recordCount += records.length;
  assert.equal(records.filter(record => record.type === 'input').length, stats.after.cases, suite);
  for (const phase of ['before', 'after']) for (const expected of stats[phase].byIntensity) {
    const candidates = records.filter(record => record.type === 'candidate' && record.phase === phase && record.intensity === expected.intensity).map(record => record.candidate);
    const displayed = candidates.filter(candidate => candidate.displayedOrdinal !== null);
    assert.equal(candidates.length, expected.poolCandidates, `${suite}/${phase}/pool`);
    assert.equal(displayed.length, expected.displayedCandidates, `${suite}/${phase}/display`);
    assert.ok(displayed.every(candidate => candidate.verificationStatus === 'passed'), `${suite}/${phase}/verification`);
    assert.ok(candidates.every(candidate => candidate.scores.S === null && candidate.scores.Q === null), `${suite}/${phase}/untrained`);
    assert.ok(candidates.every(candidate => candidate.lexicalPermission.every(edit => edit.independentlyPermitted)), `${suite}/${phase}/lexical-permission`);
  }
}
const heldout = JSON.parse(fs.readFileSync(path.join(folder, 'holdout-seal.json'), 'utf8'));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, 'heldout-cases.json'))).digest('hex'), heldout.heldoutFileSha256, 'Heldout seal');
const freeze = JSON.parse(fs.readFileSync(path.join(folder, 'code-freeze.json'), 'utf8'));
assert.equal(freeze.heldoutFileSha256, heldout.heldoutFileSha256, 'Heldout frozen identity');
const after = JSON.parse(fs.readFileSync(path.join(folder, 'heldout-after-metadata.json'), 'utf8'));
assert.ok(Date.parse(heldout.authoredAt) < Date.parse(freeze.frozenAt), 'Seal predates freeze');
assert.ok(Date.parse(freeze.frozenAt) < Date.parse(after.startedAt), 'Freeze predates heldout execution');
assert.equal(after.testedEngineBuild.sourceHash, freeze.build.sourceHash, 'Frozen build identity');
console.log(JSON.stringify({ verified: true, indexedFiles: summary.artifactFiles.length, typedRecords: recordCount, sourceHash: freeze.build.sourceHash, heldoutHash: heldout.heldoutFileSha256 }));
