'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceDocument, outputProtectedValues } = require('../../dist/packages/core/source');
const { protectedValueRole } = require('../../dist/packages/core/quantities');
const signature = values => values.map(item => [item.kind, item.raw, item.role, item.comparator ?? null]);
test('terminal polite copulas do not masquerade as the protected-value particle で', () => {
  for (const value of ['500円', '500円以上', '300〜500円', 'A', 'test@example.com', '三百円']) {
    for (const [before, after] of [['です。', 'だ。'], ['でした。', 'だった。'], ['です', 'だ'], ['でした\n', 'だった\n']]) {
      assert.deepEqual(signature(sourceDocument(value + before).protectedValues), signature(outputProtectedValues(value + after)), value + before);
    }
  }
  for (const ending of ['です。', 'でした。', 'です', 'でした\n', 'です！', 'です」', 'でした』']) assert.equal(protectedValueRole(ending), 'unknown');
});
test('copula exclusion keeps real particles and ambiguous nonterminal continuations visible', () => {
  for (const suffix of ['で買う', 'で\n', 'ですしを買う', 'でしたくする', 'ではない', 'ですから', 'である']) assert.equal(protectedValueRole(suffix), 'で', suffix);
  for (const role of ['を', 'に', 'が', 'は', 'から', 'より']) assert.equal(protectedValueRole(role + '確認した'), role);
  assert.notDeepEqual(signature(outputProtectedValues('500円で買った')), signature(outputProtectedValues('500円に変えた')));
  assert.notDeepEqual(signature(outputProtectedValues('500円です。')), signature(outputProtectedValues('600円だ。')));
  assert.notDeepEqual(signature(outputProtectedValues('500円以上です。')), signature(outputProtectedValues('500円以下だ。')));
});
