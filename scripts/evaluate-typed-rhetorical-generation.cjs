'use strict';
// Raw schema-agnostic recorder, frozen before implementation. Derived structural
// diagnostics are computed separately so raw runs do not change with that code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const args=Object.fromEntries(process.argv.slice(2).flatMap((v,i,a)=>v.startsWith('--')?[[v.slice(2),a[i+1]]]:[]));
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,o)=>fs.writeFileSync(p,p.endsWith('.gz')?zlib.gzipSync(JSON.stringify(o)+'\n',{level:9}):JSON.stringify(o)+'\n');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function hashes(root){const files=[];function walk(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,d.name);if(d.isDirectory()&&!['generated','__pycache__'].includes(d.name))walk(f);else if(d.isFile()&&/\.(?:js|ts|py|json)$/u.test(d.name))files.push(f);}}for(const dir of ['packages','dist/packages','services/japanese-analysis'])walk(path.join(root,dir));return Object.fromEntries(files.sort().map(f=>[path.relative(root,f),sha(fs.readFileSync(f))]));}
async function run(){for(const k of ['engine-root','assets','cases','out','revision'])if(!args[k])throw Error('Missing --'+k);
const root=path.resolve(args['engine-root']),inputs=read(args.cases),initial=hashes(root);
const {PythonClient}=require(path.join(root,'dist/packages/runtime/python-client'));
const {loadAssets}=require(path.join(root,'dist/packages/core/assets'));
const {generate}=require(path.join(root,'dist/packages/core/engine'));
const {verifyGeneratedResult}=require(path.join(root,'dist/packages/runtime/semantic-verification'));
process.chdir(root);const assets=loadAssets(path.resolve(args.assets)),python=new PythonClient(root);
const result={meta:{schemaVersion:1,testedRevision:args.revision,startedAt:new Date().toISOString(),engineHashes:initial,engineHash:sha(JSON.stringify(initial)),buildInfo:read(path.join(root,'build-info.json')),assetFileHash:sha(fs.readFileSync(args.assets)),assetManifest:assets.manifest,datasetId:assets.datasetId,inputSetHash:sha(fs.readFileSync(args.cases)),protocol:inputs.protocol,settings:inputs.settings,captureScriptHash:sha(fs.readFileSync(__filename)),node:process.version,claim:'Exact candidate texts, proofs, checks and display order. No human style or quality ratings; S/Q null is checked.'},rows:[]};
try{result.meta.parser=await python.start();for(const item of inputs.cases){const row={...item,results:[]};try{const analysis=await python.analyze(item.source);row.sourceAnalysisHash=sha(JSON.stringify(analysis));row.sourceAnalysis=analysis;for(const intensity of inputs.settings.intensities){try{const req={...inputs.settings,source:item.source,intensity};delete req.intensities;delete req.experimentalOperators;
const start=performance.now(),g=generate(req,analysis,assets);const pool=g.candidatePool??[...g.candidates,...g.reviewCandidates];const pre=pool.map(c=>({id:c.id,planId:c.plan.id,verificationStatus:c.verificationStatus}));const verified=await verifyGeneratedResult(g,python,analysis);const order=new Map(verified.candidates.map((c,i)=>[c.id+':'+c.plan.id,i+1]));
row.results.push({intensity,elapsedMs:Math.round((performance.now()-start)*1000)/1000,ir:verified.ir,selectedCandidateId:verified.selectedCandidateId,selected:verified.candidates.map(c=>({id:c.id,planId:c.plan.id,text:c.text})),candidates:pool.map(c=>({...c,displayOrdinal:order.get(c.id+':'+c.plan.id)??null,preVerificationStatus:pre.find(p=>p.id===c.id&&p.planId===c.plan.id)?.verificationStatus??null})),fallback:verified.fallback,shortfallReason:verified.shortfallReason,replayManifest:verified.replayManifest,constructionDiagnostics:verified.constructionDiagnostics??null});console.log(JSON.stringify({id:item.id,intensity,pool:pool.length,display:verified.candidates.length}));
}catch(e){row.results.push({intensity,error:{message:e.message,validationErrors:e.validationErrors??null}});}}}catch(e){row.error={message:e.message};}result.rows.push(row);save(args.out+'.partial',result);}
result.meta.stableEngine=equal(initial,hashes(root));result.meta.finishedAt=new Date().toISOString();result.summary={cases:result.rows.length,requests:result.rows.flatMap(r=>r.results).length,errors:result.rows.filter(r=>r.error).length+result.rows.flatMap(r=>r.results).filter(r=>r.error).length};save(args.out,result);fs.unlinkSync(args.out+'.partial');console.log(JSON.stringify({completed:true,stableEngine:result.meta.stableEngine,...result.summary,out:args.out}));if(!result.meta.stableEngine||result.summary.errors)process.exitCode=1;
}finally{python.close();}}
run().catch(e=>{console.error(e);process.exitCode=1;});
