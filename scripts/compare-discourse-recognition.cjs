'use strict';
// Compare source recognition, not surface program representation. The baseline
// must be an independently built checkout/archive of the named original commit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = path.resolve(process.argv[2] || '/workspace/shared/pr4-baseline-24972be7');
const destination = path.resolve(process.argv[3] || path.join(root, 'artifacts/composable-constructions-20261002/recognition-parity.json'));
const baselineCommit = '24972be7eab0530f7c1e895d4912dca7cc258209';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const files = ['packages/core/discourse-constructions.ts', 'packages/core/grammar-scope.ts', 'packages/core/facts.ts'];
const sourceDigests = files.map(file => {
  const archived = fs.readFileSync(path.join(baseline, file));
  const original = execFileSync('git', ['show', `${baselineCommit}:${file}`], { cwd: root });
  if (!archived.equals(original)) throw new Error(`Baseline source differs from ${baselineCommit}: ${file}`);
  return { file, before: sha256(archived), after: sha256(fs.readFileSync(path.join(root, file))) };
});

function recognize(directory, source, analysis, intensity) {
  const moduleAt = name => require(path.join(directory, 'dist/packages/core', name));
  const ir = moduleAt('facts').extractFacts(moduleAt('source').sourceDocument(source), analysis, { source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity, series: 'all', backend: 'structured', clientRevision: 0, seed: 'recognition-parity' });
  const narrative = moduleAt('planning').planNarrative(ir, 'source_order');
  const bind = moduleAt('discourse-constructions').createDiscourseBinder(ir, moduleAt('grammar-scope').propositionScopes(ir.source, ir));
  return narrative.units.flatMap((unit, index) => bind({ id: `fact-node-${index}`, type: 'FactClause', sourceSpan: unit.sourceSpan, text: moduleAt('source').slice(source, unit.sourceSpan), factIds: unit.factIds, evidenceIds: [] }, intensity)).map(edit => ({ nodeId: edit.nodeId, kind: edit.constructionId, factId: edit.factId, bindings: edit.bindings }));
}

function compare(filenames, intensities) {
  const rows = [];
  for (const filename of filenames) {
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures', filename), 'utf8'));
    for (const [index, { source, analysis }] of fixture.cases.entries()) for (const intensity of intensities) {
      const before = recognize(baseline, source, analysis, intensity), after = recognize(root, source, analysis, intensity);
      const signature = value => JSON.stringify(value);
      const retained = before.filter(value => after.some(other => signature(value) === signature(other)));
      const added = after.filter(value => !before.some(other => signature(value) === signature(other)));
      const removed = before.filter(value => !after.some(other => signature(value) === signature(other)));
      rows.push({ fixture: filename, index, source, intensity, status: !added.length && !removed.length ? 'unchanged' : 'changed', before, after, retainedCount: retained.length, added, removed });
    }
  }
  return { inputCount: rows.length / intensities.length, comparisonCount: rows.length, unchangedComparisonCount: rows.filter(row => row.status === 'unchanged').length,
    changedComparisonCount: rows.filter(row => row.status === 'changed').length, retainedRelationCount: rows.reduce((count, row) => count + row.retainedCount, 0),
    addedRelationCount: rows.reduce((count, row) => count + row.added.length, 0), removedRelationCount: rows.reduce((count, row) => count + row.removed.length, 0), rows };
}

const originalFilenames = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineCommit, '--', 'test/fixtures'], { cwd: root, encoding: 'utf8' }).trim().split('\n').map(file => path.basename(file)).filter(file => /^ginza-.*\.json$/.test(file));
const original = compare(originalFilenames, [2, 3]);
const deliberateExceptions = compare(['ginza-discourse-past.json', 'ginza-discourse-context-boundaries.json', 'ginza-discourse-desire.json'], [3]);
const result = { baselineCommit, command: `node scripts/compare-discourse-recognition.cjs ${baseline} ${path.relative(root, destination)}`, sourceDigests,
  comparison: 'construction kind, fact ID, node ID, and all original source bindings including spans/text/token IDs; excludes changed version/output/prefix sourceSpan and new proof payload',
  exceptionScope: ['Voiced past AUX recognition accepts lemma だ only when Inflection is exactly 助動詞-タ, shared with fact extraction', 'Whitespace-only immediate antecedents are rejected rather than skipped, closing a scope bypass; no broader relation inference', 'A predicate-owned desire AUX たい or Inflection 助動詞-タイ cannot license a modest-achievement frame even with genuine past AUX; this preexisting hole was found by independent source review, not held-out evaluation'], original, deliberateExceptions };
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
for (const [label, summary] of Object.entries({ original, deliberateExceptions })) { const { rows, ...counts } = summary; console.log(label, counts); }
console.log(path.relative(root, destination));
if (original.changedComparisonCount) process.exitCode = 1;
