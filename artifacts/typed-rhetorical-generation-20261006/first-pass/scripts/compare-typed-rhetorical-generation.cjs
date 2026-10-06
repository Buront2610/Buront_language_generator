'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const args=Object.fromEntries(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith('--')?[[v.slice(2),a[i+1]]]:[]));
const read=p=>JSON.parse(p.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(p)):fs.readFileSync(p,'utf8'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const slice=(s,p)=>[...s].slice(p.start,p.end).join('');
const inside=(s,p)=>p.start<=s.start&&s.end<=p.end;
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
const invert=spans=>spans.some((s,i)=>i&&s.start<spans[i-1].start);
const readme={scope:'Objective source-program diagnostics. No human S/Q, naturalness, humor or style-quality claim.',bodyComposition:'An independently revalidated STRUCTURAL program whose source-bound pieces cover at least two relation roles and actually invert source-role order or change source sentence grouping. Source-bound forms count as replaced source roles, separately from copied pieces. Nominalization or fixed wording alone is structural-form-only, not body composition.',grouping:'Compare number of source GiNZA sentence spans intersecting the block to terminal-delimited output groups in reconstructed block text. This is a finite surface grouping diagnostic, not a syntactic oracle.',proof:'Production bounded validators are rerun from original IR; this is independent of the submitted plan but not an independently implemented linguistic oracle. Slot span partition/coverage is additionally calculated directly.',selection:'Pool, displayed, and first displayed counts are separated. Changed order and more candidates do not imply improved quality.'};
function classify(input,root){
 const rules=require(path.join(root,'dist/packages/core/rewrite-rules')).rewriteRuleById;
 const {validateRewrite}=require(path.join(root,'dist/packages/core/rewrite-validation'));
 const {validateConstruction}=require(path.join(root,'dist/packages/core/constructions'));
 const structuralPath=path.join(root,'dist/packages/core/structural-validation.js');
 const validateStructural=fs.existsSync(structuralPath)?require(structuralPath).validateStructural:null;
 const stats={cases:input.rows.length,requests:0,errors:0,candidates:0,displayed:0,noDisplay:0,fewerThanThree:0,rejected:0,nonPassingDisplayed:0,nonNullSQ:0,invalidBoundedProof:0,structuralPool:0,structuralDisplayed:0,structuralTop:0,bodyPool:0,bodyDisplayed:0,bodyTop:0,bodyRequests:0,bodyDisplayRequests:0,movementPool:0,movementDisplayed:0,groupingPool:0,groupingDisplayed:0,slotCoverageFailures:0,relationProvenanceFailures:0,classifications:{},family:{}};
 const rows=input.rows.map(row=>{const out={...Object.fromEntries(Object.entries(row).filter(([k])=>!['sourceAnalysis','results'].includes(k))),results:[]};
 if(row.error)stats.errors++;
 for(const r of row.results){stats.requests++;if(r.error){stats.errors++;out.results.push(r);continue;}stats.displayed+=r.selected.length;stats.noDisplay+=!r.selected.length;stats.fewerThanThree+=r.selected.length<3;
 const cs=r.candidates.map(c=>{const p=c.plan,refs=new Map(c.evidence.map(e=>[e.id,e.text]));let proof=null;try{proof=p.structural?(validateStructural?validateStructural(r.ir,p,refs):false):p.construction?validateConstruction(r.ir,p,refs):p.rewrite?validateRewrite(r.ir,p,refs):null;}catch{proof=false;}
 const blocks=(p.structural?.blocks??[]).map(b=>{
  const sourceBound=b.pieces.filter(x=>x.sourceSpan),sourceCopied=b.pieces.filter(x=>x.kind==='source');
  const roles=sourceBound.map(x=>b.relation.slots.find(s=>inside(x.sourceSpan,s.span))?.role??'marker');
  const uniqueRoles=[...new Set(roles.filter(x=>x!=='marker'))];
  const partition=b.relation.slots.map(s=>{const spans=sourceBound.filter(x=>inside(x.sourceSpan,s.span)).map(x=>x.sourceSpan).sort((a,b)=>a.start-b.start);let cursor=s.span.start,pass=true;for(const q of spans){if(q.start!==cursor||q.end<=q.start)pass=false;cursor=q.end;}return {role:s.role,span:s.span,source:slice(row.source,s.span),spans,pass:pass&&cursor===s.span.end};});
  const sourceSentences=r.ir.sentences.filter(s=>overlap(s,b.sourceSpan)).length;
  const renderedNode=p.nodes.find(n=>n.id===b.nodeId);const text=renderedNode?.text??'';const outputGroups=text.split(/[。！？!?]+/u).filter(s=>s.trim()).length;
  const copiedOrderInverted=invert(sourceCopied.map(x=>x.sourceSpan)),sourceBoundOrderInverted=invert(sourceBound.map(x=>x.sourceSpan));
  const groupingChange=outputGroups-sourceSentences;
  return {operatorId:b.operatorId,realizationId:b.realizationId,kind:b.relation.kind,sourceForm:b.relation.sourceForm,sourceSpan:b.sourceSpan,roles:uniqueRoles,emittedRoleOrder:roles,sourceBoundOrderInverted,copiedOrderInverted,sourceSentenceCount:sourceSentences,outputGroupCount:outputGroups,groupingChange,slotPartition:partition,slotsCoveredExactlyOnce:partition.every(s=>s.pass),provenanceValid:b.relation.provenance.inputHash===r.ir.source.inputHash&&b.relation.provenance.parserVersion===r.ir.parserVersion,formIds:b.pieces.filter(x=>x.kind==='form').map(x=>x.formId),evidenceIds:b.evidenceIds,bodyComposition:proof===true&&uniqueRoles.length>=2&&(sourceBoundOrderInverted||groupingChange!==0)};
 });
 const local=p.structural?.localEdits??p.construction?.lexicalEdits??p.rewrite?.edits??[];
 const localKinds=local.map(e=>rules.get(e.ruleId)?.kind??'unknown');
 let category='other-candidate';
 if(p.structural)category=proof!==true?'invalid-structural-program':blocks.some(b=>b.bodyComposition)?'body-composition':'structural-fixed-form-only';
 else if(p.construction)category='fixed-phrase-construction';
 else if(p.rewrite)category=localKinds.every(k=>k==='punctuation')?'preservation-layout-only':localKinds.every(k=>['ending','punctuation'].includes(k))?'ending-only':'lexical-only';
 const checks=c.checks.map(q=>({code:q.code,status:q.status,required:q.required,explanation:q.explanation}));
 const obj={id:c.id,planId:p.id,text:c.text,displayOrdinal:c.displayOrdinal,operator:p.mainOperator,family:p.family,classification:category,independentBoundedProof:proof,verificationStatus:c.verificationStatus,preVerificationStatus:c.preVerificationStatus,allChecksPass:checks.every(q=>q.status==='pass'),checks,scores:c.scores,sqNull:c.scores.S===null&&c.scores.Q===null,sourceProvenance:{nodes:p.nodes.map(n=>({id:n.id,sourceSpan:n.sourceSpan,factIds:n.factIds,evidenceIds:n.evidenceIds})),blocks},editSignature:sha(JSON.stringify(p.structural??p.construction??p.rewrite??p)),localKinds,plan:p,evidence:c.evidence};
 stats.candidates++;stats.rejected+=c.verificationStatus!=='passed';stats.nonPassingDisplayed+=c.displayOrdinal!==null&&(!obj.allChecksPass||c.verificationStatus!=='passed');stats.nonNullSQ+=!obj.sqNull;stats.invalidBoundedProof+=proof===false;
 if(p.structural){stats.structuralPool++;stats.structuralDisplayed+=c.displayOrdinal!==null;stats.structuralTop+=c.displayOrdinal===1;stats.slotCoverageFailures+=blocks.filter(b=>!b.slotsCoveredExactlyOnce).length;stats.relationProvenanceFailures+=blocks.filter(b=>!b.provenanceValid).length;}
 if(category==='body-composition'){stats.bodyPool++;stats.bodyDisplayed+=c.displayOrdinal!==null;stats.bodyTop+=c.displayOrdinal===1;}
 stats.movementPool+=blocks.some(b=>b.sourceBoundOrderInverted);stats.movementDisplayed+=c.displayOrdinal!==null&&blocks.some(b=>b.sourceBoundOrderInverted);stats.groupingPool+=blocks.some(b=>b.groupingChange!==0);stats.groupingDisplayed+=c.displayOrdinal!==null&&blocks.some(b=>b.groupingChange!==0);
 stats.classifications[category]??={pool:0,displayed:0,top:0};stats.classifications[category].pool++;stats.classifications[category].displayed+=c.displayOrdinal!==null;stats.classifications[category].top+=c.displayOrdinal===1;
 return obj;});
 const body=cs.filter(c=>c.classification==='body-composition');stats.bodyRequests+=body.length>0;stats.bodyDisplayRequests+=body.some(c=>c.displayOrdinal!==null);
 const family=row.family??row.category??'prior-regression';stats.family[family]??={requests:0,bodyRequests:0,bodyDisplayRequests:0,structuralRequests:0};stats.family[family].requests++;stats.family[family].bodyRequests+=body.length>0;stats.family[family].bodyDisplayRequests+=body.some(c=>c.displayOrdinal!==null);stats.family[family].structuralRequests+=cs.some(c=>c.operator==='STRUCTURAL');
 out.results.push({intensity:r.intensity,selectedCandidateId:r.selectedCandidateId,selected:r.selected,candidates:cs,shortfallReason:r.shortfallReason,fallback:r.fallback,semanticVerification:r.replayManifest.semanticVerification});}
 return out;});return {summary:stats,rows};}
for(const key of ['before','after','before-root','after-root','out','summary'])if(!args[key])throw Error('Missing --'+key);
const before=read(args.before),after=read(args.after);
for(const k of ['inputSetHash','assetFileHash','datasetId','captureScriptHash','settings','parser'])if(!equal(before.meta[k],after.meta[k]))throw Error('Mismatch '+k);
if(!before.meta.stableEngine||!after.meta.stableEngine)throw Error('Unstable engine');
if(before.rows.length!==after.rows.length)throw Error('Row count');
for(let i=0;i<before.rows.length;i++){const a=before.rows[i],b=after.rows[i];if(a.id!==b.id||a.source!==b.source||a.sourceAnalysisHash!==b.sourceAnalysisHash)throw Error('Source mismatch '+i);}
const b=classify(before,path.resolve(args['before-root'])),a=classify(after,path.resolve(args['after-root']));
const summary={schemaVersion:1,methods:readme,classifierHash:sha(fs.readFileSync(__filename)),before:b.summary,after:a.summary,changedDisplayRequests:a.rows.flatMap((r,i)=>r.results.map((q,j)=>!equal(q.selected?.map(c=>c.text),b.rows[i].results[j].selected?.map(c=>c.text)))).filter(Boolean).length,beforeMeta:before.meta,afterMeta:after.meta};
const result={summary,before:b.rows,after:a.rows};fs.writeFileSync(args.out,zlib.gzipSync(JSON.stringify(result)+'\n',{level:9}));fs.writeFileSync(args.summary,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({before:b.summary,after:a.summary,changedDisplayRequests:summary.changedDisplayRequests}));
