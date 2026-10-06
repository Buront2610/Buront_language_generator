'use strict';
const fs = require('node:fs'), path=require('node:path'), assert=require('node:assert/strict'), {performance}=require('node:perf_hooks'), cp=require('node:child_process'), Module=require('node:module');
// Build first. Finite-rule review only; no held-out data or implementation writes.
// node scripts/review-coherent-ending-plans.cjs --output /tmp/review-detail.json.gz
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); if (index < 0) return fallback; if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`); return args[index + 1]; };
if (args.includes('--help')) { console.log('Usage: node scripts/review-coherent-ending-plans.cjs [--root repository] [--baseline git-ref] [--output report.json[.gz]]\nBuild first; PythonClient uses BURONT_PYTHON when set, otherwise the repository .venv.'); process.exit(0); }
for (let i = 0; i < args.length; i += 2) if (!['--root', '--baseline', '--output'].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
const root = path.resolve(option('--root', path.resolve(__dirname, '..')));
const outputFile = path.resolve(option('--output', path.join(root, 'artifacts/coherent-ending-plans-20261006/review-detail.json.gz')));
const baselineRef = option('--baseline', '4d918a56fba7e77c06788baa1cd33817086b5a12');
const save = value => { fs.mkdirSync(path.dirname(outputFile), { recursive: true }); const text = JSON.stringify(value, null, 2) + '\n'; fs.writeFileSync(outputFile, outputFile.endsWith('.gz') ? require('node:zlib').gzipSync(text) : text); };
process.chdir(root);
const reqmod=p=>require(`${root}/dist/packages/${p}`);
const {PythonClient}=reqmod('runtime/python-client'), {compileAssets}=reqmod('core/assets'), {generate}=reqmod('core/engine'), {makeRewritePlans}=reqmod('core/rewrite'), {validateRewrite,renderEdits}=reqmod('core/rewrite-validation'), {rewriteRuleById}=reqmod('core/rewrite-rules'), {sourceDocument,hash,slice}=reqmod('core/source'), {extractFacts}=reqmod('core/facts'), {realize,validateCandidate}=reqmod('core/validator'), {verifyGeneratedResult}=reqmod('runtime/semantic-verification'), {replayGeneration}=reqmod('core/replay');

const original=cp.execFileSync('git',['show',`${baselineRef}:packages/core/rewrite.ts`],{cwd:root,encoding:'utf8'});
const baseline=new Module(`${root}/dist/packages/core/rewrite-review-baseline.js`,module); baseline.filename=`${root}/dist/packages/core/rewrite-review-baseline.js`; baseline.paths=module.paths;baseline._compile(Module.stripTypeScriptTypes(original).replace(/import \{([^}]+)\} from '([^']+)'/g, 'const {$1} = require("$2")').replace('export function makeRewritePlans', 'function makeRewritePlans') + '\nmodule.exports={makeRewritePlans};',baseline.filename);
const makeBaselinePlans=baseline.exports.makeRewritePlans;
const request=(source,intensity=2,extra={})=>({source,task:'rewrite',contextMode:'faithful',noveltyMode:'blend',intensity,series:'all',backend:'structured',clientRevision:0,seed:'independent-ending-review',...extra});
const rows=[
 ['value-copulas','私は確認しました。担当者は連絡しました。料金は500円です。連絡先はtest@example.comです。',['500円','test@example.com']],
 ['value-past-copulas','私は確認しました。担当者は連絡しました。料金は５００円でした。記号はＡＢＣでした。',['５００円','ＡＢＣ']],
 ['real-value-particle','私は確認しました。担当者は連絡しました。私は500円で買いました。私はtest@example.comで確認しました。',['500円で','test@example.comで']],
 ['sushi-particle','私は確認しました。担当者は連絡しました。私は500円ですしを買いました。',['500円ですしを']],
 ['value-comparators','私は確認しました。金額は500円以下です。参加者は１２人です。期限は2026年10月2日です。',['500円以下','１２人','2026年10月2日']],
 ['value-range','私は確認しました。金額は500〜600円です。幅は-1.5kgです。参加者は１０人以上です。',['500〜600円','-1.5kg','１０人以上']],
 ['four-polites','私は速度をアピールしました。担当者は確認しました。会議は終了しました。結果は確実です。',[]],
 ['longer-safe','私は作業を確認しました。担当者は連絡しました。全員が集合しました。確認は完了しました。作業は終了しました。結果は確実です。',[]],
 ['quoted-safe-neighbors','私は確認しました。担当者は連絡しました。田中は「私は確認しませんでした。全員が失敗しました。」と言いました。私は報告しました。',['「私は確認しませんでした。全員が失敗しました。」']],
 ['reported','私は確認しました。担当者は連絡しました。私は失敗しましたと田中が言いました。私は報告しました。',['私は失敗しました']],
 ['reported-at-end','私は確認しました。担当者は連絡しました。田中が成功したと佐藤が言いました。',['田中が成功した']],
 ['uncertain','私は確認しました。担当者は連絡しました。明日は失敗するかもしれません。私は報告しました。',['失敗するかもしれません']],
 ['uncertain-nominal','私は確認しました。担当者は連絡しました。これは失敗かもしれないです。私は報告しました。',['失敗かもしれないです']],
 ['reported-uncertain','私は確認しました。担当者は連絡しました。明日は失敗するそうです。私は報告しました。',['失敗するそうです']],
 ['conditional','私は確認しました。担当者は連絡しました。もし雨なら中止します。私は報告しました。',['もし雨なら中止します']],
 ['question','私は確認しました。担当者は連絡しました。田中が確認しましたか？私は報告しました。',['田中が確認しましたか？']],
 ['request','私は確認しました。担当者は連絡しました。明日確認してください。私は報告しました。',['明日確認してください']],
 ['negative-past','私は確認しませんでした。担当者は連絡していませんでした。会議は開催しません。これは成功ではありません。',[]],
 ['adjective-past','今日は寒かったです。昨日は暑かったです。私は疲れました。担当者が終わりました。',[]],
 ['negative-copula-past','私は確認しました。担当者は連絡しました。これは成功ではありませんでした。問題は簡単ではないです。',[]],
 ['protected-values','私は100件を確認しました。AからBへ３個を渡しました。担当者はhttps://example.com/速度ですを確認しました。連絡先はtest@example.comです。',['100件','AからBへ３個','https://example.com/速度です','test@example.com']],
 ['protected-inline','私は「速度です」を確認しました。私はhttps://example.com/ですを確認しました。私はＡＢＣ_12を確認しました。',['「速度です」','https://example.com/です','ＡＢＣ_12']],
 ['astral-offsets','😀私は確認しました。担当者は連絡しました。𠮷田は100件を確認しました。私は報告しました。',['😀','𠮷田','100件']],
 ['enclosures','私は確認しました。担当者は連絡しました。（私は失敗しました。）私は報告しました。',['（私は失敗しました。）']],
 ['explanatory-causal','私は確認しました。担当者は連絡しました。私はこの方法を選びました。速度が重要だからです。',[]],
 ['split-safe-report','私は確認しました。担当者は連絡しました。私は確認し、田中は失敗したと言いました。私は報告しました。',['失敗したと']],
 ['existing-insistence','私は確認しました。担当者は連絡しました。これは成功だからな。私は報告しました。',['成功だからな']],
 ['newline-units','私は確認しました。\n担当者は連絡しました。\n結果は確実です。\n会議は終了しました。',[]],
 ['long-clauses','私は確認しましたが担当者は連絡しました。会議は終了しましたが結果は確実です。私は報告しました。',[]],
 ['greeting','私は確認しました。担当者は連絡しました。ありがとうございます。私は報告しました。',['ありがとうございます']],
 ['proper-compound','私は確認しました。担当者は連絡しました。私立学校の速度制限を確認しました。全員会議は開催しました。',['私立学校','速度制限','全員会議']],
];
function rebuild(plan,ir){for(const node of plan.nodes){const edits=plan.rewrite.edits.filter(e=>e.nodeId===node.id);node.text=renderEdits(ir.source.raw,node,edits);node.evidenceIds=[...new Set(edits.flatMap(e=>e.evidenceIds))];}plan.evidenceIds=[...new Set(plan.rewrite.edits.flatMap(e=>e.evidenceIds))];}
(async()=>{
 const python=new PythonClient(root), output={schemaVersion:1, baselineRef, startedAt:new Date().toISOString(), versions:null, cases:[], tampering:[],locks:[],performance:[]};
 try{
 await python.start(); output.versions=python.versions;output.diffHash=hash(cp.execFileSync('git',['diff','--','packages/core'],{cwd:root,encoding:'utf8'}));output.buildInfo=JSON.parse(fs.readFileSync(root+'/build-info.json','utf8'));const assets=compileAssets(), references=new Map(assets.evidence.map(e=>[e.id,e.text])),evidenceIds=new Set(references.keys()); const cache=new Map();
 for(const [name,source,preserved] of rows){const analysis=await python.analyze(source);cache.set(source,analysis);for(const intensity of [1,2,3]){const req=request(source,intensity), ir=extractFacts(sourceDocument(source),analysis,req),plans=makeRewritePlans(ir,req,assets),old=makeBaselinePlans(ir,req,assets);const result=await verifyGeneratedResult(generate(req,analysis,assets),python,analysis);let failure=[];for(const plan of plans){if(!validateRewrite(ir,plan,references))failure.push('rewrite-validation');const {text,spans}=realize(plan,ir);if(!validateCandidate(ir,plan,text,spans,evidenceIds,undefined,references,assets.seriesProfiles).every(c=>c.status==='pass'))failure.push('candidate-validation');for(const literal of preserved)if(!text.includes(literal))failure.push(`changed-protected:${literal}`);if(plan.rewrite.edits.filter(e=>rewriteRuleById.get(e.ruleId).mode==='insistence').length>(intensity===3?2:1))failure.push('insistence-budget');}
 const record={name,intensity,source,analysisSentences:analysis.sentences.length,plans:plans.map(p=>({text:p.nodes.map(n=>n.text).join(''),plain:p.rewrite.edits.filter(e=>rewriteRuleById.get(e.ruleId).mode==='plain').length,insistence:p.rewrite.edits.filter(e=>rewriteRuleById.get(e.ruleId).mode==='insistence').length})),selected:result.candidates.map(c=>c.text),old:old.map(p=>p.nodes.map(n=>n.text).join('')),failure};output.cases.push(record);if(failure.length)console.log('FAIL',JSON.stringify(record));}
 console.log('checked',name);
 }
 const source=rows[0][1],analysis=cache.get(source),req=request(source), result=await verifyGeneratedResult(generate(req,analysis,assets),python,analysis),ir=result.ir;
 const allPlain=makeRewritePlans(ir,req,assets).find(p=>p.rewrite.edits.filter(e=>rewriteRuleById.get(e.ruleId).mode==='plain').length>=4&&!p.rewrite.edits.some(e=>rewriteRuleById.get(e.ruleId).mode==='insistence'));assert.ok(allPlain,'must have coherent four-clause plain variant');
 const mutations=[
 ['excess-insistence',p=>{for(const edit of p.rewrite.edits.filter(e=>rewriteRuleById.get(e.ruleId).mode==='plain').slice(0,2)){const rule=[...rewriteRuleById.values()].find(r=>r.mode==='insistence'&&r.from===edit.from);edit.ruleId=rule.id;edit.to=rule.to;}rebuild(p,ir);}],
 ['unknown-rule',p=>{p.rewrite.edits[0].ruleId='ending-plain-9999';}],
 ['fake-neutral-insistence',p=>{const edit=p.rewrite.edits.find(e=>rewriteRuleById.get(e.ruleId).mode==='plain');edit.to+='からな';rebuild(p,ir);}],
 ['source-span',p=>{p.rewrite.edits.at(-1).sourceSpan.start--;rebuild(p,ir);}],
 ['changed-text',p=>{p.nodes[2].text+='絶対';}],
 ['fake-evidence',p=>{p.rewrite.edits.at(-1).evidenceIds=['fake'];rebuild(p,ir);}],
 ['lower-intensity',p=>{p.rewrite.intensity=1;}],
 ['duplicate-edit',p=>{p.rewrite.edits.push(structuredClone(p.rewrite.edits.at(-1)));rebuild(p,ir);}],
 ];for(const [name,mutate] of mutations){const plan=structuredClone(allPlain);mutate(plan);const accepted=validateRewrite(ir,plan,references);output.tampering.push({name,accepted});assert.equal(accepted,false,name);}
 const fresh=structuredClone(ir);const rootToken=fresh.tokens.find(t=>t.dep==='ROOT');rootToken.morphology.push('Inflection=五段;仮定形-一般');assert.equal(validateRewrite(fresh,allPlain,references),false);output.tampering.push({name:'fresh-source-scope-rebuild',accepted:false});
 for(const parent of result.candidates){const lockedNodeIds=parent.plan.nodes.map(n=>n.id);const next=await verifyGeneratedResult(generate({...req,seed:'lock-review'},analysis,assets,{lockedPlan:parent.plan,lockedNodeIds,replayParent:result.replayManifest,parentCandidateId:parent.id}),python,analysis);assert.ok(next.candidates.length);assert.ok(next.candidates.every(c=>c.text===parent.text));const replay=replayGeneration(next.replayManifest,analysis,assets);await verifyGeneratedResult(replay,python,analysis);assert.equal(replay.replayManifest.candidateSetHash,next.replayManifest.candidateSetHash);assert.deepEqual(replay.candidates,next.candidates);const forged=structuredClone(next.replayManifest);forged.regeneration.lockedPlan.nodes[0].text+='偽';assert.throws(()=>replayGeneration(forged,analysis,assets),/REPLAY_LOCK_MISMATCH/);output.locks.push({parent:parent.text,allNodeLock:true,replay:true,tamperedReplayRejected:true});}
 const before=hash(makeRewritePlans(ir,req,assets));const cloned=makeRewritePlans(ir,req,assets);cloned[0].rewrite.edits[0].to='MUTATED';assert.equal(hash(makeRewritePlans(ir,req,assets)),before);assert.ok(cloned.slice(1).every(p=>p.rewrite.edits.every(e=>e.to!=='MUTATED')));output.tampering.push({name:'cross-variant-edit-isolation',accepted:false});
 for(const count of [4,30,100,250]){const text='私は担当者に確認しました。'.repeat(count),analysis=await python.analyze(text,Date.now()+60000),req=request(text),ir=extractFacts(sourceDocument(text),analysis,req);let ms={};for(const [name,maker]of [['baseline',makeBaselinePlans],['current',makeRewritePlans]]){const t=performance.now();const plans=maker(ir,req,assets);ms[name]=+(performance.now()-t).toFixed(2);if(name==='current'){const t=performance.now();for(const plan of plans)assert.ok(validateRewrite(ir,plan,references));ms.validateAll=+(performance.now()-t).toFixed(2);ms.planCount=plans.length;ms.maxPlain=Math.max(...plans.map(p=>p.rewrite.edits.filter(e=>rewriteRuleById.get(e.ruleId).mode==='plain').length));}}output.performance.push({count,scalarLength:[...text].length,...ms});console.log('performance',JSON.stringify(output.performance.at(-1)));}
 }finally{python.close();output.finishedAt=new Date().toISOString();save(output);}
 if(output.cases.some(row=>row.failure.length))process.exitCode=1;
 console.log('FINAL',JSON.stringify({output:outputFile,cases:output.cases.length,failures:output.cases.filter(c=>c.failure.length).map(c=>({name:c.name,intensity:c.intensity,failure:c.failure})),tampering:output.tampering,locks:output.locks.length,performance:output.performance}));
})().catch(e=>{console.error(e);process.exitCode=1;});
