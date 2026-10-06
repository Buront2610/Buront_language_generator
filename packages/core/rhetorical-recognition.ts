import type { DocumentIR, Fact, Span, Token, RhetoricalSlot, RhetoricalMarker, RhetoricalCondition, RhetoricalRelation } from '../contracts';
import { recognizeCarrierEvidenceRequests } from './evidence-request-roles';
import { hash, overlaps, slice } from './source';
import { hasInflection, insideEnclosure, isPastAuxiliary, propositionScopes, type PropositionScope } from './grammar-scope';

/** Source relations contain no chosen style, output wording or invented speaker.
 * A condition's illocution is independent of the fact extractor's realization:
 * an embedded target in an evidence question is mentioned, never asserted. */
export type { RhetoricalSlot, RhetoricalMarker, RhetoricalCondition, RhetoricalRelation } from '../contracts';

const inSpan = (inner: Span, outer: Span): boolean => outer.start <= inner.start && inner.end <= outer.end;
const spanKey = (span: Span): string => `${span.start}:${span.end}`;
const firstPerson = new Set(['私', 'わたし', 'わたくし', '僕', '俺']);
const reportOrThought = new Set(['言う', 'いう', '話す', '聞く', '述べる', '報告', '伝える', '思う', '考える', '推測', '予想']);
export type SentenceContext = { sentence: Span; body: Span; scopes: PropositionScope[]; root: PropositionScope };
export type Context = {
  ir: DocumentIR; scopes: PropositionScope[]; facts: Map<string, Fact>;
  sentences: (SentenceContext | undefined)[];
};
const factFor = (context: Context, scope: PropositionScope): Fact | undefined => context.facts.get(spanKey(scope.predicate.span));
const tokensIn = (context: Context, span: Span): Token[] => context.ir.tokens.filter(token => inSpan(token.span, span));

function preservesModality(scope: PropositionScope): boolean {
  if ((hasInflection(scope.predicate, '命令形') || hasInflection(scope.predicate, '仮定形')) && scope.associated.some(token => token.lemma === 'ます')) return true;
  if (scope.tokens.some(token => token.pos === 'AUX' && ['できる', 'れる', 'られる'].includes(token.lemma))
    || ['できる', '読める', '見える', '聞こえる'].includes(scope.predicate.lemma)) return true;
  // The parser supplies conjugation but no reliable lexical potential bit.
  // Productive godan potentials (休める, 泳げる, 帰れる, etc.) are lower
  // ichidan verbs. Ordinary lower-ichidan verbs share that class; preserve
  // their source modality conservatively rather than guessing from a lexicon.
  return scope.predicate.pos === 'VERB' && hasInflection(scope.predicate, '下一段');
}

function trimSpan(raw: string, span: Span, boundary = false): Span | undefined {
  const chars = [...slice(raw, span)];
  let start = 0, end = chars.length;
  while (start < end && /\s/u.test(chars[start])) start++;
  while (end > start && (boundary ? /[\s。！!？?]/u : /\s/u).test(chars[end - 1])) end--;
  return start < end ? { start: span.start + start, end: span.start + end } : undefined;
}

function adopted(context: Context, span: Span): boolean {
  const { ir } = context;
  if (ir.topicOnly || ir.omittedSpans.some(value => overlaps(value, span))) return false;
  let cursor = span.start;
  for (const piece of [...ir.adoptedSpans].sort((a, b) => a.start - b.start)) {
    if (piece.end <= cursor) continue;
    if (piece.start > cursor) return false;
    cursor = Math.max(cursor, piece.end);
    if (cursor >= span.end) return true;
  }
  return false;
}

/** Check each licensed assertion; literal nested roles have separate preservation contracts. */
function safeScope(context: Context, scope: PropositionScope, speechAct: 'assertion' | 'question' | 'request' = 'assertion', copied: { prospective?: boolean; uncertainMorphology?: boolean; assessment?: boolean; conditional?: boolean; speculative?: boolean; boundSpan?: Span } = {}): boolean {
  const fact = factFor(context, scope);
  const morphologicalUnknown = !!fact && copied.uncertainMorphology && !scope.ambiguous && scope.associated.some(token => token.pos === 'AUX' && ['れる', 'られる'].includes(token.lemma));
  if (!fact || fact.attribution.kind !== 'narrator' || fact.attribution.speaker !== null
    || scope.attribution !== 'narrator' || !(fact.realization === 'actual' || copied.prospective && fact.realization === 'prospective' || copied.conditional && fact.realization === 'hypothetical' || copied.speculative && scope.speculative && fact.realization === 'unknown' || morphologicalUnknown)
    || !morphologicalUnknown && (fact.polarity === 'unknown' || fact.tense === 'unknown' || fact.voice === 'unknown')
    || !copied.conditional && scope.conditional || !copied.speculative && scope.speculative
    || !copied.prospective && scope.prospective || scope.ambiguous || !copied.assessment && scope.reportedContent || scope.reportHead || scope.reportSource
    || speechAct === 'assertion' && scope.nonDeclarative) return false;
  // These parser variants are not all represented by the shared checker. In
  // particular, GiNZA may label か in かもしれない as case instead of mark.
  if (scope.tokens.some(token => token.text === 'か'
    && scope.tokens.some(child => child.head === token.id && child.dep === 'fixed' && ['しれる', '知れる'].includes(child.lemma)))) return false;
  // に違いない / に決まっている are epistemic fixed expressions attached
  // through a case particle, outside the predicate auxiliary chain. They are
  // not evidence that the underlying event actually happened.
  if (scope.tokens.some(token => token.text === 'に' && token.dep === 'case' && token.head === scope.predicate.id
    && scope.tokens.some(child => child.head === token.id && child.dep === 'fixed' && ['違い', '相違', '決まる'].includes(child.lemma)))) return false;
  // A possibility/fear or "気がする" shell must not hide the status of its
  // embedded proposition. These conservative guards are relation-specific.
  if (scope.predicate.lemma === '決まる' && context.scopes.some(child => child.predicate.head === scope.predicate.id
    && child.children.some(token => token.text === 'に' && token.dep === 'case'))) return false;
  if (scope.children.some(token => ['可能性', '恐れ', 'おそれ'].includes(token.lemma))
    || scope.predicate.lemma === 'する' && scope.children.some(token => token.lemma === '気' && token.dep === 'nsubj')) return false;
  if (scope.associated.some(token => token.pos === 'AUX' && (['たい', 'べし'].includes(token.lemma)
    || hasInflection(token, '助動詞-タイ') || speechAct !== 'request' && hasInflection(token, '命令形')))) return false;
  // An independent occurrence of a reporting verb is not a relation license.
  // Reject any reporting predicate that has clausal material below it even
  // when a malformed or unusual parse failed to set reportedContent.
  if (!copied.assessment && reportOrThought.has(scope.predicate.lemma) && context.scopes.some(child => child.predicate.head === scope.predicate.id && child !== scope && (!copied.boundSpan || inSpan(child.predicate.span, copied.boundSpan)))) return false;
  return true;
}

function safeSurface(context: Context, entry: SentenceContext): boolean {
  const { source } = context.ir;
  return !insideEnclosure(source.raw, entry.sentence.start)
    && !source.opaqueSpans.some(span => overlaps(span, entry.sentence))
    && entry.scopes.every(scope => !insideEnclosure(source.raw, scope.predicate.span.start));
}

function safeCausalParts(context: Context, entry: SentenceContext, reasonRoot: PropositionScope, reason: Span, claim: Span): boolean {
  return safeSurface(context, entry) && entry.scopes.every(scope => {
    if (inSpan(scope.predicate.span, reason)) return safeScope(context, scope, 'assertion', { prospective: true, uncertainMorphology: scope !== reasonRoot || scope.negative });
    if (inSpan(scope.predicate.span, claim)) return safeScope(context, scope, 'assertion', { prospective: true, conditional: true, speculative: true, assessment: true, uncertainMorphology: scope !== entry.root || scope.negative });
    return false;
  });
}

/** Clause reordering must not detach an explicit link to preceding discourse.
 * GiNZA uses cc even for split ADP で+も and AUX だ+から, and can label
 * sentence-internal しかし as ADV. Do not confuse a nested relative clause or
 * the ordinary object その結果を with a sentence-level connective. */
function leadingDiscourseMarker(context: Context, span: Span): boolean {
  const tokens = tokensIn(context, span).filter(token => token.pos !== 'SPACE' && !/^\s+$/u.test(token.text));
  const first = tokens.find(token => token.pos !== 'PUNCT');
  if (!first) return false;
  if (first.pos === 'CCONJ' || ['cc', 'discourse'].includes(first.dep)) return true;
  if (first.pos === 'ADV' && ['しかし', 'だが', 'ただし', 'なお', 'また', 'さらに', '更に', 'したがって', '従って', 'つまり', 'むしろ'].includes(first.lemma)) return true;
  const next = tokens[tokens.indexOf(first) + 1];
  if (['ただ', 'あと', '一方', '逆'].includes(first.lemma) && next && /[、,]/u.test(next.text)) return true;
  if (first.lemma === 'その' && first.dep === 'det' && next && first.head === next.id && ['ため', '結果'].includes(next.lemma)) {
    const tail = tokens[tokens.indexOf(next) + 1];
    return !!tail && (/[、,]/u.test(tail.text) || tail.dep === 'case' && ['に', 'で'].includes(tail.text));
  }
  return false;
}

function descendants(context: Context, predicate: Token, entry: SentenceContext): Set<number> {
  const result = new Set([predicate.id]);
  const tokens = tokensIn(context, entry.sentence);
  for (let pass = 0; pass < tokens.length; pass++) {
    let changed = false;
    for (const token of tokens) if (!result.has(token.id) && result.has(token.head)) { result.add(token.id); changed = true; }
    if (!changed) break;
  }
  return result;
}

function marker(context: Context, role: string, span: Span): RhetoricalMarker {
  return { role, span: { ...span }, tokenIds: tokensIn(context, span).map(token => token.id) };
}

/** Embedded descriptions/complements are preserved in their governing source
 * clause. A copied judgment or nominalized activity is not independently
 * certified as an asserted proposition by a causal relation. */
function embeddedWithin(context: Context, scope: PropositionScope, slot: Span): boolean {
  let current: Token | undefined = scope.predicate;
  for (let steps = 0; current && steps < context.ir.tokens.length; steps++) {
    const head = context.ir.tokens.find(token => token.id === current!.head);
    if (!head || head.id === current.id || !inSpan(head.span, slot)) return false;
    const nominalized = context.ir.tokens.some(token => token.head === current!.id && token.text === 'の' && token.dep === 'mark')
      && context.ir.tokens.some(token => token.head === current!.id && ['は','が'].includes(token.text) && token.dep === 'case');
    if (['acl','ccomp','csubj','nmod'].includes(current.dep) || nominalized) return true;
    current = head;
  }
  return false;
}

function makeRelation(context: Context, kind: RhetoricalRelation['kind'], sourceForm: RhetoricalRelation['sourceForm'],
  sourceSpan: Span, bodies: { role: RhetoricalSlot['role']; span: Span }[], markers: RhetoricalMarker[],
  entries: SentenceContext[], agentResolution?: RhetoricalRelation['agentResolution'], metadata: Pick<RhetoricalRelation, 'selfEvaluation' | 'achievementKind' | 'eventBinding' | 'targetMode' | 'targetLink'> = {}): RhetoricalRelation | undefined {
  if (!adopted(context, sourceSpan) || bodies.some(body => body.span.start >= body.span.end || !inSpan(body.span, sourceSpan))) return;
  const slots: RhetoricalSlot[] = bodies.map(body => ({ ...body, span: { ...body.span },
    tokenIds: tokensIn(context, body.span).map(token => token.id),
    factIds: context.ir.facts.filter(fact => inSpan(fact.predicateSpan, body.span)).map(fact => fact.id) }));
  if (slots.some(slot => !slot.factIds.length && !(slot.role === 'target' && metadata.targetMode === 'nominal'))) return;
  // Preserve every original separator/tail. Content slots and non-evidential
  // markers partition the adopted block; past/limit markers are evidence that
  // deliberately points inside an already copied achievement slot.
  const occupied = [...slots.map(slot => slot.span), ...markers.map(value => value.span)].sort((a, b) => a.start - b.start || a.end - b.end);
  const allMarkers = [...markers];
  let cursor = sourceSpan.start;
  for (const span of occupied) {
    if (span.start > cursor) allMarkers.push(marker(context, 'boundary', { start: cursor, end: span.start }));
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < sourceSpan.end) allMarkers.push(marker(context, 'boundary', { start: cursor, end: sourceSpan.end }));
  allMarkers.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end || a.role.localeCompare(b.role));
  const conditions: RhetoricalCondition[] = entries.flatMap(entry => entry.scopes.map(scope => {
    const fact = factFor(context, scope)!;
    const target = slots.find(slot => slot.role === 'target');
    const literalContext = slots.some(slot => slot.role === 'context' && inSpan(scope.predicate.span, slot.span));
    const nominalTarget = !!target && metadata.targetMode === 'nominal' && inSpan(scope.predicate.span, target.span);
    const owned = slots.find(slot => inSpan(scope.predicate.span, slot.span));
    const assessment = owned?.role === 'modesty' && metadata.selfEvaluation !== 'scale-minimizing';
    const assessmentLiteral = assessment && (entries.flatMap(entry => entry.scopes).filter(local => inSpan(local.predicate.span, owned!.span)).length > 1 || scope.ambiguous || fact.voice === 'unknown' || scope.speculative || scope.conditional);
    const embeddedEvent = owned?.role === 'achievement' && metadata.eventBinding?.embeddedPredicateTokenIds.includes(scope.predicate.id);
    const embeddedCause = kind === 'reason-claim' && !!owned && embeddedWithin(context, scope, owned.span);
    const embedded = embeddedEvent || embeddedCause;
    // Japanese nonpast verbal clauses may be a plan/prediction even without
    // one of the parser's temporal cue words. Do not turn that unresolved
    // temporal commitment into a fact-nominalized conclusion.
    const boundedNonpastEvent = kind === 'reason-claim' && owned?.role === 'claim' && scope.predicate.pos === 'VERB' && fact.tense === 'nonpast';
    const relationShell = !owned;
    const sourceRole: RhetoricalCondition['sourceRole'] = literalContext ? 'literal-context' : owned?.role === 'modesty' ? 'assessment-content' : embedded ? 'embedded-description'
      : relationShell ? 'relation-marker' : owned?.role === 'achievement' ? 'asserted-event' : kind !== 'evidence-request' ? 'causal-proposition'
      : owned?.role === 'target' ? 'mentioned-target' : 'request-shell';
    const illocution: RhetoricalCondition['illocution'] = literalContext ? 'literal-context' : assessment || embedded ? 'mentioned-proposition' : kind !== 'evidence-request' ? 'assertion' : target && inSpan(scope.predicate.span, target.span) ? 'mentioned-proposition'
      : sourceForm === 'embedded-evidence-question' ? 'question' : 'request';
    return { predicateTokenId: scope.predicate.id, factId: fact.id, polarity: fact.polarity, tense: fact.tense,
      realization: fact.realization, completion: fact.completion, voice: fact.voice, attribution: { ...fact.attribution }, resolution: fact.resolution,
      conditional: scope.conditional, speculative: scope.speculative, prospective: scope.prospective,
      ambiguous: scope.ambiguous, nonDeclarative: scope.nonDeclarative, reportedContent: scope.reportedContent, sourceRole, illocution,
      preservation: literalContext || nominalTarget || assessmentLiteral ? 'literal-copy' : assessment ? 'modality-preserved' : embedded ? 'embedded-scope' : boundedNonpastEvent || scope.prospective || scope.conditional || scope.speculative || fact.voice === 'unknown' || fact.realization !== 'actual' || preservesModality(scope) || metadata.achievementKind === 'past-ability' && owned?.role === 'achievement' ? 'modality-preserved' : 'asserted' };

  }));
  const content = { version: 3 as const, kind, sourceForm, sourceSpan: { ...sourceSpan }, slots, markers: allMarkers, conditions,
    ...(agentResolution ? { agentResolution } : {}), ...metadata, provenance: { inputHash: context.ir.source.inputHash, parserVersion: context.ir.parserVersion } };
  return { ...content, id: `rhetorical-${hash(content).slice(0, 24)}` };
}

function causeMarkers(context: Context, scope: PropositionScope): RhetoricalMarker[] {
  const result: RhetoricalMarker[] = [];
  for (const token of scope.children) {
    if (token.pos !== 'SCONJ' || token.dep !== 'mark') continue;
    if (token.text === 'から') result.push(marker(context, 'cause', token.span));
    if (token.text === 'ので') result.push(marker(context, 'cause', token.span));
    if (token.text === 'の') {
      const tail = scope.tokens.find(child => child.head === token.id && child.dep === 'fixed' && child.text === 'で' && child.pos === 'AUX' && child.span.start === token.span.end);
      if (tail) result.push(marker(context, 'cause', { start: token.span.start, end: tail.span.end }));
    }
  }
  return result;
}

/** Explanatory/nominal negation may deny the proposed causal connection,
 * rather than its matrix event. Splitting AのでBのではない would falsely
 * assert not-B. Refuse that decomposition; plain predicate negation and
 * negative propositions inside a supplied reason retain their own roles. */
function negatedCausalExplanation(scope: PropositionScope): boolean {
  if (!scope.negative) return false;
  if (['の','ん','わけ','訳','こと','事','もの','物'].includes(scope.predicate.lemma)) return true;
  return scope.associated.some(nominalizer => ['の','ん','だけ','ばかり','のみ'].includes(nominalizer.lemma) && ['mark','case'].includes(nominalizer.dep)
    && scope.associated.some(copula => copula.pos === 'AUX' && ['だ','です'].includes(copula.lemma)
      && copula.span.start === nominalizer.span.end && ['aux','cop','fixed'].includes(copula.dep)
      && scope.associated.some(negative => negative.span.start >= copula.span.end && ['ない','ぬ','ず'].includes(negative.lemma) && ['AUX','ADJ'].includes(negative.pos))));
}

/** A refused relation-wide negation is an opaque discourse scope for this
 * program. Other sentence blocks may transform, but cannot lend local-edit
 * permission to its unresolved explanation/negation boundary. */
export function literalRhetoricalContextSpans(ir: DocumentIR): Span[] {
  const scopes = propositionScopes(ir.source, ir);
  return ir.sentences.filter(sentence => scopes.some(scope => scope.predicate.dep === 'ROOT' && inSpan(scope.predicate.span, sentence) && negatedCausalExplanation(scope))).map(span => ({ ...span }));
}

function recognizeCausalClause(context: Context, entry: SentenceContext): RhetoricalRelation | undefined {
  if (negatedCausalExplanation(entry.root)) return;
  if (leadingDiscourseMarker(context, entry.body)) return;
  const candidates = entry.scopes.flatMap(scope => causeMarkers(context, scope).map(cause => ({ scope, cause })));
  if (candidates.length !== 1) return;
  const { scope, cause } = candidates[0];
  if (scope.predicate.dep !== 'advcl' || scope.predicate.head !== entry.root.predicate.id || scope === entry.root) return;
  const owned = descendants(context, scope.predicate, entry);
  // Splitting/reordering is licensed only for a contiguous leading reason.
  // A matrix topic before the reason (私は雨なので...) is not moved into it.
  if (!tokensIn(context, { start: entry.body.start, end: cause.span.end }).every(token => owned.has(token.id))) return;
  if (tokensIn(context, { start: cause.span.end, end: entry.body.end }).some(token => owned.has(token.id) && token.pos !== 'PUNCT' && !/^\s+$/u.test(token.text))) return;
  let claimStart = cause.span.end;
  const chars = [...context.ir.source.raw];
  while (claimStart < entry.body.end && /[\s、,]/u.test(chars[claimStart])) claimStart++;
  const claim = { start: claimStart, end: entry.body.end };
  if (!inSpan(entry.root.predicate.span, claim) || leadingDiscourseMarker(context, claim)) return;
  let reasonEnd = cause.span.start;
  const markers = [cause];
  const linkingCopula = scope.associated.find(token => token.text === 'な' && token.lemma === 'だ' && token.pos === 'AUX'
    && ['aux', 'cop'].includes(token.dep) && token.span.end === cause.span.start);
  if (linkingCopula) { reasonEnd = linkingCopula.span.start; markers.push(marker(context, 'cause-link-copula', linkingCopula.span)); }
  const reason = trimSpan(context.ir.source.raw, { start: entry.body.start, end: reasonEnd });
  if (!reason || !inSpan(scope.predicate.span, reason) || !safeCausalParts(context, entry, scope, reason, claim)) return;
  return makeRelation(context, 'reason-claim', 'causal-clause', entry.sentence,
    [{ role: 'reason', span: reason }, { role: 'claim', span: claim }], markers, [entry]);
}

/** ため is causal only with an independently stated state, an ongoing event,
 * or a past event. A bare intended/nonpast action can instead express purpose. */
function recognizeCausalTame(context: Context, entry: SentenceContext): RhetoricalRelation | undefined {
  if (negatedCausalExplanation(entry.root)) return;
  if (leadingDiscourseMarker(context, entry.body)) return;
  const heads = tokensIn(context, entry.body).filter(token => token.lemma === 'ため' && token.pos === 'NOUN' && token.dep === 'obl' && token.head === entry.root.predicate.id);
  if (heads.length !== 1) return;
  const head = heads[0], clauses = entry.scopes.filter(scope => scope.predicate.head === head.id && ['acl', 'nmod'].includes(scope.predicate.dep));
  if (clauses.length !== 1) return;
  const scope = clauses[0], fact = factFor(context, scope)!;
  const ongoing = scope.children.some(token => ['て', 'で'].includes(token.text) && token.dep === 'mark'
    && scope.tokens.some(child => child.head === token.id && child.dep === 'fixed' && child.lemma === 'いる'));
  const stative = scope.predicate.pos === 'ADJ' || scope.predicate.pos === 'NOUN' && scope.children.some(token => token.dep === 'nsubj');
  const negativeAbility = scope.negative && (scope.associated.some(token => token.lemma === 'できる') || ['読める', '見える', '聞こえる', '分かる', 'ある', 'ない'].includes(scope.predicate.lemma));
  if (!(fact.tense === 'past' || ongoing || stative || negativeAbility)) return;
  const owned = descendants(context, scope.predicate, entry);
  if (!tokensIn(context, { start: entry.body.start, end: head.span.start }).every(token => owned.has(token.id))) return;
  const after = context.ir.tokens.filter(token => token.head === head.id && token.dep === 'case' && token.text === 'に' && token.span.start === head.span.end);
  const cause = { start: head.span.start, end: after[0]?.span.end ?? head.span.end };
  let claimStart = cause.end;
  const chars = [...context.ir.source.raw];
  while (claimStart < entry.body.end && /[\s、,]/u.test(chars[claimStart])) claimStart++;
  const claim = { start: claimStart, end: entry.body.end };
  if (!inSpan(entry.root.predicate.span, claim) || leadingDiscourseMarker(context, claim)) return;
  let reasonEnd = head.span.start;
  const markers = [marker(context, 'cause', cause)];
  const copula = scope.tokens.find(token => token.span.end === head.span.start && (token.text === 'な' && token.lemma === 'だ' && token.pos === 'AUX'
    || token.text === 'の' && token.dep === 'case' && token.head === scope.predicate.id && scope.predicate.pos === 'NOUN'));
  if (copula) { reasonEnd = copula.span.start; markers.push(marker(context, 'cause-link-copula', copula.span)); }
  const reason = trimSpan(context.ir.source.raw, { start: entry.body.start, end: reasonEnd });
  if (!reason || !safeCausalParts(context, entry, scope, reason, claim)) return;
  return makeRelation(context, 'reason-claim', 'causal-tame', entry.sentence,
    [{ role: 'reason', span: reason }, { role: 'claim', span: claim }], markers, [entry]);
}

function recognizeTrailingReason(context: Context, previous: SentenceContext | undefined, entry: SentenceContext): RhetoricalRelation | undefined {
  if (!previous || negatedCausalExplanation(previous.root) || !safeSurface(context, previous) || !previous.scopes.every(scope => safeScope(context, scope, 'assertion', { prospective: true, conditional: true, speculative: true, assessment: true, uncertainMorphology: scope !== previous.root || scope.negative })) || !safeSurface(context, entry) || !entry.scopes.every(scope => safeScope(context, scope, 'assertion', { prospective: true }))
    || leadingDiscourseMarker(context, previous.body) || leadingDiscourseMarker(context, entry.body)) return;
  const markers = causeMarkers(context, entry.root).filter(value => slice(context.ir.source.raw, value.span) === 'から');
  if (markers.length !== 1) return;
  const cause = markers[0];
  const copula = entry.root.children.find(token => ['だ', 'です'].includes(token.text) && token.pos === 'AUX'
    && ['aux', 'cop'].includes(token.dep) && token.span.start === cause.span.end && token.span.end === entry.body.end && !isPastAuxiliary(token));
  if (!copula || /^(?:何故なら|なぜなら|どうしてかというと|なぜかというと|何故かというと|というのも|(?:その)?理由は)/u.test(slice(context.ir.source.raw, entry.body))) return;
  const reason = trimSpan(context.ir.source.raw, { start: entry.body.start, end: cause.span.start });
  if (!reason || !inSpan(entry.root.predicate.span, reason)) return;
  return makeRelation(context, 'reason-claim', 'trailing-reason', { start: previous.sentence.start, end: entry.sentence.end },
    [{ role: 'claim', span: previous.body }, { role: 'reason', span: reason }],
    [cause, marker(context, 'explanatory-copula', copula.span)], [previous, entry]);
}

/** An explicit sentence-final ためだ explains the preceding whole assertion.
 * A bare intended action remains ambiguous purpose and is not a causal license. */
function recognizeTrailingTame(context: Context, previous: SentenceContext | undefined, entry: SentenceContext): RhetoricalRelation | undefined {
  if (!previous || negatedCausalExplanation(previous.root) || entry.root.predicate.lemma !== 'ため' || !safeSurface(context, previous) || !safeSurface(context, entry)
    || leadingDiscourseMarker(context, previous.body) || leadingDiscourseMarker(context, entry.body)) return;
  if (!previous.scopes.every(scope => safeScope(context, scope, 'assertion', { prospective: true, conditional: true, speculative: true, assessment: true, uncertainMorphology: scope !== previous.root || scope.negative }))) return;
  const head = entry.root.predicate;
  const roots = entry.scopes.filter(scope => scope.predicate.head === head.id && ['acl','nmod'].includes(scope.predicate.dep));
  const copula = entry.root.associated.find(token => token.pos === 'AUX' && ['だ','です'].includes(token.text) && token.span.start === head.span.end && token.span.end === entry.body.end);
  if (roots.length !== 1 || !copula || !entry.scopes.every(scope => safeScope(context, scope, 'assertion', { prospective: true }))) return;
  const root = roots[0], fact = factFor(context, root)!;
  const ongoing = root.tokens.some(token => token.lemma === 'いる' && token.dep === 'fixed' && ['て','で'].includes(context.ir.tokens.find(value => value.id === token.head)?.text ?? ''));
  if (!(fact.tense === 'past' || ongoing || root.predicate.pos === 'ADJ' || root.predicate.pos === 'NOUN')) return;
  const owned = descendants(context, root.predicate, entry);
  if (!tokensIn(context, { start: entry.body.start, end: head.span.start }).every(token => owned.has(token.id))) return;
  const link = root.tokens.find(token => token.span.end === head.span.start && token.text === 'な' && token.lemma === 'だ' && token.pos === 'AUX');
  const reason = trimSpan(context.ir.source.raw, { start: entry.body.start, end: link?.span.start ?? head.span.start });
  if (!reason) return;
  return makeRelation(context, 'reason-claim', 'trailing-tame', { start: previous.sentence.start, end: entry.sentence.end },
    [{ role: 'claim', span: previous.body }, { role: 'reason', span: reason }],
    [marker(context, 'cause', head.span), marker(context, 'explanatory-copula', copula.span), ...(link ? [marker(context, 'cause-link-copula', link.span)] : [])], [previous,entry]);
}

function simpleFirstPerson(context: Context, token: Token): boolean {
  return token.pos === 'PRON' && firstPerson.has(token.lemma)
    && !context.ir.tokens.some(child => child.head === token.id && child.id !== token.id && !['case', 'punct'].includes(child.dep))
    && context.ir.tokens.filter(child => child.head === token.id && child.dep === 'case').every(child => ['は', 'が'].includes(child.text));
}

/** Match the small modesty construction by its predicate, lexical arguments and
 * auxiliary chain. Achievement vocabulary and argument values remain generic. */
function modestyPredicate(context: Context, entry: SentenceContext): { self: Token[] } | undefined {
  if (entry.scopes.length !== 1) return;
  const { root } = entry, fact = factFor(context, root)!;
  if (fact.polarity !== 'negative' || fact.tense !== 'nonpast' || fact.voice !== 'active') return;
  const self = root.children.filter(token => ['nsubj', 'dislocated'].includes(token.dep) && simpleFirstPerson(context, token));
  const lexical = new Set<number>();
  if (root.predicate.lemma === 'する') {
    const object = root.children.find(token => token.lemma === 'こと' && ['nsubj', 'obj'].includes(token.dep));
    const adjective = object && root.tokens.find(token => token.head === object.id && token.lemma === '大した' && token.dep === 'amod');
    if (!object || !adjective || !root.tokens.some(token => token.head === object.id && token.text === 'は' && token.dep === 'case')
      || !/^してい(?:ない|ません)$/u.test(root.associated.map(token => token.text).join(''))) return;
    lexical.add(object.id); lexical.add(adjective.id);
    root.tokens.filter(token => token.head === object.id && token.dep === 'case' && token.text === 'は').forEach(token => lexical.add(token.id));
  } else if (['こと', '自慢'].includes(root.predicate.lemma)) {
    if (!/^(?:こと|自慢)(?:では(?:ない|ありません)|じゃ(?:ない|ありません))$/u.test(root.associated.map(token => token.text).join(''))) return;
    if (root.predicate.lemma === 'こと') {
      const adjective = root.children.find(token => token.lemma === '大した' && token.dep === 'amod');
      if (!adjective) return;
      lexical.add(adjective.id);
    }
  } else return;
  root.associated.forEach(token => lexical.add(token.id));
  for (const token of self) {
    lexical.add(token.id);
    root.tokens.filter(child => child.head === token.id && child.dep === 'case').forEach(child => lexical.add(child.id));
  }
  if (root.tokens.some(token => !lexical.has(token.id) && token.pos !== 'PUNCT' && !/^\s+$/u.test(token.text))) return;
  return { self };
}

const concessiveWords = new Set(['が', 'けど', 'けれど', 'けれども', 'もの']);
const positiveCompetence = new Set(['得意', '上手', '専門', '専門家', '達人', 'ベテラン', '詳しい', '慣れる', '自信']);
const limitedCompetence = new Set(['不慣れ', '苦手', '不得意', '未熟', '不器用', '初心者', '素人', '未経験']);
const completionPredicates = new Set(['済む', '済ませる', '終える', '終わる', '完了', '完成']);

/** Completed-event binding is grammatical, not an achievement/topic lexicon.
 * A past positive source event is never relabelled successful or praiseworthy.
 * Potential and perfective result states retain their narrower source status. */
function sourceDeed(context: Context, entry: SentenceContext, root: PropositionScope): { potential: boolean; unresolvedModality: boolean; nominalizer?: Token; embedded?: PropositionScope; perfective: boolean; completion: Token[] } | undefined {
  if (root.predicate.pos !== 'VERB') return;
  const nominalizer = root.children.find(token => token.lemma === 'こと' && ['compound', 'nsubj'].includes(token.dep));
  const embedded = nominalizer && entry.scopes.find(scope => scope.predicate.head === nominalizer.id && scope.predicate.dep === 'acl');
  const explicitPotential = root.predicate.lemma === 'できる' || root.associated.some(token => token.lemma === 'できる') || (hasInflection(root.predicate, '命令形') || hasInflection(root.predicate, '仮定形')) && root.associated.some(token => token.lemma === 'ます');
  const potential = explicitPotential || !!nominalizer && (root.predicate.lemma === 'できる' || root.tokens.some(token => token.lemma === 'できる'));
  const past = root.associated.filter(isPastAuxiliary);
  const aspect = root.tokens.filter(token => token.lemma === 'いる' && token.dep === 'fixed' && ['て', 'で'].includes(context.ir.tokens.find(value => value.id === token.head)?.text ?? ''));
  const completion = [...past, ...root.tokens.filter(token => completionPredicates.has(token.lemma) && token.id === root.predicate.id), ...entry.scopes.filter(scope => scope.predicate.head === root.predicate.id && scope.predicate.span.start === root.predicate.span.end && completionPredicates.has(scope.predicate.lemma)).map(scope => scope.predicate)];
  const perfective = !past.length && completion.length > 0 && aspect.length > 0;
  if (!past.length && !perfective) return;
  return { potential: potential && !perfective, unresolvedModality: !perfective && !potential && preservesModality(root), nominalizer, embedded, perfective, completion };
}

/** Assessments bind their entire supplied scope, including negated degree,
 * nominalized competence and conditional manifestations. Their inner predicates
 * are mentioned assessment material, not asserted autobiographical events. */
function assessmentKind(context: Context, entry: SentenceContext, root: PropositionScope, body: Span): RhetoricalRelation['selfEvaluation'] | undefined {
  const sourceFact = factFor(context, root);
  if (!sourceFact || sourceFact.attribution.kind !== 'narrator' || sourceFact.attribution.speaker !== null
    || sourceFact.realization !== 'actual' && !(sourceFact.realization === 'unknown' && (root.ambiguous || root.associated.some(token => ['れる','られる'].includes(token.lemma))))
    || sourceFact.polarity === 'unknown' && !(root.ambiguous || root.associated.some(token => ['れる','られる'].includes(token.lemma)))) return;
  const local = entry.scopes.filter(scope => inSpan(scope.predicate.span, body));
  const trimmed = { ...root, tokens: root.tokens.filter(token => inSpan(token.span, body)), associated: root.associated.filter(token => inSpan(token.span, body)), children: root.children.filter(token => inSpan(token.span, body)) };
  const original = modestyPredicate(context, { sentence: body, body, scopes: local.length === 1 ? [trimmed] : local, root: trimmed });
  if (original) return root.predicate.lemma === '自慢' ? 'nonboast' : 'scale-minimizing';
  const tokens = tokensIn(context, body);
  const degreeWrapper = ['わけ', '訳', 'ほう', '方', 'ほど', '程度', 'こと', '仕事', '成果'].includes(root.predicate.lemma);
  const metalinguisticDegree = ['いう','言う','言える'].includes(root.predicate.lemma) && (root.associated.some(token => token.lemma === 'ほど') || root.predicate.lemma === '言える');
  const manifestation = ['出る','現れる','表れる'].includes(root.predicate.lemma);
  const evaluationScopes = [root, ...local.filter(scope => scope !== root && scope.predicate.head === root.predicate.id && (degreeWrapper || metalinguisticDegree || manifestation && scope.predicate.dep === 'csubj'))];
  const evaluationHeads = new Set(evaluationScopes.map(scope => scope.predicate.id));
  if (metalinguisticDegree) for (const token of root.children) {
    if (positiveCompetence.has(token.lemma) || limitedCompetence.has(token.lemma)) evaluationHeads.add(token.id);
  }
  const evaluationSubjects = tokens.filter(token => evaluationHeads.has(token.head) && ['nsubj','dislocated'].includes(token.dep));
  // Topic nouns are open vocabulary; named/third-person evaluands are not the
  // speaker. Nested descriptive subjects are not inherited by the matrix.
  if (evaluationSubjects.some(token => (token.pos === 'PROPN' || token.pos === 'PRON' && !simpleFirstPerson(context, token)
      || context.ir.tokens.some(child => child.head === token.id && child.pos === 'PROPN')))) return;
  // Genitive topics may name someone else's competence (弟の話し方).
  // Without a resolved first-person possessor, leave that ownership literal
  // rather than using a topic vocabulary to guess a self-assessment.
  if (evaluationSubjects.some(topic => context.ir.tokens.some(owner => owner.head === topic.id && owner.dep === 'nmod'
      && context.ir.tokens.some(link => link.head === owner.id && link.dep === 'case' && link.text === 'の')
      && !(owner.pos === 'PRON' && firstPerson.has(owner.lemma))))) return;
  // A dislocated evaluator cannot inherit identity from the later event.
  if (evaluationSubjects.some(token => token.dep === 'dislocated' && !simpleFirstPerson(context, token))) return;
  // A generic noun does not reveal whether it names an activity domain or a
  // person (片付け / 弟). Require a source first-person evaluator, a parser-
  // typed action nominal, or a grammatical nominalized activity; otherwise
  // abstain instead of guessing from a topic/person vocabulary.
  for (const head of evaluationHeads) {
    const subjects = evaluationSubjects.filter(token => token.head === head);
    const explicitEvaluator = subjects.some(token => simpleFirstPerson(context, token));
    if (!explicitEvaluator && subjects.some(token => !simpleFirstPerson(context, token) && !/サ変可能/u.test(token.tag)
      && !(['こと','の'].includes(token.lemma) && local.some(scope => scope.predicate.head === token.id && scope.predicate.dep === 'acl')))) return;
  }
  if (root.attribution !== 'narrator' || root.reportSource || root.reportHead || root.speculative || root.reportedContent && !metalinguisticDegree || root.nonDeclarative) return;
  // Dative assessment arguments may be an experiencer or a target of trust,
  // not the speaker's skill domain (弟に自信がある). Resolve only explicit
  // self, parser-typed action nominals and grammatical activities.
  const dativeDomains = tokens.filter(token => evaluationHeads.has(token.head) && token.dep === 'obl'
    && context.ir.tokens.some(link => link.head === token.id && link.dep === 'case' && link.text === 'に'));
  for (const token of dativeDomains) {
    const self = token.pos === 'PRON' && firstPerson.has(token.lemma);
    const nominalActivity = ['こと','の'].includes(token.lemma) && local.some(scope => scope.predicate.head === token.id && scope.predicate.dep === 'acl');
    if (!self && !/サ変可能/u.test(token.tag) && !nominalActivity) return;
    if (context.ir.tokens.some(owner => owner.head === token.id && owner.dep === 'nmod'
      && context.ir.tokens.some(link => link.head === owner.id && link.dep === 'case' && link.text === 'の')
      && !(owner.pos === 'PRON' && firstPerson.has(owner.lemma)))) return;
  }
  const owned = new Set(root.tokens.map(token => token.id));
  // Only a direct evaluative predicate or a licensed degree wrapper supplies
  // the assessment. Negation in an unrelated relative clause is not its scope.
  const embeddedEvaluationIds = new Set(local.filter(scope => scope.predicate.head === root.predicate.id).flatMap(scope => scope.tokens.map(token => token.id)));
  const evaluationTokens = degreeWrapper || metalinguisticDegree
    ? tokens.filter(token => owned.has(token.id) || embeddedEvaluationIds.has(token.id) || token.head === root.predicate.id || context.ir.tokens.some(parent => parent.id === token.head && parent.head === root.predicate.id && ['aux','compound'].includes(token.dep)))
    : root.tokens;
  if (limitedCompetence.has(root.predicate.lemma) && !root.negative) return 'limited-competence';
  if (root.negative && evaluationTokens.some(token => positiveCompetence.has(token.lemma))) return 'limited-competence';
  if (root.negative && root.associated.some(token => ['ほど','ほう','方','わけ','訳'].includes(token.lemma))
    && evaluationTokens.some(token => ['誇る','誇れる','褒める','張る','張れる','立派'].includes(token.lemma))) return 'limited-competence';
  if (['浅い','少ない'].includes(root.predicate.lemma) && !root.negative && root.children.some(token => token.lemma === '経験' && token.dep === 'nsubj')) return 'limited-competence';
  if (root.negative && ['成果','仕事','こと'].includes(root.predicate.lemma) && root.children.some(token => token.dep === 'amod' && ['大した','大きい','大きな','立派','十分','凄い','すごい'].includes(token.lemma))) return 'limited-competence';
  // A supplied manifestation of a nominalized lack of competence remains a
  // literal assessment. The conditional setting below that subject is not
  // inherited by the independent completed event after the concession.
  if (['出る','現れる','表れる'].includes(root.predicate.lemma) && !root.negative) {
    const subject = local.find(scope => scope.predicate.dep === 'csubj' && scope.predicate.head === root.predicate.id && scope.negative);
    if (subject && local.some(scope => positiveCompetence.has(scope.predicate.lemma) && (scope === subject || scope.predicate.head === subject.predicate.id && scope.predicate.span.start === subject.predicate.span.end))) return 'limited-competence';
  }
  // The degree of a supplied pride/praise evaluation may be a child of a
  // negative nominal assessment, with the whole scope copied unchanged.
  if (root.negative && degreeWrapper && local.some(scope => ['張れる','張る'].includes(scope.predicate.lemma) && scope.predicate.head === root.predicate.id && scope.children.some(token => token.lemma === '胸' && token.dep === 'obj') && scope.children.some(token => token.lemma === 'ほど'))) return 'limited-competence';

}

function matrixActionScope(context: Context, scope: PropositionScope, root: PropositionScope): boolean {
  if (scope === root) return true;
  let current: Token | undefined = scope.predicate;
  for (let steps = 0; current && steps < context.ir.tokens.length; steps++) {
    if (['acl', 'nmod', 'csubj', 'ccomp'].includes(current.dep)) return false;
    if (current.head === root.predicate.id) return ['advcl', 'conj'].includes(current.dep);
    if (current.head === current.id) return false;
    current = context.ir.tokens.find(token => token.id === current!.head);
  }
  return false;
}

function bindCompletedEvent(context: Context, entry: SentenceContext, body: Span): { deed: NonNullable<ReturnType<typeof sourceDeed>>; binding: NonNullable<RhetoricalRelation['eventBinding']> } | undefined {
  const action = entry.root, fact = factFor(context, action)!;
  const deed = sourceDeed(context, entry, action);
  if (!deed || !safeScope(context, action, 'assertion', { boundSpan: body }) || fact.polarity !== 'positive' || fact.realization !== 'actual' || fact.voice !== 'active'
    || !(fact.tense === 'past' && fact.completion === 'completed' || deed.perfective && fact.completion === 'ongoing')) return;
  const local = entry.scopes.filter(scope => inSpan(scope.predicate.span, body));
  const matrix = local.filter(scope => matrixActionScope(context, scope, action) || scope === deed.embedded);
  const actors: Token[] = [];
  for (const scope of matrix) {
    if (!safeScope(context, scope, 'assertion', { boundSpan: body }) || factFor(context, scope)!.polarity !== 'positive' || factFor(context, scope)!.voice !== 'active') return;
    const subjects = scope.children.filter(token => ['nsubj', 'dislocated'].includes(token.dep) && token.id !== deed.nominalizer?.id);
    for (const token of subjects) {
      // A causative completion result may topicalize its finished task rather
      // than an actor. Keep it literal; never assign that topic narrator rank.
      const taskTopic = deed.perfective && scope === action && token.pos === 'NOUN'
        && !context.ir.tokens.some(child => child.head === token.id && child.pos === 'PROPN')
        && scope.associated.some(aux => aux.lemma === 'せる');
      if (!simpleFirstPerson(context, token) && !taskTopic) return;
      if (!taskTopic) actors.push(token);
    }
    if (scope.children.some(token => token.dep === 'obl' && scope.tokens.some(child => child.head === token.id && child.dep === 'case' && child.text === 'と'))) return;
  }
  return { deed, binding: { predicateTokenId: action.predicate.id, actorTokenIds: actors.map(token => token.id), completionTokenIds: deed.completion.map(token => token.id), embeddedPredicateTokenIds: local.filter(scope => !matrix.includes(scope)).map(scope => scope.predicate.id) } };
}

function recognizeModestAchievement(context: Context): RhetoricalRelation | undefined {
  const [opening, following] = context.sentences;
  if (!opening || !following || !/^\s*$/u.test(slice(context.ir.source.raw, { start: 0, end: opening.body.start })) || !safeSurface(context, opening) || !safeSurface(context, following)) return;
  const selfEvaluation = assessmentKind(context, opening, opening.root, opening.body);
  if (!selfEvaluation) return;
  const prefix = tokensIn(context, following.body).find(token => token.span.start === following.body.start && token.pos === 'CCONJ' && token.dep === 'cc');
  const prefixTokens = prefix ? [prefix, ...context.ir.tokens.filter(token => token.head === prefix.id && token.dep === 'fixed')].sort((a,b) => a.span.start-b.span.start) : [];
  const prefixText = prefixTokens.map(token => token.text).join('');
  const explicitContrast = ['それでも', 'しかし', 'だが', 'でも'].includes(prefixText);
  if (leadingDiscourseMarker(context, following.body) && !explicitContrast) return;
  let start = explicitContrast ? prefixTokens.at(-1)!.span.end : following.body.start;
  const chars = [...context.ir.source.raw]; while (start < following.body.end && /[\s、,]/u.test(chars[start])) start++;
  const achievement = { start, end: following.body.end }, bound = bindCompletedEvent(context, following, achievement);
  if (!bound) return;
  const { deed, binding } = bound;
  const explicitSelf = binding.actorTokenIds.length > 0 || tokensIn(context, opening.body).some(token => ['nsubj','dislocated'].includes(token.dep) && simpleFirstPerson(context, token));
  const limit = tokensIn(context, achievement).find(token => token.text === 'だけ' && ['mark','case'].includes(token.dep));
  if (!explicitSelf && !explicitContrast && !limit) return;
  const markers = deed.completion.map(token => marker(context, isPastAuxiliary(token) ? 'past' : 'completion', token.span));
  if (limit) markers.push(marker(context, 'limit', limit.span));
  if (explicitContrast) markers.push(marker(context, 'assessment-sentence-contrast', { start: following.body.start, end: start }));
  return makeRelation(context, 'modest-achievement', explicitContrast ? 'concessive-sentences' : 'opening-modesty', { start: opening.sentence.start, end: following.sentence.end },
    [{ role: 'modesty', span: opening.body }, { role: 'achievement', span: achievement }], markers, [opening, following], explicitSelf ? 'explicit-first-person' : 'source-omitted',
    { selfEvaluation, achievementKind: deed.perfective ? 'perfective-event' : deed.potential ? 'past-ability' : deed.unresolvedModality ? 'past-event-modality-unresolved' : 'completed-event', eventBinding: binding });
}

function recognizeConcessiveAssessment(context: Context, entry: SentenceContext, index: number): RhetoricalRelation | undefined {
  if (index !== 0 || !/^\s*$/u.test(slice(context.ir.source.raw, { start: 0, end: entry.body.start })) || !safeSurface(context, entry)) return;
  const candidates = entry.scopes.filter(scope => scope !== entry.root && scope.predicate.dep === 'advcl' && scope.predicate.head === entry.root.predicate.id)
    .flatMap(scope => scope.children.filter(token => token.pos === 'SCONJ' && token.dep === 'mark' && concessiveWords.has(token.text)).map(token => ({ scope, token })));
  if (candidates.length !== 1) return;
  const { scope, token } = candidates[0], owned = descendants(context, scope.predicate, entry);
  const fixed = token.text === 'もの' ? context.ir.tokens.find(value => value.head === token.id && value.dep === 'fixed' && value.text === 'の') : undefined;
  if (token.text === 'もの' && !fixed) return;
  const markerEnd = fixed?.span.end ?? token.span.end;
  if (!tokensIn(context, { start: entry.body.start, end: markerEnd }).every(value => owned.has(value.id))) return;
  const modesty = trimSpan(context.ir.source.raw, { start: entry.body.start, end: token.span.start });
  if (!modesty) return;
  const selfEvaluation = assessmentKind(context, entry, scope, modesty);
  if (!selfEvaluation) return;
  let actionStart = markerEnd; const chars = [...context.ir.source.raw];
  while (actionStart < entry.body.end && /[\s、,]/u.test(chars[actionStart])) actionStart++;
  const achievement = { start: actionStart, end: entry.body.end };
  if (!inSpan(entry.root.predicate.span, achievement) || leadingDiscourseMarker(context, achievement)) return;
  const bound = bindCompletedEvent(context, entry, achievement); if (!bound) return;
  const { deed, binding } = bound;
  const self = binding.actorTokenIds.length > 0 || tokensIn(context, modesty).some(value => ['nsubj','dislocated'].includes(value.dep) && simpleFirstPerson(context, value));
  const markers = [marker(context, 'assessment-concession', { start: token.span.start, end: actionStart }), ...deed.completion.map(value => marker(context, isPastAuxiliary(value) ? 'past' : 'completion', value.span))];
  for (const limit of tokensIn(context, achievement).filter(value => value.text === 'だけ' && ['case','mark'].includes(value.dep))) markers.push(marker(context, 'limit', limit.span));
  return makeRelation(context, 'modest-achievement', 'concessive-assessment', entry.sentence,
    [{ role: 'modesty', span: modesty }, { role: 'achievement', span: achievement }], markers, [entry], self ? 'explicit-first-person' : 'source-omitted',
    { selfEvaluation, achievementKind: deed.perfective ? 'perfective-event' : deed.potential ? 'past-ability' : deed.unresolvedModality ? 'past-event-modality-unresolved' : 'completed-event', eventBinding: binding });
}

const evidentialWords = new Set(['証拠', '根拠', '試験結果', '試験の結果', '検証データ', '検証結果', '検証の結果', '測定結果', '測定の結果', '実験結果', '実験の結果', '調査結果', '裏付け', '理由']);

function evidenceHead(context: Context, noun: Token): Span | undefined {
  const parts = context.ir.tokens.filter(token => token.id === noun.id || token.head === noun.id && token.dep === 'compound');
  for (const child of context.ir.tokens.filter(token => token.head === noun.id && token.dep === 'nmod' && ['試験', '検証', '測定', '実験'].includes(token.lemma))) {
    const genitive = context.ir.tokens.find(token => token.head === child.id && token.dep === 'case' && token.text === 'の');
    if (genitive) parts.push(child, genitive);
  }
  const span = { start: Math.min(...parts.map(token => token.span.start)), end: noun.span.end };
  return evidentialWords.has(slice(context.ir.source.raw, span)) ? span : undefined;
}

/** This older question-blending path licenses only literal existence questions.
 * Positive demands, wishes and permission requests use action-preserving
 * carrier roles, or abstain; they cannot borrow an existence-question shell. */
function sourceRequestShape(context: Context, entry: SentenceContext): { kind: 'question'; ending: Token; argument: 'nsubj' } | undefined {
  const root = entry.root, fact = factFor(context, root);
  if (!fact || root.predicate.lemma !== 'ある' || root.predicate.pos !== 'VERB' || !safeScope(context, root, 'question')
    || insideEnclosure(context.ir.source.raw, root.predicate.span.start) || fact.polarity !== 'positive' || fact.tense !== 'nonpast' || fact.voice !== 'active') return;
  const terminal = root.children.find(token => token.text === 'か' && token.dep === 'mark' && token.pos === 'PART' && token.span.end === entry.body.end);
  if (root.nonDeclarative && terminal && /^(?:あります|ある(?:の(?:です)?)?)か$/u.test(slice(context.ir.source.raw, { start: root.predicate.span.start, end: entry.body.end }))) return { kind: 'question', ending: terminal, argument: 'nsubj' };
}

function evidenceContext(context: Context, entry: SentenceContext, head: Span): Span | undefined {
  const candidates = entry.scopes.flatMap(scope => scope.children.filter(token => token.pos === 'SCONJ' && token.dep === 'mark'
    && concessiveWords.has(token.text) && token.span.end < head.start).map(token => ({ scope, token })));
  for (const { scope, token } of candidates) {
    const understanding = ['分かる', '理解', '承知', '賛成', '反対', '聞く', '知る', '認める', '納得', '同意'].includes(scope.predicate.lemma)
      || ['ある', 'ない'].includes(scope.predicate.lemma) && scope.children.some(child => child.lemma === '異論');
    if (scope.predicate.head !== entry.root.predicate.id && !understanding) continue;
    const owned = descendants(context, scope.predicate, entry);
    if (!tokensIn(context, { start: entry.body.start, end: token.span.end }).every(value => owned.has(value.id))) continue;
    let end = token.span.end;
    const chars = [...context.ir.source.raw];
    while (end < head.start && /[\s、,]/u.test(chars[end])) end++;
    // Require a visible boundary when an attachment reaches into the target.
    if (scope.predicate.head !== entry.root.predicate.id && end === token.span.end) continue;
    return { start: entry.body.start, end };
  }
}

function recognizeEvidenceRequest(context: Context, entry: SentenceContext): RhetoricalRelation | undefined {
  const root = entry.root, shape = sourceRequestShape(context, entry);
  // Existence-question blending cannot erase an explicitly requested action
  // or a supplied desire. Such requests need an action-preserving carrier
  // operator; an unsupported terminal/object stays outside this relation.
  if (!shape || root.predicate.lemma !== 'ある') return;
  const nouns = root.children.filter(token => token.pos === 'NOUN' && token.dep === shape.argument)
    .flatMap(noun => { const span = evidenceHead(context, noun); return span ? [{ noun, span }] : []; });
  if (nouns.length !== 1) return;
  const { noun, span: head } = nouns[0];
  const topic = context.ir.tokens.find(token => token.head === noun.id && token.dep === 'case'
    && ['は', 'が'].includes(token.text));
  if (!topic) return;
  const markers: RhetoricalMarker[] = [marker(context, 'evidence-head', head)];
  const bodies: { role: RhetoricalSlot['role']; span: Span }[] = [];
  const literalContext = evidenceContext(context, entry, head);
  let targetStart = literalContext?.end ?? entry.body.start;
  if (literalContext) bodies.push({ role: 'context', span: literalContext });
  else {
    const contrast = root.children.find(token => ['しかし', 'ただ', 'だが'].includes(token.text) && token.pos === 'CCONJ' && token.dep === 'cc' && token.span.start === entry.body.start);
    if (contrast) {
      if (root.tokens.some(token => token.head === contrast.id && token.dep === 'fixed') || /^ながら/u.test(slice(context.ir.source.raw, { start: contrast.span.end, end: entry.body.end }))) return;
      targetStart = contrast.span.end;
      const chars = [...context.ir.source.raw];
      while (targetStart < head.start && /[\s、,]/u.test(chars[targetStart])) targetStart++;
      markers.push(marker(context, 'contrast-prefix', { start: entry.body.start, end: targetStart }));
    }
  }
  const targets = entry.scopes.filter(scope => scope.predicate.dep === 'acl' && scope.predicate.head === noun.id && scope.predicate.span.start >= targetStart);
  let targetSpan: Span | undefined, targetMode: RhetoricalRelation['targetMode'], targetLink: RhetoricalRelation['targetLink'];
  if (targets.length === 1) {
    const target = targets[0], owned = descendants(context, target.predicate, entry);
    const quotative = target.children.find(token => token.text === 'と' && token.dep === 'case' && token.pos === 'ADP');
    const embedding = quotative && target.tokens.find(token => token.head === quotative.id && token.dep === 'fixed' && token.lemma === 'いう' && token.text === 'いう' && token.span.start === quotative.span.end);
    if (quotative && embedding && embedding.span.end === head.start) {
      targetSpan = trimSpan(context.ir.source.raw, { start: targetStart, end: quotative.span.start });
      targetMode = 'proposition'; targetLink = 'quotative';
      markers.push(marker(context, 'embedding', { start: quotative.span.start, end: embedding.span.end }));
    } else {
      targetSpan = trimSpan(context.ir.source.raw, { start: targetStart, end: head.start });
      targetMode = 'nominal'; targetLink = 'adnominal';
    }
    if (!targetSpan || !inSpan(target.predicate.span, targetSpan) || !tokensIn(context, { start: targetStart, end: head.start }).every(token => owned.has(token.id))) return;
  } else if (!targets.length) {
    const modifiers = context.ir.tokens.filter(token => token.head === noun.id && token.dep === 'nmod' && ['NOUN', 'PROPN'].includes(token.pos) && token.span.start >= targetStart && token.span.end <= head.start);
    if (modifiers.length !== 1) return;
    const modifier = modifiers[0], genitive = context.ir.tokens.find(token => token.head === modifier.id && token.text === 'の' && token.dep === 'case' && token.span.end === head.start);
    if (!genitive) return;
    const owned = descendants(context, modifier, entry);
    targetSpan = trimSpan(context.ir.source.raw, { start: targetStart, end: genitive.span.start });
    if (!targetSpan || !tokensIn(context, { start: targetStart, end: head.start }).every(token => owned.has(token.id))) return;
    targetMode = 'nominal'; targetLink = 'genitive';
    markers.push(marker(context, 'target-link', genitive.span));
  } else return;
  const requestSpan = { start: head.start, end: shape.ending?.span.start ?? entry.body.end };
  // Quoted or uncertain targets are never converted to asserted propositions.
  // A complete adnominal/genitive NP remains literal, including any judgment,
  // conditional, modality or attribution inside that unaltered requested NP.
  if (insideEnclosure(context.ir.source.raw, targetSpan.start) || context.ir.source.opaqueSpans.some(span => overlaps(span, targetSpan) || overlaps(span, requestSpan))) return;
  for (const scope of entry.scopes) {
    if (literalContext && inSpan(scope.predicate.span, literalContext)) continue;
    if (inSpan(scope.predicate.span, targetSpan)) {
      if (targetMode === 'proposition' && !safeScope(context, scope)) return;
      continue;
    }
    if (scope !== root) return;
  }
  const allowed = new Set([...tokensIn(context, targetSpan), ...tokensIn(context, head), ...root.associated, topic,
    ...markers.flatMap(value => tokensIn(context, value.span)), ...(literalContext ? tokensIn(context, literalContext) : [])].map(token => token.id));
  if (root.tokens.some(token => !allowed.has(token.id) && token.pos !== 'PUNCT' && !/^\s+$/u.test(token.text))) return;
  if (shape.ending) markers.push(marker(context, 'request-terminal', shape.ending.span));
  bodies.push({ role: 'target', span: targetSpan }, { role: 'request', span: requestSpan });
  return makeRelation(context, 'evidence-request', 'embedded-evidence-question', entry.sentence,
    bodies, markers, [entry], undefined, { targetMode, targetLink });
}

/** Recognition is independent of intensity, series, style lexicon and output.
 * Call this again on immutable source IR when validating a serialized plan. */
export function recognizeRhetoricalRelations(ir: DocumentIR, scopes: PropositionScope[] = propositionScopes(ir.source, ir)): RhetoricalRelation[] {
  if (ir.topicOnly) return [];
  const context: Context = { ir, scopes, facts: new Map(ir.facts.map(fact => [spanKey(fact.predicateSpan), fact])), sentences: [] };
  context.sentences = ir.sentences.map(sentence => {
    const body = trimSpan(ir.source.raw, sentence, true), local = scopes.filter(scope => inSpan(scope.predicate.span, sentence));
    const roots = local.filter(scope => scope.predicate.dep === 'ROOT');
    return body && roots.length === 1 && local.length && local.every(scope => factFor(context, scope))
      ? { sentence, body, scopes: local, root: roots[0] } : undefined;
  });
  const carrierRelations = recognizeCarrierEvidenceRequests(ir, scopes);
  const result: RhetoricalRelation[] = [...carrierRelations];
  for (const [index, entry] of context.sentences.entries()) {
    if (!entry) continue;
    for (const relation of [recognizeCausalClause(context, entry), recognizeCausalTame(context, entry), recognizeConcessiveAssessment(context, entry, index), recognizeTrailingReason(context, context.sentences[index - 1], entry), recognizeTrailingTame(context, context.sentences[index - 1], entry), recognizeEvidenceRequest(context, entry)]) {
      if (relation && !carrierRelations.some(carrier => overlaps(carrier.sourceSpan, relation.sourceSpan))) result.push(relation);
    }
  }
  const modesty = recognizeModestAchievement(context);
  if (modesty) result.push(modesty);
  return result.sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || a.sourceSpan.end - b.sourceSpan.end || a.kind.localeCompare(b.kind));
}
