'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const [rawFile,comparisonFile,engineRoot,outPrefix]=process.argv.slice(2);
if(!rawFile||!comparisonFile||!engineRoot||!outPrefix)throw Error('Usage: node audit-typed-rhetorical-development-stages.cjs RAW_AFTER.json.gz COMPACT.json.gz FROZEN_ENGINE OUTPUT_PREFIX');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(p))),raw=read(rawFile),comparison=read(comparisonFile),root=path.resolve(engineRoot);
function checkEngine(){for(const [file,h]of Object.entries(raw.meta.engineHashes))if(sha(fs.readFileSync(path.join(root,file)))!==h)throw Error('Engine changed '+file);}
checkEngine();if(raw.meta.engineHash!==comparison.summary.afterMeta.engineHash)throw Error('Engine identity mismatch');
if(raw.meta.inputSetHash!==comparison.summary.afterMeta.inputSetHash)throw Error('Input identity mismatch');
const recognize=require(path.join(root,'dist/packages/core/rhetorical-recognition')).recognizeRhetoricalRelations;
const realizations=require(path.join(root,'dist/packages/core/rhetorical-operators')).relationRealizations;
const indexed=new Map(comparison.rows.map(r=>[r.id,r]));
const rows=raw.rows.map(row=>{
 const paired=indexed.get(row.id);if(!paired||paired.source!==row.source)throw Error('Source mismatch '+row.id);
 const first=row.results.find(q=>q.ir),relations=first?recognize(first.ir):[];
 const requests=paired.results.map(request=>{
  const q=request.after,c=q.candidates??[],structural=c.filter(c=>c.operator==='STRUCTURAL'),body=c.filter(c=>c.classification==='body-composition'),displayed=body.filter(c=>c.displayOrdinal!==null);
  const eligibleRealizations=relations.flatMap(r=>realizations(r,request.intensity)).length;
  const category=q.error?'request-error':displayed.length?'body-displayed':body.length?'body-pool-not-displayed':structural.length?'structural-fixed-form-only':relations.length?(eligibleRealizations?'recognized-but-no-structural-pool':'recognized-no-realization-at-intensity'):'no-recognized-relation';
  return {intensity:request.intensity,eligibleRealizations,category,plannedStructuralPool:structural.length,bodyPool:body.length,bodyDisplayed:displayed.length,independentFailedProofs:c.filter(c=>c.independentBoundedProof===false).length,nonPassingDisplays:c.filter(c=>c.displayOrdinal!==null&&(!c.allChecksPass||c.verificationStatus!=='passed')).length};
 });
 return {id:row.id,source:row.source,cohort:row.developmentCohort,domain:row.developmentDomain,recognitionCount:relations.length,recognizedRelations:relations.map(r=>({kind:r.kind,sourceForm:r.sourceForm,sourceSpan:r.sourceSpan,slotRoles:r.slots.map(s=>s.role)})),requests};
});
function stats(list){const requests=list.flatMap(r=>r.requests),categories={};for(const q of requests)categories[q.category]=(categories[q.category]??0)+1;return {cases:list.length,requests:requests.length,recognizedCases:list.filter(r=>r.recognitionCount>0).length,plannedStructuralCases:list.filter(r=>r.requests.some(q=>q.plannedStructuralPool>0)).length,bodyPoolCases:list.filter(r=>r.requests.some(q=>q.bodyPool>0)).length,bodyDisplayedCases:list.filter(r=>r.requests.some(q=>q.bodyDisplayed>0)).length,requestCategories:categories,noRecognitionIds:list.filter(r=>!r.recognitionCount).map(r=>r.id),noBodyPoolIds:list.filter(r=>r.requests.every(q=>!q.bodyPool)).map(r=>r.id),noBodyDisplayIds:list.filter(r=>r.requests.every(q=>!q.bodyDisplayed)).map(r=>r.id)};}
const grouped={};for(const r of rows){const key=r.cohort+'/'+r.domain;(grouped[key]??=[]).push(r);}
const out={schemaVersion:1,sourceHash:raw.meta.buildInfo.sourceHash,engineHash:raw.meta.engineHash,inputHash:raw.meta.inputSetHash,scriptHash:sha(fs.readFileSync(__filename)),claims:['Every case is exposed development; no unseen claim.','Recognition is independently rerun on retained original IR using the frozen recognizer.','Planned structural count means a structural plan retained in the complete raw candidate pool, not every internal search attempt.','Registered realization eligibility is rerun at each intensity; evidence requests intentionally have no realization at intensity 2.',
 'No-recognition and no-pool are observed noncoverage categories, not inferred linguistic refusal reasons or safety certifications.','Body and display classifications come unchanged from the separately audited comparison; S/Q null.'],overall:stats(rows),ordinary54:stats(rows.filter(r=>['reason','modesty','evidence-request'].includes(r.domain))),domain:Object.fromEntries(['reason','modesty','evidence-request'].map(d=>[d,stats(rows.filter(r=>r.domain===d))])),cohortDomain:Object.fromEntries(Object.entries(grouped).map(([name,list])=>[name,stats(list)])),rows};
checkEngine();fs.writeFileSync(outPrefix+'.json',JSON.stringify(out,null,2)+'\n');
let md=`# Exposed development pipeline stages\n\nSnapshot sourceHash: \`${out.sourceHash}\`. All 203 cases are exposed. Recognition is rerun from retained original IR; planned counts mean source-structural plans present in the raw pool. Noncoverage labels do not claim a specific linguistic rejection reason.\n\n| Cohort/domain | Cases | Recognized | Structural plan in pool | Actual body in pool | Actual body displayed |\n|---|---:|---:|---:|---:|---:|\n`;
for(const [name,s]of Object.entries(out.cohortDomain))md+=`| ${name} | ${s.cases} | ${s.recognizedCases} | ${s.plannedStructuralCases} | ${s.bodyPoolCases} | ${s.bodyDisplayedCases} |\n`;
md+='\n## Request noncoverage categories\n\n';for(const [domain,s]of Object.entries(out.domain))md+=`- ${domain}: ${JSON.stringify(s.requestCategories)}\n`;
md+='\n## Ordinary cases with no displayed body composition\n\n';for(const row of rows.filter(r=>['reason','modesty','evidence-request'].includes(r.domain)&&r.requests.every(q=>!q.bodyDisplayed)))md+=`- ${row.id}: ${row.source} (${row.requests.map(q=>q.intensity+':'+q.category).join('; ')})\n`;
fs.writeFileSync(outPrefix+'.md',md);console.log(JSON.stringify({outPrefix,domain:out.domain,ordinary54:out.ordinary54}));
