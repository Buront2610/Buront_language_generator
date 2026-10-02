"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), files = [];
function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const filename = path.join(directory, entry.name); if (entry.isDirectory()) { if (!['generated', '__pycache__'].includes(entry.name)) walk(filename); } else if (/\.(ts|py|json|txt)$/u.test(filename)) files.push(path.relative(root, filename)); } }
walk(path.join(root, 'packages')); walk(path.join(root, 'services')); walk(path.join(root, 'apps/server')); files.push('package-lock.json');
const hash = createHash('sha256'); for (const file of files.sort()) { hash.update(file.replaceAll(path.sep, '/')); hash.update(fs.readFileSync(path.join(root, file))); }
let toolCommit = 'unavailable', workingTreeDirty = null; try { toolCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); workingTreeDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').some(line => line.trim() && !line.endsWith('build-info.json')); } catch { if (fs.existsSync(path.join(root, 'build-info.json'))) toolCommit = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8')).toolCommit; }
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify({ schemaVersion: 1, sourceHash: hash.digest('hex'), toolCommit, workingTreeDirty, runtime: 'node24-python3.11', safetyContract: 'v1' }, null, 2) + '\n');
