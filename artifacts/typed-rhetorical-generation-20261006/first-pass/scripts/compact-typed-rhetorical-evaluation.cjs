'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node compact-structural-evaluation.cjs INPUT.json.gz OUTPUT.json.gz');
const read=JSON.parse(zlib.gunzipSync(fs.readFileSync(input))),sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const plans={},evidence={},checks={};
function intern(map,key,value){if(map[key]&&sha(map[key])!==sha(value))throw Error('Dictionary collision '+key);map[key]=value;return key;}
function candidate(c){intern(plans,c.planId,c.plan);const evidenceIds=c.evidence.map(e=>intern(evidence,e.id,e));const checkIds=c.checks.map(e=>intern(checks,sha(e).slice(0,20),e));
 const o={...c};delete o.plan;delete o.evidence;delete o.checks;delete o.sourceProvenance;
 return {...o,evidenceIds,checkIds,structuralDiagnostics:c.sourceProvenance.blocks.map(b=>({...b,slotPartition:b.slotPartition.map(s=>{const x={...s};delete x.source;return x;})}))};}
function request(q){return {...q,candidates:q.candidates?.map(candidate)}}
if(read.before.length!==read.after.length)throw Error('Row mismatch');
const rows=read.before.map((b,i)=>{const a=read.after[i];if(b.id!==a.id||b.source!==a.source||b.sourceAnalysisHash!==a.sourceAnalysisHash)throw Error('Source mismatch');
 return {...Object.fromEntries(Object.entries(b).filter(([k])=>k!=='results')),results:b.results.map((q,j)=>{const r=a.results[j];if(q.intensity!==r.intensity)throw Error('Intensity mismatch');return {intensity:q.intensity,before:request(q),after:request(r)};})};});
const result={schemaVersion:1,format:'deduplicated-structural-comparison-v1',note:'Every candidate text and display ordinal retained. Full plans, evidence records and check explanations are dictionaries keyed by planId, evidenceIds and checkIds. Original source analysis is reproducible from pinned parser and sourceAnalysisHash; raw repeated IR is kept outside the repository.',summary:read.summary,plans,evidence,checks,rows};
fs.writeFileSync(output,zlib.gzipSync(JSON.stringify(result)+'\n',{level:9}));
// Readback verifies dictionary resolution, raw text and display order before delivery.
const restored=JSON.parse(zlib.gunzipSync(fs.readFileSync(output)));let count=0;
for(let i=0;i<rows.length;i++)for(let j=0;j<rows[i].results.length;j++)for(const side of ['before','after']){
 const actual=restored.rows[i].results[j][side],expected=read[side][i].results[j];if(JSON.stringify(actual.selected)!==JSON.stringify(expected.selected))throw Error('Selected-order mismatch');
 for(let k=0;k<(actual.candidates??[]).length;k++){const c=actual.candidates[k],e=expected.candidates[k];if(c.text!==e.text||c.displayOrdinal!==e.displayOrdinal||sha(restored.plans[c.planId])!==sha(e.plan)||sha(c.checkIds.map(id=>restored.checks[id]))!==sha(e.checks)||sha(c.evidenceIds.map(id=>restored.evidence[id]))!==sha(e.evidence))throw Error('Lossy candidate');count++;}}
console.log(JSON.stringify({output,bytes:fs.statSync(output).size,candidates:count,plans:Object.keys(plans).length,evidence:Object.keys(evidence).length,checkVariants:Object.keys(checks).length,losslessCandidateReadback:true}));
