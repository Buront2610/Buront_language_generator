"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pythonExecutable } = require('../../scripts/train-preferences');
const { prepareReviewPreferences } = require('../../scripts/prepare-preferences');
const { hash } = require('../../dist/packages/core/source');
const { ReviewStore } = require('../../dist/packages/runtime/review-store');
const { outputFeatures, featureVersion, score } = require('../../dist/packages/core/evaluation');
const root = path.resolve(__dirname, '../..');

test('Preference trainer and runtime use exactly the same feature version and keys', () => {
  const script = "import importlib.util,json\ns=importlib.util.spec_from_file_location('training', 'services/japanese-analysis/train_preferences.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps({'version':m.FEATURE_VERSION,'keys':sorted(m.FEATURE_KEYS)}))";
  const result = spawnSync(pythonExecutable(), ['-c', script], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { version: featureVersion, keys: Object.keys(outputFeatures('')).sort() });
  assert.equal(score({ text: '比較文。' }), null);
});

test('Existing current-schema comparison export reaches the learner but cannot train without human labels', t => {
  const saved = path.join(root, 'artifacts/v1-evaluation-experimental.3/comparisons-private.json');
  const data = JSON.parse(fs.readFileSync(saved, 'utf8'));
  assert.ok(data.comparisons.length > 0);
  assert.deepEqual(data.preferences, []);
  for (const pair of data.comparisons) {
    assert.equal(pair.private.featureVersion, featureVersion);
    assert.deepEqual(pair.private.features, [outputFeatures(pair.left), outputFeatures(pair.right)]);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buront preference training '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Copy actual saved comparison records; never invent directional labels.
  const input = path.join(directory, '保存した 比較.json'), output = path.join(directory, '学習 係数.json');
  fs.copyFileSync(saved, input);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/train-preferences.js'), path.basename(input), path.basename(output)], {
    cwd: directory, env: { ...process.env, BURONT_PYTHON: pythonExecutable() }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 1, result.error?.message || result.stderr);
  assert.match(result.stderr, /HUMAN_LABELS_REQUIRED/);
  assert.doesNotMatch(result.stderr, /FEATURE_.*MISMATCH|FileNotFoundError/);
  assert.equal(fs.existsSync(output), false);
});

function reviewFixture(directory) {
  // These answers are test-only transport fixtures, never human quality evidence.
  const body = { schemaVersion: 1, title: 'TEST ONLY', engineHash: 'test', datasetId: 'test', vectorReportHash: 'test',
    items: [{ id: 'test-pair', source: '試験原文。', left: '左の試験文。', right: '右の試験文。', private: { group: 'test-group', split: 'pilot', vectors: [99, -99] } }],
    manifest: { split: 'pilot', fixture: true } };
  const pack = { ...body, batchId: hash(body) }, folder = path.join(directory, 'artifacts/vector-style-audit');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'review-pack.json'), JSON.stringify(pack));
  const store = new ReviewStore(directory), answer = { batchId: pack.batchId, itemId: 'test-pair', annotatorId: 'test-only',
    ratings: { S: 'both_bad', Q: 'tie', C: 'cannot_judge' }, reason: 'Test-only fixture; not a human evaluation.' };
  store.save(answer);
  store.save({ ...answer, ratings: { S: 'right', Q: 'both_bad', C: 'tie' } });
  return store.export('test-only');
}

test('Durable review export converts only saved latest answers through the existing feature extractor', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buront saved review '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = reviewFixture(directory), original = structuredClone(data), converted = prepareReviewPreferences(data);
  assert.deepEqual(data, original);
  assert.equal(data.history.length, 2);
  assert.equal(converted.comparisons.length, 1);
  assert.equal(converted.preferences.length, 3);
  assert.deepEqual(converted.preferences.map(label => [label.dimension, label.choice]), [['S', 'right'], ['Q', 'both_bad'], ['C', 'tie']]);
  const pair = converted.comparisons[0];
  assert.equal(pair.left, data.pack.items[0].left);
  assert.equal(pair.right, data.pack.items[0].right);
  assert.deepEqual(pair.private.features, [outputFeatures(pair.left), outputFeatures(pair.right)]);
  assert.equal(pair.private.featureVersion, featureVersion);
  assert.equal(pair.private.split, 'pilot');
  assert.equal(pair.private.group, 'test-group');
  assert.ok(converted.preferences.every(label => label.comparisonId === pair.comparisonId));
  assert.equal(converted.releaseApproved, false);
  assert.doesNotMatch(JSON.stringify(converted), /vectors/);

  const input = path.join(directory, '保存した review.json'), output = path.join(directory, '比較 preferences.json'), model = path.join(directory, 'model.json');
  fs.writeFileSync(input, '\ufeff' + JSON.stringify(data));
  const prepared = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-preferences.js'), input, output], { encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), converted);
  const trained = spawnSync(process.execPath, [path.join(root, 'scripts/train-preferences.js'), output, model], { encoding: 'utf8' });
  assert.equal(trained.status, 1, trained.stderr);
  assert.match(trained.stderr, /HUMAN_LABELS_REQUIRED/);
  assert.equal(fs.existsSync(model), false);
  const repeated = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-preferences.js'), input, output], { encoding: 'utf8' });
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /EEXIST/);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), converted);
});

test('Review conversion rejects mismatched text, unknown answers, duplicate votes, and pilot split promotion', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buront review validation '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = reviewFixture(directory);
  for (const mutate of [
    value => { value.pack.items[0].left = 'tampered'; },
    value => { value.answers[0].itemId = 'missing'; },
    value => { value.answers[0].origin = 'generated'; },
    value => { value.answers[0].ratings.Q = 'automatic'; },
    value => { value.answers.push(value.answers[0]); },
    value => { value.pack.items[0].private.split = 'test'; const { batchId, ...body } = value.pack; value.pack.batchId = hash(body); },
  ]) {
    const invalid = structuredClone(data); mutate(invalid);
    assert.throws(() => prepareReviewPreferences(invalid), /INVALID_REVIEW/);
  }
  const noAnswers = prepareReviewPreferences({ ...data, answers: [] });
  assert.deepEqual(noAnswers.preferences, []);
});

test('Test-only directional fixtures still cannot promote a converted pilot export into training', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'buront pilot refusal '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const data = reviewFixture(directory);
  // Reach the existing minimum-count guard with explicitly synthetic votes,
  // solely to test refusal. Nothing is added to repository review data.
  data.answers = Array.from({ length: 20 }, (_, i) => ({ ...data.answers[0], annotatorId: `synthetic-test-only-${i}`,
    ratings: { S: 'left', Q: 'right', C: 'cannot_judge' } }));
  const input = path.join(directory, 'test-only.json'), output = path.join(directory, 'never-trained.json');
  fs.writeFileSync(input, JSON.stringify(prepareReviewPreferences(data)));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/train-preferences.js'), input, output], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /FROZEN_SPLIT_REQUIRED/);
  assert.equal(fs.existsSync(output), false);
});
