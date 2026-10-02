'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {PythonClient}=require('../../dist/packages/runtime/python-client');
const {compileAssets}=require('../../dist/packages/core/assets');
const {generate}=require('../../dist/packages/core/engine');
const {verifyGeneratedResult}=require('../../dist/packages/runtime/semantic-verification');
const {validateRewrite}=require('../../dist/packages/core/rewrite-validation');
let python,assets,references;
const saved=[];
before(async()=>{python=new PythonClient();await python.start();assets=compileAssets();references=new Map(assets.evidence.map(e=>[e.id,e.text]));});
after(()=>{python?.close();if(process.env.PUNCTUATION_OUTPUT_PATH)fs.writeFileSync(process.env.PUNCTUATION_OUTPUT_PATH,JSON.stringify({engine:assets.manifest.engine,rows:saved},null,2));});
async function run(source){const request={source,task:'rewrite',contextMode:'faithful',noveltyMode:'blend',intensity:2,series:'all',backend:'structured',clientRevision:0,seed:'punctuation-fix'};const analysis=await python.analyze(source);const result=await verifyGeneratedResult(generate(request,analysis,assets),python,analysis);saved.push({source,candidates:result.candidates.map(c=>c.text)});assert.ok(result.candidates.length,`${source}: ${JSON.stringify(result.reviewCandidates.map(c=>c.checks.filter(x=>x.status!=='pass')))}`);for(const c of result.candidates){assert.ok(validateRewrite(result.ir,c.plan,references));assert.ok(c.checks.every(x=>x.status==='pass'));}return result;}
test('prose full stops become line boundaries; terminal full stop is removed and んだが is not manufactured',async()=>{
 const result=await run('私は処理の速度をアピールしました。全員に助言したが、雰囲気は悪かった。');
 assert.ok(result.candidates.some(c=>/俺は処理の速さとスピードをアッピル/u.test(c.text)));
 assert.ok(result.candidates.some(c=>/全員にアドバイスを助言したが雰囲気/u.test(c.text)));
 for(const c of result.candidates){assert.doesNotMatch(c.text,/[。、]|んだが/u);assert.equal(c.text.split('\n').length,2);assert.match(c.text,/全員に(?:アドバイスを)?助言したが雰囲気/u);}
});
test('short plain sentences can change punctuation alone',async()=>{
 for(const source of ['今日は寒い。','確認した。']){const result=await run(source);for(const c of result.candidates)assert.doesNotMatch(c.text,/[。\n]|んだが/u);}
});
test('existing line and paragraph boundaries survive without doubled newlines',async()=>{
 for(const gap of ['\n','\r\n','\n\n']){const result=await run(`私は確認した。${gap}全員が待った。`);for(const c of result.candidates){assert.doesNotMatch(c.text,/。/u);assert.equal(c.text.split(gap).length,2);assert.equal(c.text.replace(gap,'').includes('\n'),false);}}
});
test('quotes, parenthesized content, question marks, URLs and values keep their punctuation',async()=>{
 const cases=[['私は「確認した。次は待つ、いいか？」と言った。','「確認した。次は待つ、いいか？」'],['私は（確認した。次に進む）と言った。','（確認した。次に進む）'],['私は3.14個を確認した。','3.14個'],['私はhttps://example.com/a?x=1を確認した。','https://example.com/a?x=1'],['私は確認した。全員は来る？','は来る？']];
 for(const [source,kept] of cases){const result=await run(source);for(const c of result.candidates){assert.ok(c.text.includes(kept),c.text);assert.ok(!c.text.endsWith('。'),c.text);}}
});
test('list commas and nested/unclosed quotation punctuation are not stripped',async()=>{
 for(const [source,kept] of [['私はりんご、バナナを買った。','りんご、バナナ'],['私は「彼は『確認した。』と言った。」と言った。','「彼は『確認した。』と言った。」'],['私は「確認した。次に待つ。','「確認した。次に待つ。']]){const result=await run(source);for(const c of result.candidates)assert.ok(c.text.includes(kept),c.text);}
});
test('forged period removal inside a quote is rejected by independent rewrite validation',async()=>{
 const result=await run('私は「確認した。」と言った。'),plan=structuredClone(result.candidates[0].plan);
 const edit=plan.rewrite.edits.find(e=>e.ruleId.startsWith('punctuation-end-'));assert.ok(edit);
 const start=[...result.ir.source.raw].indexOf('。');edit.sourceSpan={start,end:start+1};
 assert.equal(validateRewrite(result.ir,plan,references),false);
});
