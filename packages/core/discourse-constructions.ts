import type { ConstructionBinding, ConstructionEdit, DocumentIR, Fact, PlanNode, Span } from '../contracts';
import { overlaps, slice } from './source';
import { insideEnclosure, type PropositionScope } from './grammar-scope';

// These are small discourse frames, not permission to supply premises, praise,
// causes or an adversary. The copied clauses and their context are rebound from
// the immutable input during verification, just like the local constructions.
export const discourseConstructionRegistry = [
  { id: 'explicit-reason', version: 1, series: ['gg'], family: 'explicit-reason-frame', level: 2,
    evidenceId: 'post_02421_ef97fdc26a351d5a_9490', needle: '何故なら',
    slots: ['claim', 'reason', 'marker', 'predicate'], semanticDelta: 'explicit trailing reason -> overt reason introduction; clauses copied', preserves: ['arguments', 'polarity', 'tense', 'attribution', 'realization', 'modality', 'reason-direction'] },
  { id: 'explicit-contrast', version: 1, series: ['night'], family: 'explicit-contrast-frame', level: 3,
    evidenceId: 'post_01674_cb7c3a70cfcf77ea_5601', needle: 'だが',
    slots: ['antecedent', 'contrast', 'marker', 'predicate'], semanticDelta: 'explicit sentence-initial しかし -> attested だが; clauses copied', preserves: ['arguments', 'polarity', 'tense', 'attribution', 'realization', 'contrast-direction'] },
  { id: 'modest-achievement', version: 1, series: ['night'], family: 'modest-achievement-frame', level: 2,
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
  if (insideEnclosure(ir.source.raw, span.start) || ir.source.opaqueSpans.some(value => overlaps(value, span))) return false;
  const local = sentenceScopes(context, span), root = rootIn(context, span);
  if (!root || !local.length) return false;
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

function edit(ir: DocumentIR, node: PlanNode, item: typeof discourseConstructionRegistry[number], fact: Fact, sourceSpan: Span, to: string, bindings: ConstructionBinding[]): ConstructionEdit {
  return { nodeId: node.id, constructionId: item.id, constructionVersion: 1, realizationId: `${item.id}:copied-context`, factId: fact.id,
    sourceSpan, from: slice(ir.source.raw, sourceSpan), to, bindings,
    features: { polarity: fact.polarity, tense: fact.tense, realization: fact.realization, completion: fact.completion, attribution: { ...fact.attribution }, voice: fact.voice }, evidenceIds: [item.evidenceId] };
}

// One caller-owned index per planning/proof pass. It is never stored on the IR
// or serialized as evidence; the verifier creates its own from source scopes.
export function createDiscourseBinder(ir: DocumentIR, scopes: PropositionScope[]): (node: PlanNode, intensity: number) => ConstructionEdit[] {
  const context: DiscourseContext = { byStart: new Map(ir.sentences.map((sentence, index) => [sentence.start, { sentence, index, scopes: [] }])), factsByPredicate: new Map(ir.facts.map(fact => [spanKey(fact.predicateSpan), fact])) };
  let index = 0;
  for (const scope of scopes) {
    while (index < ir.sentences.length - 1 && scope.predicate.span.start >= ir.sentences[index].end) index++;
    const item = context.byStart.get(ir.sentences[index]?.start);
    if (item && inSpan(scope.predicate.span, item.sentence)) item.scopes.push(scope);
  }
  return (node, intensity) => bindDiscourseForNode(ir, node, intensity, context);
}

function bindDiscourseForNode(ir: DocumentIR, node: PlanNode, intensity: number, context: DiscourseContext): ConstructionEdit[] {
  if (!node.sourceSpan || ir.topicOnly || intensity < 2) return [];
  const entry = context.byStart.get(node.sourceSpan.start);
  if (!entry || !inSpan(entry.sentence, node.sourceSpan) || ir.sentences[entry.index + 1]?.start < node.sourceSpan.end) return [];
  const { sentence, index } = entry, body = bodySpan(ir, sentence), root = rootIn(context, sentence);
  if (!body || !root || !inSpan(body, node.sourceSpan)) return [];
  const text = slice(ir.source.raw, body), previous = ir.sentences[index - 1], next = ir.sentences[index + 1];
  const reasonShape = !!previous && /から(?:だ|です)$/u.test(text) && !/^(?:何故なら|なぜなら|どうしてかというと|なぜかというと|何故かというと|というのも|(?:その)?理由は)/u.test(text);
  const contrastShape = intensity >= 3 && !!previous && text.startsWith('しかし');
  const modestyShape = index === 0 && text === '大したことはしていない' && !!next;
  if (!reasonShape && !contrastShape && !modestyShape) return [];
  const fact = factFor(context, root); if (!fact || !node.factIds.includes(fact.id)) return [];
  const result: ConstructionEdit[] = [];

  // The grammatical から + copula already marks this as an explanation.
  // Temporal/source case particles (三時からだ / 駅からだ) cannot license it.
  if (reasonShape && previous && safeCopiedSentence(ir, previous, context, true) && safeCopiedSentence(ir, sentence, context)
    && fact.realization === 'actual' && fact.polarity !== 'unknown') {
    const marker = root.children.find(token => token.text === 'から' && token.pos === 'SCONJ' && token.dep === 'mark');
    const copula = root.children.find(token => token.span.end === body.end && ['だ', 'です'].includes(token.text) && ['cop', 'aux'].includes(token.dep));
    if (marker && copula && marker.span.end === copula.span.start) result.push(edit(ir, node, discourseConstructionRegistry[0], fact, body, `何故なら${text}`,
      [binding('claim', previous, ir), binding('reason', body, ir), binding('marker', marker.span, ir), binding('predicate', root.predicate.span, ir)]));
  }

  // A bare SCONJ が or けど may introduce background, not opposition. Only an
  // already explicit adversative connective is changed; no relation is inferred.
  if (contrastShape && previous && safeCopiedSentence(ir, previous, context) && safeCopiedSentence(ir, sentence, context)) {
    const marker = root.children.find(token => token.text === 'しかし' && token.pos === 'CCONJ' && token.dep === 'cc' && token.span.start === body.start);
    // Do not cut the connective compound しかしながら / しかしながらも.
    if (marker && !root.tokens.some(token => token.head === marker.id && token.dep === 'fixed') && !/^ながら/u.test(slice(ir.source.raw, { start: marker.span.end, end: body.end }))
      && !ir.source.protectedValues.some(value => overlaps(value.span, marker.span))) result.push(edit(ir, node, discourseConstructionRegistry[1], fact, marker.span, 'だが',
      [binding('antecedent', previous, ir), binding('contrast', body, ir), binding('marker', marker.span, ir), binding('predicate', root.predicate.span, ir)]));
  }

  // Only the document-opening, exact modesty formula is paraphrased. This avoids
  // resolving an omitted subject from an earlier topic or an attributed remark.
  // The following deed must be explicit, completed and limited by ただけだ.
  if (modestyShape && /^\s*$/u.test(slice(ir.source.raw, { start: 0, end: body.start })) && next
    && root.predicate.lemma === 'する' && fact.polarity === 'negative' && fact.realization === 'actual'
    && safeCopiedSentence(ir, sentence, context) && safeCopiedSentence(ir, next, context)) {
    const achievement = rootIn(context, next), achieved = achievement && factFor(context, achievement), nextBody = bodySpan(ir, next);
    const actionScopes = sentenceScopes(context, next).filter(scope => ['ROOT', 'advcl', 'conj'].includes(scope.predicate.dep));
    const agents = actionScopes.flatMap(scope => scope.children.filter(token => ['nsubj', 'dislocated'].includes(token.dep)));
    const comitative = actionScopes.some(scope => scope.children.some(token => token.dep === 'obl' && scope.tokens.some(child => child.head === token.id && child.dep === 'case' && child.text === 'と')));
    if (achievement && achieved && nextBody && completedDeeds.has(achievement.predicate.lemma) && achieved.polarity === 'positive' && achieved.realization === 'actual' && achieved.completion === 'completed' && achieved.tense === 'past' && achieved.voice === 'active'
      && /ただけだ$/u.test(slice(ir.source.raw, nextBody)) && !comitative
      && agents.every(token => token.pos === 'PRON' && firstPerson.has(token.lemma) && !ir.tokens.some(child => child.head === token.id && child.id !== token.id && !['case', 'punct'].includes(child.dep)))) {
      const limit = achievement.children.find(token => token.text === 'だけ' && token.dep === 'mark');
      const past = achievement.children.find(token => token.lemma === 'た' && token.dep === 'aux');
      const copula = achievement.children.find(token => token.text === 'だ' && token.span.end === nextBody.end && token.dep === 'aux');
      if (limit && past && copula && past.span.end === limit.span.start && limit.span.end === copula.span.start) result.push(edit(ir, node, discourseConstructionRegistry[2], fact, body, 'それほどでもない',
        [binding('modesty', body, ir), binding('achievement', next, ir), binding('predicate', root.predicate.span, ir)]));
    }
  }
  return result;
}
