import type { DocumentIR, Fact, RhetoricalCondition, RhetoricalPiece, RhetoricalRelation, RhetoricalSlot, Span, Token } from '../contracts';
import { insideEnclosure, propositionScopes, type PropositionScope } from './grammar-scope';
import { hash, overlaps, slice } from './source';

/** An evidence carrier is a syntactic object of an explicit source request,
 * licensed by a dependency-connected evidential relation. Its noun is open
 * vocabulary: report/file/record names alone never license this construction.
 * Nested spans are semantic references, not duplicate emitted source slots. */
const evidentialNouns = new Set(['証拠', '根拠', '裏付け']);
// Empirical result nouns are licensed by an explicit evidence-producing
// process, not a catalogue of carrier/report/file types. Handles both fused
// tokens (試験結果) and dependency compounds (測定 + 結果, 試験の結果).
const evidenceProcesses = new Set(['試験', '検証', '測定', '実験', '調査']);
function evidentialHead(noun: Token, tokens: Token[]): boolean {
  if (noun.pos !== 'NOUN') return false;
  if (evidentialNouns.has(noun.lemma)) return true;
  const fused = /^(.*)(結果|データ)$/u.exec(noun.lemma);
  if (fused && evidenceProcesses.has(fused[1])) return true;
  return ['結果', 'データ'].includes(noun.lemma) && tokens.some(token => token.head === noun.id
    && evidenceProcesses.has(token.lemma) && (token.dep === 'compound' || token.dep === 'nmod'
      && tokens.some(link => link.head === token.id && link.dep === 'case' && link.text === 'の')));
}
const judgmentPredicates = new Set(['判断', '分かる', 'わかる', '判明']);
const verificationPredicates = new Set(['確かめる', '確認', '検証']);
const presentationActions = new Set(['見せる', '示す', '教える', '説明', '提示', '提供', '出す']);
const inspectionActions = new Set(['読む', '見る', '確認', '検証', '調べる', '確かめる']);
const inside = (inner: Span, outer: Span): boolean => outer.start <= inner.start && inner.end <= outer.end;
const key = (span: Span): string => `${span.start}:${span.end}`;
type Entry = { sentence: Span; body: Span; root: PropositionScope; scopes: PropositionScope[]; tokens: Token[] };
type Cue = { targetSpan: Span; cueTokenIds: number[] };

function trim(raw: string, span: Span): Span | undefined {
  const chars = [...slice(raw, span)]; let left = 0, right = chars.length;
  while (left < right && /\s/u.test(chars[left])) left++;
  while (right > left && /[\s。！？!?]/u.test(chars[right - 1])) right--;
  return left < right ? { start: span.start + left, end: span.start + right } : undefined;
}
function descendants(tokens: Token[], head: Token): Set<number> {
  const ids = new Set([head.id]);
  for (let pass = 0; pass < tokens.length; pass++) {
    let changed = false;
    for (const token of tokens) if (!ids.has(token.id) && ids.has(token.head)) { ids.add(token.id); changed = true; }
    if (!changed) break;
  }
  return ids;
}
function ownedSpan(tokens: Token[], ids: Set<number>, excluded: Set<number> = new Set()): Span | undefined {
  const owned = tokens.filter(token => ids.has(token.id) && !excluded.has(token.id));
  if (!owned.length) return;
  const span = { start: owned[0].span.start, end: owned.at(-1)!.span.end };
  return tokens.filter(token => inside(token.span, span)).every(token => ids.has(token.id) && !excluded.has(token.id)) ? span : undefined;
}
function adopted(ir: DocumentIR, span: Span): boolean {
  if (ir.topicOnly || ir.omittedSpans.some(piece => overlaps(piece, span))) return false;
  let cursor = span.start;
  for (const piece of [...ir.adoptedSpans].sort((a, b) => a.start - b.start)) {
    if (piece.end <= cursor) continue;
    if (piece.start > cursor) return false;
    cursor = Math.max(cursor, piece.end); if (cursor >= span.end) return true;
  }
  return false;
}
function safePositiveScope(scope: PropositionScope, fact: Fact | undefined): boolean {
  return !!fact && fact.polarity === 'positive' && fact.attribution.kind === 'narrator' && fact.attribution.speaker === null
    && !scope.negative && !scope.conditional && !scope.speculative && !scope.ambiguous
    && !scope.reportedContent && !scope.reportHead && !scope.reportSource
    // GiNZA sometimes leaves desiderative negation as ADJ/dep rather than
    // in the auxiliary chain (確かめたくない). It still negates this cue.
    && !scope.children.some(token => ['ない', 'ぬ', 'ず'].includes(token.lemma) && ['dep', 'aux', 'advcl'].includes(token.dep));
}

/** Return a complete literal target attached to its explicit evidence cue.
 * Never infer a target from an unrelated neighboring clause or a file name. */
function bindCue(entry: Entry, object: Token, carrier: Span, facts: Map<string, Fact>, opaqueSpans: Span[], prefixEnd: number): Cue | undefined {
  const { tokens, root, scopes } = entry;
  const byId = new Map(tokens.map(token => [token.id, token]));
  const objectOwned = descendants(tokens, object);
  const positive = (token: Token) => {
    const scope = scopes.find(scope => scope.predicate.id === token.id);
    return !!scope && safePositiveScope(scope, facts.get(key(scope.predicate.span)));
  };
  const targetUnder = (cue: Token, nominal = false): Cue | undefined => {
    const below = descendants(tokens, cue);
    const targets = scopes.filter(scope => below.has(scope.predicate.id) && scope.predicate.id !== cue.id
      && scope.predicate.span.start >= prefixEnd && ['acl', 'advcl', 'ccomp'].includes(scope.predicate.dep));
    // The outermost source clause contains its own nested descriptions. A
    // separate second target is ambiguous and cannot be silently discarded.
    const outer = targets.filter(scope => !targets.some(other => other !== scope && descendants(tokens, other.predicate).has(scope.predicate.id)));
    if (!outer.length && nominal) {
      const dependency = evidentialHead(cue, tokens) ? 'nmod' : 'nsubj';
      const heads = tokens.filter(token => token.head === cue.id && token.dep === dependency && token.pos === 'NOUN' && token.span.start >= prefixEnd);
      if (heads.length !== 1) return;
      const head = heads[0], caseToken = tokens.find(token => token.head === head.id && token.dep === 'case'
        && (dependency === 'nmod' ? token.text === 'の' : ['が', 'は'].includes(token.text)));
      if (!caseToken) return;
      const targetSpan = ownedSpan(tokens, descendants(tokens, head), new Set([caseToken.id]));
      return targetSpan ? { targetSpan, cueTokenIds: [cue.id, caseToken.id].sort((a, b) => a - b) } : undefined;
    }
    if (outer.length !== 1) return;
    const target = outer[0], owned = descendants(tokens, target.predicate);
    const quote = tokens.find(token => token.head === target.predicate.id && token.dep === 'case' && token.text === 'と');
    const excluded = quote ? descendants(tokens, quote) : new Set<number>();
    for (const token of tokens) if (token.span.end <= prefixEnd) excluded.add(token.id);
    const boundTarget = ownedSpan(tokens, owned, excluded);
    if (!boundTarget) return;
    let targetSpan: Span = boundTarget;
    // A bare conditional before an unquoted adnominal claim can also scope
    // over the request. Require an explicit mention boundary before moving it.
    const attributedQuote = target.predicate.lemma === 'する' && target.predicate.text === 'する'
      && target.predicate.dep === 'acl' && target.predicate.head === cue.id
      && !target.negative && target.associated.every(token => token.id === target.predicate.id)
      ? tokens.find(token => token.dep === 'case' && token.text === 'と' && owned.has(token.id)
        && tokens.some(head => head.id === token.head && head.head === target.predicate.id && ['advcl', 'ccomp'].includes(head.dep))) : undefined;
    // In Xとする裏付け, とする is an explicit referenced-judgment
    // shell. Its full source surface, including negative/hypothetical target
    // scope, remains in the literal carrier; it is never an asserted premise.
    if (!quote && !attributedQuote && targets.some(scope => scope.conditional)) return;
    for (const enclosure of opaqueSpans) if (overlaps(enclosure, targetSpan)) {
      const expanded: Span = { start: Math.min(enclosure.start, targetSpan.start), end: Math.max(enclosure.end, targetSpan.end) };
      if (tokens.some(token => inside(token.span, expanded) && !inside(token.span, targetSpan!) && token.pos !== 'PUNCT')) return;
      targetSpan = expanded;
    }
    return { targetSpan, cueTokenIds: [cue.id, ...(quote ? [...excluded] : []), ...(attributedQuote ? [attributedQuote.id, target.predicate.id] : [])].sort((a, b) => a - b) };
  };
  const candidates: Cue[] = [];
  for (const cue of tokens) {
    if (evidentialHead(cue, tokens)) {
      let linked = cue.id === object.id;
      // Evidence-to-carrier path: claim -> evidence -> become -> carrier.
      // Do not license “a document that denies the evidence” or a named
      // “evidence folder”: an actual affirmative linking predicate is needed.
      if (!linked && objectOwned.has(cue.id)) {
        const parent = byId.get(cue.head);
        if (parent?.lemma === 'なる' && parent.dep === 'acl' && positive(parent)
          && tokens.some(token => token.head === cue.id && token.dep === 'case' && ['に', 'と'].includes(token.text))) {
          let current: Token | undefined = byId.get(parent.head);
          for (let steps = 0; current && steps < tokens.length; steps++) {
            if (current.id === object.id) { linked = true; break; }
            if (current.dep !== 'nmod' || current.pos !== 'NOUN' || current.head === current.id) break;
            current = byId.get(current.head);
          }
        }
      }
      // Purpose adverbial: [claim ... evidence] として, [carrier] を request.
      if (!linked && cue.head === root.predicate.id && cue.dep === 'obl') {
        const caseToken = tokens.find(token => token.head === cue.id && token.dep === 'case' && token.text === 'と');
        const fixed = caseToken && tokens.filter(token => token.head === caseToken.id && token.dep === 'fixed');
        linked = !!caseToken && !!fixed?.some(token => token.lemma === 'する') && !!fixed?.some(token => token.text === 'て')
          && cue.span.end <= carrier.start;
      }
      if (linked) { const target = targetUnder(cue, cue.id === object.id); if (target) candidates.push(target); }
    }
    if (judgmentPredicates.has(cue.lemma) && cue.pos === 'VERB' && cue.dep === 'acl' && objectOwned.has(cue.id) && positive(cue)) {
      const directNominal = cue.head === object.id && ['分かる', 'わかる', '判明'].includes(cue.lemma);
      const target = targetUnder(cue, directNominal);
      if (target && (directNominal || tokens.some(token => target.cueTokenIds.includes(token.id) && token.text === 'と'))) candidates.push(target);
    }
    if (verificationPredicates.has(cue.lemma) && cue.pos === 'VERB' && cue.dep === 'advcl' && cue.head === root.predicate.id
      && cue.span.end <= carrier.start && positive(cue)) {
      const scope = scopes.find(scope => scope.predicate.id === cue.id)!;
      // A stated verification purpose/reason is kept intact, including its
      // desire. A bare preceding completed check does not request evidence.
      const purpose = scope.associated.some(token => token.lemma === 'たい')
        && scope.children.some(token => token.dep === 'mark' && ['の', 'ので', 'から'].includes(token.text));
      if (purpose) { const target = targetUnder(cue); if (target) candidates.push(target); }
    }
  }
  const unique = candidates.filter((candidate, index) => candidates.findIndex(other => key(other.targetSpan) === key(candidate.targetSpan)) === index);
  // A carrier can itself name empirical evidence while its relative clause
  // names the judgment supported by that evidence. These are one nested
  // chain, not competing targets. Bind the unique innermost target and keep
  // every outer judgment word literal in the complete carrier. Disjoint
  // target candidates remain ambiguous and are rejected.
  const innermost = unique.filter(candidate => !unique.some(other => other !== candidate && inside(other.targetSpan, candidate.targetSpan)));
  return innermost.length === 1 ? innermost[0] : undefined;
}

/** A visible opening concessive stance is literal discourse context even
 * when GiNZA attaches its predicate to a later adnominal judgment. Do not
 * generalize this to arbitrary concessions: they may qualify the target. */
function leadingStanceEnd(entry: Entry, raw: string): number {
  const words = new Set(['分かる', '理解', '承知', '賛成', '反対', '聞く', '知る', '認める', '納得', '同意', '受け入れる']);
  for (const scope of entry.scopes) {
    const stance = words.has(scope.predicate.lemma)
      || ['ある', 'ない'].includes(scope.predicate.lemma) && scope.children.some(token => token.lemma === '異論');
    if (!stance || insideEnclosure(raw, scope.predicate.span.start)) continue;
    const concession = scope.children.find(token => token.pos === 'SCONJ' && token.dep === 'mark' && ['が', 'けど', 'けれど', 'けれども'].includes(token.text));
    if (!concession) continue;
    const owned = descendants(entry.tokens, scope.predicate);
    if (!entry.tokens.filter(token => token.span.start >= entry.body.start && token.span.end <= concession.span.end).every(token => owned.has(token.id))) continue;
    const chars = [...raw]; let end = concession.span.end;
    while (end < entry.body.end && /[\s、,]/u.test(chars[end])) end++;
    if (end > concession.span.end) return end;
  }
  return entry.body.start;
}

/** Closed positive request suffixes share one parser-owned action+て stem.
 * Bind the complete source suffix as a marker, never deleting an action or
 * causative permission to replace it with a mere existence question. */
function requestTerminal(entry: Entry, raw: string): { connective: Token; span: Span } | undefined {
  const { root, tokens, body } = entry;
  const choices = root.children.filter(token => token.text === 'て' && token.pos === 'SCONJ' && token.dep === 'mark');
  for (const connective of choices) {
    const fixed = tokens.find(token => token.head === connective.id && token.dep === 'fixed' && token.span.start === connective.span.end);
    if (!fixed) continue;
    const span = { start: fixed.span.start, end: body.end }, surface = slice(raw, span);
    const terminalTokens = tokens.filter(token => inside(token.span, span));
    let valid = false;
    if (/^(?:ください|下さい)$/u.test(surface)) valid = fixed.lemma === 'くださる' && fixed.pos === 'AUX' && fixed.span.end === body.end;
    else if (/^(?:ほしい|欲しい)(?:です)?$/u.test(surface)) {
      // 見せてほしい？ may ask whether the addressee wants the speaker
      // to show it. It is not a bound narrator request. Sentence trimming
      // removes punctuation, so inspect the original terminal boundary.
      valid = !/[?？]/u.test(slice(raw, { start: body.end, end: entry.sentence.end }))
        && ['ほしい', '欲しい'].includes(fixed.lemma) && ['AUX', 'VERB'].includes(fixed.pos)
        && terminalTokens.slice(1).every(token => token.lemma === 'です' && token.pos === 'AUX' && token.dep === 'aux' && token.head === root.predicate.id);
    } else if (/^(?:もらえ|いただけ)ますか$/u.test(surface)) {
      valid = ['もらえる', 'いただける'].includes(fixed.lemma) && fixed.pos === 'VERB'
        && terminalTokens.length === 3 && terminalTokens[1].lemma === 'ます' && terminalTokens[1].pos === 'AUX'
        && terminalTokens[1].dep === 'aux' && terminalTokens[1].head === root.predicate.id
        && terminalTokens[2].text === 'か' && terminalTokens[2].pos === 'PART' && terminalTokens[2].dep === 'mark'
        && terminalTokens[2].head === root.predicate.id && terminalTokens[2].span.end === body.end;
    }
    if (valid) return { connective, span };
  }
}

export function recognizeCarrierEvidenceRequests(ir: DocumentIR, scopes: PropositionScope[] = propositionScopes(ir.source, ir)): RhetoricalRelation[] {
  if (ir.topicOnly) return [];
  const raw = ir.source.raw, facts = new Map(ir.facts.map(fact => [key(fact.predicateSpan), fact]));
  const entries = ir.sentences.map(sentence => {
    const body = trim(raw, sentence), local = scopes.filter(scope => inside(scope.predicate.span, sentence));
    const roots = local.filter(scope => scope.predicate.dep === 'ROOT');
    return body && roots.length === 1 && local.every(scope => facts.has(key(scope.predicate.span)))
      ? { sentence, body, root: roots[0], scopes: local, tokens: ir.tokens.filter(token => inside(token.span, sentence)) } : undefined;
  });
  const result: RhetoricalRelation[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const { root, tokens, body } = entry, fact = facts.get(key(root.predicate.span));
    if (!safePositiveScope(root, fact) || fact!.tense !== 'nonpast' || fact!.voice !== 'active' || !['actual', 'prospective'].includes(fact!.realization)
      || root.predicate.pos !== 'VERB' || insideEnclosure(raw, root.predicate.span.start)) continue;
    const presentation = presentationActions.has(root.predicate.lemma);
    const inspection = inspectionActions.has(root.predicate.lemma) && root.associated.some(token => ['せる', 'させる'].includes(token.lemma));
    if (!presentation && !inspection) continue;
    const terminal = requestTerminal(entry, raw);
    if (!terminal) continue;
    const { connective } = terminal;
    const actionSpan = { start: root.predicate.span.start, end: terminal.span.start };
    if (tokens.filter(token => inside(token.span, actionSpan)).some(token => token.id !== root.predicate.id && token.id !== connective.id
      && !(token.head === root.predicate.id && token.pos === 'AUX' && token.dep === 'aux' && ['する', 'せる', 'させる'].includes(token.lemma)))) continue;
    const objects = root.children.filter(token => token.dep === 'obj' && ['NOUN', 'PROPN'].includes(token.pos));
    if (objects.length !== 1) continue;
    const object = objects[0], cases = tokens.filter(token => token.head === object.id && token.dep === 'case' && token.text === 'を');
    if (cases.length !== 1) continue;
    const caseToken = cases[0], owned = descendants(tokens, object), excluded = new Set([caseToken.id]);
    const prefixEnd = leadingStanceEnd(entry, raw);
    for (const token of tokens) if (token.span.end <= prefixEnd) excluded.add(token.id);
    // Punctuation belongs to the full literal NP, except the object case.
    const boundCarrier = ownedSpan(tokens, owned, excluded);
    if (!boundCarrier) continue;
    let carrierSpan: Span = boundCarrier;
    for (const enclosure of ir.source.opaqueSpans) if (overlaps(enclosure, carrierSpan)) {
      const expanded: Span = { start: Math.min(enclosure.start, carrierSpan.start), end: Math.max(enclosure.end, carrierSpan.end) };
      const edgeTokens = tokens.filter(token => inside(token.span, expanded) && !inside(token.span, carrierSpan!));
      if (edgeTokens.every(token => token.pos === 'PUNCT')) { carrierSpan = expanded; edgeTokens.forEach(token => owned.add(token.id)); }
    }
    if (!carrierSpan || carrierSpan.end !== caseToken.span.start || caseToken.span.end > actionSpan.start) continue;
    const requestSpan = { start: caseToken.span.end, end: actionSpan.end };
    // Recipient, time and actor adjuncts between object and verb travel with
    // the unchanged request shell; their dependency cannot enter the carrier.
    if (tokens.filter(token => inside(token.span, requestSpan) && token.span.end <= actionSpan.start).some(token => owned.has(token.id))) continue;
    if (ir.source.opaqueSpans.some(span => overlaps(span, carrierSpan) && !inside(span, carrierSpan))) continue;
    const cue = bindCue(entry, object, carrierSpan, facts, ir.source.opaqueSpans, prefixEnd); if (!cue) continue;
    // A comma-delimited initial に/で adjunct inside the alleged object can
    // instead be a recipient/time modifier of the request. Moving it would
    // silently resolve a parser attachment ambiguity; retain source instead.
    const firstComma = tokens.find(token => inside(token.span, carrierSpan) && /[、,]/u.test(token.text)
      && !ir.source.opaqueSpans.some(span => inside(token.span, span)));
    if (firstComma) {
      const lead = tokens.filter(token => token.span.start >= carrierSpan.start && token.span.end <= firstComma.span.start);
      if (lead.at(-1)?.dep === 'case' && ['に', 'で'].includes(lead.at(-1)!.text)
        && !entry.scopes.some(scope => scope.predicate.span.start >= carrierSpan.start && scope.predicate.span.end <= firstComma.span.start)) continue;
      // A leading when/if clause before a visible comma may condition the
      // request itself, despite being parsed under the mentioned proposition.
      // Keep the original order rather than moving that condition after it.
      if (entry.scopes.some(scope => scope.conditional && scope.predicate.span.start >= carrierSpan.start
        && scope.predicate.span.end <= firstComma.span.start && !insideEnclosure(raw, scope.predicate.span.start))) continue;
    }
    // Keep prefix adjuncts/actors/recipients in place. Refuse a matrix subject
    // belonging inside the moved object or an object with a crossing dependency.
    const prefix = { start: entry.sentence.start, end: carrierSpan.start };
    if (tokens.some(token => token.span.start >= carrierSpan.start && token.span.end <= body.end
      && !inside(token.span, carrierSpan) && token.id !== caseToken.id && !inside(token.span, requestSpan) && !inside(token.span, terminal.span))) continue;
    // The preceding sentence is an independent source unit, not a license
    // for this request. Owning it here would suppress an adjacent causal or
    // modesty relation during nonoverlapping block composition. Its original
    // text (or separately verified rewrite) remains outside this block.
    const sourceSpan = { ...entry.sentence };
    if (!adopted(ir, sourceSpan)) continue;
    const contextSpan = { start: sourceSpan.start, end: prefix.end };
    const slot = (role: RhetoricalSlot['role'], span: Span): RhetoricalSlot => ({ role, span: { ...span },
      tokenIds: ir.tokens.filter(token => inside(token.span, span)).map(token => token.id),
      factIds: ir.facts.filter(fact => inside(fact.predicateSpan, span)).map(fact => fact.id) });
    const slots: RhetoricalSlot[] = [...(contextSpan.start < contextSpan.end ? [slot('context', contextSpan)] : []), slot('carrier', carrierSpan), slot('request', requestSpan)];
    const marker = (role: string, span: Span) => ({ role, span: { ...span }, tokenIds: ir.tokens.filter(token => inside(token.span, span)).map(token => token.id) });
    const markers = [marker('carrier-case', caseToken.span), marker('request-terminal', terminal.span),
      ...(terminal.span.end < sourceSpan.end ? [marker('boundary', { start: terminal.span.end, end: sourceSpan.end })] : [])];
    const conditions: RhetoricalCondition[] = scopes.filter(scope => inside(scope.predicate.span, sourceSpan)).map(scope => {
      const fact = facts.get(key(scope.predicate.span))!, isRequest = scope.predicate.id === root.predicate.id;
      const mentioned = inside(scope.predicate.span, cue.targetSpan) || inside(scope.predicate.span, carrierSpan);
      return { predicateTokenId: scope.predicate.id, factId: fact.id, polarity: fact.polarity, tense: fact.tense,
        realization: fact.realization, completion: fact.completion, voice: fact.voice, attribution: { ...fact.attribution }, resolution: fact.resolution,
        conditional: scope.conditional, speculative: scope.speculative, prospective: scope.prospective, ambiguous: scope.ambiguous,
        nonDeclarative: scope.nonDeclarative, reportedContent: scope.reportedContent,
        illocution: isRequest ? 'request' : mentioned ? 'mentioned-proposition' : 'literal-context',
        sourceRole: isRequest ? 'request-shell' : mentioned ? 'mentioned-target' : 'literal-context', preservation: 'literal-copy' };
    });
    const evidenceRequest = { targetSpan: { ...cue.targetSpan }, carrierSpan: { ...carrierSpan }, actionSpan: { ...actionSpan },
      terminalSpan: { ...terminal.span }, caseSpan: { ...caseToken.span }, cueTokenIds: [...cue.cueTokenIds],
      actionKind: inspection ? 'inspection-permission' as const : 'presentation' as const };
    const content = { version: 3 as const, kind: 'evidence-request' as const, sourceForm: 'carrier-evidence-request' as const,
      sourceSpan, slots, markers, conditions, targetMode: 'nominal' as const, targetLink: 'adnominal' as const,
      evidenceRequest, provenance: { inputHash: ir.source.inputHash, parserVersion: ir.parserVersion } };
    result.push({ ...content, id: `rhetorical-${hash(content).slice(0, 24)}` });
  }
  return result;
}

/** Each component has a separate original-post witness. All three are required:
 * the two nega questions alone do not attest the yorusama object-after-action
 * order. Selecting a series may therefore abstain instead of borrowing style. */
export const carrierEvidenceOperator = {
  id: 'carrier-evidence-request', kind: 'evidence-request', level: 3,
  mechanisms: ['clause-recomposition', 'request-object-postposition', 'question-syntax-blending'],
  permittedChange: 'Front the source-requested presentation or inspection-permission action, retaining its complete evidential object, literal purpose, actor, recipient and context.',
  constraints: ['dependency-bound-evidence-carrier', 'explicit-request-action', 'literal-mentioned-target', 'retain-request-action', 'no-assertion-promotion', 'all-component-witnesses'],
  examples: [
    { id: 'post_01345_aae925d37360c57c_4231', series: ['yorusama'], needle: '見てみろよ周りのやつらの装備をよ' },
    { id: 'post_01904_94d1e3084483dd25_6841', series: ['nega'], needle: '落してくれるか？' },
    { id: 'post_02200_13ca24afe21445ab_8323', series: ['nega'], needle: '聞いてくれるか' },
  ],
} as const;

export function realizeCarrierEvidencePieces(ir: DocumentIR, relation: RhetoricalRelation, realizationId: string, evidenceIds: string[]): RhetoricalPiece[] | undefined {
  if (relation.sourceForm !== 'carrier-evidence-request' || realizationId !== 'request-then-carrier'
    || !relation.evidenceRequest || !carrierEvidenceOperator.examples.every(example => evidenceIds.includes(example.id))) return;
  const metadata = relation.evidenceRequest, carrier = relation.slots.find(slot => slot.role === 'carrier'), request = relation.slots.find(slot => slot.role === 'request');
  if (!carrier || !request) return;
  const pieces: RhetoricalPiece[] = [], context = relation.slots.find(slot => slot.role === 'context');
  if (context) pieces.push({ kind: 'source', role: 'context', sourceSpan: { ...context.span } });
  pieces.push({ kind: 'source', role: 'request', sourceSpan: { ...request.span } });
  pieces.push({ kind: 'form', formId: 'source-action-request-question', text: 'くれるか、', anchor: metadata.terminalSpan.start, evidenceIds: [...evidenceIds] });
  pieces.push({ kind: 'source', role: 'carrier', sourceSpan: { ...carrier.span } });
  pieces.push({ kind: 'source', role: 'carrier-case', sourceSpan: { ...metadata.caseSpan } });
  pieces.push({ kind: 'form', formId: 'request-object-tail-close', text: '。', anchor: relation.sourceSpan.end, evidenceIds: [...evidenceIds] });
  return pieces;
}
