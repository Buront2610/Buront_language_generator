import fs from 'node:fs';
import path from 'node:path';
import type MiniSearch from 'minisearch';
import { boundedExactSearch } from './bounded-search';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hash } from './source';
import type { Evaluator } from './evaluation';
import { featureVersion, outputFeatures } from './output-features';
import { compileSeriesProfiles, type SeriesProfile } from './series';
export type Evidence = { id: string; text: string; url?: string; postId: string; series: string[]; family: string; sourceType: 'original_post' | 'quote_heading' | 'quote_excerpt';
  unitType?: 'sentence' | 'heading' | 'emphasis'; sourceId?: string; sourcePostIds?: string[]; leakagePostIds?: string[];
  quoteGroupId?: string; variantGroupId?: string; leakageGroupId?: string; samplingWeight?: number; positiveExample?: boolean;
  sectionId?: string; pagePostId?: string; headingIds?: string[]; memberIds?: string[]; contextStatus?: string;
  emphasizedSpans?: { start: number; end: number; text: string; style: 'bold' | 'red' }[]; offsetUnit?: 'unicode_code_point' };
export type OriginalPost = { id: string; text: string; sourceType: 'original_post'; unitType: 'whole_post'; positiveExample: true; url?: string; leakageGroupId?: string };
export type Lexeme = { lemma: string; reading: string; pos: string; concept: string; evidenceIds: string[] };
export type Assets = { datasetId: string; manifest: Record<string, any>; evidence: Evidence[]; originalPosts?: OriginalPost[]; lexicon: Lexeme[]; operations: { id: string; status: string; relation: string; forbidden: string[] }[]; series: { id: string; label: string }[]; seriesProfiles?: SeriesProfile[]; evaluators?: { S?: Evaluator; Q?: Evaluator } };
const words: [string, string, string][] = [
  ['盾', 'タテ', 'defense'], ['鎧', 'ヨロイ', 'defense'], ['剣', 'ケン', 'attack'], ['槍', 'ヤリ', 'attack'],
  ['力', 'チカラ', 'scale'], ['速度', 'ソクド', 'scale'], ['信頼', 'シンライ', 'social'], ['勝利', 'ショウリ', 'goal'],
  ['努力', 'ドリョク', 'means'], ['練習', 'レンシュウ', 'means'], ['経験', 'ケイケン', 'knowledge'], ['理論', 'リロン', 'knowledge'],
  ['理屈', 'リクツ', 'knowledge'], ['装備', 'ソウビ', 'means'], ['防御', 'ボウギョ', 'defense'], ['知識', 'チシキ', 'knowledge'],
  ['時間', 'ジカン', 'scale'], ['技術', 'ギジュツ', 'means'], ['言葉', 'コトバ', 'social'], ['証拠', 'ショウコ', 'knowledge'],
];
export function compileAssets(root = process.cwd()): Assets {
  const filenames = ['log-corpus.json', 'quote-corpus.json', 'archive-series.json', 'style-model.json', 'novel-model.json'];
  const files = Object.fromEntries(filenames.map(name => [name, hash(fs.readFileSync(path.join(root, 'data', name)).toString('utf8'))]));
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'data/log-corpus.json'), 'utf8'));
  const quotes = JSON.parse(fs.readFileSync(path.join(root, 'data/quote-corpus.json'), 'utf8'));
  const archive = JSON.parse(fs.readFileSync(path.join(root, 'data/archive-series.json'), 'utf8'));
  const posts = new Map<string, any>(corpus.posts.map((post: any) => [post.id, post]));
  const seriesSets = archive.series.map((series: any) => ({ id: series.id, posts: new Set(series.postIds) }));
  const postLeakage = new Map<string, string>((quotes.sourcePosts ?? []).map((post: any) => [post.id, post.leakageGroupId]));
  const originalPosts: OriginalPost[] = corpus.posts.map((post: any) => ({ id: post.id, text: post.content, sourceType: 'original_post', unitType: 'whole_post', positiveExample: true,
    url: post.postUrl, leakageGroupId: postLeakage.get(post.id) ?? `post:${post.id}` }));
  const evidence: Evidence[] = corpus.sentences.map((sentence: any) => ({ id: sentence.id, text: sentence.text, postId: sentence.postId, sourceType: 'original_post',
    unitType: 'sentence', sourceId: 'original_log', sourcePostIds: [sentence.postId], leakagePostIds: [sentence.postId], positiveExample: true,
    leakageGroupId: postLeakage.get(sentence.postId) ?? `post:${sentence.postId}`,
    url: posts.get(sentence.postId)?.postUrl, series: seriesSets.filter((series: any) => series.posts.has(sentence.postId)).map((series: any) => series.id), family: sentence.intents[0] || 'general' }));
  const lexicalTokens = new Map(corpus.sentences.map((sentence: any) => [sentence.id, new Set<string>(sentence.tokens ?? tokenize(sentence.text))]));
  // Whole-token occurrences avoid using 真剣 as evidence for the weapon 剣.
  // The concept annotation remains experimental, not human gold.
  const lexicon = words.flatMap(([lemma, reading, concept]) => {
    const matching = evidence.filter(item => (lexicalTokens.get(item.id) as Set<string>)?.has(lemma));
    const evidenceIds = [...new Set([matching.slice(0, 2), ...seriesSets.map((series: any) => matching.filter(item => item.series.includes(series.id)).slice(0, 2))].flat().map(item => item.id))];
    return evidenceIds.length ? [{ lemma, reading, concept, pos: 'NOUN', evidenceIds }] : [];
  });
  for (const [sourceType, items] of [['quote_heading', quotes.headings], ['quote_excerpt', quotes.excerpts]] as const) for (const item of items) {
    // Defensive filtering also protects old schema-v1 corpora. Metadata and
    // ambiguous context candidates never become an asserted original-post link.
    if (/^(?:赤字|太字|黒字)\s*[・.：:]/u.test(item.text)) continue;
    const postIds: string[] = item.sourcePostIds ?? (item.contexts ?? []).filter((context: any) => context.confidence !== 'low').map((context: any) => context.postId);
    evidence.push({ id: item.id, text: item.text, postId: postIds[0] ?? '', sourceType, url: quotes.source.url,
      sourceId: item.sourceId ?? 'quote_page', unitType: sourceType === 'quote_heading' ? 'heading' : 'emphasis', sourcePostIds: postIds,
      leakagePostIds: item.leakagePostIds ?? postIds, quoteGroupId: item.quoteGroupId, variantGroupId: item.variantGroupId ?? item.groupId,
      leakageGroupId: item.leakageGroupId, samplingWeight: item.samplingWeight ?? 1, sectionId: item.sectionId, pagePostId: item.pagePostId,
      headingIds: item.headingIds, contextStatus: item.contextMatch?.status, emphasizedSpans: item.emphasizedSpans, offsetUnit: item.offsetUnit,
      family: item.families[0] ?? 'general', series: seriesSets.filter((series: any) => postIds.some((id: string) => series.posts.has(id))).map((series: any) => series.id) });
  }
  const relations = ['domain_transfer', 'scale_conflict', 'semantic_doubling', 'lexical_reinterpretation', 'mora_neighbor', 'evaluation_reverse', 'means_end', 'reason_expansion', 'humble_boast', 'compression'];
  const operations = relations.map((relation, i) => ({ id: `OP-${String(i + 1).padStart(2, '0')}`, relation, status: i < 2 || i === 5 || i === 6 ? 'experimental_enabled' : 'experimental_disabled', forbidden: ['replace_actor', 'change_quantity', 'promote_completion', 'invent_opponent', 'invent_cause'] }));
  const seriesProfiles = compileSeriesProfiles(evidence, ['all', ...archive.series.map((item: any) => item.id)]);
  let toolCommit = 'unavailable'; try { toolCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true }).toString().trim(); } catch {}
  const buildInfo = fs.existsSync(path.join(root, 'build-info.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8')) : { sourceHash: 'unbuilt', toolCommit };
  const evaluatorFile = path.join(root, 'assets/annotations/evaluators.json');
  const evaluators = fs.existsSync(evaluatorFile) ? JSON.parse(fs.readFileSync(evaluatorFile, 'utf8')) : undefined;
  if (evaluators) validateEvaluators(evaluators);
  const manifest = { schemaVersion: 1, files, compiledEvidence: hash(evidence), originalPosts: hash(originalPosts), quoteGrouping: "variant-weight/leakage-split-v2", seriesProfiles: hash(seriesProfiles), engine: buildInfo, parser: 'ja_ginza', dictionary: hash(lexicon), rules: hash(operations), index: 'minisearch-7/intl-word-nfkc-grouped-v2', annotations: evaluators ? hash(Object.values(evaluators).map((value: any) => value.trainingManifest)) : 'none', evaluator: evaluators ? hash(evaluators) : 'untrained', toolCommit: buildInfo.toolCommit,
    sourceMetadata: corpus.sources, quoteSource: quotes.source, rights: 'unverified-local-only', sourceTypes: ['original_posts', 'original_sentences', 'quote_headings', 'quote_emphasis', 'adaptation_works'], reproducible: true };
  return { datasetId: hash(manifest), manifest, evidence, originalPosts, lexicon, operations, series: [{ id: 'all', label: '全系列' }, ...archive.series.map(({ id, label }: any) => ({ id, label }))], seriesProfiles, ...(evaluators ? { evaluators } : {}) };
}
export function publishAssets(assets: Assets, root = process.cwd()) {
  const directory = path.join(root, '.runtime/assets'); fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${assets.datasetId}.json`);
  if (!fs.existsSync(target)) { const staging = target + '.' + randomUUID() + '.staging'; fs.writeFileSync(staging, JSON.stringify(assets)); loadAssets(staging); fs.renameSync(staging, target); }
  else loadAssets(target);
  const pointer = path.join(directory, 'active.json'), temporary = pointer + '.' + randomUUID() + '.staging';
  fs.writeFileSync(temporary, JSON.stringify({ datasetId: assets.datasetId, schemaVersion: 1 })); fs.renameSync(temporary, pointer);
  return target;
}
export function loadAssets(filename: string): Assets {
  const assets: Assets = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (assets.manifest.schemaVersion !== 1 || assets.datasetId !== hash(assets.manifest) || assets.manifest.dictionary !== hash(assets.lexicon) || assets.manifest.rules !== hash(assets.operations) || assets.manifest.compiledEvidence !== hash(assets.evidence)) throw new Error('ASSET_INCOMPATIBLE');
  // The manifest covers original files; compiled evidence is separately integrity checked in bundles.
  if (!Array.isArray(assets.evidence) || !assets.evidence.length) throw new Error('ASSET_INCOMPATIBLE');
  if (assets.manifest.originalPosts && assets.manifest.originalPosts !== hash(assets.originalPosts)) throw new Error('ASSET_INCOMPATIBLE');
  if (assets.manifest.seriesProfiles && assets.manifest.seriesProfiles !== hash(assets.seriesProfiles)) throw new Error('ASSET_INCOMPATIBLE');
  if (assets.evaluators) { validateEvaluators(assets.evaluators); if (assets.manifest.evaluator !== hash(assets.evaluators)) throw new Error('EVALUATOR_INCOMPATIBLE'); }
  return assets;
}
function validateEvaluators(value: any) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['S', 'Q'].includes(key))) throw new Error('INVALID_EVALUATOR');
  const featureKeys = new Set(Object.keys(outputFeatures('')));
  for (const [dimension, model] of Object.entries(value) as [string, any][]) if (!model || model.schemaVersion !== 1 || model.featureVersion !== featureVersion || Object.keys(model.coefficients ?? {}).some(key => !featureKeys.has(key)) || model.dimension !== dimension || typeof model.personal !== 'boolean' || !Number.isFinite(model.intercept) || !model.trainingManifest?.labelsHash || !model.coefficients || Object.keys(model.coefficients).length > 20000 || Object.values(model.coefficients).some(coefficient => !Number.isFinite(coefficient))) throw new Error('INVALID_EVALUATOR');
}
export const tokenize = (text: string) => [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(text.normalize('NFKC').toLowerCase())].filter(part => part.isWordLike).map(part => part.segment);
const normalizedEvidenceText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/[。、，．！？!?「」『』（）()【】\[\]・…“”"'：:]/gu,
  (punctuation, index, value) => /\d/u.test(value[index - 1] ?? '') && /\d/u.test(value[index + 1] ?? '') ? punctuation : '');

/** Index one representative per quote variant before calculating term statistics.
 * All source records stay in Assets.evidence; this is an index sampling policy.
 */
export function deduplicateRetrievalEvidence(evidence: Evidence[]): Evidence[] {
  const originals = evidence.filter(item => item.sourceType === 'original_post');
  const originalsByText = new Map<string, Evidence[]>();
  for (const item of originals) {
    const key = normalizedEvidenceText(item.text);
    originalsByText.set(key, [...(originalsByText.get(key) ?? []), item]);
  }
  const quoteGroups = new Map<string, Evidence[]>();
  for (const item of evidence.filter(item => item.sourceType !== 'original_post')) {
    if (/^(?:赤字|太字|黒字)\s*[・.：:]/u.test(item.text)) continue;
    const key = item.variantGroupId ?? item.quoteGroupId ?? `text:${normalizedEvidenceText(item.text)}`;
    quoteGroups.set(key, [...(quoteGroups.get(key) ?? []), item]);
  }
  const merge = (members: Evidence[]): Evidence => ({ ...members[0], memberIds: [...new Set(members.flatMap(item => item.memberIds ?? [item.id]))],
    series: [...new Set(members.flatMap(item => item.series))], sourcePostIds: [...new Set(members.flatMap(item => item.sourcePostIds ?? (item.postId ? [item.postId] : [])))],
    leakagePostIds: [...new Set(members.flatMap(item => item.leakagePostIds ?? []))], samplingWeight: 1 });
  const representatives: Evidence[] = [...originalsByText.values()].map(merge);
  for (const members of quoteGroups.values()) {
    // Matching a heading and an original sentence is one observed occurrence.
    // Keep the original positive and do not add the quote as a second vote.
    if (members.some(item => originalsByText.has(normalizedEvidenceText(item.text)))) continue;
    members.sort((a, b) => Number(a.sourceType === 'quote_heading') - Number(b.sourceType === 'quote_heading') || b.text.length - a.text.length || a.id.localeCompare(b.id));
    representatives.push(merge(members));
  }
  return representatives;
}

export class Retrieval {
  private content: MiniSearch<Evidence>;
  private usage: MiniSearch<Evidence>;
  private novelty: MiniSearch<Evidence>;
  private byId: Map<string, Evidence>;
  constructor(assets: Assets, excludedIds = new Set<string>()) {
    const explicitlyExcluded = (item: Evidence) => [item.id, item.postId, item.family, item.quoteGroupId, item.variantGroupId, item.leakageGroupId,
      ...(item.leakagePostIds ?? []), ...(item.sourcePostIds ?? [])].some(id => !!id && excludedIds.has(id));
    const blockedLeakageGroups = new Set(assets.evidence.filter(explicitlyExcluded).flatMap(item => item.leakageGroupId ? [item.leakageGroupId] : []));
    const documents = assets.evidence.filter(item => !explicitlyExcluded(item) && (!item.leakageGroupId || !blockedLeakageGroups.has(item.leakageGroupId)));
    const canonical = deduplicateRetrievalEvidence(documents);
    const originals = canonical.filter(item => item.sourceType === 'original_post');
    this.content = boundedExactSearch<Evidence>(['text'], tokenize); this.content.addAll(originals);
    this.usage = boundedExactSearch<Evidence>(['family', 'text'], tokenize); this.usage.addAll(canonical);
    this.novelty = boundedExactSearch<Evidence>(['text'], tokenize); this.novelty.addAll(canonical);
    this.byId = new Map(canonical.map(item => [item.id, item]));
  }
  search(query: string, series = 'all', purpose: 'content' | 'usage' | 'novelty' = 'content', limit = 12) {
    return this[purpose].search(query, { prefix: false, filter: result => series === 'all' || result.series.includes(series) }).slice(0, limit).map(result => this.byId.get(result.id)!);
  }
}

const retrievalCache = new Map<string, { value: Retrieval; bytes: number; touched: number }>();
export function retrievalFor(assets: Assets) {
  const now = Date.now();
  for (const [key, entry] of retrievalCache) if (now - entry.touched > 30 * 60000) retrievalCache.delete(key);
  const existing = retrievalCache.get(assets.datasetId);
  if (existing) { existing.touched = now; retrievalCache.delete(assets.datasetId); retrievalCache.set(assets.datasetId, existing); return existing.value; }
  const value = new Retrieval(assets), bytes = Buffer.byteLength(JSON.stringify(assets.evidence)) * 4;
  if (bytes < 64 * 1024 * 1024) retrievalCache.set(assets.datasetId, { value, bytes, touched: now });
  while (retrievalCache.size > 2 || [...retrievalCache.values()].reduce((sum, entry) => sum + entry.bytes, 0) > 64 * 1024 * 1024) retrievalCache.delete(retrievalCache.keys().next().value!);
  return value;
}
