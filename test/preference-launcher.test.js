"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pythonExecutable, trainPreferences } = require('../scripts/train-preferences');
const root = path.resolve(__dirname, '..');

test('Preference launcher chooses the override, then the platform-specific local venv', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.equal(pythonExecutable({ BURONT_PYTHON: 'C:\\Python environments\\python.exe' }, platform), 'C:\\Python environments\\python.exe');
    assert.equal(pythonExecutable({}, platform), path.join(root, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
    assert.equal(pythonExecutable({ BURONT_PYTHON: '' }, platform), pythonExecutable({}, platform));
  }
});

test('Preference launcher preserves every argument and never invokes a shell', () => {
  const env = { BURONT_PYTHON: '/Python environments/python', EXAMPLE: 'kept' };
  const args = ['saved comparisons/人手 評価.json', 'C:\\models with spaces\\evaluators.json', '', '--literal="quoted value"', '$(do-not-execute); & %PATH%'];
  const original = [...args], status = { status: 7 };
  let calls = 0;
  const result = trainPreferences(args, { env, spawn: (executable, forwarded, options) => {
    calls += 1;
    assert.equal(executable, env.BURONT_PYTHON);
    assert.deepEqual(forwarded, [path.join(root, 'services/japanese-analysis/train_preferences.py'), ...args]);
    assert.deepEqual(options, { env, stdio: 'inherit', windowsHide: true, shell: false });
    return status;
  } });
  assert.equal(calls, 1);
  assert.equal(result, status);
  assert.deepEqual(args, original);
});

test('Preference launcher reports a missing interpreter and exits unsuccessfully', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/train-preferences.js'), '--help'], {
    env: { ...process.env, BURONT_PYTHON: path.join(root, 'does-not-exist', 'python') }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot start preference trainer:.*BURONT_PYTHON/);
});
