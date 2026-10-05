"use strict";
const fs = require('node:fs');
const { hash } = require('../dist/packages/core/source');
const { outputFeatures, featureVersion } = require('../dist/packages/core/output-features');
const { reviewDimensions, reviewChoices } = require('../dist/packages/evaluation/review-types');

function prepareReviewPreferences(data) {
  if (data?.schemaVersion !== 1 || !data.pack || !Array.isArray(data.answers)) throw new Error('INVALID_REVIEW_EXPORT');
  const { batchId, ...body } = data.pack;
  if (body.schemaVersion !== 1 || batchId !== hash(body) || !Array.isArray(body.items) || !body.items.length) throw new Error('INVALID_REVIEW_PACK');
  const ids = new Map();
  const comparisons = body.items.map(item => {
    if (!item || ['id', 'source', 'left', 'right'].some(key => typeof item[key] !== 'string') || !item.id || ids.has(item.id)) throw new Error('INVALID_REVIEW_ITEM');
    const comparisonId = hash([batchId, item.id]).slice(0, 24);
    ids.set(item.id, comparisonId);
    const split = item.private?.split ?? body.manifest?.split ?? 'pilot';
    if (!['pilot', 'train', 'validation', 'test'].includes(split) || (body.manifest?.split === 'pilot' && split !== 'pilot')) throw new Error('INVALID_REVIEW_SPLIT');
    const group = item.private?.group ?? (split === 'pilot' ? hash(item.source) : null);
    if (typeof group !== 'string' || !group) throw new Error('REVIEW_GROUP_REQUIRED');
    // Re-extract the saved, displayed text with the existing common extractor.
    // Audit vectors/methods are diagnostics, never substitute features or labels.
    return { comparisonId, source: item.source, left: item.left, right: item.right,
      private: { features: [outputFeatures(item.left), outputFeatures(item.right)], featureVersion, group, split,
        reviewBatchId: batchId, reviewItemId: item.id } };
  });
  const seen = new Set();
  const preferences = data.answers.flatMap(answer => {
    const key = JSON.stringify([answer?.itemId, answer?.annotatorId]);
    if (!answer || !ids.has(answer.itemId) || answer.origin !== 'explicit_user' || typeof answer.annotatorId !== 'string' || !answer.annotatorId.trim()
      || typeof answer.reason !== 'string' || !answer.ratings || Object.keys(answer.ratings).length !== reviewDimensions.length
      || reviewDimensions.some(dimension => !reviewChoices.includes(answer.ratings[dimension])) || seen.has(key)) throw new Error('INVALID_REVIEW_ANSWER');
    seen.add(key);
    // Export.answers already contains the latest saved answer. History contains
    // superseded revisions and must not become additional training votes.
    return reviewDimensions.map(dimension => ({ comparisonId: ids.get(answer.itemId), annotatorId: answer.annotatorId,
      dimension, choice: answer.ratings[dimension], reason: answer.reason }));
  });
  return { schemaVersion: 1, featureVersion, containsUserText: true, releaseApproved: false,
    sourceReview: { batchId, engineHash: body.engineHash, datasetId: body.datasetId }, comparisons, preferences };
}

if (require.main === module) {
  try {
    const [input, output, ...extra] = process.argv.slice(2);
    if (!input || !output || extra.length) throw new Error('Usage: npm run prepare:preferences -- review-export.json comparisons-with-labels.json');
    const data = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/u, ''));
    fs.writeFileSync(output, JSON.stringify(prepareReviewPreferences(data), null, 2) + '\n', { flag: 'wx' });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { prepareReviewPreferences };
