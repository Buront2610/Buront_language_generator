'use strict';
// node scripts/capture-discourse-fixtures.js (after npm run build:engine)
// Captured from the real configured parser; no hand-authored token analyses.
const fs = require('node:fs');
const { PythonClient } = require('../dist/packages/runtime/python-client');
const groups = {
  reason: ['電車のほうがよいと思う。安いからだ。', 'その案には賛成できない。費用が高いだけでなく、準備に一週間もかかるからだ。'],
  contrast: ['この傘は軽い。しかし値段は高い。'],
  'contrast-boundaries': ['この傘は軽い。しかしながら値段は高い。', 'この傘は軽い。しかしながらも値段は高い。'],
  modesty: ['大したことはしていない。故障の原因を見つけて、止まっていた機械を動かしただけだ。'],
};
(async () => {
  const python = new PythonClient(); await python.start();
  try {
    for (const [kind, sources] of Object.entries(groups)) {
      const cases = [];
      for (const source of sources) cases.push({ source, analysis: await python.analyze(source) });
      fs.writeFileSync(`test/fixtures/ginza-discourse-${kind}.json`, JSON.stringify({ capturedAt: new Date().toISOString(), command: 'node scripts/capture-discourse-fixtures.js', cases }, null, 2) + '\n');
    }
  } finally { python.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
