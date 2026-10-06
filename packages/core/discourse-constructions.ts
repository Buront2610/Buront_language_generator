import type { ConstructionBinding, ConstructionEdit, DocumentIR, Fact, PlanNode, RecognizedDiscourseRelation, Span, Token } from '../contracts';
import { overlaps, slice } from './source';
import { insideEnclosure, isPastAuxiliary, type PropositionScope } from './grammar-scope';

// These are small discourse frames, not permission to supply premises, praise,
// causes or an adversary. The copied clauses and their context are rebound from
// the immutable input during verification, just like the local constructions.
export const discourseConstructionRegistry = [
  { id: 'explicit-reason', realization: 'prefix_source_body', surface: '何故なら', version: 2, series: ['gg'], family: 'explicit-reason-frame', level: 2,
    evidenceId: 'post_02421_ef97fdc26a351d5a_9490', needle: '何故なら',
    slots: ['claim', 'reason', 'marker', 'predicate'], semanticDelta: 'explicit trailing reason -> overt reason introduction; clauses copied', preserves: ['arguments', 'polarity', 'tense', 'attribution', 'realization', 'modality', 'reason-direction'] },
  { id: 'explicit-contrast', realization: 'replace_marker', surface: 'だが', version: 2, series: ['night'], family: 'explicit-contrast-frame', level: 3,
    evidenceId: 'post_01674_cb7c3a70cfcf77ea_5601', needle: 'だが',
    slots: ['antecedent', 'contrast', 'marker', 'predicate'], semanticDelta: 'explicit sentence-initial しかし -> attested だが; clauses copied', preserves: ['arguments', 'polarity', 'tense', 'attribution', 'realization', 'contrast-direction'] },
  { id: 'modest-achievement', realization: 'replace_modesty', surface: 'それほどでもない', version: 2, series: ['night'], family: 'modest-achievement-frame', level: 2,
    evidenceId: 'post_01690_01eabacc0c5882f8_5672', needle: 'それほどでもない',
    slots: ['modesty', 'achievement', 'predicate'], semanticDelta: 'explicit opening modesty before a completed limited deed -> attested modest evaluation; deed copied', preserves: ['achievement', 'arguments', 'tense', 'attribution', 'realization', 'limitation'] },
] as const;

const binding = (slot: ConstructionBinding['slot'], span: Span, ir: DocumentIR): ConstructionBinding => ({ slot, span: { ...span }, text: slice(ir.source.raw, span), tokenIds: ir.tokens.filter(token => span.start <= token.span.start && token.span.end <= span.end).map(token => token.id) });
const inSpan = (inner: Span, outer: Span) => outer.start <= inner.start && inner.end <= outer.end;
const spanKey = (span: Span) => `${span.start}:${span.end}`;
type DiscourseContext = { byStart: Map<number, { sentence: Span; index: number; scopes: PropositionScope[] }>; factsByPredicate: Map<string, Fact> };
const factFor = (context: DiscourseContext, scope: PropositionScope) => context.factsByPredicate.get(spanKey(scope.predicate.span));
const sentenceScopes = (context: DiscourseContext, span: Span) => context.byStart.get(span.start)?.scopes ?? [];
const rootIn = (context: DiscourseContext, span: Span) => sentenceScopes(context, span).find(scope => scope.predicate.dep === 'ROOT');
const firstPerson = new Set(['私', 'わたし', 'わたくし', '僕', '俺']);
// A finite list of completed deeds. This does not label every past action an
// achievement (e.g. merely considering, failing, or denying an action).
const completedDeeds = new Set(['直す', '動かす', '見つける', '修理', '復旧', '終える', '完成', '提出', '作る', '届ける', '助ける', '確認', '解決', '整理', '運ぶ', '渡す', '片付ける']);

function bodySpan(ir: DocumentIR, sentence: Span): Span | undefined {
  const text = slice(ir.source.raw, sentence), match = /^(\s*)([\s\S]*?)([。！!]*\s*)$/u.exec(text);
  if (!match || !match[2]) return;
  const start = sentence.start + [...match[1]].length;
  return { start, end: start + [...match[2]].length };
}

function safeCopiedSentence(ir: DocumentIR, span: Span, context: DiscourseContext, allowOpinion = false): boolean {
  // GiNZA can emit a newline-only sentence with a whitespace ROOT token. It is not
  // an antecedent, and must not hide a question or uncertain earlier sentence.
  // Do not skip across it: this recognizer only licenses immediate context.
  if (!slice(ir.source.raw, span).trim()) return false;
  if (insideEnclosure(ir.source.raw, span.start) || ir.source.opaqueSpans.some(value => overlaps(value, span))) return false;
  const local = sentenceScopes(context, span), root = rootIn(context, span);
  if (!root || !local.length || local.some(scope => !factFor(context, scope))) return false;
  // GiNZA also attaches the possibility particle か as case (not mark).
  // Keep this frame conservative without relaxing the shared scope checker.
  if (local.some(scope => scope.tokens.some(token => token.text === 'か' && ['case', 'mark'].includes(token.dep)
    && scope.tokens.some(child => child.head === token.id && child.dep === 'fixed' && ['しれる', '知れる'].includes(child.lemma))))) return false;
  // An explicit opinion shell is copied verbatim, never promoted to a fact.
  // Other uncertain constructions remain unsupported in this first frame set.
  const opinion = allowOpinion && root.predicate.lemma === '思う'
    && /と思う[。！!]*\s*$/u.test(slice(ir.source.raw, span))
    && !ir.tokens.some(token => inSpan(token.span, span) && (['らしい', 'そう', 'よう', 'みたい', 'はず', 'つもり'].includes(token.lemma) || token.text === 'か'));
  return local.every(scope => scope.attribution === 'narrator' && !scope.conditional && !scope.prospective && !scope.ambiguous && !scope.nonDeclarative && !scope.reportedContent
    && (!scope.speculative || opinion && (scope.predicate.id === root.predicate.id || scope.predicate.head === root.predicate.id && scope.predicate.dep === 'ccomp')));
}

export type DiscourseRecognitionDiagnostic = {
  kind: RecognizedDiscourseRelation['kind']; nodeId: string; sourceSpan?: Span;
  outcome: 'recognized' | 'relation_not_recognized' | 'scope_blocked'; reason: string;
};
export type DiscourseRecognitionObserver = (event: DiscourseRecognitionDiagnostic) => void;

function relation(ir: DocumentIR, context: DiscourseContext, kind: RecognizedDiscourseRelation['kind'], fact: Fact,
  clauses: { role: RecognizedDiscourseRelation['clauses'][number]['role']; span: Span }[],
  evidence: { role: RecognizedDiscourseRelation['evidenceTokens'][number]['role']; token: Token }[],
  sentences: Span[]): RecognizedDiscourseRelation {
  return { version: 1, kind, factId: fact.id, certainty: 'explicit',
    clauses: clauses.map(clause => ({ role: clause.role, span: { ...clause.span }, tokenIds: ir.tokens.filter(token => inSpan(token.span, clause.span)).map(token => token.id) })),
    evidenceTokens: evidence.map(({ role, token }) => ({ role, tokenId: token.id, span: { ...token.span } })),
    conditions: sentences.flatMap(sentence => sentenceScopes(context, sentence).map(scope => {
      const observed = factFor(context, scope)!;
      return { predicateTokenId: scope.predicate.id, factId: observed.id,
        polarity: observed.polarity, tense: observed.tense, realization: observed.realization, completion: observed.completion,
        voice: observed.voice, attribution: { ...observed.attribution }, conditional: scope.conditional, speculative: scope.speculative,
        prospective: scope.prospective, ambiguous: scope.ambiguous, nonDeclarative: scope.nonDeclarative, reportedContent: scope.reportedContent };
    })), provenance: { inputHash: ir.source.inputHash, parserVersion: ir.parserVersion } };
}

// Recognition contains only source relations and grammatical evidence. In
// particular, intensity, series and the registered output wording do not decide
// whether a relation exists. These caller-owned indexes are rebuilt for proof.
export function createDiscourseRecognizer(ir: DocumentIR, scopes: PropositionScope[], onDiagnostic?: DiscourseRecognitionObserver): (node: PlanNode) => RecognizedDiscourseRelation[] {
  const context: DiscourseContext = { byStart: new Map(ir.sentences.map((sentence, index) => [sentence.start, { sentence, index, scopes: [] }])), factsByPredicate: new Map(ir.facts.map(fact => [spanKey(fact.predicateSpan), fact])) };
  let index = 0;
  for (const scope of scopes) {
    while (index < ir.sentences.length - 1 && scope.predicate.span.start >= ir.sentences[index].end) index++;
    const item = context.byStart.get(ir.sentences[index]?.start);
    if (item && inSpan(scope.predicate.span, item.sentence)) item.scopes.push(scope);
  }
  return node => recognizeDiscourseForNode(ir, node, context, onDiagnostic);
}

function recognizeDiscourseForNode(ir: DocumentIR, node: PlanNode, context: DiscourseContext, onDiagnostic?: DiscourseRecognitionObserver): RecognizedDiscourseRelation[] {
  const report = (kind: RecognizedDiscourseRelation['kind'], outcome: DiscourseRecognitionDiagnostic['outcome'], reason: string) => onDiagnostic?.({ kind, nodeId: node.id, sourceSpan: node.sourceSpan, outcome, reason });
  const rejectAll = (outcome: DiscourseRecognitionDiagnostic['outcome'], reason: string): RecognizedDiscourseRelation[] => {
    for (const kind of ['explicit-reason', 'explicit-contrast', 'modest-achievement'] as const) report(kind, outcome, reason);
    return [];
  };
  if (!node.sourceSpan || ir.topicOnly) return rejectAll('scope_blocked', 'source_not_adopted');
  const entry = context.byStart.get(node.sourceSpan.start);
  if (!entry || !inSpan(entry.sentence, node.sourceSpan) || ir.sentences[entry.index + 1]?.start < node.sourceSpan.end) return rejectAll('scope_blocked', 'node_is_not_one_sentence');
  const { sentence, index } = entry, body = bodySpan(ir, sentence), root = rootIn(context, sentence);
  if (!body || !root || !inSpan(body, node.sourceSpan)) return rejectAll('relation_not_recognized', 'sentence_predicate_missing');
  const text = slice(ir.source.raw, body), previous = ir.sentences[index - 1], next = ir.sentences[index + 1];
  const reasonShape = !!previous && /から(?:だ|です)$/u.test(text) && !/^(?:何故なら|なぜなら|どうしてかというと|なぜかというと|何故かというと|というのも|(?:その)?理由は)/u.test(text);
  const contrastShape = !!previous && text.startsWith('しかし');
  const modestyShape = index === 0 && text === '大したことはしていない' && !!next;
  const fact = factFor(context, root);
  if (!fact || !node.factIds.includes(fact.id)) return rejectAll('scope_blocked', 'predicate_fact_not_adopted');
  const result: RecognizedDiscourseRelation[] = [];
  const accept = (recognized: RecognizedDiscourseRelation) => { result.push(recognized); report(recognized.kind, 'recognized', 'explicit_source_relation'); };

  // The grammatical から + copula already marks this as an explanation.
  // Temporal/source case particles (三時からだ / 駅からだ) cannot license it.
  if (!reasonShape || !previous) report('explicit-reason', 'relation_not_recognized', 'explicit_reason_shape_missing');
  else if (!safeCopiedSentence(ir, previous, context, true) || !safeCopiedSentence(ir, sentence, context)
    || fact.realization !== 'actual' || fact.polarity === 'unknown') report('explicit-reason', 'scope_blocked', 'unsafe_reason_context');
  else {
    const marker = root.children.find(token => token.text === 'から' && token.pos === 'SCONJ' && token.dep === 'mark');
    const copula = root.children.find(token => token.span.end === body.end && ['だ', 'です'].includes(token.text) && ['cop', 'aux'].includes(token.dep));
    if (marker && copula && marker.span.end === copula.span.start) accept(relation(ir, context, 'explicit-reason', fact,
      [{ role: 'claim', span: previous }, { role: 'reason', span: body }],
      [{ role: 'marker', token: marker }, { role: 'predicate', token: root.predicate }, { role: 'copula', token: copula }], [previous, sentence]));
    else report('explicit-reason', 'relation_not_recognized', 'grammatical_reason_marker_missing');
  }

  // A bare SCONJ が or けど may introduce background, not opposition. Only an
  // already explicit adversative connective is recognized; no relation is inferred.
  if (!contrastShape || !previous) report('explicit-contrast', 'relation_not_recognized', 'explicit_contrast_shape_missing');
  else if (!safeCopiedSentence(ir, previous, context) || !safeCopiedSentence(ir, sentence, context)) report('explicit-contrast', 'scope_blocked', 'unsafe_contrast_context');
  else {
    const marker = root.children.find(token => token.text === 'しかし' && token.pos === 'CCONJ' && token.dep === 'cc' && token.span.start === body.start);
    // Do not cut the connective compound しかしながら / しかしながらも.
    if (marker && !root.tokens.some(token => token.head === marker.id && token.dep === 'fixed') && !/^ながら/u.test(slice(ir.source.raw, { start: marker.span.end, end: body.end }))
      && !ir.source.protectedValues.some(value => overlaps(value.span, marker.span))) accept(relation(ir, context, 'explicit-contrast', fact,
        [{ role: 'antecedent', span: previous }, { role: 'contrast', span: body }],
        [{ role: 'marker', token: marker }, { role: 'predicate', token: root.predicate }], [previous, sentence]));
    else report('explicit-contrast', 'relation_not_recognized', 'standalone_contrast_marker_missing');
  }

  // Only the document-opening, exact modesty formula is recognized. This avoids
  // resolving an omitted subject from an earlier topic or an attributed remark.
  // Require the morphological past AUX -> だけ -> terminal copula sequence,
  // including voiced past だ, which GiNZA distinguishes through Inflection.
  if (!modestyShape || !next) report('modest-achievement', 'relation_not_recognized', 'opening_modesty_shape_missing');
  else if (!/^\s*$/u.test(slice(ir.source.raw, { start: 0, end: body.start }))
    || root.predicate.lemma !== 'する' || fact.polarity !== 'negative' || fact.realization !== 'actual'
    || !safeCopiedSentence(ir, sentence, context) || !safeCopiedSentence(ir, next, context)) report('modest-achievement', 'scope_blocked', 'unsafe_modesty_context');
  else {
    const achievement = rootIn(context, next), achieved = achievement && factFor(context, achievement), nextBody = bodySpan(ir, next);
    const actionScopes = sentenceScopes(context, next).filter(scope => ['ROOT', 'advcl', 'conj'].includes(scope.predicate.dep));
    const agents = actionScopes.flatMap(scope => scope.children.filter(token => ['nsubj', 'dislocated'].includes(token.dep)));
    const comitative = actionScopes.some(scope => scope.children.some(token => token.dep === 'obl' && scope.tokens.some(child => child.head === token.id && child.dep === 'case' && child.text === 'と')));
    if (!achievement || !achieved || !nextBody || !completedDeeds.has(achievement.predicate.lemma)) report('modest-achievement', 'relation_not_recognized', 'supported_achievement_missing');
    // A past desire is still not an accomplished deed: 運びたかった contains
    // both AUX たい and a genuine past AUX た. Keep this frame-specific guard
    // on the predicate-owned auxiliary chain; do not alter fact tense or infer
    // the realization of wishes elsewhere in the document.
    else if (achievement.associated.some(token => token.pos === 'AUX' && token.dep === 'aux'
      && (token.lemma === 'たい' || token.morphology.some(item => /^Inflection=助動詞-タイ(?:;|$)/u.test(item))))) report('modest-achievement', 'scope_blocked', 'desiderative_action_not_achievement');
    else if (achieved.polarity !== 'positive' || achieved.realization !== 'actual' || achieved.completion !== 'completed' || achieved.tense !== 'past' || achieved.voice !== 'active'
      || comitative || !agents.every(token => token.pos === 'PRON' && firstPerson.has(token.lemma) && !ir.tokens.some(child => child.head === token.id && child.id !== token.id && !['case', 'punct'].includes(child.dep)))) report('modest-achievement', 'scope_blocked', 'achievement_not_completed_narrator_action');
    else {
      const limit = achievement.children.find(token => token.text === 'だけ' && token.dep === 'mark');
      const past = achievement.children.find(isPastAuxiliary);
      const copula = achievement.children.find(token => token.text === 'だ' && token.lemma === 'だ' && token.pos === 'AUX'
        && token.span.end === nextBody.end && token.dep === 'aux' && !isPastAuxiliary(token));
      if (limit && past && copula && achievement.predicate.span.end <= past.span.start && past.span.end === limit.span.start && limit.span.end === copula.span.start) accept(relation(ir, context, 'modest-achievement', fact,
        [{ role: 'modesty', span: body }, { role: 'achievement', span: next }],
        [{ role: 'predicate', token: root.predicate }, { role: 'past', token: past }, { role: 'limit', token: limit }, { role: 'copula', token: copula }], [sentence, next]));
      else report('modest-achievement', 'relation_not_recognized', 'limited_past_achievement_sequence_missing');
    }
  }
  return result;
}

/** Select a registered form only after source-only recognition. A relation can
 * exist without a form at the requested intensity. The independent verifier
 * recognizes it again; a serialized relation is never trusted as its own proof. */
export function realizeDiscourseRelation(ir: DocumentIR, node: PlanNode, recognized: RecognizedDiscourseRelation, intensity: number): ConstructionEdit[] {
  const item = discourseConstructionRegistry.find(value => value.id === recognized.kind);
  if (!item || intensity < item.level || recognized.provenance.inputHash !== ir.source.inputHash || recognized.provenance.parserVersion !== ir.parserVersion) return [];
  const fact = ir.facts.find(value => value.id === recognized.factId);
  if (!fact || !node.factIds.includes(fact.id)) return [];
  const clause = (role: RecognizedDiscourseRelation['clauses'][number]['role']) => recognized.clauses.find(value => value.role === role);
  const marker = recognized.evidenceTokens.find(value => value.role === 'marker');
  const predicate = recognized.evidenceTokens.find(value => value.role === 'predicate');
  const target = item.realization === 'prefix_source_body' ? clause('reason')?.span : item.realization === 'replace_marker' ? marker?.span : clause('modesty')?.span;
  if (!target || !predicate) return [];
  const sourceSpan = item.realization === 'prefix_source_body' ? { start: target.start, end: target.start } : { ...target };
  const bindings = recognized.clauses.map(value => binding(value.role, value.span, ir));
  if (marker) bindings.push(binding('marker', marker.span, ir));
  bindings.push(binding('predicate', predicate.span, ir));
  return [{ nodeId: node.id, constructionId: item.id, constructionVersion: item.version, realizationId: `${item.id}:${item.realization}`, factId: fact.id,
    sourceSpan, from: slice(ir.source.raw, sourceSpan), to: item.surface, bindings, relation: recognized,
    operation: item.realization === 'prefix_source_body' ? { kind: 'prefix_source_body', prefix: item.surface, bodySourceSpan: { ...target }, permittedLocalEdits: 'independently_verified_rewrites' } : { kind: 'replace' },
    features: { polarity: fact.polarity, tense: fact.tense, realization: fact.realization, completion: fact.completion, attribution: { ...fact.attribution }, voice: fact.voice }, evidenceIds: [item.evidenceId] }];
}

export function createDiscourseBinder(ir: DocumentIR, scopes: PropositionScope[], onDiagnostic?: DiscourseRecognitionObserver): (node: PlanNode, intensity: number) => ConstructionEdit[] {
  const recognize = createDiscourseRecognizer(ir, scopes, onDiagnostic);
  return (node, intensity) => recognize(node).flatMap(recognized => realizeDiscourseRelation(ir, node, recognized, intensity));
}
