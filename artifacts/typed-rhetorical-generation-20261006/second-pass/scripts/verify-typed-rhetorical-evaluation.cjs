'use strict';
// Artifact integrity/readback verifier. This is not a linguistic quality oracle.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const dir=path.resolve(process.argv[2]??'artifacts/typed-rhetorical-generation-20261006');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(p.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(p)):fs.readFileSync(p,'utf8'));
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b),slice=(s,p)=>[...s].slice(p.start,p.end).join('');
const inside=(s,p)=>p.start<=s.start&&s.end<=p.end,overlap=(a,b)=>a.start<b.end&&b.start<a.end;
const inverted=xs=>xs.some((x,i)=>i>0&&x<xs[i-1]);
function requireThat(ok,message){if(!ok)throw Error(message);}
const idx=read(path.join(dir,'index.json'));
for(const [name,meta] of Object.entries(idx.files)){
 const resolved=path.resolve(dir,name);requireThat(resolved.startsWith(dir+path.sep),'Path escapes artifact directory');
 const b=fs.readFileSync(resolved);requireThat(sha(b)===meta.sha256&&b.length===meta.bytes,'File mismatch '+name);
}
const reports=[];
for(const name of Object.keys(idx.files).filter(f=>f.endsWith('-comparison.json.gz'))){
 const x=read(path.join(dir,name));requireThat(x.format==='deduplicated-structural-comparison-v1','Unknown comparison format');
 const v2=x.summary.auditVersion>=2;
 const init=()=>({cases:x.rows.length,requests:0,errors:0,candidates:0,displayed:0,noDisplay:0,fewerThanThree:0,rejected:0,nonPassingDisplayed:0,nonNullSQ:0,invalidBoundedProof:0,structuralPool:0,structuralDisplayed:0,structuralTop:0,bodyPool:0,bodyDisplayed:0,bodyTop:0,bodyRequests:0,bodyDisplayRequests:0,movementPool:0,movementDisplayed:0,groupingPool:0,groupingDisplayed:0,slotCoverageFailures:0,relationProvenanceFailures:0,classifications:{},family:{}});
 const totals={before:init(),after:init()};let changedDisplayRequests=0;
 for(const k of ['inputSetHash','assetFileHash','datasetId','captureScriptHash','settings','parser'])requireThat(eq(x.summary.beforeMeta[k],x.summary.afterMeta[k]),'Capture identity mismatch '+k);
 for(const side of ['before','after']){
  const meta=x.summary[side+'Meta'];requireThat(meta.stableEngine===true,'Unstable engine');
  requireThat(meta.engineHash===sha(JSON.stringify(meta.engineHashes)),'Engine inventory/hash mismatch');
 }
 const seen=new Set();
 for(const row of x.rows){
  requireThat(!seen.has(row.id),'Duplicate case ID '+row.id);seen.add(row.id);
  requireThat(typeof row.source==='string'&&/^[a-f0-9]{64}$/u.test(row.sourceAnalysisHash),'Missing source hash '+row.id);
  if(row.error)for(const side of ['before','after'])totals[side].errors++;
  for(const request of row.results){
   changedDisplayRequests+=!eq(request.before.selected?.map(c=>c.text),request.after.selected?.map(c=>c.text));
   for(const side of ['before','after']){
    const q=request[side],s=totals[side];s.requests++;if(q.error){s.errors++;continue;}
    requireThat(q.intensity===request.intensity,'Intensity mismatch');s.candidates+=q.candidates.length;s.displayed+=q.selected.length;s.noDisplay+=q.selected.length===0;s.fewerThanThree+=q.selected.length<3;
    if(v2){requireThat(q.sourceInputHash===sha(row.source),'Request source hash mismatch');requireThat(Array.isArray(q.sourceSentenceSpans),'Missing original sentence spans');requireThat(q.replayManifest&&eq(q.replayManifest.semanticVerification,q.semanticVerification),'Missing replay manifest');}
    const displayed=q.candidates.filter(c=>c.displayOrdinal!==null).sort((a,b)=>a.displayOrdinal-b.displayOrdinal);
    requireThat(eq(displayed.map(c=>({id:c.id,planId:c.planId,text:c.text})),q.selected),'Display order mismatch '+row.id);
    requireThat(displayed.every((c,i)=>c.displayOrdinal===i+1),'Noncontiguous ordinal');
    requireThat(q.selectedCandidateId===null||displayed.some(c=>c.id===q.selectedCandidateId),'Selected candidate ID absent from display');
    for(const c of q.candidates){
     const p=x.plans[c.planId];requireThat(p&&p.id===c.planId,'Missing plan '+c.planId);requireThat(c.evidenceIds.every(id=>x.evidence[id]),'Missing evidence');requireThat(c.checkIds.every(id=>x.checks[id]),'Missing check');const checks=c.checkIds.map(id=>x.checks[id]);
     requireThat(c.allChecksPass===checks.every(t=>t.status==='pass'),'Check summary mismatch');requireThat(c.sqNull===(c.scores.S===null&&c.scores.Q===null),'S/Q summary mismatch');
     s.rejected+=c.verificationStatus!=='passed';s.nonNullSQ+=!c.sqNull;s.invalidBoundedProof+=c.independentBoundedProof===false;s.nonPassingDisplayed+=c.displayOrdinal!==null&&(!c.allChecksPass||c.verificationStatus!=='passed');
     if(p.structural){
      s.structuralPool++;s.structuralDisplayed+=c.displayOrdinal!==null;s.structuralTop+=c.displayOrdinal===1;requireThat(c.text===p.nodes.map(n=>n.text).join(''),'Structural text/plan mismatch');
      requireThat(c.structuralDiagnostics.length===p.structural.blocks.length,'Missing block diagnostics');
      for(let i=0;i<p.structural.blocks.length;i++){
       const b=p.structural.blocks[i],d=c.structuralDiagnostics[i];requireThat(b.operatorId===d.operatorId&&b.realizationId===d.realizationId,'Operation mismatch');requireThat(eq(b.sourceSpan,d.sourceSpan),'Span mismatch');requireThat(b.relation.provenance.inputHash===sha(row.source),'Source provenance mismatch');requireThat(b.evidenceIds.every(id=>c.evidenceIds.includes(id)),'Missing block evidence');
       const bound=b.pieces.filter(p=>p.sourceSpan),copied=b.pieces.filter(p=>p.kind==='source'),spans=bound.map(p=>p.sourceSpan);
       requireThat(d.sourceBoundOrderInverted===inverted(spans.map(p=>p.start)),'Movement diagnostic mismatch');
       requireThat(d.copiedOrderInverted===inverted(copied.map(p=>p.sourceSpan.start)),'Copy movement diagnostic mismatch');
       const partitions=b.relation.slots.map(slot=>{
        const spans=bound.filter(p=>inside(p.sourceSpan,slot.span)).map(p=>p.sourceSpan).sort((a,b)=>a.start-b.start);let cursor=slot.span.start,pass=true;for(const p of spans){if(p.start!==cursor||p.end<=p.start)pass=false;cursor=p.end;}
        return {role:slot.role,span:slot.span,spans,pass:pass&&cursor===slot.span.end};
       });
       requireThat(eq(d.slotPartition,partitions),'Slot partition diagnostic mismatch');requireThat(d.slotsCoveredExactlyOnce===partitions.every(p=>p.pass),'Slot coverage diagnostic mismatch');
       s.slotCoverageFailures+=!d.slotsCoveredExactlyOnce;s.relationProvenanceFailures+=!d.provenanceValid;
       if(v2){
        const roles=bound.map(p=>b.relation.slots.find(slot=>inside(p.sourceSpan,slot.span))?.role??'marker');
        const unique=[...new Set(roles.filter(r=>!['marker','context'].includes(r)))];
        const original=b.relation.slots.filter(slot=>slot.role!=='context').slice().sort((a,b)=>a.span.start-b.span.start).map(s=>s.role);
        const roleInverted=inverted(roles.filter(r=>original.includes(r)).map(r=>original.indexOf(r)));
        const text=p.nodes.find(n=>n.id===b.nodeId)?.text??'',sourceText=slice(row.source,b.sourceSpan);
        const sourceCount=q.sourceSentenceSpans.filter(s=>overlap(s,b.sourceSpan)).length,outputCount=text.split(/[。！？!?]+/u).filter(s=>s.trim()).length;
        const provenanceValid=b.relation.provenance.inputHash===q.sourceInputHash&&b.relation.provenance.parserVersion===q.sourceParserVersion;
        requireThat(eq(d.emittedRoleOrder,roles)&&eq(d.roles,unique)&&eq(d.sourceRoleOrder,original)&&d.sourceRoleOrderInverted===roleInverted,'Role order diagnostic mismatch');
        requireThat(d.sourceBlockText===sourceText&&d.outputBlockText===text&&d.actualBlockChanged===(sourceText!==text),'Block text diagnostic mismatch');
        requireThat(d.sourceSentenceCount===sourceCount&&d.outputGroupCount===outputCount&&d.groupingChange===outputCount-sourceCount,'Split/fusion diagnostic mismatch');
        requireThat(d.provenanceValid===provenanceValid,'Parser provenance diagnostic mismatch');
        const body=c.independentBoundedProof===true&&partitions.every(p=>p.pass)&&provenanceValid&&text!==sourceText&&unique.length>=2&&(roleInverted||outputCount!==sourceCount);
        requireThat(d.bodyComposition===body,'Block composition diagnostic mismatch');
       }
      }
      if(v2){const category=c.independentBoundedProof!==true?'invalid-structural-program':c.structuralDiagnostics.some(b=>b.bodyComposition)?'body-composition':'structural-fixed-form-only';requireThat(c.classification===category,'Structural classification mismatch');}
     }
     if(c.classification==='body-composition'){
      s.bodyPool++;s.bodyDisplayed+=c.displayOrdinal!==null;s.bodyTop+=c.displayOrdinal===1;
      requireThat(c.independentBoundedProof===true&&c.structuralDiagnostics.some(b=>b.roles.length>=2&&((v2?b.sourceRoleOrderInverted:b.sourceBoundOrderInverted)||b.groupingChange!==0)),'Unsupported body classification');
     }
     const moved=c.structuralDiagnostics.some(b=>v2?b.sourceRoleOrderInverted:b.sourceBoundOrderInverted),grouped=c.structuralDiagnostics.some(b=>b.groupingChange!==0);
     s.movementPool+=moved;s.movementDisplayed+=c.displayOrdinal!==null&&moved;s.groupingPool+=grouped;s.groupingDisplayed+=c.displayOrdinal!==null&&grouped;
     const category=s.classifications[c.classification]??={pool:0,displayed:0,top:0};category.pool++;category.displayed+=c.displayOrdinal!==null;category.top+=c.displayOrdinal===1;
    }
    const body=q.candidates.filter(c=>c.classification==='body-composition');s.bodyRequests+=body.length>0;s.bodyDisplayRequests+=body.some(c=>c.displayOrdinal!==null);
    const family=row.family??row.category??'prior-regression',g=s.family[family]??={requests:0,bodyRequests:0,bodyDisplayRequests:0,structuralRequests:0};g.requests++;g.bodyRequests+=body.length>0;g.bodyDisplayRequests+=body.some(c=>c.displayOrdinal!==null);g.structuralRequests+=q.candidates.some(c=>c.operator==='STRUCTURAL');
   }
  }
 }
 for(const side of ['before','after'])for(const [k,v] of Object.entries(totals[side]))requireThat(eq(x.summary[side][k],v),`Summary mismatch ${name}/${side}/${k}`);
 requireThat(x.summary.changedDisplayRequests===changedDisplayRequests,'Changed display summary mismatch');
 const summaryName=name.replace('-comparison.json.gz','-summary.json');if(idx.files[summaryName])requireThat(eq(read(path.join(dir,summaryName)),x.summary),'Standalone summary mismatch '+name);
 reports.push({file:name,auditVersion:x.summary.auditVersion??1,...totals});
}
for(const seal of [idx.sealedInput,...(idx.sealedInputs??[])].filter(Boolean)){const bytes=fs.readFileSync(path.join(dir,seal.file));requireThat(sha(bytes)===seal.sha256,'Seal mismatch');}
console.log(JSON.stringify({passed:true,files:Object.keys(idx.files).length,suites:reports},null,2));
