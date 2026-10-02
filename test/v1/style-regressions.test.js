'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {PythonClient}=require('../../dist/packages/runtime/python-client');
const {compileAssets}=require('../../dist/packages/core/assets');
const {generate}=require('../../dist/packages/core/engine');
const {makeRewritePlans}=require('../../dist/packages/core/rewrite');
const {validateRewrite}=require('../../dist/packages/core/rewrite-validation');
const {validateCandidate,realize,verification}=require('../../dist/packages/core/validator');
const {verifyGeneratedResult}=require('../../dist/packages/runtime/semantic-verification');
const {ruleQuality}=require('../../dist/packages/core/evaluation');
const {sourceDocument}=require('../../dist/packages/core/source');
const {extractFacts}=require('../../dist/packages/core/facts');
const {rewriteRuleById}=require('../../dist/packages/core/rewrite-rules');
const {renderEdits}=require('../../dist/packages/core/rewrite-validation');
let python,assets,references,evidenceIds;
before(async()=>{python=new PythonClient();await python.start();assets=compileAssets();references=new Map(assets.evidence.map(e=>[e.id,e.text]));evidenceIds=new Set(references.keys())});
after(()=>python?.close());
const request=(source,options={})=>({source,noveltyMode:'blend',task:'rewrite',contextMode:'faithful',intensity:2,series:'all',backend:'structured',clientRevision:1,seed:'full-reread-regression',...options});
async function run(source,options={}){const req=request(source,options),analysis=await python.analyze(source);return verifyGeneratedResult(generate(req,analysis,assets),python,analysis)}
function check(ir,plan){const out=realize(plan,ir);return verification(validateCandidate(ir,plan,out.text,out.spans,evidenceIds,undefined,references,assets.seriesProfiles))}
test('general readings are not injected as distinctive spelling at any intensity',async()=>{
 for(const intensity of [1,2,3]){const result=await run('私は全員の雰囲気を確認した。',{intensity});assert.ok(result.candidates.length);for(const c of result.candidates){assert.match(c.text,/全員の雰囲気/u);assert.doesNotMatch(c.text,/ふいんき|ぜいいん/u);assert.ok(c.checks.every(x=>x.status==='pass'));}}
 const original=await run('私はぜいいんのふいんきを確認した。');assert.ok(original.candidates.length);for(const c of original.candidates)assert.match(c.text,/ぜいいんのふいんき/u);
});
test('withdrawn spelling edits cannot be reinstated by supplying their real archived evidence',async()=>{
 const result=await run('私は全員の雰囲気を確認した。');assert.ok(result.candidates.length);
 for(const [id,from,to,evidenceId] of [['fuinki','雰囲気','ふいんき','post_02212_b32699bc7773619d_8422'],['zei-in','全員','ぜいいん','post_01694_7cde927e1222c449_5687']]){
  assert.ok(references.get(evidenceId).includes(to));assert.equal(rewriteRuleById.has(id),false);
  const plan=structuredClone(result.candidates[0].plan),start=[...result.ir.source.raw.slice(0,result.ir.source.raw.indexOf(from))].length;
  const node=plan.nodes.find(n=>n.sourceSpan.start<=start&&n.sourceSpan.end>=start+[...from].length);
  plan.rewrite.edits.push({nodeId:node.id,sourceSpan:{start,end:start+[...from].length},ruleId:id,from,to,evidenceIds:[evidenceId]});
  const edits=plan.rewrite.edits.filter(e=>e.nodeId===node.id);node.text=renderEdits(result.ir.source.raw,node,edits);node.evidenceIds=[...new Set(edits.flatMap(e=>e.evidenceIds))];plan.evidenceIds=[...new Set(plan.rewrite.edits.flatMap(e=>e.evidenceIds))];
  assert.equal(validateRewrite(result.ir,plan,references),false);
 }
});
test('body rewriting composes attested vocabulary and semantic doubling without appended metaphors',async()=>{
 const result=await run('私は処理の速度をアピールしました。');assert.ok(result.candidates.length);
 assert.ok(result.candidates.some(c=>/俺は処理の速さとスピードをアッピル/u.test(c.text)));
 for(const c of result.candidates){assert.equal(c.plan.mainOperator,'REWRITE');assert.equal(c.novelty.classification,'adaptation');assert.equal(c.scores.S,null);assert.equal(c.scores.Q,null);assert.doesNotMatch(c.text,/試験官|助力|通行許可|ここ大事|関連する語録|【/u);assert.ok(c.plan.nodes.every(n=>n.type==='FactClause'));assert.ok(validateRewrite(result.ir,c.plan,references));assert.ok(c.checks.every(x=>x.status==='pass'));assert.ok(c.evidence.every(e=>e.kind==='construction_evidence'))}
});
test('ordinary inputs produce short rewrites without invented people, analogies or lessons',async()=>{
 for(const source of ['今日は寒い。','今日は寒いです。','田中が佐藤を助けた。','Bは停止中だ。']){const result=await run(source);assert.ok(result.candidates.length,source);for(const c of result.candidates){assert.ok(c.text.length<source.length+12,c.text);assert.equal(c.text.split('。').filter(Boolean).length,1)}}
});
test('uncertainty, questions, gratitude and quotations are not turned into boasting or certainty',async()=>{
 for(const source of ['私は明日確認するかもしれない。','もし全員が来れば確認する。','田中は「私は全員に助言します」と言った。','私は助言したと田中が言った。','確認してくれてありがとうございます。','どうすればいいですか？']){const result=await run(source);for(const c of result.candidates){assert.doesNotMatch(c.text,/確定的|それほどでもない|からな|んだが/u);if(source.includes('「'))assert.ok(c.text.includes('「私は全員に助言します」'));if(source.includes('かもしれない'))assert.ok(c.text.includes('かもしれない'))}}
});
test('negation, past tense, numbers, roles and compound words survive body edits',async()=>{
 for(const source of ['私は確認しませんでした。','私はAからBへ3個を渡した。','私は100件の記録を確認した。','私立学校で雰囲気を調べた。','速度制限を確認した。']){const result=await run(source);assert.ok(result.candidates.length,source);for(const c of result.candidates){assert.equal(c.checks.find(x=>x.code==='V-quantity').status,'pass');if(source.includes('しませんでした'))assert.match(c.text,/しませんでした|しなかった/u);for(const literal of ['AからBへ3個','100件','私立学校','速度制限'])if(source.includes(literal))assert.ok(c.text.includes(literal),c.text)}}
});
test('forged text, edit destinations, offsets, rule IDs and evidence cannot self-certify',async()=>{
 const result=await run('私は100件の記録を確認した。'),original=result.candidates[0].plan;
 const mutations=[p=>{p.nodes[0].text=p.nodes[0].text.replace('100','200')},p=>{p.nodes[0].text=p.nodes[0].text.replace('俺','田中')},p=>{p.rewrite.edits[0].to='田中';p.nodes[0].text=p.nodes[0].text.replace('俺','田中')},p=>{p.rewrite.edits[0].sourceSpan.start++},p=>{p.rewrite.edits[0].ruleId='invented'},p=>{p.rewrite.edits[0].evidenceIds=['fake']},p=>{p.nodes[0].text+='（ここ大事）'},p=>{p.rewrite.edits=[]},p=>{p.nodes[0].type='RhetoricalClause'}];
 for(const mutate of mutations){const plan=structuredClone(original);mutate(plan);assert.notEqual(check(result.ir,plan),'passed');assert.equal(ruleQuality(result.ir,plan).C,0)}
});
test('invent abstains from finite adaptations and dictionaries cannot silently change facts',async()=>{
 const invented=await run('私は処理の速度をアピールした。',{noveltyMode:'invent'});assert.equal(invented.candidates.length,0);assert.equal(invented.shortfallReason,'unsupported_generation_mode');
 const edited=await run('私は確認した。',{customRules:[{id:'bad',from:'俺',to:'田中',priority:1}]});assert.equal(edited.candidates.length,0);assert.ok(edited.reviewCandidates.length);assert.equal(edited.shortfallReason,'dictionary_needs_review');
});
test('rules have original-post evidence in the requested series; unavailable rules abstain',async()=>{
 const source='私は処理の速度をアピールした。',analysis=await python.analyze(source);
 for(const series of ['all',...assets.series.map(s=>s.id)]){const req=request(source,{series}),ir=extractFacts(sourceDocument(source),analysis,req);for(const plan of makeRewritePlans(ir,req,assets))for(const id of plan.evidenceIds){const evidence=assets.evidence.find(e=>e.id===id);assert.equal(evidence.sourceType,'original_post');assert.ok(series==='all'||evidence.series.includes(series))}}
});
test('regeneration retains locked body edits and deterministic requests reproduce',async()=>{
 const source='私は速度をアピールした。全員に助言した。',req=request(source),analysis=await python.analyze(source),first=generate(req,analysis,assets),parent=first.candidates[0];assert.ok(parent);
 const next=generate({...req,seed:'second'},analysis,assets,{lockedPlan:parent.plan,lockedNodeIds:[parent.plan.nodes[0].id]});assert.ok(next.candidates.length);for(const c of next.candidates)assert.equal(c.plan.nodes[0].text,parent.plan.nodes[0].text);assert.deepEqual(generate(req,analysis,assets).candidates,first.candidates);
});
