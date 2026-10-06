'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PythonClient } = require('../../dist/packages/runtime/python-client');
const { compileAssets } = require('../../dist/packages/core/assets');
const { generate } = require('../../dist/packages/core/engine');
const { validateConstruction, makeConstructionPlans } = require('../../dist/packages/core/constructions');
const { realize, validateCandidate, verification } = require('../../dist/packages/core/validator');
const { verifyGeneratedResult } = require('../../dist/packages/runtime/semantic-verification');
const fixtures = ['reason', 'contrast', 'modesty'].flatMap(kind => require(`../fixtures/ginza-discourse-${kind}.json`).cases);
const request = (source, extra = {}) => ({ source, task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured', clientRevision: 0, seed: 'bounded-discourse', ...extra });
const ids = new Set(['explicit-reason', 'explicit-contrast', 'modest-achievement']);
const framed = result => result.candidatePool.filter(candidate => candidate.plan.construction?.edits.some(edit => ids.has(edit.constructionId)));
let python, assets, references;
const cache = new Map();
before(async () => { python = new PythonClient(); await python.start(); assets = compileAssets(); references = new Map(assets.evidence.map(item => [item.id, item.text])); });
after(() => python?.close());
async function run(source, extra = {}) {
  if (!cache.has(source)) cache.set(source, await python.analyze(source));
  return generate(request(source, extra), cache.get(source), assets);
}

test('live and captured explicit reasons retain copied opinions, negatives, amounts and all reason content', async () => {
  for (const fixture of fixtures.filter(row => /からだ。$/u.test(row.source))) {
    for (const result of [await run(fixture.source), generate(request(fixture.source), fixture.analysis, assets)]) {
      const candidates = framed(result); assert.ok(candidates.length, fixture.source);
      for (const candidate of candidates) {
        const edit = candidate.plan.construction.edits.find(edit => edit.constructionId === 'explicit-reason');
        assert.ok(edit); assert.equal(edit.to, `何故なら${edit.from}`);
        assert.equal(edit.bindings.find(binding => binding.slot === 'claim').text, fixture.source.split('。')[0] + '。');
        assert.ok(validateConstruction(result.ir, candidate.plan, references));
        assert.equal(candidate.verificationStatus, 'passed');
        assert.ok(!candidate.text.includes('からだからな'));
      }
    }
  }
  for (const source of ['帰らなかった。雨が降っていたからだ。', 'ここに残る。電車が来ないからです。']) {
    const result = await run(source); assert.ok(framed(result).length, source);
    assert.ok(framed(result).every(candidate => /何故なら/u.test(candidate.text)));
  }
});

test('reason framing refuses missing antecedents, time/source case markers and unsafe context on either side', async () => {
  for (const source of [
    '安いからだ。', '出発時刻が変わった。午後三時からだ。', '出発地点が変わった。駅からだ。',
    '電車にする？安いからだ。', 'もし安ければ買う。便利だからだ。',
    '「電車にする。」安いからだ。', '太郎は電車にすると言った。安いからだ。',
    '電車にするらしい。安いからだ。', '電車にする。安いからだと思う。',
    '電車にする。安いからではない。', '電車にする。安いからだ？',
    '電車にする。安かったら帰るからだ。', '電車にする。「安いからだ。」',
    '明日帰る。雨だからだ。', '帰った。雨が降るらしいからだ。',
  ]) assert.equal(framed(await run(source)).length, 0, source);
});

test('contrast only restyles existing explicit しかし at intensity three and never invents opposition from が', async () => {
  const fixture = fixtures.find(row => row.source.includes('しかし'));
  assert.equal(framed(await run(fixture.source)).length, 0);
  for (const result of [await run(fixture.source, { intensity: 3 }), generate(request(fixture.source, { intensity: 3 }), fixture.analysis, assets)]) {
    assert.ok(framed(result).some(candidate => candidate.text.includes('だが値段は高い')));
    for (const candidate of framed(result)) {
      assert.ok(validateConstruction(result.ir, candidate.plan, references));
      const edit = candidate.plan.construction.edits.find(edit => edit.constructionId === 'explicit-contrast');
      assert.equal(edit.from, 'しかし'); assert.equal(edit.to, 'だが');
    }
  }
  for (const source of ['私は学生だが、趣味は読書だ。', '値段は高かったが、満足している。', '店に行ったが、友人に会った。', 'この本があるが、読みますか。', 'しかし値段は高い。', 'この傘は軽い。「しかし値段は高い。」', 'この傘は軽い。しかし値段は高いかもしれない。']) {
    assert.equal(framed(await run(source, { intensity: 3 })).length, 0, source);
  }
});

test('modesty requires opening modest evaluation plus a completed narrator-owned limited deed', async () => {
  const fixture = fixtures.find(row => row.source.startsWith('大した'));
  for (const result of [await run(fixture.source), generate(request(fixture.source), fixture.analysis, assets)]) {
    const candidate = framed(result)[0]; assert.ok(candidate);
    assert.match(candidate.text, /^それほどでもない/u);
    const edit = candidate.plan.construction.edits.find(edit => edit.constructionId === 'modest-achievement');
    assert.equal(edit.bindings.find(binding => binding.slot === 'achievement').text, fixture.source.split('。')[1] + '。');
    assert.ok(validateConstruction(result.ir, candidate.plan, references));
    assert.ok(!/褒め|尊敬|最強|一級|自慢/u.test(candidate.text));
  }
  for (const source of [
    '大したことはしていない。', '大したことはしていない。機械を動かすだけだ。',
    '大したことはしていない。機械を動かさなかっただけだ。', '大したことはしていない。機械を動かしただけだと思う。',
    '大したことはしていない。太郎は機械を動かしただけだ。', '大したことはしていない。彼が原因を見つけて機械を動かしただけだ。',
    '大したことはしていない。太郎と私が機械を動かしただけだ。', '大したことはしていない。私と太郎が機械を動かしただけだ。', '大したことはしていない。私は太郎と機械を動かしただけだ。',
    '太郎の話だ。大したことはしていない。機械を動かしただけだ。', '大したことはしていない。機械を壊しただけだ。',
    '私は大したことはしていない。機械を動かしただけだ。', '「大したことはしていない。」機械を動かしただけだ。',
    '大したことはしていない。機械を動かしただけだ？', '大したことはしていない。機械を動かしただけらしい。',
    '大したことはしていない。機械を動かしているだけだ。',
  ]) assert.equal(framed(await run(source)).length, 0, source);
});

test('compound しかしながら is never cut into a malformed standalone adversative', async () => {
  const boundaries = require('../fixtures/ginza-discourse-contrast-boundaries.json').cases;
  const good = framed(await run('この傘は軽い。しかし値段は高い。', { intensity: 3 }))[0]; assert.ok(good);
  for (const fixture of boundaries) {
    for (const result of [await run(fixture.source, { intensity: 3 }), generate(request(fixture.source, { intensity: 3 }), fixture.analysis, assets)]) {
      assert.equal(framed(result).length, 0, fixture.source);
      assert.ok(result.candidatePool.every(candidate => !candidate.text.includes('だがながら')), fixture.source);
      assert.equal(validateConstruction(result.ir, good.plan, references), false);
    }
  }
});

test('discourse frames are idempotent on live parser output-to-input round trips', async () => {
  for (const fixture of fixtures) {
    const original = framed(await run(fixture.source, { intensity: 3 }))[0]; assert.ok(original);
    for (const source of [original.text, original.text + '。']) {
      const result = await run(source, { intensity: 3 });
      assert.equal(framed(result).length, 0, source);
      assert.ok(result.candidatePool.every(candidate => !/何故なら何故なら|だがだが|それほどでもないそれほどでもない/u.test(candidate.text)));
    }
  }
  for (const source of ['電車にする。なぜなら安いからだ。', '電車にする。何故なら安いからだ。', '電車にする。なぜならば安いからだ。', '電車にする。どうしてかというと安いからだ。', '電車にする。というのも安いからだ。', '電車にする。理由は安いからだ。', '電車にする。その理由は安いからだ。', 'この傘は軽い。だが高い。', 'それほどでもない。機械を動かしただけだ。']) assert.equal(framed(await run(source, { intensity: 3 })).length, 0, source);
});

test('series and intensity constrain source-grounded frames', async () => {
  for (const fixture of fixtures) {
    const series = fixture.source.includes('からだ。') ? 'gg' : 'night';
    assert.ok(framed(await run(fixture.source, { series, intensity: 3 })).length, fixture.source);
    assert.equal(framed(await run(fixture.source, { series: 'roto', intensity: 3 })).length, 0);
    assert.equal(framed(await run(fixture.source, { intensity: 1 })).length, 0);
  }
});

test('context, token IDs, copied payload, source features and provenance are independently rebound', async () => {
  for (const fixture of fixtures) {
    const result = await run(fixture.source, { intensity: 3 }), original = framed(result)[0]; assert.ok(original);
    const editIndex = original.plan.construction.edits.findIndex(edit => ids.has(edit.constructionId));
    for (const mutate of [
      edit => { edit.bindings[0].text += '偽'; },
      edit => { edit.bindings[0].span.end--; },
      edit => { edit.bindings[0].tokenIds.pop(); },
      edit => { edit.bindings = edit.bindings.filter(binding => !['claim', 'antecedent', 'achievement'].includes(binding.slot)); },
      edit => { edit.to += 'みんなから褒められた'; },
      edit => { edit.features.polarity = 'unknown'; },
      edit => { edit.evidenceIds = ['post_00016_82d78e65bd643a54_22']; },
    ]) {
      const forged = structuredClone(original.plan); mutate(forged.construction.edits[editIndex]);
      assert.equal(validateConstruction(result.ir, forged, references), false);
      const rendered = realize(forged, result.ir);
      assert.notEqual(verification(validateCandidate(result.ir, forged, rendered.text, rendered.spans, new Set(references.keys()), undefined, references, assets.seriesProfiles)), 'passed');
    }
    const missing = new Map(references); missing.delete(original.plan.construction.edits[editIndex].evidenceIds[0]);
    assert.equal(validateConstruction(result.ir, original.plan, missing), false);
  }
});

test('source context changed after generation cannot retain a valid discourse proof', async () => {
  for (const [good, bad] of [
    ['電車にする。安いからだ。', '電車にする？安いからだ。'],
    ['この傘は軽い。しかし値段は高い。', 'この傘は軽い？しかし値段は高い。'],
    ['大したことはしていない。機械を動かしただけだ。', '大したことはしていない。太郎が機械を動かしただけだ。'],
  ]) {
    const original = await run(good, { intensity: 3 }), changed = await run(bad, { intensity: 3 });
    const candidate = framed(original)[0]; assert.ok(candidate, good);
    assert.equal(validateConstruction(changed.ir, candidate.plan, references), false);
    assert.equal(makeConstructionPlans(changed.ir, request(bad, { intensity: 3 }), assets, []).filter(plan => plan.construction.edits.some(edit => ids.has(edit.constructionId))).length, 0);
  }
});

test('registered discourse program survives final verification', async () => {
  for (const fixture of fixtures) {
    const result = await run(fixture.source, { intensity: 3 });
    const verified = await verifyGeneratedResult(result, python, cache.get(fixture.source));
    assert.ok(verified.candidates.some(candidate => candidate.plan.construction?.edits.some(edit => ids.has(edit.constructionId))), fixture.source);
  }
});
