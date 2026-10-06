'use strict';
// Additional domain-matched coverage. Historical any-body classification is not
// changed: an unrelated body block must not stand in for the requested domain.
const fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
const [comparisonFile,casesFile,outPrefix]=process.argv.slice(2);
if(!comparisonFile||!casesFile||!outPrefix)throw Error('Usage: node report-typed-rhetorical-domain-matches.cjs COMPACT.json.gz CASES.json OUTPUT_PREFIX');
const read=p=>JSON.parse(p.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(p)):fs.readFileSync(p)),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const x=read(comparisonFile),inputs=read(casesFile),caseMap=new Map(inputs.cases.map(c=>[c.id,c]));
const relationKinds={reason:'reason-claim',modesty:'modest-achievement','evidence-request':'evidence-request'};
const rows=x.rows.flatMap(row=>{
 const c=caseMap.get(row.id);if(!c||c.source!==row.source)throw Error('Case/source mismatch '+row.id);
 const expectedKind=relationKinds[c.developmentDomain];if(!expectedKind)return [];
 const results=row.results.map(q=>{
  const all=q.after.candidates??[],any=all.filter(c=>c.classification==='body-composition');
  const matched=any.filter(c=>c.structuralDiagnostics.some(b=>b.bodyComposition===true&&b.kind===expectedKind));
  return {intensity:q.intensity,anyBodyPool:any.length,anyBodyDisplayed:any.filter(c=>c.displayOrdinal!==null).length,domainMatchedBodyPool:matched.length,domainMatchedBodyDisplayed:matched.filter(c=>c.displayOrdinal!==null).length,domainMatchedFirst:matched.some(c=>c.displayOrdinal===1),bodyCandidates:any.map(c=>({text:c.text,displayOrdinal:c.displayOrdinal,matchedDomain:c.structuralDiagnostics.some(b=>b.bodyComposition===true&&b.kind===expectedKind),blocks:c.structuralDiagnostics.map(b=>({kind:b.kind,operatorId:b.operatorId,realizationId:b.realizationId,bodyComposition:b.bodyComposition,sourceSpan:b.sourceSpan,sourceBlockText:b.sourceBlockText,outputBlockText:b.outputBlockText}))}))};
 });
 return [{id:row.id,source:row.source,domain:c.developmentDomain,cohort:c.developmentCohort,pair:c.developmentPair,expectedRelationKind:expectedKind,anyBodyPool:results.some(r=>r.anyBodyPool>0),anyBodyDisplayed:results.some(r=>r.anyBodyDisplayed>0),domainMatchedBodyPool:results.some(r=>r.domainMatchedBodyPool>0),domainMatchedBodyDisplayed:results.some(r=>r.domainMatchedBodyDisplayed>0),results}];
});
function aggregate(list){return {cases:list.length,anyBodyPoolCases:list.filter(r=>r.anyBodyPool).length,anyBodyDisplayedCases:list.filter(r=>r.anyBodyDisplayed).length,domainMatchedBodyPoolCases:list.filter(r=>r.domainMatchedBodyPool).length,domainMatchedBodyDisplayedCases:list.filter(r=>r.domainMatchedBodyDisplayed).length,poolMismatchIds:list.filter(r=>r.anyBodyPool&&!r.domainMatchedBodyPool).map(r=>r.id),displayMismatchIds:list.filter(r=>r.anyBodyDisplayed&&!r.domainMatchedBodyDisplayed).map(r=>r.id),noMatchedBodyPoolIds:list.filter(r=>!r.domainMatchedBodyPool).map(r=>r.id),noMatchedBodyDisplayIds:list.filter(r=>!r.domainMatchedBodyDisplayed).map(r=>r.id)};}
const group={};for(const r of rows)(group[r.cohort+'/'+r.domain]??=[]).push(r);
const pairs={};for(const r of rows.filter(r=>r.pair))(pairs[r.pair]??=[]).push(r);
const pairRows=Object.fromEntries(Object.entries(pairs).map(([name,p])=>[name,{caseIds:p.map(c=>c.id),bothAnyBodyPool:p.every(c=>c.anyBodyPool),bothAnyBodyDisplayed:p.every(c=>c.anyBodyDisplayed),bothDomainMatchedPool:p.every(c=>c.domainMatchedBodyPool),bothDomainMatchedDisplayed:p.every(c=>c.domainMatchedBodyDisplayed)}]));
const result={schemaVersion:1,sourceHash:x.summary.afterMeta.buildInfo.sourceHash,engineHash:x.summary.afterMeta.engineHash,originalComparisonInputHash:x.summary.afterMeta.inputSetHash,metadataInputHash:sha(fs.readFileSync(casesFile)),comparisonHash:sha(fs.readFileSync(comparisonFile)),scriptHash:sha(fs.readFileSync(__filename)),method:'Historical any-body classifications remain unchanged. Domain-matched body requires an independently proved actual body-composition block (not merely a STRUCTURAL label or other block) with the expected relation kind for that case. All cases are exposed development; this is not human style/quality.',relationKinds,overall:aggregate(rows),domain:Object.fromEntries(Object.keys(relationKinds).map(d=>[d,aggregate(rows.filter(r=>r.domain===d))])),cohortDomain:Object.fromEntries(Object.entries(group).map(([n,rs])=>[n,aggregate(rs)])),pairs:pairRows,rows};
fs.writeFileSync(outPrefix+'.json',JSON.stringify(result,null,2)+'\n');
let md=`# Domain-matched body audit\n\nSourceHash: \`${result.sourceHash}\`. All cases are exposed development. Historical any-body definitions/counts are retained unchanged. A domain-matched case needs a body-composition block of its requested relation family: reason-claim, modest-achievement or evidence-request. An unrelated reason edit cannot stand in for an untransformed evidence request.\n\n| Cohort/domain | Cases | Any body pool / display | Domain-matched body pool / display |\n|---|---:|---:|---:|\n`;
for(const [name,s]of Object.entries({...result.cohortDomain,ALL:result.overall}))md+=`| ${name} | ${s.cases} | ${s.anyBodyPoolCases} / ${s.anyBodyDisplayedCases} | ${s.domainMatchedBodyPoolCases} / ${s.domainMatchedBodyDisplayedCases} |\n`;
md+='\n## Mismatches\n\n';const mismatches=rows.filter(r=>r.anyBodyPool&&!r.domainMatchedBodyPool||r.anyBodyDisplayed&&!r.domainMatchedBodyDisplayed);
if(!mismatches.length)md+='No case-level coverage difference. The JSON still records each candidate/block so related or unrelated secondary edits remain inspectable.\n';
for(const r of mismatches){md+=`- ${r.id} (${r.domain}): ${r.source}\n`;for(const q of r.results)for(const c of q.bodyCandidates)md+=`  - intensity ${q.intensity}, display ${c.displayOrdinal??'pool only'}, domain match ${c.matchedDomain}: ${c.text}\n`;}
fs.writeFileSync(outPrefix+'.md',md);console.log(JSON.stringify({outPrefix,overall:result.overall,domain:result.domain}));
