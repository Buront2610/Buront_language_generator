'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const dir=path.resolve(process.argv[2]??'artifacts/typed-rhetorical-generation-20261006');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(p.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(p)):fs.readFileSync(p,'utf8'));
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function requireThat(ok,message){if(!ok)throw Error(message);}
const idx=read(path.join(dir,'index.json'));
for(const [name,meta] of Object.entries(idx.files)){const b=fs.readFileSync(path.join(dir,name));requireThat(sha(b)===meta.sha256&&b.length===meta.bytes,'File mismatch '+name);}
const reports=[];
for(const name of Object.keys(idx.files).filter(f=>f.endsWith('-comparison.json.gz'))){
 const x=read(path.join(dir,name));requireThat(x.format==='deduplicated-structural-comparison-v1','Unknown comparison format');
 const totals={before:{cases:x.rows.length,requests:0,candidates:0,displayed:0,structuralPool:0,structuralDisplayed:0,bodyPool:0,bodyDisplayed:0,bodyTop:0,nonNullSQ:0,invalidBoundedProof:0,nonPassingDisplayed:0},after:{cases:x.rows.length,requests:0,candidates:0,displayed:0,structuralPool:0,structuralDisplayed:0,bodyPool:0,bodyDisplayed:0,bodyTop:0,nonNullSQ:0,invalidBoundedProof:0,nonPassingDisplayed:0}};
 for(const row of x.rows){requireThat(typeof row.source==='string'&&/^[a-f0-9]{64}$/u.test(row.sourceAnalysisHash),'Missing source hash '+row.id);
  for(const request of row.results)for(const side of ['before','after']){const q=request[side],s=totals[side];s.requests++;if(q.error)continue;requireThat(q.intensity===request.intensity,'Intensity mismatch');s.candidates+=q.candidates.length;s.displayed+=q.selected.length;
   const displayed=q.candidates.filter(c=>c.displayOrdinal!==null).sort((a,b)=>a.displayOrdinal-b.displayOrdinal);
   requireThat(eq(displayed.map(c=>({id:c.id,planId:c.planId,text:c.text})),q.selected),'Display order mismatch '+row.id);
   requireThat(displayed.every((c,i)=>c.displayOrdinal===i+1),'Noncontiguous ordinal');
   for(const c of q.candidates){const p=x.plans[c.planId];requireThat(p&&p.id===c.planId,'Missing plan '+c.planId);requireThat(c.evidenceIds.every(id=>x.evidence[id]),'Missing evidence');requireThat(c.checkIds.every(id=>x.checks[id]),'Missing check');const checks=c.checkIds.map(id=>x.checks[id]);
    requireThat(c.allChecksPass===checks.every(t=>t.status==='pass'),'Check summary mismatch');requireThat(c.sqNull===(c.scores.S===null&&c.scores.Q===null),'S/Q summary mismatch');s.nonNullSQ+=!c.sqNull;s.invalidBoundedProof+=c.independentBoundedProof===false;s.nonPassingDisplayed+=c.displayOrdinal!==null&&(!c.allChecksPass||c.verificationStatus!=='passed');
    if(p.structural){s.structuralPool++;s.structuralDisplayed+=c.displayOrdinal!==null;requireThat(c.text===p.nodes.map(n=>n.text).join(''),'Structural text/plan mismatch');
     requireThat(c.structuralDiagnostics.length===p.structural.blocks.length,'Missing block diagnostics');
     for(let i=0;i<p.structural.blocks.length;i++){const b=p.structural.blocks[i],d=c.structuralDiagnostics[i];requireThat(b.operatorId===d.operatorId&&b.realizationId===d.realizationId,'Operation mismatch');requireThat(eq(b.sourceSpan,d.sourceSpan),'Span mismatch');requireThat(b.relation.provenance.inputHash===sha(row.source),'Source provenance mismatch');requireThat(b.evidenceIds.every(id=>c.evidenceIds.includes(id)),'Missing block evidence');
      const spans=b.pieces.filter(p=>p.sourceSpan).map(p=>p.sourceSpan);requireThat(d.sourceBoundOrderInverted===spans.some((p,j)=>j&&p.start<spans[j-1].start),'Movement diagnostic mismatch');
     }
    }
    if(c.classification==='body-composition'){s.bodyPool++;s.bodyDisplayed+=c.displayOrdinal!==null;s.bodyTop+=c.displayOrdinal===1;requireThat(c.independentBoundedProof===true&&c.structuralDiagnostics.some(b=>b.roles.length>=2&&(b.sourceBoundOrderInverted||b.groupingChange!==0)),'Unsupported body classification');}
   }
  }
 }
 for(const side of ['before','after'])for(const [k,v] of Object.entries(totals[side]))requireThat(x.summary[side][k]===v,`Summary mismatch ${name}/${side}/${k}`);
 reports.push({file:name,...totals});
}
if(idx.sealedInput){const bytes=fs.readFileSync(path.join(dir,idx.sealedInput.file));requireThat(sha(bytes)===idx.sealedInput.sha256,'Seal mismatch');}
console.log(JSON.stringify({passed:true,files:Object.keys(idx.files).length,suites:reports},null,2));
