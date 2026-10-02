"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { normalizeForSearch } = require("../lib/text-analysis");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_URL = "https://kenkyonanight.xxxxxxxx.jp/goroku.html";
const PARSER_VERSION = "visible-lines-codepoints-v2";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const unique = (values) => [...new Set(values)];
const characters = (value) => Array.from(value);
const searchKey = (value) => normalizeForSearch(value).replace(/\s+/gu, "");
// Typography variants only: this must not equate different assertions or numbers.
const variantKey = (value) => searchKey(value).replace(/[。、，．！？!?「」『』（）()【】\[\]・…“”"'：:]/gu,
  (punctuation, index, text) => /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "") ? punctuation : "");
const isLegend = (text) => /^(?:赤字|太字|黒字)\s*[・.：:]/u.test(text);
const isPostHeader = (text) => /^\d+\s*(?:名前\s*[:：]|[:：].*(?:投稿日|\d{2,4}\/\d{2}\/\d{2}|ID:))/u.test(text);
const isAnchor = (text) => /^(?:>>|＞＞)\s*\d+(?:[-,、]\d+)*\s*$/u.test(text);

function decodeEntities(value) {
  const named = { nbsp: "\u00a0", gt: ">", lt: "<", quot: '"', apos: "'", amp: "&" };
  return String(value ?? "").replace(/&(#x[\da-f]+|#\d+|nbsp|gt|lt|quot|apos|amp);/gi, (entity, name) => {
    if (name[0] !== "#") return named[name.toLowerCase()] ?? entity;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function colorIs(value, color) {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, "");
  return (color === "red" ? ["red", "#f00", "#ff0000", "rgb(255,0,0)"] : ["blue", "#00f", "#0000ff", "rgb(0,0,255)"]).includes(normalized);
}

/** Source-specific static HTML tokenizer. Does not execute CSS/JS or fetch resources.
 * Inline markup never creates an artificial line boundary. Offsets are Unicode
 * code points, end-exclusive, in the reconstructed visible line (not HTML bytes).
 */
function parseVisibleLines(html) {
  if (typeof html !== "string" || html.length > 8_000_000) throw new Error("QUOTE_HTML_INVALID_OR_TOO_LARGE");
  const lines = [];
  const stack = [];
  let cells = [];
  let lineNumber = 0;
  const flush = () => {
    while (cells.length && /\s/u.test(cells[0].character)) cells.shift();
    while (cells.length && /\s/u.test(cells.at(-1).character)) cells.pop();
    if (!cells.length) return;
    const text = cells.map((cell) => cell.character).join("");
    const emphasizedSpans = [];
    for (const style of ["bold", "red"]) {
      let start = null;
      for (let index = 0; index <= cells.length; index += 1) {
        if (cells[index]?.[style] && start === null) start = index;
        if (!cells[index]?.[style] && start !== null) {
          emphasizedSpans.push({ start, end: index, text: cells.slice(start, index).map((cell) => cell.character).join(""), style });
          start = null;
        }
      }
    }
    const blueText = cells.filter((cell) => cell.blue).map((cell) => cell.character).join("").trim();
    lines.push({ text, emphasizedSpans, blueText, lineNumber: ++lineNumber });
    cells = [];
  };
  const blocks = new Set(["p", "div", "dt", "dd", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);
  const voidTags = new Set(["br", "hr", "img", "meta", "link", "input", "wbr", "area", "base", "embed", "source"]);
  const tokens = html.match(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+|</gi) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!") || /^<(?:script|style|template|noscript)\b/i.test(token)) continue;
    if (/^<\/?[a-zA-Z]/.test(token)) {
      const closing = /^<\//.test(token);
      const tag = /^<\/?([\w:-]+)/.exec(token)[1].toLowerCase();
      if (closing) {
        const index = stack.findLastIndex((item) => item.tag === tag);
        if (index >= 0) {
          if (stack.slice(index).some((item) => item.blue)) flush();
          stack.splice(index);
        }
        if (blocks.has(tag)) flush();
      } else {
        const attrs = attributes(token);
        const styleColor = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(attrs.style ?? "")?.[1];
        const blue = colorIs(attrs.color ?? styleColor, "blue");
        if (blocks.has(tag) || tag === "br" || tag === "hr" || blue) flush();
        if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) {
          if (stack.length > 512) throw new Error("QUOTE_HTML_NESTING_LIMIT");
          stack.push({ tag, blue, color: attrs.color ?? styleColor, red: colorIs(attrs.color ?? styleColor, "red"),
            bold: tag === "strong" || tag === "b" || /font-weight\s*:\s*(?:bold|[7-9]00)/i.test(attrs.style ?? ""),
            hidden: ["script", "style", "head", "template", "noscript"].includes(tag) || /\bhidden(?:\s|=|>)/i.test(token) || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style ?? "") });
        }
      }
    } else if (!stack.some((item) => item.hidden)) {
      const flags = { bold: stack.some((item) => item.bold), red: !!stack.findLast((item) => item.color != null)?.red, blue: stack.some((item) => item.blue) };
      for (const character of decodeEntities(token).replace(/[\t\r\n\f ]+/g, " ")) {
        if (character === " " && cells.at(-1)?.character === " ") continue;
        cells.push({ character, ...flags });
      }
    }
  }
  flush();
  return lines;
}

function classify(text) {
  const families = [];
  const rules = [
    ["anger", /怒|切れ|有頂天|逆鱗|ふるかい|不快|謝(?:れ|っても遅|罪しろ)/],
    ["gratitude", /感謝|ありがとう|有難/],
    ["lament", /悲し|絶望|寿命|一巻の終わり|いくえ不明|手遅れ/],
    ["warning", /危険|気をつけ|死|骨になる|病院|裏世界|犯罪|逮捕/],
    ["victory", /勝|論破|カウンター|これで勝つる|最強|唯一ぬに/],
    ["humility", /謙虚|それほどでもない|一歩引く|心が広/],
    ["evidence", /証拠|証明|事実|ノンフィクション|見ろ|確定/],
    ["prediction", /予知|最初から|目に見えて|シュミレート|発覚/],
    ["comparison", /対等|格が違|対して|よりも|ナンバー|一般社会/],
    ["surprise", /びび|ギク|驚|ほう・・|おいィ|何いきなり/],
    ["power", /パワー|破壊力|ワンパン|パンチ|ノーリスク|加速|攻撃力/],
    ["instruction", /見習|べき|勉強|注意|改心|義務|しきたり/],
    ["denial", /関係ない|はげていない|狩られる側じゃない|大反対|ノーなんで/],
  ];
  for (const [family, pattern] of rules) if (pattern.test(text)) families.push(family);
  return families.length ? families : ["general"];
}

function preparePosts(logCorpus) {
  return (logCorpus.posts ?? []).map((post) => ({ ...post, key: searchKey(post.content), variant: variantKey(post.content) }));
}

function contextFor(post, matchMethod, confidence) {
  return { postId: post.id, threadTitle: post.threadTitle, responseNumber: post.responseNumber,
    postUrl: post.postUrl, intents: post.intents ?? [], anchorCount: post.anchorTargets?.length ?? 0, matchMethod, confidence };
}

function linkPagePost(pagePost, posts) {
  const lines = pagePost.lines.filter((line) => !isAnchor(line.text));
  const needle = variantKey(lines.map((line) => line.text).join("\n"));
  const responseNumber = Number(/^\d+/.exec(pagePost.header)?.[0]);
  const dateMatch = /(?:\d{2})?(\d{2})\/(\d{2})\/(\d{2})/.exec(pagePost.header);
  const date = dateMatch ? `${Number(dateMatch[1]) < 70 ? "20" : "19"}${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  const ranked = posts.flatMap((post) => {
    if (!needle || !post.variant) return [];
    const exact = needle === post.variant;
    const contained = needle.length >= 12 && (post.variant.includes(needle) || needle.includes(post.variant) && post.variant.length >= 12);
    const matchingLength = lines.reduce((sum, line) => {
      const key = variantKey(line.text);
      return sum + (key.length >= 4 && post.variant.includes(key) ? key.length : 0);
    }, 0);
    const coverage = matchingLength / Math.max(1, needle.length);
    const headerMatches = responseNumber === Number(post.responseNumber) && (!date || date === post.date);
    if (!exact && !contained && !(coverage >= 0.6 && (headerMatches || matchingLength >= 30))) return [];
    return [{ post, score: (exact ? 100 : contained ? 60 : coverage * 40) + (headerMatches ? 20 : 0), exact }];
  }).sort((a, b) => b.score - a.score || a.post.id.localeCompare(b.post.id));
  const best = ranked[0];
  const winners = best ? ranked.filter((item) => item.score === best.score) : [];
  pagePost.sourcePostIds = winners.length === 1 ? [best.post.id] : [];
  pagePost.contexts = winners.map(({ post, exact }) => contextFor(post, exact ? "whole_post_exact" : "post_text_and_context", winners.length === 1 ? "high" : "low"));
  pagePost.contextMatch = { status: winners.length === 1 ? "matched" : winners.length ? "ambiguous" : "unmatched", candidateCount: winners.length };
}

/** All lengths, including one-to-four character headings, are searched. Short
 * labels and placeholders require nearby source context or retain uncertainty.
 */
function linkQuote(item, posts, nearbyPostIds) {
  const queries = unique([searchKey(item.text), searchKey(item.text.replace(/[（(][^）)]*[）)]/g, "").replace(/[「」『』○]/g, ""))]).filter(Boolean);
  const candidates = posts.filter((post) => queries.some((query) => post.key.includes(query)));
  const contextual = candidates.filter((post) => nearbyPostIds.includes(post.id));
  const selected = contextual.length ? contextual : candidates;
  const short = queries.some((query) => characters(query).length < 5);
  const certain = selected.length === 1 && (!short || contextual.length > 0);
  item.contexts = selected.map((post) => contextFor(post, contextual.length ? "section_and_text" : "text_only", certain ? "high" : selected.length === 1 && !short ? "medium" : "low"));
  item.sourcePostIds = certain ? selected.map((post) => post.id) : [];
  // Potential duplicate text must not cross a holdout even when provenance is
  // ambiguous. These conservative links are not asserted source attribution.
  item.leakagePostIds = candidates.map((post) => post.id);
  item.contextMatch = { status: certain ? "matched" : selected.length ? "ambiguous" : "unmatched", candidateCount: candidates.length, selectedCount: selected.length,
    shortQuery: short, reason: certain ? contextual.length ? "unique_contextual_match" : "unique_text_match" : selected.length ? "requires_context_review" : "no_text_match" };
}

function groupQuotes(headings, excerpts, sourcePosts) {
  const items = [...headings, ...excerpts];
  const parents = new Map(items.map((item) => [item.id, item.id]));
  const find = (id) => { if (parents.get(id) !== id) parents.set(id, find(parents.get(id))); return parents.get(id); };
  const join = (left, right) => { const a = find(left), b = find(right); if (a !== b) parents.set(b, a); };
  const byVariant = new Map();
  for (const item of items) {
    const key = variantKey(item.text);
    item.quoteGroupId = `quote_${sha256(key).slice(0, 16)}`;
    if (byVariant.has(key)) join(item.id, byVariant.get(key)); else byVariant.set(key, item.id);
  }
  // A heading and its highlighted realization are alternate granularities, not
  // independent examples. Only join within the same editorial section.
  for (const heading of headings) {
    const needle = variantKey(heading.text.replace(/[（(][^）)]*[）)]/g, "").replace(/○/g, ""));
    if (!needle) continue;
    for (const excerpt of excerpts.filter((item) => item.sectionId === heading.sectionId)) {
      if (excerpt.emphasizedSpans.some((span) => variantKey(span.text).includes(needle))) join(heading.id, excerpt.id);
    }
  }
  const buckets = new Map();
  for (const item of items) { const root = find(item.id); if (!buckets.has(root)) buckets.set(root, []); buckets.get(root).push(item); }
  const quoteGroups = [...buckets.values()].map((members) => {
    const id = `variant_${sha256(unique(members.map((item) => item.quoteGroupId)).sort().join("|")).slice(0, 16)}`;
    for (const item of members) { item.variantGroupId = id; item.groupId = id; item.samplingWeight = 1 / members.length; }
    return { id, memberIds: members.map((item) => item.id), sourcePostIds: unique(members.flatMap((item) => item.sourcePostIds)),
      canonicalText: (members.find((item) => item.kind === "emphasis") ?? members[0]).text, samplingWeight: 1 };
  });
  // Holdout groups also connect separate phrases from the same original post.
  for (const post of sourcePosts) parents.set(post.id, post.id);
  for (const item of items) for (const postId of item.leakagePostIds ?? item.sourcePostIds) if (parents.has(postId)) join(item.id, postId);
  const leakage = new Map();
  for (const id of parents.keys()) { const root = find(id); if (!leakage.has(root)) leakage.set(root, []); leakage.get(root).push(id); }
  for (const ids of leakage.values()) {
    const id = `leakage_${sha256(ids.sort().join("|")).slice(0, 16)}`;
    for (const item of [...items, ...sourcePosts]) if (ids.includes(item.id)) item.leakageGroupId = id;
  }
  for (const group of quoteGroups) group.leakageGroupId = items.find((item) => item.id === group.memberIds[0]).leakageGroupId;
  return quoteGroups;
}

/** Pure build: no network, filesystem, clock, or mutation of the original logs. */
function buildQuoteCorpus(html, logCorpus, options = {}) {
  const lines = parseVisibleLines(html);
  const headings = [], excerpts = [], pagePosts = [], sections = [];
  let section = null, pagePost = null;
  let excludedLegends = 0;
  for (const line of lines) {
    if (isLegend(line.text)) { excludedLegends += 1; continue; }
    if (line.blueText) {
      section = { id: `section_${String(sections.length + 1).padStart(3, "0")}`, headingIds: [], excerptIds: [], pagePostIds: [] };
      sections.push(section);
      const heading = { id: `heading_${String(headings.length + 1).padStart(3, "0")}`, kind: "heading", sourceId: "quote_page", sectionId: section.id,
        text: line.blueText, families: classify(line.blueText), lineNumber: line.lineNumber };
      headings.push(heading); section.headingIds.push(heading.id); pagePost = null;
      continue;
    }
    if (!section) continue; // Introduction and legend are editorial metadata.
    if (isPostHeader(line.text)) {
      pagePost = { id: `page_post_${String(pagePosts.length + 1).padStart(3, "0")}`, kind: "whole_post", sourceId: "quote_page", sectionId: section.id,
        header: line.text, lines: [], excerptIds: [] };
      pagePosts.push(pagePost); section.pagePostIds.push(pagePost.id);
      continue;
    }
    if (pagePost) pagePost.lines.push(line);
    if (!line.emphasizedSpans.length || isAnchor(line.text) || !pagePost) continue;
    const excerpt = { id: `excerpt_${String(excerpts.length + 1).padStart(3, "0")}`, kind: "emphasis", sourceId: "quote_page", sectionId: section.id, pagePostId: pagePost.id,
      headingIds: [...section.headingIds], text: line.text, emphasizedSpans: line.emphasizedSpans, offsetUnit: "unicode_code_point", families: classify(line.text), lineNumber: line.lineNumber };
    excerpts.push(excerpt); section.excerptIds.push(excerpt.id); pagePost.excerptIds.push(excerpt.id);
  }
  const posts = preparePosts(logCorpus);
  for (const post of pagePosts) linkPagePost(post, posts);
  for (const section of sections) {
    section.sourcePostIds = unique(pagePosts.filter((post) => post.sectionId === section.id).flatMap((post) => post.sourcePostIds));
    for (const heading of headings.filter((item) => item.sectionId === section.id)) {
      heading.excerptIds = [...section.excerptIds]; heading.pagePostIds = [...section.pagePostIds];
      linkQuote(heading, posts, section.sourcePostIds);
    }
    for (const excerpt of excerpts.filter((item) => item.sectionId === section.id)) {
      const page = pagePosts.find((post) => post.id === excerpt.pagePostId);
      linkQuote(excerpt, posts, page.sourcePostIds);
      // Source matching may normalize punctuation differently from direct lookup.
      if (!excerpt.sourcePostIds.length && page.sourcePostIds.length) {
        const matching = posts.filter((post) => page.sourcePostIds.includes(post.id) && post.variant.includes(variantKey(excerpt.text)));
        if (matching.length === 1) {
          excerpt.sourcePostIds = [matching[0].id]; excerpt.leakagePostIds = unique([...excerpt.leakagePostIds, matching[0].id]); excerpt.contexts = [contextFor(matching[0], "page_post_and_typography_variant", "high")];
          excerpt.contextMatch = { ...excerpt.contextMatch, status: "matched", selectedCount: 1, reason: "page_post_and_typography_variant" };
        }
      }
    }
  }
  const usedIds = new Set([...headings, ...excerpts, ...pagePosts].flatMap((item) => [...item.sourcePostIds, ...(item.leakagePostIds ?? [])]));
  const sourcePosts = posts.filter((post) => usedIds.has(post.id)).map((post) => ({ id: post.id, kind: "whole_post", sourceId: "original_log", text: post.content,
    postUrl: post.postUrl, threadTitle: post.threadTitle, responseNumber: post.responseNumber, positiveExample: true,
    headingIds: headings.filter((item) => item.sourcePostIds.includes(post.id)).map((item) => item.id),
    excerptIds: excerpts.filter((item) => item.sourcePostIds.includes(post.id)).map((item) => item.id) }));
  const quoteGroups = groupQuotes(headings, excerpts, sourcePosts);
  for (const page of pagePosts) { page.text = page.lines.map((line) => line.text).join("\n"); delete page.lines; }
  const families = {};
  for (const item of [...headings, ...excerpts]) for (const family of item.families) families[family] = (families[family] ?? 0) + 1;
  return { schemaVersion: 2, parserVersion: PARSER_VERSION, generatedAt: options.generatedAt ?? null,
    source: { url: options.sourceUrl ?? SOURCE_URL, title: "名言集っぽいの", encoding: options.encoding ?? "Shift_JIS", ...options.source },
    offsetUnit: "unicode_code_point", classification: { method: "heuristic_lexical_cues", goldLabels: false },
    samplingPolicy: { positiveBase: "all_original_log_posts", excludedFromQuotesAreNegatives: false, weightingUnit: "variantGroupId", splitUnit: "leakageGroupId", ambiguousContextLinksAreProvisional: true },
    counts: { headings: headings.length, excerpts: excerpts.length, headingsWithContext: headings.filter((item) => item.contexts.length).length,
      contextLinks: headings.reduce((sum, item) => sum + item.contexts.length, 0), quoteGroups: quoteGroups.length, sourcePosts: sourcePosts.length, pagePosts: pagePosts.length,
      excludedLegends, ambiguousHeadings: headings.filter((item) => item.contextMatch.status === "ambiguous").length, families },
    headings, excerpts, quoteGroups, sections, pagePosts, sourcePosts };
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { "User-Agent": "BurontLanguageGenerator/0.3 quote corpus preparation" }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`名言集の取得に失敗: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8_000_000) throw new Error("QUOTE_SOURCE_TOO_LARGE");
  return bytes;
}

async function main(argv = process.argv.slice(2)) {
  const input = argv[0]; // Optional captured original HTML, decoded with source encoding.
  const captured = input ? fs.readFileSync(path.resolve(input)) : await fetchBytes(SOURCE_URL);
  const bytes = input?.endsWith(".gz") ? zlib.gunzipSync(captured, { maxOutputLength: 8_000_000 }) : captured;
  const encoding = process.env.QUOTE_SOURCE_ENCODING || "shift_jis";
  const html = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  const logCorpus = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "log-corpus.json"), "utf8"));
  const output = buildQuoteCorpus(html, logCorpus, { generatedAt: new Date().toISOString(), encoding,
    source: { bytes: bytes.length, sha256: sha256(bytes), decodedSha256: sha256(html), originalLogSha256: sha256(fs.readFileSync(path.join(ROOT, "data", "log-corpus.json"))) } });
  if (!output.headings.length || !output.excerpts.length || !output.pagePosts.length) throw new Error("QUOTE_SOURCE_NOT_RECOGNIZED: existing corpus was not replaced");
  const outputPath = path.join(ROOT, "data", "quote-corpus.json");
  const staging = `${outputPath}.staging`;
  fs.writeFileSync(staging, `${JSON.stringify(output)}\n`, "utf8");
  fs.renameSync(staging, outputPath);
  console.log(JSON.stringify({ outputPath, counts: output.counts, source: output.source }, null, 2));
}

module.exports = { PARSER_VERSION, buildQuoteCorpus, classify, decodeEntities, groupQuotes, parseVisibleLines, searchKey, variantKey, main };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
