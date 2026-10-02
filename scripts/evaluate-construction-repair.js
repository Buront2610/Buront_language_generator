'use strict';
// Run after npm run build:engine. This is a bounded behavioral audit, not a
// learned style benchmark or a claim to reproduce the inaccessible 36-case file.
const fs = require('node:fs');
const path = require('node:path');
const { PythonClient } = require('../dist/packages/runtime/python-client');
const { compileAssets } = require('../dist/packages/core/assets');
const { generate } = require('../dist/packages/core/engine');
const { verifyGeneratedResult } = require('../dist/packages/runtime/semantic-verification');
const cases = [
  ['anger_plain', '私の怒りが頂点に達した。'],
  ['anger_polite', '私の怒りが頂点に達しました。'],
  ['anger_topic', '私の怒りは頂点に達した。'],
  ['anger_other_person', '太郎の怒りが頂点に達した。'],
  ['anger_negative', '私の怒りは頂点に達していない。'],
  ['anger_uncertain', '私の怒りが頂点に達するかもしれない。'],
  ['anger_conditional', '私の怒りが頂点に達したら帰る。'],
  ['anger_wrong_domain', '温度が頂点に達した。'],
  ['sadness_person', '私はとても悲しかった。'],
  ['sadness_stimulus', '私は彼の死がとても悲しかった。'],
  ['sadness_uncertain', '多分とても悲しい。'],
  ['sadness_conditional', '来ないととても悲しい。'],
  ['expiry', 'もう時間切れでした。'],
  ['quoted', '太郎は「私の怒りが頂点に達した」と言った。'],
  ['hearsay', '田中によると怒りが頂点に達した。'],
  ['protected_values', '金額は100円以下だ。私の怒りが頂点に達しました。'],
  ['ordinary_adjective', 'この映画は素晴らしい。'],
  ['ordinary_interesting', 'この映画はおもしろい。'],
];
(async () => {
  const python = new PythonClient(), assets = compileAssets(), rows = [];
  try {
    const runtime = await python.start();
    for (const [id, source] of cases) {
      const request = { source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'construction-repair-20261002' };
      const analysis = await python.analyze(source), generated = generate(request, analysis, assets);
      const pool = generated.candidatePool ?? generated.candidates;
      const preVerification = { total: pool.length, passed: pool.filter(item => item.verificationStatus === 'passed').length, constructions: pool.filter(item => item.plan.construction).length };
      const result = await verifyGeneratedResult(generated, python, analysis);
      rows.push({ id, source, preVerification, finalVerifiedCount: result.replayManifest.semanticVerification.verifiedCount, displayed: result.candidates.map(candidate => ({ text: candidate.text, operator: candidate.plan.mainOperator, family: candidate.plan.family, verificationStatus: candidate.verificationStatus, scores: candidate.scores, novelty: candidate.novelty.classification, checkCodes: candidate.checks.map(check => `${check.code}:${check.status}`) })), shortfallReason: result.shortfallReason });
    }
    const folder = path.resolve('artifacts/construction-repair-20261002');
    fs.mkdirSync(folder, { recursive: true });
    const output = { generatedAt: new Date().toISOString(), scope: '18 source-derived behavioral examples; not the inaccessible original 36-case artifact', build: assets.manifest.engine, datasetId: assets.datasetId, dataHashes: assets.manifest.files, parser: runtime, evaluator: assets.manifest.evaluator, qualityJudgment: 'Human style/appropriateness evaluation not performed', rows };
    fs.writeFileSync(path.join(folder, 'examples.json'), JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ cases: rows.length, withDisplayCandidate: rows.filter(row => row.displayed.length).length, withDisplayedConstruction: rows.filter(row => row.displayed.some(item => item.operator === 'CONSTRUCTION')).length, output: path.join(folder, 'examples.json') }));
  } finally { python.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
