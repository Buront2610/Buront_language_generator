'use strict';
// Frozen-engine behavioral audit. Source parsing is real GiNZA; bounded rewrite
// and construction proofs rebind to the original IR, not a learned quality score.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const args = Object.fromEntries(process.argv.slice(2).map((value, i, all) => value.startsWith('--') ? [value.slice(2), all[i + 1]] : []).filter(item => item.length));
for (const name of ['engine-root', 'assets', 'cases', 'out', 'revision']) if (!args[name]) throw new Error(`Missing --${name}`);
const root = path.resolve(args['engine-root']), assetPath = path.resolve(args.assets), casesPath = path.resolve(args.cases), output = path.resolve(args.out);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const inputSet = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const { PythonClient } = require(path.join(root, 'dist/packages/runtime/python-client'));
const { loadAssets } = require(path.join(root, 'dist/packages/core/assets'));
const { generate } = require(path.join(root, 'dist/packages/core/engine'));
const { verifyGeneratedResult } = require(path.join(root, 'dist/packages/runtime/semantic-verification'));
const { rewriteRuleById, permitsRewrite } = require(path.join(root, 'dist/packages/core/rewrite-rules'));
const { validateRewrite } = require(path.join(root, 'dist/packages/core/rewrite-validation'));
const { makeConstructionPlans, validateConstruction } = require(path.join(root, 'dist/packages/core/constructions'));
const { realize, validateCandidate, verification } = require(path.join(root, 'dist/packages/core/validator'));
const CATEGORIES = ['person_punctuation', 'ending', 'lexical', 'discourse_marker', 'clause_structure'];
function engineHashes() {
  const files = [];
  const walk = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory() && !['generated', '__pycache__'].includes(item.name)) walk(file);
      else if (item.isFile() && /\.(?:js|py|json)$/u.test(item.name)) files.push(file);
    }
  };
  for (const folder of ['dist/packages', 'services/japanese-analysis']) walk(path.join(root, folder));
  return Object.fromEntries(files.sort().map(file => [path.relative(root, file), digest(fs.readFileSync(file))]));
}
function editCategory(edit) {
  if (edit.constructionId) return ['explicit-reason', 'explicit-contrast'].includes(edit.constructionId) ? 'discourse_marker' : 'clause_structure';
  if (/^(?:narrator-|punctuation-)/u.test(edit.ruleId)) return 'person_punctuation';
  return edit.ruleId.startsWith('ending-') ? 'ending' : 'lexical';
}
function summarizeCandidate(candidate, ir, selected, ordinal, pre) {
  const program = candidate.plan;
  const edits = [...(program.rewrite?.edits ?? []), ...(program.construction?.lexicalEdits ?? []), ...(program.construction?.edits ?? [])].map(edit => ({
    kind: editCategory(edit), ruleId: edit.ruleId ?? null, constructionId: edit.constructionId ?? null,
    nodeId: edit.nodeId, sourceSpan: edit.sourceSpan, from: edit.from, to: edit.to,
    ...(edit.bindings ? { bindings: edit.bindings } : {}),
    ...(edit.relation ? { relation: edit.relation } : {}),
    ...(edit.operation ? { operation: edit.operation } : {}),
    ...(edit.features ? { preservedFeatures: edit.features } : {}),
    evidenceIds: edit.evidenceIds,
  }));
  const constructions = program.construction?.edits ?? [];
  const lexical = (program.rewrite?.edits ?? program.construction?.lexicalEdits ?? []).filter(edit => editCategory(edit) === 'lexical');
  const reasons = constructions.filter(edit => edit.constructionId === 'explicit-reason');
  const lexicalPermission = lexical.map(edit => {
    const node = program.nodes.find(node => node.id === edit.nodeId), rule = rewriteRuleById.get(edit.ruleId);
    return { ruleId: edit.ruleId, sourceSpan: edit.sourceSpan, independentlyPermitted: !!node?.sourceSpan && !!rule && permitsRewrite(ir, node.sourceSpan, edit.sourceSpan, rule) };
  });
  const key = `${candidate.id}:${program.id}`;
  const state = candidate.verificationStatus !== 'passed' ? 'verification_rejected' : selected.has(key) ? 'selected' : 'not_selected';
  return {
    id: candidate.id, planId: program.id, text: candidate.text, operator: program.mainOperator, family: program.family,
    displayedOrdinal: ordinal.get(key) ?? null, isTopSelection: ordinal.get(key) === 1,
    finalStage: state, preVerificationStatus: pre.get(key)?.status ?? null,
    verificationStatus: candidate.verificationStatus, scores: candidate.scores,
    checkCount: candidate.checks.length,
    nonPassingChecks: candidate.checks.filter(check => check.status !== 'pass').map(check => ({ code: check.code, status: check.status, required: check.required })),
    changeCategories: CATEGORIES.filter(kind => edits.some(edit => edit.kind === kind)), edits,
    constructionIds: [...new Set(constructions.map(edit => edit.constructionId))],
    lexicalPermission,
    standaloneRewriteProof: program.rewrite ? validateRewrite(ir, program, new Map(candidate.evidence.map(item => [item.id, item.text]))) : null,
    composition: {
      lexicalOnly: lexical.length > 0 && constructions.length === 0,
      reasonOnly: reasons.length > 0 && constructions.length === reasons.length && (program.construction?.lexicalEdits.length ?? 0) === 0,
      lexicalAndReason: lexical.length > 0 && reasons.length > 0,
      // A lexical rule in the original reason binding demonstrates actual
      // region composition rather than unrelated edits in an earlier clause.
      lexicalInsideReason: reasons.some(reason => reason.bindings.some(bound => bound.slot === 'reason' && lexical.some(edit => bound.span.start <= edit.sourceSpan.start && edit.sourceSpan.end <= bound.span.end))),
    },
  };
}
function reasonOnlyAblation(ir, request, assets) {
  const references = new Map(assets.evidence.map(item => [item.id, item.text]));
  return makeConstructionPlans(ir, request, assets, []).filter(plan => plan.construction?.edits.length
    && plan.construction.edits.every(edit => edit.constructionId === 'explicit-reason') && !plan.construction.lexicalEdits.length).map(plan => {
    const rendered = realize(plan, ir);
    const checks = validateCandidate(ir, plan, rendered.text, rendered.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles);
    return { mode: 'isolated_ablation_not_production_candidate', planId: plan.id, text: rendered.text,
      constructionIds: plan.construction.edits.map(edit => edit.constructionId), lexicalEditCount: plan.construction.lexicalEdits.length,
      independentConstructionProof: validateConstruction(ir, plan, references), verificationStatus: verification(checks),
      checks: checks.map(check => ({ code: check.code, status: check.status, required: check.required })),
      displayedOrdinal: null, changeCategories: ['discourse_marker'],
      explanation: 'makeConstructionPlans(originalIR, request, assets, []) excludes rewrite bases. The production finite validator and independently rebound construction proof are applied. This output was not offered to production selection.' };
  });
}

(async () => {
  process.chdir(root);
  const assets = loadAssets(assetPath), python = new PythonClient(root), rows = [];
  const meta = {
    schemaVersion: 1, startedAt: new Date().toISOString(), testedRevision: args.revision,
    testedEngineBuild: JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8')),
    engineHashesStart: engineHashes(), assetFileHash: digest(fs.readFileSync(assetPath)), datasetId: assets.datasetId,
    datasetEngineNote: 'Asset engine metadata is dataset provenance, not the tested engine identity.',
    engineIdentityNote: 'testedRevision and source/module hashes identify the tested code; archive builds can inherit an older toolCommit from tracked build-info.json when .git is absent.',
    inputSetHash: digest(fs.readFileSync(casesPath)), protocol: inputSet.protocol, settings: inputSet.settings, node: process.version,
    method: 'Real GiNZA source analysis; original-source bounded proof for rewrite/construction candidates. All preselection pool candidates and actual displayed order recorded. No learned or human style/quality evaluation.',
    categoryDefinitions: {
      person_punctuation: 'First-person or punctuation/layout rules; line breaks do not count as paragraph restructuring.',
      ending: 'Finite sentence-ending changes.', lexical: 'Other finite lexical substitutions.',
      discourse_marker: 'Reason-prefix insertion or explicit-connective substitution; no clause movement.',
      clause_structure: 'Registered within-clause/clause-form realization (emotion, expiry, modesty); not document reordering.',
    },
  };
  try {
    meta.parser = await python.start();
    for (const item of inputSet.cases) {
      const row = { ...item, results: [] };
      try {
        const analysis = await python.analyze(item.source);
        row.sourceAnalysisHash = digest(JSON.stringify(analysis));
        for (const intensity of inputSet.settings.intensities) {
          try {
            const request = { ...inputSet.settings, source: item.source, intensity };
            delete request.intensities; delete request.experimentalOperators;
            const start = performance.now(), generated = generate(request, analysis, assets), generationMs = performance.now() - start;
            const pool = generated.candidatePool ?? [...generated.candidates, ...generated.reviewCandidates];
            const pre = new Map(pool.map(candidate => [`${candidate.id}:${candidate.plan.id}`, { status: candidate.verificationStatus }]));
            const result = await verifyGeneratedResult(generated, python, analysis);
            const ordinal = new Map(result.candidates.map((candidate, i) => [`${candidate.id}:${candidate.plan.id}`, i + 1]));
            const candidates = pool.map(candidate => summarizeCandidate(candidate, result.ir, new Set(ordinal.keys()), ordinal, pre));
            const diagnosticEvents = result.diagnostics ?? null;
            row.results.push({ intensity, generationMs: +generationMs.toFixed(3), selectedCandidateId: result.selectedCandidateId,
              displayedIds: result.candidates.map(candidate => ({ id: candidate.id, planId: candidate.plan.id })), candidates,
              ...(item.id === 'C01' ? { reasonOnlyAblations: reasonOnlyAblation(result.ir, request, assets) } : {}),
              diagnosticEvents, diagnosticCoverage: diagnosticEvents ? 'engine-instrumented construction attempts and candidate outcomes' : 'baseline-uninstrumented; pre-plan rejection reasons unavailable, not inferred',
              fallback: result.fallback, shortfallReason: result.shortfallReason, semanticVerification: result.replayManifest.semanticVerification });
            console.log(JSON.stringify({ id: item.id, intensity, pool: candidates.length, displayed: result.candidates.length, errors: candidates.filter(candidate => candidate.finalStage === 'verification_rejected').length }));
          } catch (error) { row.results.push({ intensity, error: { message: error.message, validationErrors: error.validationErrors ?? null } }); }
        }
      } catch (error) { row.error = { message: error.message }; }
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
