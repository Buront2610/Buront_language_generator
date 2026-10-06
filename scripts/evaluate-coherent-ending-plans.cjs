'use strict';
// Compact frozen-engine audit derived from evaluate-composable-constructions.cjs.
// This measures source-bound ending coverage, never naturalness or human quality.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');
const args = Object.fromEntries(process.argv.slice(2).flatMap((value, i, all) => value.startsWith('--') ? [[value.slice(2), all[i + 1]]] : []));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file, 'utf8'));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const text = JSON.stringify(data) + '\n'; fs.writeFileSync(file, file.endsWith('.gz') ? zlib.gzipSync(text, { level: 9 }) : text); };
const overlap = (a, b) => a.start < b.end && b.start < a.end;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const METHODS = {
  scope: 'Finite source-bound rewrite/construction candidates only; no human naturalness/style/quality claim. Other candidate families are recorded but their ending metric is not applicable.',
  opportunities: 'Independently enumerate plain ending rules from original IR source-order narrative units, fixed evidence, series and intensity. Require from != to and permitsRewrite(originalIR, unit, span, rule). Overlapping alternative plain rules represent one tail site. No output substring heuristic or planner-derived edits define eligibility.',
  exclusions: 'Remove a tail site only when it overlaps a nonzero-width independently permitted non-ending edit or independently revalidated construction replacement. Prefix insertions do not remove sites. Protected/quoted/uncertain/unsupported polite text is absent from eligibility, not counted as failure.',
  partial: 'For an independently validated source-bound candidate with at least one explicit ending edit, count remaining eligible tail sites with no ending edit. A positive count is partial conversion. Candidates with no explicit ending edit are preserve/not-applicable, including construction-only choices. All counts are structural diagnostics, not a quality ranking.',
  attribution: 'Rules and permission/validation functions are production source-bound guards independently rerun from original IR, not an independently implemented linguistic oracle. Candidate validity is checked separately from coverage.',
};
function stats(rows) {
  const totals = { cases: rows.length, requests: 0, errors: 0, candidates: 0, displayed: 0, noDisplay: 0, fewerThanThree: 0, rejected: 0, nonNullSQ: 0, nonPassingSelected: 0, invalidBoundedProofs: 0, illegalEndingEdits: 0, insistenceCapViolations: 0, endingEditedCandidates: 0, preserveCandidates: 0, partialCandidates: 0, partialSelected: 0, partialTop: 0, remainingEligibleTailsLeftOriginal: 0, excludedOverwrittenTailSites: 0 };
  for (const row of rows) {
    if (row.error) totals.errors++;
    for (const result of row.results) {
      totals.requests++;
      if (result.error) { totals.errors++; continue; }
      totals.displayed += result.selected.length;
      totals.noDisplay += Number(!result.selected.length);
      totals.fewerThanThree += Number(result.selected.length < 3);
      for (const candidate of result.candidates) {
        totals.candidates++;
        totals.rejected += Number(candidate.verificationStatus !== 'passed');
        totals.nonNullSQ += Number(!candidate.sqNull);
        totals.nonPassingSelected += Number(candidate.ordinal !== null && !candidate.allChecksPass);
        totals.invalidBoundedProofs += Number(candidate.boundedProof === false);
        totals.illegalEndingEdits += candidate.endingCoverage.illegalEndingEditCount;
        totals.insistenceCapViolations += Number(candidate.endingCoverage.insistenceOverCap);
        totals.endingEditedCandidates += Number(candidate.endingCoverage.classification === 'complete' || candidate.endingCoverage.classification === 'partial');
        totals.preserveCandidates += Number(candidate.endingCoverage.classification === 'preserve');
        totals.partialCandidates += Number(candidate.endingCoverage.classification === 'partial');
        totals.partialSelected += Number(candidate.ordinal !== null && candidate.endingCoverage.classification === 'partial');
        totals.partialTop += Number(candidate.ordinal === 1 && candidate.endingCoverage.classification === 'partial');
        totals.remainingEligibleTailsLeftOriginal += candidate.endingCoverage.partialUnchangedTailIds.length;
        totals.excludedOverwrittenTailSites += candidate.endingCoverage.overwrittenTailIds.length;
      }
    }
  }
  return totals;
}
function compare() {
  for (const name of ['before', 'after', 'out']) if (!args[name]) throw new Error(`Missing --${name}`);
  const before = read(args.before), after = read(args.after);
  for (const name of ['inputSetHash', 'assetFileHash', 'datasetId', 'evaluationScriptHash']) if (before.meta[name] !== after.meta[name]) throw new Error(`Comparison mismatch: ${name}`);
  if (!before.meta.stableEngine || !after.meta.stableEngine) throw new Error('Unstable engine snapshot');
  for (const name of ['settings', 'parser']) if (!equal(before.meta[name], after.meta[name])) throw new Error(`Comparison mismatch: ${name}`);
  const map = new Map(before.rows.map(row => [row.id, row]));
  if (map.size !== before.rows.length || before.rows.length !== after.rows.length) throw new Error('Case IDs/count mismatch');
  const rows = after.rows.map(right => {
    const left = map.get(right.id);
    if (!left || left.source !== right.source || left.sourceAnalysisHash !== right.sourceAnalysisHash) throw new Error(`Input/parser mismatch: ${right.id}`);
    if (left.error || right.error) return { id: right.id, source: right.source, before: left, after: right };
    return { ...Object.fromEntries(Object.entries(right).filter(([key]) => key !== 'results')), results: right.results.map(a => {
      const b = left.results.find(item => item.intensity === a.intensity);
      if (!b) throw new Error(`Missing intensity: ${right.id}/${a.intensity}`);
      if (!a.error && !b.error && !equal(b.plainTailOpportunities, a.plainTailOpportunities)) throw new Error(`Eligibility changed: ${right.id}/${a.intensity}`);
      return { intensity: a.intensity, opportunities: a.plainTailOpportunities, selectedTextOrderChanged: !equal(b.selected?.map(c => c.text), a.selected?.map(c => c.text)), before: b, after: a };
    }) };
  });
  const summary = { schemaVersion: 1, method: METHODS, before: stats(before.rows), after: stats(after.rows), selectedTextOrderChangedRequests: rows.flatMap(row => row.results ?? []).filter(result => result.selectedTextOrderChanged).length, beforeMeta: before.meta, afterMeta: after.meta };
  write(path.resolve(args.out), { schemaVersion: 1, summary, rows });
  if (args.summary) write(path.resolve(args.summary), summary);
  console.log(JSON.stringify({ output: path.resolve(args.out), bytes: fs.statSync(args.out).size, before: summary.before, after: summary.after, selectedTextOrderChangedRequests: summary.selectedTextOrderChangedRequests }));
}
async function evaluate() {
  for (const name of ['engine-root', 'assets', 'cases', 'out', 'revision']) if (!args[name]) throw new Error(`Missing --${name}`);
  const root = path.resolve(args['engine-root']), assetPath = path.resolve(args.assets), casesPath = path.resolve(args.cases), output = path.resolve(args.out);
  const inputSet = read(casesPath);
  const { PythonClient } = require(path.join(root, 'dist/packages/runtime/python-client'));
  const { loadAssets } = require(path.join(root, 'dist/packages/core/assets'));
  const { generate } = require(path.join(root, 'dist/packages/core/engine'));
  const { verifyGeneratedResult } = require(path.join(root, 'dist/packages/runtime/semantic-verification'));
  const { rewriteRules, rewriteRuleById, permitsRewrite } = require(path.join(root, 'dist/packages/core/rewrite-rules'));
  const { validateRewrite } = require(path.join(root, 'dist/packages/core/rewrite-validation'));
  const { validateConstruction } = require(path.join(root, 'dist/packages/core/constructions'));
  const { planNarrative } = require(path.join(root, 'dist/packages/core/planning'));
  const { slice } = require(path.join(root, 'dist/packages/core/source'));
  function engineHashes() {
    const files = [];
    const walk = directory => { for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory() && !['generated', '__pycache__'].includes(item.name)) walk(file); else if (item.isFile() && /\.(?:js|ts|py|json)$/u.test(item.name)) files.push(file); } };
    for (const folder of ['packages', 'dist/packages', 'services/japanese-analysis']) walk(path.join(root, folder));
    return Object.fromEntries(files.sort().map(file => [path.relative(root, file), digest(fs.readFileSync(file))]));
  }
  process.chdir(root);
  const assets = loadAssets(assetPath), evidence = new Map(assets.evidence.map(item => [item.id, item]));
  function available(rule, request) {
    const item = evidence.get(rule.evidenceId);
    return rule.level <= request.intensity && item?.sourceType === 'original_post' && item.text.includes(rule.needle) && (rule.kind !== 'punctuation' || !item.text.includes('。')) && (request.series === 'all' || item.series.includes(request.series));
  }
  function opportunities(ir, request) {
    const found = [];
    for (const [index, unit] of planNarrative(ir, 'source_order').units.entries()) {
      const text = slice(ir.source.raw, unit.sourceSpan);
      for (const rule of rewriteRules.filter(rule => rule.kind === 'ending' && rule.mode === 'plain' && rule.from !== rule.to && available(rule, request))) {
        let offset = 0, at;
        while ((at = text.indexOf(rule.from, offset)) >= 0) {
          offset = at + rule.from.length;
          const start = unit.sourceSpan.start + [...text.slice(0, at)].length, sourceSpan = { start, end: start + [...rule.from].length };
          if (permitsRewrite(ir, unit.sourceSpan, sourceSpan, rule)) found.push({ nodeId: `fact-node-${index}`, sourceSpan, ruleId: rule.id, from: rule.from, to: rule.to });
        }
      }
    }
    const sites = [];
    for (const item of found.sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || b.sourceSpan.end - a.sourceSpan.end || a.ruleId.localeCompare(b.ruleId))) {
      const site = sites.find(site => site.nodeId === item.nodeId && site.alternatives.some(other => overlap(item.sourceSpan, other.sourceSpan)));
      if (site) site.alternatives.push(item);
      else sites.push({ id: `tail-${sites.length}`, nodeId: item.nodeId, alternatives: [item] });
    }
    return sites;
  }
  function summarizeCandidate(candidate, ir, request, sites, ordinal, pre) {
    const plan = candidate.plan, lexical = plan.rewrite?.edits ?? plan.construction?.lexicalEdits ?? [], constructions = plan.construction?.edits ?? [];
    const references = new Map(candidate.evidence.map(item => [item.id, item.text]));
    const boundedProof = plan.rewrite ? validateRewrite(ir, plan, references) : plan.construction ? validateConstruction(ir, plan, references) : null;
    function legal(edit) {
      const node = plan.nodes.find(node => node.id === edit.nodeId), rule = rewriteRuleById.get(edit.ruleId);
      return !!node?.sourceSpan && !!rule && available(rule, request) && edit.from === rule.from && edit.to === rule.to && equal(edit.evidenceIds, [rule.evidenceId]) && !!references.get(rule.evidenceId)?.includes(rule.needle) && permitsRewrite(ir, node.sourceSpan, edit.sourceSpan, rule);
    }
    const checked = lexical.map(edit => ({ edit, rule: rewriteRuleById.get(edit.ruleId), legal: legal(edit) }));
    const ending = checked.filter(item => item.rule?.kind === 'ending');
    const nonending = checked.filter(item => item.rule?.kind !== 'ending' && item.legal).map(item => item.edit);
    const replacements = [...nonending, ...(boundedProof === true ? constructions.filter(edit => edit.operation?.kind === 'replace') : [])].filter(edit => edit.sourceSpan.start < edit.sourceSpan.end && edit.from !== edit.to);
    const touches = (site, edit) => site.nodeId === edit.nodeId && site.alternatives.some(item => overlap(item.sourceSpan, edit.sourceSpan));
    const overwritten = sites.filter(site => replacements.some(edit => touches(site, edit)));
    const remaining = sites.filter(site => !overwritten.includes(site));
    const converted = remaining.filter(site => ending.some(item => item.legal && touches(site, item.edit)));
    const unchanged = remaining.filter(site => !converted.includes(site));
    const applicable = boundedProof === true && ending.length > 0;
    const insistence = ending.filter(item => item.rule.mode === 'insistence').length;
    const edits = [...lexical.map(edit => ({ ruleId: edit.ruleId, nodeId: edit.nodeId, sourceSpan: edit.sourceSpan, from: edit.from, to: edit.to, evidenceIds: edit.evidenceIds })), ...constructions.map(edit => ({ constructionId: edit.constructionId, operation: edit.operation, nodeId: edit.nodeId, sourceSpan: edit.sourceSpan, from: edit.from, to: edit.to, evidenceIds: edit.evidenceIds }))];
    return { id: candidate.id, planId: plan.id, text: candidate.text, operator: plan.mainOperator, ordinal,
      preVerificationStatus: pre, verificationStatus: candidate.verificationStatus,
      allChecksPass: candidate.checks.every(check => check.status === 'pass'),
      checkSignature: candidate.checks.map(check => [check.code, check.status, check.required]),
      scores: candidate.scores, sqNull: candidate.scores.S === null && candidate.scores.Q === null,
      boundedProof, editSignature: digest(JSON.stringify(edits)), edits,
      endingCoverage: {
        classification: boundedProof === null ? 'not_applicable' : boundedProof === false ? 'invalid_program' : !ending.length ? 'preserve' : unchanged.length ? 'partial' : 'complete',
        eligibleTailCount: sites.length, overwrittenTailIds: overwritten.map(site => site.id), remainingTailCount: remaining.length,
        convertedTailIds: converted.map(site => site.id), unchangedTailIds: unchanged.map(site => site.id),
        partialUnchangedTailIds: applicable ? unchanged.map(site => site.id) : [],
        endingEditCount: ending.length, plainEditCount: ending.filter(item => item.rule.mode === 'plain').length, insistenceEditCount: insistence,
        insistenceCap: request.intensity === 3 ? 2 : 1, insistenceOverCap: insistence > (request.intensity === 3 ? 2 : 1),
        illegalEndingEditCount: ending.filter(item => !item.legal).length,
      } };
  }
  const python = new PythonClient(root), rows = [], initialHashes = engineHashes();
  const meta = { schemaVersion: 1, startedAt: new Date().toISOString(), testedRevision: args.revision,
    testedEngineBuild: read(path.join(root, 'build-info.json')), engineHashes: initialHashes,
    engineHash: digest(JSON.stringify(initialHashes)), assetFileHash: digest(fs.readFileSync(assetPath)), datasetId: assets.datasetId,
    corpusManifest: assets.manifest, inputSetHash: digest(fs.readFileSync(casesPath)), protocol: inputSet.protocol, settings: inputSet.settings,
    evaluationScriptHash: digest(fs.readFileSync(__filename)), node: process.version, method: METHODS,
    provenanceNote: 'Fixed asset manifest engine fields identify dataset provenance, not tested code. Tested revision and source/module hashes identify each engine. Each input set protocol identifies exposed versus sealed provenance.' };
  try {
    meta.parser = await python.start();
    for (const item of inputSet.cases) {
      const row = { ...item, results: [] };
      try {
        const analysis = await python.analyze(item.source); row.sourceAnalysisHash = digest(JSON.stringify(analysis));
        for (const intensity of inputSet.settings.intensities) {
          try {
            const request = { ...inputSet.settings, source: item.source, intensity }; delete request.intensities; delete request.experimentalOperators;
            const started = performance.now(), generated = generate(request, analysis, assets), generationMs = +(performance.now() - started).toFixed(3);
            const pool = generated.candidatePool ?? [...generated.candidates, ...generated.reviewCandidates];
            const pre = new Map(pool.map(candidate => [`${candidate.id}:${candidate.plan.id}`, candidate.verificationStatus]));
            const result = await verifyGeneratedResult(generated, python, analysis), sites = opportunities(result.ir, request);
            const order = new Map(result.candidates.map((candidate, i) => [`${candidate.id}:${candidate.plan.id}`, i + 1]));
            const candidates = pool.map(candidate => summarizeCandidate(candidate, result.ir, request, sites, order.get(`${candidate.id}:${candidate.plan.id}`) ?? null, pre.get(`${candidate.id}:${candidate.plan.id}`)));
            row.results.push({ intensity, generationMs, selectedCandidateId: result.selectedCandidateId,
              selected: result.candidates.map(candidate => ({ id: candidate.id, planId: candidate.plan.id, text: candidate.text })),
              plainTailOpportunities: sites, candidates, fallback: result.fallback, shortfallReason: result.shortfallReason,
              semanticVerification: result.replayManifest.semanticVerification });
            console.log(JSON.stringify({ id: item.id, intensity, candidates: candidates.length, selected: result.candidates.length, eligibleTails: sites.length, partialCandidates: candidates.filter(candidate => candidate.endingCoverage.classification === 'partial').length }));
          } catch (error) { row.results.push({ intensity, error: { message: error.message, validationErrors: error.validationErrors ?? null } }); }
        }
      } catch (error) { row.error = { message: error.message }; }
      rows.push(row); write(output + '.partial', { meta, rows });
    }
    meta.stableEngine = equal(initialHashes, engineHashes()); meta.finishedAt = new Date().toISOString();
    const summary = stats(rows); write(output, { meta, summary, rows }); fs.unlinkSync(output + '.partial');
    console.log(JSON.stringify({ completed: true, stableEngine: meta.stableEngine, output, summary }));
    if (!meta.stableEngine || summary.errors) process.exitCode = 1;
  } finally { python.close(); }
}
(args.before ? Promise.resolve().then(compare) : evaluate()).catch(error => { console.error(error); process.exitCode = 1; });
