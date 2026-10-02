"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FaithfulQuoteGrammar } = require("../lib/grammar/faithful-quote-grammar");
const logs = require("../data/log-corpus.json");
const quotes = require("../data/quote-corpus.json");

test("missing evidence disables frames without breaking legacy initialization", () => {
  const grammar = new FaithfulQuoteGrammar([], null, { headings: [], excerpts: [] });
  assert.equal(grammar.status().activeExpressions, 0);
  assert.equal(grammar.status().disabledExpressions.length, 36);
  assert.deepEqual(grammar.signatures("という事実は確定的に明らか"), []);
  assert.deepEqual(grammar.candidates("入力", "入力", {}), []);
  assert.ok(grammar.evidenceLedger.every((item) => item.status === "disabled_missing_evidence"));
});

test("legend and arbitrary metadata cannot supply rhetorical-frame evidence", () => {
  const grammar = new FaithfulQuoteGrammar([], { quoteGrammar: { sourceTitles: ["確定的に明らか"] } }, {
    source: { title: "確定的に明らか", url: "https://example.invalid" },
    comments: "確定的に明らか",
    headings: [],
    excerpts: [{ id: "legend", text: "赤字・・試験にでるのは確定的に明らか" }],
  });
  assert.equal(grammar.status().activeExpressions, 0);
  assert.ok(grammar.evidenceLedger.find((item) => item.frame === "fact_assertion").missing.includes("確定的に明らか"));
});

test("all six legacy renderers with the unattested formula are disabled, not labelled negative", () => {
  const grammar = new FaithfulQuoteGrammar(logs.posts, null, quotes);
  assert.deepEqual(new Set(grammar.status().disabledExpressions.map((item) => item.frame)), new Set([
    "fact_assertion", "future_certainty", "gratitude_extended", "agreement_reason", "evaluation_elite", "evaluation_outclassed",
  ]));
  assert.equal(grammar.status().activeExpressions, 30);
  assert.equal(grammar.status().evidenceLinkedExpressions, 30);
  assert.ok(grammar.evidenceLedger.every((item) => !Object.hasOwn(item, "negative")));
  for (const item of grammar.evidenceLedger.filter((item) => item.linked)) {
    assert.ok(item.evidence.every((entry) => entry.sources.length > 0));
    assert.ok(item.evidence.every((entry) => entry.sources.every((source) => source.id && source.sourceType)));
  }
});

test("an actual text record can support an expression, with an explicit source identifier", () => {
  const grammar = new FaithfulQuoteGrammar([{ id: "fixture_post", content: "確定的に明らか", postUrl: "https://example.invalid/post" }], null, { headings: [], excerpts: [] });
  const entry = grammar.evidenceLedger.find((item) => item.frame === "fact_assertion");
  assert.equal(entry.linked, true);
  assert.deepEqual(entry.evidence[0].sources, [{ id: "fixture_post", sourceType: "original_post", url: "https://example.invalid/post" }]);
  assert.ok(grammar.status().expressions.includes("fact_assertion"));
});
