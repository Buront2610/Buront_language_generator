'use strict';
// Generic sealed fixture adapter. Never run against a new prospective input
// until the parent explicitly authorizes final code freeze and first exposure.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const args=Object.fromEntries(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith('--')?[[v.slice(2),a[i+1]]]:[]));
for(const name of ['sealed','seal','settings-source','freeze-record','out','exposure-record','expected-count'])if(!args[name])throw Error('Missing --'+name);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p));
const freeze=read(args['freeze-record']);
if(freeze.prospectiveEvaluationAuthorized!==true||!freeze.frozenAt||!freeze.sourceHash||!freeze.parentExplicitFreezeSignal)throw Error('Requires recorded explicit final freeze and prospective authorization; a development snapshot is insufficient');
if(fs.existsSync(args.out)||fs.existsSync(args['exposure-record']))throw Error('Refusing to overwrite first exposure/execution input');
const seal=read(args.seal),expectedHash=seal.sha256??seal.sealedFileSha256;
if(!/^[a-f0-9]{64}$/.test(expectedHash??''))throw Error('Missing SHA-256 seal');
const bytes=fs.readFileSync(args.sealed);if(sha(bytes)!==expectedHash)throw Error('Sealed input hash mismatch');
const exposure={schemaVersion:1,firstExposureAt:new Date().toISOString(),frozenAt:freeze.frozenAt,sourceHash:freeze.sourceHash,freezeRecordHash:sha(fs.readFileSync(args['freeze-record'])),sealedInputHash:expectedHash,adapterHash:sha(fs.readFileSync(__filename)),role:'first prospective synthetic run only; every later rerun is exposed regression',noPostfreezeCoverageRetuning:true,status:'exposed; parsing/validation pending'};
fs.writeFileSync(args['exposure-record'],JSON.stringify(exposure,null,2)+'\n');
try{
 const sealed=JSON.parse(bytes),cases=Array.isArray(sealed)?sealed:sealed.cases;
 const count=Number(args['expected-count']);if(!Number.isInteger(count)||!Array.isArray(cases)||cases.length!==count)throw Error('Unexpected case count');
 const settingsFixture=read(args['settings-source']);if(!settingsFixture.settings||!Array.isArray(settingsFixture.settings.intensities))throw Error('Missing frozen settings');
 const fields=new Set(),ids=new Set();
 const mapped=cases.map(c=>{
  if(!c||typeof c!=='object'||Array.isArray(c)||typeof c.id!=='string'||ids.has(c.id))throw Error('Missing/duplicate case ID');ids.add(c.id);
  const choices=['source','input','text'].filter(k=>typeof c[k]==='string');if(!choices.length)throw Error('Missing source/input/text string '+c.id);
  if(choices.some(k=>c[k]!==c[choices[0]]))throw Error('Conflicting source fields '+c.id);
  fields.add(choices[0]);const source=c[choices[0]];
  if(!source.length)throw Error('Empty input '+c.id);
  return {...c,source,family:c.family??c.domain??'unspecified',group:c.group??c.kind??'unspecified',currentRole:'third-pass-prospective-synthetic-first-run'};
 });
 const input={schemaVersion:1,protocol:'Single prospective synthetic evaluation after explicit final core freeze; unchanged source text and frozen settings. Not a random natural-language sample or human S/Q; subsequent reruns are exposed regressions.',settings:settingsFixture.settings,cases:mapped};
 fs.writeFileSync(args.out,JSON.stringify(input,null,2)+'\n');
 const readback=read(args.out);if(readback.cases.some((c,i)=>c.source!==mapped[i].source))throw Error('Source text changed in serialization');
 exposure.status='input prepared; neither engine invoked by adapter';exposure.caseCount=count;exposure.sourceFields=[...fields].sort();exposure.executionInputHash=sha(fs.readFileSync(args.out));exposure.mapping='Preserve all original case fields; source/input/text copied to source unchanged; family defaults to domain and group to kind only when absent';
}catch(error){exposure.status='adapter failed before any engine invocation';exposure.error=error.message;throw error;}
finally{fs.writeFileSync(args['exposure-record'],JSON.stringify(exposure,null,2)+'\n');}
console.log(JSON.stringify(exposure));
