'use strict';
// Recreate the exact historical asset bytes from the archived baseline corpus.
// Only historical build provenance is restored; substantive asset content and
// all input-file hashes must already match the frozen manifest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = Object.fromEntries(process.argv.slice(2).map((value, i, all) => value.startsWith('--') ? [value.slice(2), all[i + 1]] : []).filter(item => item.length));
for (const name of ['baseline-root', 'out']) if (!args[name]) throw new Error(`Missing --${name}`);
const root = path.resolve(args['baseline-root']);
const manifestPath = path.resolve(args.manifest ?? path.join(__dirname, '../artifacts/composable-constructions-20261002/frozen-asset-manifest.json'));
const pinned = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { compileAssets, loadAssets } = require(path.join(root, 'dist/packages/core/assets'));
const { hash } = require(path.join(root, 'dist/packages/core/source'));
const assets = compileAssets(root);
for (const [key, value] of Object.entries(pinned.manifest)) {
  if (['engine', 'toolCommit'].includes(key)) continue;
  if (JSON.stringify(value) !== JSON.stringify(assets.manifest[key])) throw new Error(`Frozen substantive manifest mismatch: ${key}`);
}
assets.manifest.engine = pinned.manifest.engine;
assets.manifest.toolCommit = pinned.manifest.toolCommit;
assets.datasetId = hash(assets.manifest);
const text = JSON.stringify(assets), sha256 = crypto.createHash('sha256').update(text).digest('hex');
if (assets.datasetId !== pinned.datasetId || sha256 !== pinned.fileSha256) throw new Error('Frozen asset bytes do not match');
const output = path.resolve(args.out);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, text);
loadAssets(output);
console.log(JSON.stringify({ output, datasetId: assets.datasetId, sha256, exactHistoricalBytes: true }));
