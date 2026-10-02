import type { Analysis, DocumentIR, Fact, GenerationRequest, SourceDocument, Span, Argument } from '../contracts';
import { slice, overlaps } from './source';
import { propositionScopes, hasInflection } from './grammar-scope';
export function extractFacts(source: SourceDocument, analysis: Analysis, request: GenerationRequest): DocumentIR {
  const entities: DocumentIR['entities'] = [], facts: Fact[] = [];
  const predicateFacts = new Map<number, string>(), tokenFacts = new Map<number, string>();
  const entity = (text: string, span: Span) => {
    let value = entities.find(value => value.text === text);
    if (!value) { value = { id: `entity-${entities.length}`, text, mentions: [] }; entities.push(value); }
    value.mentions.push(span); return value.id;
  };
  const tokens = analysis.tokens;
  const scopes = propositionScopes(source, analysis);
  for (const sentence of analysis.sentences) {
    const sentenceTokens = tokens.filter(token => overlaps(token.span, sentence));
    for (const grammar of scopes.filter(scope => overlaps(scope.predicate.span, sentence))) {
      const predicate = grammar.predicate, scopedTokens = grammar.tokens, factSpan = grammar.span;
      const children = grammar.children, associated = grammar.associated;
      const localText = associated.map(token => token.text).join('');
      const passiveAuxiliary = associated.some(token => token.dep === 'aux' && /^(れる|られる)$/u.test(token.lemma));
      const passiveAgent = children.find(token => token.dep === 'obl' && sentenceTokens.some(child => child.head === token.id && child.dep === 'case' && child.text === 'に'));
      // Explicit agents plus a supported transitive predicate disambiguate this
      // small passive subset. Potential/honorific/spontaneous uses stay unknown.
      const passive = passiveAuxiliary && !!passiveAgent && /^(助ける|確認|承認|変更|復旧|叱る|褒める|渡す)$/u.test(predicate.lemma);
      const args: Argument[] = [];
      for (const token of children.filter(token => token.id !== grammar.reportSource?.id && ['nsubj', 'obj', 'iobj', 'obl'].includes(token.dep))) {
        const parts = sentenceTokens.filter(child => child.id === token.id || child.head === token.id && ['compound', 'nummod', 'flat'].includes(child.dep));
        const span = { start: Math.min(...parts.map(part => part.span.start)), end: Math.max(...parts.map(part => part.span.end)) };
        const text = slice(source.raw, span);
        const particle = sentenceTokens.find(child => child.head === token.id && child.dep === 'case')?.text;
        const role = passive && token.id === passiveAgent!.id ? 'agent' : passive && token.dep === 'nsubj' ? 'patient' : token.dep === 'nsubj' ? 'agent' : token.dep === 'obj' ? 'patient' : token.dep === 'iobj' || particle === 'に' ? 'recipient' : 'location';
        args.push({ role, text, span, entityId: entity(text, span) });
      }
      const reportHead = grammar.reportHead;
      const attribution = grammar.attribution;
      const ambiguous = grammar.ambiguous || passiveAuxiliary && !passive;
      const negative = grammar.negative;
      const prospective = grammar.prospective;
      const hypothetical = grammar.conditional;
      const speakerToken = grammar.reportSource ?? (reportHead ? tokens.find(token => token.head === reportHead.id && token.dep === 'nsubj') : undefined);
      predicateFacts.set(predicate.id, `fact-${facts.length}`);
      for (const token of scopedTokens) tokenFacts.set(token.id, `fact-${facts.length}`);
      const past = associated.some(token => (token.lemma === 'た' || hasInflection(token, '助動詞-タ;')) && token.dep === 'aux' && !hasInflection(token, '仮定形'));
      facts.push({ id: `fact-${facts.length}`, sourceSpan: factSpan, predicateSpan: predicate.span, predicateLemma: predicate.lemma, arguments: args,
        polarity: ambiguous ? 'unknown' : negative ? 'negative' : 'positive',
        realization: ambiguous ? 'unknown' : hypothetical ? 'hypothetical' : grammar.speculative ? 'unknown' : prospective ? 'prospective' : 'actual',
        completion: ambiguous ? 'unknown' : negative || /停止中|未解決|未完了/u.test(localText) ? 'not_completed' : /中$/u.test(predicate.text) || /てい(?:る|た|ます|ました)/u.test(localText) || scopedTokens.some(token => token.lemma === 'いる' && token.dep === 'fixed' && tokens[token.head]?.text === 'て') ? 'ongoing' : past || /完了|終える/u.test(predicate.lemma) ? 'completed' : 'unknown',
        tense: ambiguous ? 'unknown' : past ? 'past' : 'nonpast', voice: passive ? 'passive' : passiveAuxiliary ? 'unknown' : 'active',
        attribution: { kind: attribution, speaker: speakerToken ? entity(speakerToken.text, speakerToken.span) : null },
        protectedValueIds: source.protectedValues.filter(value => overlaps(value.span, factSpan)).map(value => value.id),
        resolution: ambiguous || grammar.speculative || grammar.nonDeclarative || attribution !== 'narrator' ? 'partial' : (['VERB', 'ADJ'].includes(predicate.pos) || /^(停止中|稼働中|未完了|未解決)$/u.test(predicate.lemma) && args.some(arg => arg.role === 'agent')) ? 'resolved' : 'opaque' });
    }
  }
  const all = { start: 0, end: [...source.raw].length };
  // Only complete sentences may become factual quote focus. Partial selections remain topics.
  const focus = request.focusSpans?.length ? request.focusSpans : analysis.sentences.slice(0, 1);
  const adoptedSpans = request.task === 'rewrite' ? [all] : analysis.sentences.filter(span => focus.some(value => value.start <= span.start && value.end >= span.end));
  const topicOnly = request.task === 'quote' && (!adoptedSpans.length || facts.every(fact => fact.resolution === 'opaque'));
  if (!adoptedSpans.length) adoptedSpans.push(...focus);
  const omittedSpans: Span[] = [];
  let cursor = 0;
  for (const span of adoptedSpans.sort((a, b) => a.start - b.start)) { if (cursor < span.start) omittedSpans.push({ start: cursor, end: span.start }); cursor = span.end; }
  if (cursor < all.end) omittedSpans.push({ start: cursor, end: all.end });
  const relations: DocumentIR['relations'] = [];
  for (const [tokenId, factId] of predicateFacts) {
    const token = tokens[tokenId], parent = tokenFacts.get(token.head), fact = facts.find(fact => fact.id === factId)!;
    if (!parent || parent === factId) continue;
    const text = slice(source.raw, fact.sourceSpan);
    if (fact.attribution.kind === 'hearsay') relations.push({ type: 'reported_by', from: factId, to: parent });
    else if (fact.realization === 'hypothetical' && facts.find(value => value.id === parent)?.realization === 'hypothetical') relations.push({ type: 'conditional_on', from: parent, to: factId });
    else if (/ので|から$/u.test(text) && token.dep === 'advcl') relations.push({ type: 'explicit_cause', from: factId, to: parent });
    else if (tokens.some(child => child.head === tokenId && child.dep === 'mark' && /^(が|けれど|けど|のに)$/u.test(child.text))) relations.push({ type: 'contrast', from: factId, to: parent });
    // Mere adjacency and ambiguous ため do not create a causal relation.
  }
  const anchors: DocumentIR['anchors'] = source.protectedValues.filter(value => value.kind === 'anchor').map(value => {
    const utteranceSpan = analysis.sentences.find(span => overlaps(span, value.span)) ?? value.span, text = slice(source.raw, utteranceSpan);
    const usage = /同意|賛成/u.test(text) ? 'agreement' : /感謝|ありがとう/u.test(text) ? 'gratitude' : /証拠|出典|参照/u.test(text) ? 'evidence' : /評価|正しい|誤り/u.test(text) ? 'evaluation' : /さん|君|へ/u.test(text) ? 'vocative' : text.trimStart().startsWith(value.raw) ? 'reply' : 'unknown';
    return { id: value.id, raw: value.raw, span: value.span, utteranceSpan, target: value.raw.replace(/^(?:>>|＞＞)\s*/u, ''), usage, factIds: facts.filter(fact => overlaps(fact.predicateSpan, utteranceSpan)).map(fact => fact.id) };
  });
  return { source, parserVersion: analysis.parserVersion, facts, entities, tokens, sentences: analysis.sentences, anchors,
    times: tokens.filter(token => /明日|今日|昨日|今後|来週|年|月|日/u.test(token.text)).map(token => ({ text: token.text, span: token.span })),
    conditions: scopes.filter(scope => scope.conditional).map(scope => scope.span), relations, adoptedSpans, omittedSpans, topicOnly };
}
