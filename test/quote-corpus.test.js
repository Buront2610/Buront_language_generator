"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildQuoteCorpus, classify, decodeEntities, parseVisibleLines, variantKey } = require("../scripts/prepare-quote-corpus");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures/quotes/inline-source.html"), "utf8");
const original = (id, content, responseNumber = 99) => ({ id, content, responseNumber, date: "2007-01-01", threadTitle: "synthetic test", intents: ["general"], anchorTargets: [], postUrl: `https://example.invalid/${id}` });
const logCorpus = { posts: [
  original("post_a", "文脈は真骨董です\n😀前感謝の言葉、ありがとう後\n普通の黒字も原投稿の一部\n数字は😀&謝謝、<b>は文字\n全角カイです\n全角ｶｲです", 7),
  original("post_b", "別の真骨董を見つけた"),
  original("post_c", "未確定の候補その一"),
  original("post_d", "未確定の候補その二"),
  original("post_e", "礼を述べる", 9),
  original("non_quote", "強調されていない原ログも正例のまま"),
] };
const corpus = buildQuoteCorpus(fixture, logCorpus);

test("pure quote parser excludes legend, metadata and hidden content", () => {
  assert.equal(corpus.schemaVersion, 2);
  assert.equal(corpus.counts.excludedLegends, 3);
  assert.deepEqual(corpus.headings.map((item) => item.text), ["真骨董", "未確定", "礼"]);
  assert.ok([...corpus.headings, ...corpus.excerpts].every((item) => !/試験に|not a heading|非表示|名前：/.test(item.text)));
  assert.deepEqual(buildQuoteCorpus(fixture, logCorpus), corpus, "no implicit clock, random IDs or mutation");
});

test("inline tags reconstruct full visible text with code-point emphasis spans", () => {
  const entry = corpus.excerpts.find((item) => item.text.startsWith("😀前"));
  assert.equal(entry.text, "😀前感謝の言葉、ありがとう後");
  assert.equal(entry.offsetUnit, "unicode_code_point");
  assert.deepEqual(entry.emphasizedSpans, [
    { start: 2, end: 4, text: "感謝", style: "bold" },
    { start: 8, end: 13, text: "ありがとう", style: "red" },
  ]);
  const nested = corpus.excerpts.find((item) => item.text === "文脈は真骨董です");
  assert.deepEqual(nested.emphasizedSpans, [
    { start: 3, end: 6, text: "真骨董", style: "bold" },
    { start: 4, end: 5, text: "骨", style: "red" },
  ]);
  for (const item of corpus.excerpts) for (const span of item.emphasizedSpans) {
    assert.equal(Array.from(item.text).slice(span.start, span.end).join(""), span.text);
  }
});

test("numeric entities decode after markup parsing, without interpreting escaped tags", () => {
  assert.equal(decodeEntities("&#x1F600;&#35613;&lt;b&gt;&amp;"), "😀謝<b>&");
  assert.equal(decodeEntities("&#xD800;&#0;&#1114112;"), "���");
  assert.ok(corpus.excerpts.some((item) => item.text === "数字は😀&謝謝、<b>は文字"));
  assert.equal(parseVisibleLines("前<strong>中\nの<span>語</span></strong>後<br>次")[0].text, "前中 の語後");
  assert.deepEqual(parseVisibleLines('<font color="red">赤<span style="color:black">黒</span>赤</font>')[0].emphasizedSpans, [
    { start: 0, end: 1, text: "赤", style: "red" }, { start: 2, end: 3, text: "赤", style: "red" },
  ]);
});

test("gratitude is not anger merely because it contains 謝", () => {
  assert.deepEqual(classify("感謝"), ["gratitude"]);
  assert.ok(!classify("今回のでそれが良くわかったよ>>199感謝").includes("anger"));
  assert.ok(classify("怒りのパワー、謝っても遅い").includes("anger"));
});

test("short headings are searched and nearby posts disambiguate matches", () => {
  const heading = corpus.headings.find((item) => item.text === "真骨董");
  assert.equal(heading.contextMatch.candidateCount, 2);
  assert.equal(heading.contextMatch.status, "matched");
  assert.equal(heading.contextMatch.shortQuery, true);
  assert.deepEqual(heading.sourcePostIds, ["post_a"]);
  const singleCharacter = corpus.headings.find((item) => item.text === "礼");
  assert.deepEqual(singleCharacter.sourcePostIds, ["post_e"]);
  const ambiguous = corpus.headings.find((item) => item.text === "未確定");
  assert.equal(ambiguous.contextMatch.status, "ambiguous");
  assert.equal(ambiguous.contextMatch.candidateCount, 2);
  assert.deepEqual(ambiguous.sourcePostIds, []);
  assert.ok(ambiguous.contexts.every((context) => context.confidence === "low"));
  assert.deepEqual(ambiguous.leakagePostIds, ["post_c", "post_d"]);
  assert.ok(corpus.sourcePosts.filter((post) => ambiguous.leakagePostIds.includes(post.id)).every((post) => post.leakageGroupId === ambiguous.leakageGroupId));
});

test("headings, emphasized lines and whole original posts have explicit provenance links", () => {
  const heading = corpus.headings[0];
  const excerpt = corpus.excerpts.find((item) => item.text === "文脈は真骨董です");
  const source = corpus.sourcePosts.find((item) => item.id === "post_a");
  assert.equal(heading.kind, "heading"); assert.equal(excerpt.kind, "emphasis"); assert.equal(source.kind, "whole_post");
  assert.ok(heading.excerptIds.includes(excerpt.id));
  assert.ok(excerpt.headingIds.includes(heading.id));
  assert.ok(source.excerptIds.includes(excerpt.id));
  assert.equal(source.text, logCorpus.posts[0].content);
  assert.equal(source.positiveExample, true);
  assert.equal(source.leakageGroupId, excerpt.leakageGroupId);
  assert.equal(heading.variantGroupId, excerpt.variantGroupId);
});

test("variants share one sampling unit and common-source quotes stay in one holdout group", () => {
  const variants = corpus.excerpts.filter((item) => item.text.startsWith("全角"));
  assert.equal(variants.length, 2);
  assert.equal(variants[0].quoteGroupId, variants[1].quoteGroupId);
  assert.equal(variants[0].variantGroupId, variants[1].variantGroupId);
  const weights = new Map();
  for (const item of [...corpus.headings, ...corpus.excerpts]) weights.set(item.groupId, (weights.get(item.groupId) ?? 0) + item.samplingWeight);
  for (const weight of weights.values()) assert.ok(Math.abs(weight - 1) < 1e-10);
  const samePost = corpus.excerpts.filter((item) => item.sourcePostIds.includes("post_a"));
  assert.equal(new Set(samePost.map((item) => item.leakageGroupId)).size, 1);
  assert.notEqual(variantKey("10回勝った"), variantKey("1回勝った"));
  assert.notEqual(variantKey("1、2回勝った"), variantKey("12回勝った"));
  assert.notEqual(variantKey("19:00に終わった"), variantKey("1900に終わった"));
  assert.notEqual(variantKey("勝った"), variantKey("勝っていない"));
});

test("original posts remain positive, and exclusion from quote selection creates no negative labels", () => {
  const before = JSON.stringify(logCorpus);
  const result = buildQuoteCorpus(fixture, logCorpus);
  assert.equal(JSON.stringify(logCorpus), before);
  assert.equal(result.samplingPolicy.positiveBase, "all_original_log_posts");
  assert.equal(result.samplingPolicy.excludedFromQuotesAreNegatives, false);
  assert.ok(!("negativeExamples" in result));
  assert.ok(logCorpus.posts.some((post) => post.id === "non_quote"));
});

test("HTML bounds fail before writing any corpus, and importing the parser has no side effects", () => {
  assert.throws(() => parseVisibleLines("x".repeat(8_000_001)), /TOO_LARGE/);
  assert.throws(() => parseVisibleLines("<span>".repeat(514)), /NESTING_LIMIT/);
  assert.deepEqual(parseVisibleLines("<script>const x='<font color=blue>fake</font>';</script>visible"), [
    { text: "visible", emphasizedSpans: [], blueText: "", lineNumber: 1 },
  ]);
});

test("checked-in corpus has valid spans, groups and source references", () => {
  const actual = require("../data/quote-corpus.json");
  assert.equal(actual.schemaVersion, 2);
  const sources = new Map(actual.sourcePosts.map((item) => [item.id, item]));
  const groups = new Set(actual.quoteGroups.map((group) => group.id));
  assert.equal(actual.counts.headings, actual.headings.length);
  assert.equal(actual.counts.excerpts, actual.excerpts.length);
  assert.ok(actual.headings.every((item) => !/^(?:赤字|太字|黒字)[・.]/u.test(item.text)));
  for (const item of [...actual.headings, ...actual.excerpts]) {
    assert.ok(groups.has(item.variantGroupId));
    for (const postId of item.leakagePostIds) {
      assert.ok(sources.has(postId));
      assert.equal(sources.get(postId).leakageGroupId, item.leakageGroupId);
    }
    for (const span of item.emphasizedSpans ?? []) assert.equal(Array.from(item.text).slice(span.start, span.end).join(""), span.text);
  }
  for (const text of ["名誉既存", "烏合の民", "真骨董"]) assert.equal(actual.headings.find((item) => item.text === text).contextMatch.status, "matched");
  assert.ok(actual.excerpts.every((item) => !/^(?:赤字|太字|黒字)[・.]/u.test(item.text)));
});


test("checked-in provenance verifies unchanged original logs without embedding the source page", () => {
  const crypto = require("node:crypto");
  const actual = require("../data/quote-corpus.json");
  const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
  const logBytes = fs.readFileSync(path.join(__dirname, "../data/log-corpus.json"));
  assert.equal(digest(logBytes), actual.source.originalLogSha256);
  assert.match(actual.source.sha256, /^[a-f0-9]{64}$/);
  assert.ok(actual.source.bytes > 0);
  assert.equal(actual.source.snapshot, undefined);
});
