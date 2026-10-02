'use strict';
// Independent live-GiNZA acceptance, corruption, replay and exact-retrieval probes.
// Run after npm run build:engine: node scripts/evaluate-independent-review.cjs
const fs=require('node:fs'), assert=require('node:assert/strict'), path=require('node:path');
const root=path.resolve(__dirname,'..');
process.chdir(root);
const {compileAssets}=require(root+'/dist/packages/core/assets');
const {generate}=require(root+'/dist/packages/core/engine');
const {validateConstruction,makeConstructionPlans,constructionRegistry}=require(root+'/dist/packages/core/constructions');
const {finishSemanticVerification}=require(root+'/dist/packages/core/semantic');
const {validateCandidate,realize,verification}=require(root+'/dist/packages/core/validator');
const {replayGeneration}=require(root+'/dist/packages/core/replay');
const {hash}=require(root+'/dist/packages/core/source');
const sources=[
  [
    "R01",
    "電車のほうがよいと思う。安いからだ。"
  ],
  [
    "R02",
    "今日は休んだ。熱があるからです。"
  ],
  [
    "R03",
    "電車が遅れた。故障したからだ。"
  ],
  [
    "R04",
    "安いからだ。"
  ],
  [
    "R05",
    "昨日は休んだ。今日は午前9時からだ。"
  ],
  [
    "R06",
    "「電車は便利だ。安いからだ。」"
  ],
  [
    "R07",
    "今日は休むかもしれない。熱があるからだ。"
  ],
  [
    "R08",
    "今日は休まなかった。熱がなかったからだ。"
  ],
  [
    "R09",
    "田中は帰ったと言った。雨が降ったからだ。"
  ],
  [
    "R10",
    "家を出たら駅に行く。安いからだ。"
  ],
  [
    "R11",
    "電車のほうがよいと思う。何故なら安いからだ。"
  ],
  [
    "R12",
    "電車のほうがよいと思う。\n安いからだ。"
  ],
  [
    "R13",
    "100円を払った。値段が100円だったからだ。"
  ],
  [
    "R14",
    "電車は便利だ。安いからだと言われた。"
  ],
  [
    "R15",
    "電車は便利だ。安いからだろう。"
  ],
  [
    "C01",
    "この傘は軽い。しかし値段は高い。"
  ],
  [
    "C02",
    "この傘は軽くない。しかし値段は高い。"
  ],
  [
    "C03",
    "私は確認した。しかし彼は確認しなかった。"
  ],
  [
    "C04",
    "費用は100円だ。しかし予定は3日後だ。"
  ],
  [
    "C05",
    "「この傘は軽い。しかし値段は高い。」"
  ],
  [
    "C06",
    "この傘は軽いらしい。しかし値段は高い。"
  ],
  [
    "C07",
    "この傘は軽い。しかし値段は高いか。"
  ],
  [
    "C08",
    "この傘は軽い。だが値段は高い。"
  ],
  [
    "C09",
    "東京に住んでいるが、名前は太郎だ。"
  ],
  [
    "C10",
    "昨日のことだが、私は資料を確認した。"
  ],
  [
    "C11",
    "この傘は軽い。\nしかし、値段は高い。"
  ],
  [
    "C12",
    "この傘は軽い。しかしながら値段は高い。"
  ],
  [
    "M01",
    "大したことはしていない。機械を動かしただけだ。"
  ],
  [
    "M02",
    "大したことはしていない。太郎が機械を動かしただけだ。"
  ],
  [
    "M03",
    "大したことはしていない。私が機械を動かしただけだ。"
  ],
  [
    "M04",
    "大したことはしていない。私と太郎が機械を動かしただけだ。"
  ],
  [
    "M05",
    "大したことはしていない。明日は機械を動かすだけだ。"
  ],
  [
    "M06",
    "大したことはしていない。機械を動かしたら帰るだけだ。"
  ],
  [
    "M07",
    "大したことはしていない。機械を動かしたかもしれないだけだ。"
  ],
  [
    "M08",
    "大したことはしていない。「機械を動かしただけだ」。"
  ],
  [
    "M09",
    "大したことはしていない。機械は動かしていないだけだ。"
  ],
  [
    "M10",
    "大したことはしていない。機械を動かされただけだ。"
  ],
  [
    "M11",
    "大したことはしていない。故障した機械を見ただけだ。"
  ],
  [
    "M12",
    "大したことはしていない。200円で機械を直しただけだ。"
  ],
  [
    "M13",
    "大したことはしていない。彼が壊した機械を直しただけだ。"
  ],
  [
    "M14",
    "大したことはしていない。太郎は笑った。機械を直しただけだ。"
  ],
  [
    "M15",
    "大したことはしていない。\n機械を直しただけだ。"
  ],
  [
    "M16",
    "それほどでもない。機械を直しただけだ。"
  ],
  [
    "M17",
    "太郎は言った。大したことはしていない。機械を直しただけだ。"
  ],
  [
    "G01",
    "時既に時間切れだ。既に時間切れだ。"
  ],
  [
    "G02",
    "既に時間切れだ。時既に時間切れだ。"
  ],
  [
    "G03",
    "😀予算は１００.００円。私の怒りは頂点に達しました。"
  ]
];
const {PythonClient}=require(root+'/dist/packages/runtime/python-client');
const {execFileSync}=require('node:child_process');
function sourceHashes(){const out={};for(const name of ['source','validator','assets','bounded-search','rewrite-rules','constructions','discourse-constructions','grammar-scope','rewrite-validation','semantic','replay'])for(const file of [`packages/core/${name}.ts`,`dist/packages/core/${name}.js`])out[file]=hash(fs.readFileSync(path.join(root,file)).toString('utf8'));return out;}
(async()=>{
const before=sourceHashes(),python=new PythonClient(root),cases=[];
try{await python.start();for(const [id,source] of sources)cases.push({id,source,analysis:await python.analyze(source)});}finally{python.close();}

const assets=compileAssets(), references=new Map(assets.evidence.map(x=>[x.id,x.text]));
const request=(source,intensity=3,extra={})=>({source,task:'rewrite',contextMode:'faithful',noveltyMode:'blend',intensity,series:'all',backend:'structured',clientRevision:0,seed:'independent-safety-review-20261002',...extra});
const rows=[], mutations=[], tested=new Set(), replay=[], provenance=[], freshProof=[];
function leaves(x,p=[]){ if(Array.isArray(x)) return x.flatMap((v,i)=>leaves(v,[...p,i])); if(x&&typeof x==='object')return Object.entries(x).flatMap(([k,v])=>leaves(v,[...p,k])); return [{p,v:x}]; }
function set(x,p,v){for(const k of p.slice(0,-1))x=x[k];x[p.at(-1)]=v;}
function malformed(v){return typeof v==='number'?v+999:typeof v==='string'?v+'偽':typeof v==='boolean'?!v:'forged';}
for(const row of cases){
 const result=generate(request(row.source),row.analysis,assets), pool=result.candidatePool;
 const constructed=pool.filter(c=>c.plan.construction);
 for(const candidate of constructed){
   for(const originalEdit of candidate.plan.construction.edits){
     if(tested.has(originalEdit.constructionId))continue; tested.add(originalEdit.constructionId);
     const editIndex=candidate.plan.construction.edits.indexOf(originalEdit);
     assert.equal(validateConstruction(result.ir,candidate.plan,references),true);
     const boundFact=result.ir.facts.find(f=>f.id===originalEdit.factId);
     const markerToken=result.ir.tokens.find(t=>t.span.start===boundFact.predicateSpan.start&&t.span.end===boundFact.predicateSpan.end);
     markerToken.morphology.push('Inflection=五段;仮定形-一般');
     const rejectsChangedGrammar=!validateConstruction(result.ir,candidate.plan,references);
     markerToken.morphology.pop();
     freshProof.push({construction:originalEdit.constructionId,rejectsChangedGrammar,acceptsRestoredGrammar:validateConstruction(result.ir,candidate.plan,references)});
     const entry=constructionRegistry.find(e=>e.id===originalEdit.constructionId);
     for(const [label,replace] of [['non-original',e=>({...e,sourceType:'quote_heading'})],['wrong-series',e=>({...e,series:[]})],['wrong-text',e=>({...e,text:'unsupported'})]]){
       const tamperedAssets={...assets,evidence:assets.evidence.map(e=>e.id===entry.evidenceId?replace(e):e)};
       const plans=makeConstructionPlans(result.ir,request(row.source,3,{series:entry.series[0]}),tamperedAssets,[]);
       provenance.push({construction:entry.id,mutation:label,rejected:plans.every(p=>p.construction.edits.every(e=>e.constructionId!==entry.id))});
     }
     for(const leaf of leaves(originalEdit)){
       const plan=structuredClone(candidate.plan);set(plan.construction.edits[editIndex],leaf.p,malformed(leaf.v));
       const valid=validateConstruction(result.ir,plan,references), rendered=realize(plan,result.ir);
       const finalStatus=verification(validateCandidate(result.ir,plan,rendered.text,rendered.spans,new Set(references.keys()),undefined,references,assets.seriesProfiles));
       mutations.push({construction:originalEdit.constructionId,field:leaf.p.join('.'),rejected:!valid&&finalStatus!=='passed',valid,finalStatus});
     }
     for(const [label,change] of [
       ['missing-evidence',p=>p.evidenceIds=[]],['forged-family',p=>p.family='forged'],['missing-narrative',p=>delete p.narrative],['missing-intent',p=>delete p.intentPlan],
       ['node-factIds',p=>p.nodes[0].factIds=[]],['node-span',p=>p.nodes[0].sourceSpan.end--],['node-text',p=>p.nodes[0].text+='太郎が100万円受け取った'],
       ['duplicate-edit',p=>p.construction.edits.push(structuredClone(p.construction.edits[0]))],
     ]){
       const plan=structuredClone(candidate.plan);change(plan);
       const valid=validateConstruction(result.ir,plan,references);mutations.push({construction:originalEdit.constructionId,field:label,rejected:!valid,valid});
     }
     const emptyReferencesValid=validateConstruction(result.ir,candidate.plan,new Map());mutations.push({construction:originalEdit.constructionId,field:'absent-reference-corpus',rejected:!emptyReferencesValid});
   }
 }
 const failControl=structuredClone(result);
 for(const c of failControl.candidatePool)c.checks.push({code:'V-independent-injected-failure',status:'fail',required:true,explanation:'independent review preservation control',factIds:[],checkerVersion:'review'});
 finishSemanticVerification(failControl,{});
 const preservedFailures=failControl.candidates.length===0;
 const verified=finishSemanticVerification(result,{});
 const selected=verified.candidates.find(c=>c.plan.construction);
 if(selected && !replay.some(r=>r.family===selected.plan.family)){
   const child=generate(request(row.source,3,{seed:'review-child'}),row.analysis,assets,{lockedPlan:selected.plan,lockedNodeIds:selected.plan.nodes.map(n=>n.id),replayParent:verified.replayManifest,parentCandidateId:selected.id});
   let replayed=false,forgedRejected=false;try{const r=replayGeneration(structuredClone(child.replayManifest),row.analysis,assets);replayed=r.replayManifest.candidateSetHash===child.replayManifest.candidateSetHash;}catch(e){replay.push({family:selected.plan.family,error:e.message});}
   const forged=structuredClone(child.replayManifest);forged.regeneration.lockedPlan.construction.edits[0].to+='偽';try{replayGeneration(forged,row.analysis,assets)}catch(e){forgedRejected=/REPLAY_LOCK_MISMATCH/.test(e.message)}
   replay.push({family:selected.plan.family,replayed,forgedRejected,allLockedExact:child.candidates.every(c=>c.text===selected.text)});
 }
 rows.push({id:row.id,source:row.source,constructorPool:constructed.map(c=>({text:c.text,ids:c.plan.construction.edits.map(e=>e.constructionId),status:c.verificationStatus})),displayed:verified.candidates.map(c=>({text:c.text,operator:c.plan.mainOperator,status:c.verificationStatus})),shortfallReason:verified.shortfallReason,preservedFailures});
 console.log(row.id,constructed.length,verified.candidates.length);
}
const out={build:assets.manifest.engine,reviewedRoot:root,datasetId:assets.datasetId,rows,mutations,replay,provenance,freshProof,summary:{cases:rows.length,constructors:[...tested],mutations:mutations.length,mutationFailures:mutations.filter(m=>!m.rejected),failedCheckSuppression:rows.filter(r=>!r.preservedFailures),replay,provenance,freshProof}};

const expectedPositives=new Set(['R01','R02','R03','R08','R12','R13','C01','C02','C03','C11','M01','M03','M12','M13','M15','G01','G02','G03']);
for(const row of rows)assert.equal(row.constructorPool.length>0,expectedPositives.has(row.id),row.id+' constructor eligibility');
assert.equal(out.summary.mutationFailures.length,0);assert.equal(out.summary.failedCheckSuppression.length,0);
assert.ok(provenance.every(p=>p.rejected));assert.ok(freshProof.every(p=>p.rejectsChangedGrammar&&p.acceptsRestoredGrammar));assert.ok(replay.every(p=>p.replayed&&p.forgedRejected&&p.allLockedExact));
const equality=exactEquality();
const after=sourceHashes();assert.deepEqual(before,after,'code changed during independent review');
const report={schemaVersion:1,capturedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD']).toString().trim(),build:assets.manifest.engine,datasetId:assets.datasetId,scriptSha256:hash(fs.readFileSync(__filename).toString('utf8')),sourceAndDistHashes:before,codeUnchangedDuringRun:true,casesSha256:hash(sources),analysisSha256:hash(cases.map(c=>({id:c.id,analysis:c.analysis}))),parserVersion:cases[0].analysis.parserVersion,request:request('(each case source)'),summary:out.summary,exactRetrieval:equality,rows:rows.map(r=>({id:r.id,source:r.source,expectedConstruction:expectedPositives.has(r.id),constructionTexts:[...new Set(r.constructorPool.map(c=>c.text))],constructionIds:[...new Set(r.constructorPool.flatMap(c=>c.ids))],displayed:r.displayed,requiredFailurePreserved:r.preservedFailures})),resolvedFindings:[{severity:'P2',area:'discourse-constructions.ts standalone connective',description:'GiNZA parses しかしながら as しかし plus fixed ながら. Replacing only the prefix emitted だがながら. Fixed-child and continuation guards now abstain; C12 verifies rejection.'},{severity:'P3',area:'bounded-search.ts options guard',description:'Exact-only helper previously accepted prefix callbacks. Guard now permits only absent/false; focused regression tests cover callback/numeric/null.'},{severity:'P3',area:'discourse-constructions.test.js final verification call',description:'Corrected test arguments to the actual runtime API instead of relying on the bounded path leaving incorrect arguments unused.'}],limitations:['47 authored adversarial cases, not exhaustive Japanese grammar coverage','New frames are narrow source-grounded discourse changes; no claim of broad literary style mastery','Near-limit performance and full-suite evidence are separate artifacts']};
const output=path.join(root,'artifacts/grounded-discourse-20261002/independent-review.json');const encoded=JSON.stringify(report,null,2)+'\n';assert.ok(Buffer.byteLength(encoded)<60000,'review artifact exceeds limit');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,encoded);console.log(JSON.stringify({output:path.relative(root,output),cases:rows.length,mutations:mutations.length,provenanceMutations:provenance.length,replayFamilies:replay.length,exactComparisons:equality.comparisons,status:'passed'}));
})().catch(error=>{console.error(error);process.exitCode=1;});

function exactEquality(){
const { boundedExactSearch } = require(process.cwd() + '/dist/packages/core/bounded-search');
const MiniSearch = require('minisearch');
const assert = require('node:assert/strict');
let state = 731;
const rnd = n => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n);
const vocabulary = ['A', 'a', 'Ａ', 'é', 'e\u0301', '後', '前', '空', '雨', '速度', '〇', '😀', 'abc-12', 'a/b', 'constructor'];
const tokenize = query => query.normalize('NFKC').split('|').filter(Boolean);
const documents = Array.from({ length: 90 }, (_, id) => ({ id: `doc-${id}`, text: Array.from({ length: 1 + rnd(15) }, () => vocabulary[rnd(vocabulary.length)]).join('|'), family: Array.from({ length: 1 + rnd(4) }, () => vocabulary[rnd(vocabulary.length)]).join('|'), series: [`${rnd(4)}`] }));
let comparisons = 0;
for (const fields of [['text'], ['family', 'text']]) {
  const actual = boundedExactSearch(fields, tokenize);
  const expected = new MiniSearch({ fields, storeFields: ['series'], tokenize });
  actual.addAll(documents); expected.addAll(documents);
  for (let i = 0; i < 100; i++) {
    const query = Array.from({ length: rnd(120) }, () => vocabulary[rnd(vocabulary.length)]).join('|');
    const options = { prefix: false, filter: item => i % 4 === 0 || item.series.includes(`${i % 4}`) };
    assert.deepEqual(actual.search(query, options), expected.search(query, options));
    comparisons++;
  }
}
return { comparisons, status: 'passed', seed: 731, documents: 90, includes: ['full ordered results', 'exact floating-point score', 'matched fields', 'query term order', 'normalization', 'combining characters', 'series filter', 'repeated terms', 'ties'] };

}
