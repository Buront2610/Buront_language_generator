'use strict';
// Batch adapter around the unchanged production engine. The research backend never
// registers a rule and never inherits the baseline's verification status.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(process.argv[2]);
const inputs = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const destination = path.resolve(process.argv[4]);
if (fs.existsSync(destination)) throw new Error('OUTPUT_ALREADY_EXISTS');
const { PythonClient } = require(path.join(root, 'dist/packages/runtime/python-client'));
const { compileAssets } = require(path.join(root, 'dist/packages/core/assets'));
const { generate } = require(path.join(root, 'dist/packages/core/engine'));
const { unsupportedGenerationMode } = require(path.join(root, 'dist/packages/core/capabilities'));
const { verifyGeneratedResult } = require(path.join(root, 'dist/packages/runtime/semantic-verification'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fileHashes(dir) {
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).filter(p => p.endsWith('.js')).sort().map(p => [p, hash(fs.readFileSync(path.join(dir,p)))]));
}
(async () => {
  process.chdir(root);
  const assets = compileAssets();
  const python = new PythonClient(root);
  const before = fileHashes(path.join(root,'dist/packages'));
  const result = { schema_version: 1, backend: 'unchanged-structured-baseline', adapter_sha256:hash(fs.readFileSync(__filename)), revision: cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), engine_hashes:before, asset_id:assets.datasetId, source_hash:assets.manifest.engine?.sourceHash, inputs:[] };
  const summary = c => ({ id:c.id,text:c.text,verificationStatus:c.verificationStatus,checks:c.checks,scores:c.scores });
  try {
    result.parser = await python.start();
    for (const source of inputs) {
      const request = {source,task:'rewrite',contextMode:'faithful',noveltyMode:'blend',intensity:2,series:'all',backend:'structured',clientRevision:1,seed:'statistical-research-comparison-v1'};
      if (unsupportedGenerationMode(request)) throw new Error("BASELINE_UNSUPPORTED_MODE");
      const analysis = await python.analyze(source);
      const generated = generate(request,analysis,assets);
      const pool = generated.candidatePool ?? generated.candidates;
      const verified = await verifyGeneratedResult(generated,python,analysis);
      if (verified.fallback?.reason === "unsupported_generation_mode" || verified.shortfallReason === "unsupported_generation_mode") throw new Error("BASELINE_UNSUPPORTED_MODE");
      result.inputs.push({source,request,displayed:verified.candidates.map(summary),candidate_pool:pool.map(summary),fallback:verified.fallback});
    }
    if (JSON.stringify(before) !== JSON.stringify(fileHashes(path.join(root,'dist/packages')))) throw new Error('BASELINE_CHANGED_DURING_COMPARISON');
    fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  } finally { python.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
