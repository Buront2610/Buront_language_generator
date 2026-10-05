'use strict';
// Independent authored probes only; never loads the held-out behavioral set.
// Run after build:engine with BURONT_PYTHON pointing to the locked GiNZA env.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..'); process.chdir(root);
const { PythonClient } = require('../dist/packages/runtime/python-client');
const { compileAssets } = require('../dist/packages/core/assets');
const { generate } = require('../dist/packages/core/engine');
const { validateConstruction } = require('../dist/packages/core/constructions');
const { constructionEdits, constructionEditsConflict, hasConstructionEditConflicts } = require('../dist/packages/core/construction-edits');
const { realize, validateCandidate, verification } = require('../dist/packages/core/validator');
const { finishSemanticVerification } = require('../dist/packages/core/semantic');
const { replayGeneration } = require('../dist/packages/core/replay');
const { hash, slice } = require('../dist/packages/core/source');
const { QuotePlanSchema, GenerationResultSchema } = require('../dist/packages/contracts/results');
const Ajv = require('ajv/dist/2020');
const ajv = new Ajv({ strict: true }); const schemaPlan = ajv.compile(QuotePlanSchema), schemaResult = ajv.compile(GenerationResultSchema);
const cases = [
  ['composed-start', '電車を選んだ。私は速さを重視するからだ。', 'explicit-reason'],
  ['composed-polite', '電車を選んだ。私は速さを重視するからです。', 'explicit-reason'],
  ['composed-negative', '電車を選ばなかった。私は全然急がないからだ。', 'explicit-reason'],
  ['protected-scalars', '😀私は１００.００円を払った。私は速さを重視するからだ。', 'explicit-reason'],
  ['contrast', 'この傘は軽い。しかし私は値段を重視する。', 'explicit-contrast'],
  ['modesty-voiced', '大したことはしていない。荷物を運んだだけだ。', 'modest-achievement'],
  ['modesty-unvoiced', '大したことはしていない。荷物を届けただけだ。', 'modest-achievement'],
  ['modesty-desire-voiced', '大したことはしていない。荷物を運びたかっただけだ。', null],
  ['modesty-desire-unvoiced', '大したことはしていない。荷物を届けたかっただけだ。', null],
  ['modesty-desire-suru', '大したことはしていない。資料を提出したかっただけだ。', null],
  ['modesty-nonpast', '大したことはしていない。荷物を運ぶだけだ。', null],
  ['reason-speculation', '電車がよいらしい。私は速さを重視するからだ。', null],
  ['reason-newline-speculation', '電車がよいらしい。\n私には速さが大切だからです。', null],
  ['reason-newline-question', '電車を選ぶ？\n私には速さが大切だからです。', null],
  ['quoted', '「電車を選んだ。私は速さを重視するからだ。」', null],
  ['hypothetical', '電車を選ぶなら帰る。私は速さを重視するからだ。', null],
  ['reported', '彼は電車を選んだと言った。私は速さを重視するからだ。', null],
  ['unknown-reason', '電車を選んだ。私は速さを重視するらしいからだ。', null],
  ['already-prefixed', '電車を選んだ。何故なら私は速さを重視するからだ。', null],
  ['local-anger', '私の怒りが頂点に達しました。', 'anger-peak'],
];
const request = (source, extra={}) => ({source, task:'rewrite', contextMode:'faithful', noveltyMode:'blend', intensity:3, series:'all', backend:'structured', clientRevision:0, seed:'independent-composable-review-20261002', ...extra});
const report={schemaVersion:1,startedAt:new Date().toISOString(),sourceSet:'20 independently authored review probes; no held-out input access',rows:[],mutations:[],schemaMutations:[],conflicts:[],mapping:[],diagnostics:[],replay:[],originalSource:[],errors:[]};
function codeHashes(){return Object.fromEntries(['constructions','discourse-constructions','construction-edits','construction-diagnostics','grammar-scope','facts','rewrite-validation','rewrite-rules','validator','engine','semantic','replay'].flatMap(name=>['ts','js'].map(ext=>{const file=ext==='ts'?`packages/core/${name}.${ext}`:`dist/packages/core/${name}.${ext}`;return [file,hash(fs.readFileSync(file,'utf8'))]})));}
function check(name,fn){try{fn();return true}catch(e){report.errors.push({name,error:e.message});return false}}
function leaves(x,p=[]){if(Array.isArray(x))return x.flatMap((v,i)=>leaves(v,[...p,i]));if(x&&typeof x==='object')return Object.entries(x).flatMap(([k,v])=>leaves(v,[...p,k]));return [{p,v:x}]}
function alter(x,p,v){for(const k of p.slice(0,-1))x=x[k];x[p.at(-1)]=v;}
function invalid(v){return typeof v==='number'?v+1:typeof v==='boolean'?!v:typeof v==='string'?v+'偽':'forged';}
function retext(plan, ir){const {renderEdits}=require('../dist/packages/core/rewrite-validation');const all=constructionEdits(plan); for(const n of plan.nodes){const edits=all.filter(e=>e.nodeId===n.id);n.text=renderEdits(ir.source.raw,n,edits);n.evidenceIds=[...new Set(edits.flatMap(e=>e.evidenceIds))];}plan.evidenceIds=[...new Set(all.flatMap(e=>e.evidenceIds))];}
(async()=>{
report.codeHashesStart=codeHashes(); const python=new PythonClient(root), assets=compileAssets(), refs=new Map(assets.evidence.map(e=>[e.id,e.text]));
const tested=new Set();let representative;
try{report.parser=await python.start();for(const [id,source,expected] of cases){const analysis=await python.analyze(source),start=performance.now();const result=generate(request(source),analysis,assets);const constructionCandidates=result.candidatePool.filter(c=>c.plan.construction);const row={id,source,expected,generatedMs:+(performance.now()-start).toFixed(3),constructionIds:[...new Set(constructionCandidates.flatMap(c=>c.plan.construction.edits.map(e=>e.constructionId)))],texts:constructionCandidates.map(c=>c.text)};report.rows.push(row);
check(id+':eligibility',()=>expected?assert.ok(row.constructionIds.includes(expected)):assert.equal(constructionCandidates.length,0));
for(const c of constructionCandidates){check(id+':valid',()=>{assert.ok(schemaPlan(c.plan));assert.ok(validateConstruction(result.ir,c.plan,refs));assert.equal(c.verificationStatus,'passed');});
const mapcheck=check(id+':mapping',()=>{const rendered=realize(c.plan,result.ir);assert.equal(rendered.text,c.text);assert.deepEqual(rendered.spans,c.spans);let last=0;for(const span of c.spans){assert.equal(span.span.start,last);last=span.span.end;assert.ok(span.sourceSpan);if(span.origin==='source_fact')assert.equal(slice(c.text,span.span),slice(source,span.sourceSpan));else{const matches=constructionEdits(c.plan).filter(e=>e.nodeId===span.nodeId&&hash(e.sourceSpan)===hash(span.sourceSpan)&&e.to===slice(c.text,span.span));assert.ok(matches.length);}}assert.equal(last,[...c.text].length);});report.mapping.push({id,planId:c.plan.id,passed:mapcheck});
for(let i=0;i<c.plan.construction.edits.length;i++){const edit=c.plan.construction.edits[i];if(tested.has(edit.constructionId))continue;tested.add(edit.constructionId);
for(const leaf of leaves(edit)){const forged=structuredClone(c.plan);alter(forged.construction.edits[i],leaf.p,invalid(leaf.v));const semantic=validateConstruction(result.ir,forged,refs);const rendered=realize(forged,result.ir);const final=verification(validateCandidate(result.ir,forged,rendered.text,rendered.spans,new Set(refs.keys()),undefined,refs,assets.seriesProfiles));const rejected=!semantic&&final!=='passed';report.mutations.push({construction:edit.constructionId,field:leaf.p.join('.'),rejected});check(`mutation:${edit.constructionId}:${leaf.p.join('.')}`,()=>assert.ok(rejected));}
for(const [label,mutate] of [['missing-operation',e=>delete e.operation],['null-operation',e=>e.operation=null],['unknown-operation',e=>e.operation.kind='free'],['operation-extra',e=>e.operation.extra=true],['missing-span',e=>delete e.sourceSpan],['unknown-relation',e=>e.relation={kind:'invented'}]]){const forged=structuredClone(c.plan);mutate(forged.construction.edits[i]);const rejects=!schemaPlan(forged);report.schemaMutations.push({construction:edit.constructionId,label,rejected:rejects});check('schema:'+label,()=>assert.ok(rejects));}
}
}
if(id==='composed-start'){
 representative={source,analysis,result:structuredClone(result)};const composed=constructionCandidates.find(c=>c.plan.construction.lexicalEdits.some(e=>e.ruleId==='speed-doubling'));check('genuine-composition',()=>assert.ok(composed));if(composed){const frame=composed.plan.construction.edits[0],lexical=composed.plan.construction.lexicalEdits;check('zero-width-prefix',()=>{assert.equal(frame.sourceSpan.start,frame.sourceSpan.end);assert.equal(frame.from,'');assert.equal(frame.to,frame.operation.prefix);assert.equal(slice(source,frame.operation.bodySourceSpan),frame.bindings.find(b=>b.slot==='reason').text);assert.ok(frame.relation.clauses.find(c=>c.role==='claim'));});for(const edit of lexical){check('local-valid:'+edit.ruleId,()=>assert.equal(constructionEditsConflict(frame,edit),false));}
for(const [label,other,conflict] of [['duplicate-prefix',structuredClone(frame),true],['construction-in-body',{...frame,operation:{kind:'replace'},sourceSpan:{start:frame.sourceSpan.start+1,end:frame.sourceSpan.start+2}},true],['different-node-local',{...lexical.find(e=>e.ruleId==='speed-doubling'),nodeId:'fact-node-0'},true],['crosses-body-end',{...lexical.find(e=>e.ruleId==='speed-doubling'),sourceSpan:{start:frame.operation.bodySourceSpan.end-1,end:frame.operation.bodySourceSpan.end+1}},true],['local-at-prefix',lexical.find(e=>e.ruleId==='narrator-watashi'),false]]){const actual=constructionEditsConflict(frame,other);report.conflicts.push({label,expected:conflict,actual});check('conflict:'+label,()=>assert.equal(actual,conflict));}
for(const [label,mutate] of [['duplicate-prefix',p=>p.construction.edits.push(structuredClone(frame))],['overlap-lexical',p=>p.construction.lexicalEdits.push(structuredClone(lexical.find(e=>e.ruleId==='speed-doubling')))],['invented-edit',p=>p.construction.lexicalEdits.find(e=>e.ruleId==='speed-doubling').to='金を受け取った'],['forged-lexical-evidence',p=>p.construction.lexicalEdits.find(e=>e.ruleId==='speed-doubling').evidenceIds=[]],['removed-relation',p=>delete p.construction.edits[0].relation],['old-version',p=>p.construction.version=1],['foreign-prefix-span',p=>p.construction.edits[0].sourceSpan={start:0,end:0}]]){const forged=structuredClone(composed.plan);mutate(forged);retext(forged,result.ir);const rejected=!validateConstruction(result.ir,forged,refs);report.mutations.push({construction:'composed-program',field:label,rejected});check('composed:'+label,()=>assert.ok(rejected));}
for(const slot of ['claim','reason']){const changed=structuredClone(result.ir),bound=frame.bindings.find(b=>b.slot===slot);const predicate=changed.tokens.find(t=>bound.span.start<=t.span.start&&t.span.end<=bound.span.end&&t.dep==='ROOT');predicate.morphology.push('Inflection=五段;仮定形-一般');const rejected=!validateConstruction(changed,composed.plan,refs);report.originalSource.push({slot,rejected});check('fresh-source:'+slot,()=>assert.ok(rejected));}
}
}
const pool=result.candidatePool;finishSemanticVerification(result,{});check(id+':result-schema',()=>assert.ok(schemaResult(result)));const selected=new Set(result.candidates.map(c=>`${c.id}:${c.plan.id}`));const diagnosticCorrect=check(id+':diagnostics',()=>{for(const c of pool.filter(c=>c.plan.construction)){const relevant=result.diagnostics.filter(d=>d.candidateId===c.id&&d.planId===c.plan.id);const expected=c.verificationStatus!=='passed'?'verification_rejected':selected.has(`${c.id}:${c.plan.id}`)?'selected':'not_selected';assert.ok(relevant.some(d=>d.stage===expected));assert.ok(!relevant.some(d=>d.stage==='selected'&&expected!=='selected'));assert.ok(relevant.filter(d=>['verified','verification_rejected'].includes(d.stage)).every(d=>d.reason.startsWith('independent_validation')));}});report.diagnostics.push({id,passed:diagnosticCorrect});
console.log(JSON.stringify({id,constructions:constructionCandidates.length,errors:report.errors.length}));
}
if(representative){const {source,analysis}=representative;const result=representative.result;const pool=result.candidatePool;for(const c of pool)c.checks.push({code:'V-review-required-failure',status:'fail',required:true,explanation:'independent rejection control',factIds:[],checkerVersion:'review'});finishSemanticVerification(result,{});check('rejected-final-diagnostics',()=>{assert.equal(result.candidates.length,0);assert.ok(!result.diagnostics.some(d=>d.stage==='selected'));assert.ok(result.diagnostics.some(d=>d.stage==='verification_rejected'));});
const parent=generate(request(source),analysis,assets);finishSemanticVerification(parent,{});const accepted=parent.candidates.find(c=>c.plan.construction);check('replay-construction-selected',()=>assert.ok(accepted));if(accepted){const child=generate(request(source,{seed:'independent-composable-child'}),analysis,assets,{lockedPlan:accepted.plan,lockedNodeIds:accepted.plan.nodes.map(n=>n.id),replayParent:parent.replayManifest,parentCandidateId:accepted.id});const actual=replayGeneration(structuredClone(child.replayManifest),analysis,assets);check('replay-exact',()=>{assert.equal(actual.replayManifest.candidateSetHash,child.replayManifest.candidateSetHash);assert.ok(child.candidates.every(c=>c.text===accepted.text));});for(const [label,mutate] of [['prefix',e=>e.operation.prefix+='偽'],['body',e=>e.operation.bodySourceSpan.end--],['relation',e=>e.relation.conditions[0].speculative=true],['version',e=>e.constructionVersion=1]]){const forged=structuredClone(child.replayManifest);mutate(forged.regeneration.lockedPlan.construction.edits[0]);let error;try{replayGeneration(forged,analysis,assets)}catch(e){error=e.message}report.replay.push({label,error,rejected:error==='REPLAY_LOCK_MISMATCH'});check('replay-'+label,()=>assert.equal(error,'REPLAY_LOCK_MISMATCH'));}}
}
}finally{python.close();}
report.finishedAt=new Date().toISOString();report.codeHashesEnd=codeHashes();report.stableCode=hash(report.codeHashesStart)===hash(report.codeHashesEnd);report.scriptHash=hash(fs.readFileSync(__filename,'utf8'));report.summary={cases:report.rows.length,mutations:report.mutations.length,schemaMutations:report.schemaMutations.length,mapping:report.mapping.length,errors:report.errors.length,stableCode:report.stableCode};
const out='artifacts/composable-constructions-20261002/independent-review.json';fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({out,...report.summary,failures:report.errors}));if(report.errors.length||!report.stableCode)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
