import type { Analysis, SourceDocument, Span, Token, Fact } from '../contracts';
import { overlaps } from './source';

/** A proposition owns token IDs, not the convex hull of a sentence. The latter
 * can include a quoted or embedded clause that belongs to a different speaker. */
export type PropositionScope = {
  predicate: Token; tokens: Token[]; associated: Token[]; children: Token[]; span: Span;
  conditional: boolean; speculative: boolean; negative: boolean; prospective: boolean;
  ambiguous: boolean; nonDeclarative: boolean; reportedContent: boolean;
  attribution: Fact['attribution']['kind']; reportHead?: Token; reportSource?: Token;
};
const predicateDependencies = new Set(['ROOT', 'advcl', 'conj', 'ccomp', 'acl', 'nmod']);
const reports = new Set(['言う', 'いう', '話す', '聞く', '述べる', '報告', '伝える', '話', 'こと']);
const thoughts = new Set(['思う', '考える', '推測', '予想']);
const modalNouns = new Set(['はず', '筈', 'つもり']);
const epistemicAdverbs = new Set(['多分', 'たぶん', 'おそらく', '恐らく', 'きっと', 'たしか', '確か', 'どうやら', 'ひょっと', 'ひょっとして', 'もしか', 'もしかして']);
const reportNouns = new Set(['噂', 'うわさ', '話', '報告', '情報', '伝聞']);
const temporalNouns = new Set(['時', 'とき', '際', '場合']);
const negativeLemmas = new Set(['ない', 'ぬ', 'ず']);
export const hasInflection = (token: Token, value: string) => token.morphology.some(item => item.startsWith('Inflection=') && item.includes(value));
/** GiNZA may lemmatize the voiced past auxiliary in 運んだ as だ.
 * Inflection distinguishes that 助動詞-タ from the terminal copula 助動詞-ダ.
 * Hypothetical たら is not evidence of an asserted past event. */
export const isPastAuxiliary = (token: Token): boolean => token.pos === 'AUX' && token.dep === 'aux'
  && (token.lemma === 'た' || token.morphology.some(item => /^Inflection=助動詞-タ(?:;|$)/u.test(item))) && !hasInflection(token, '仮定形');
const grammatical = (token: Token) => ['AUX', 'PART', 'SCONJ', 'ADP'].includes(token.pos) || /助動詞|助詞/u.test(token.tag);
const extent = (tokens: Token[]): Span => ({ start: Math.min(...tokens.map(token => token.span.start)), end: Math.max(...tokens.map(token => token.span.end)) });

export function propositionScopes(source: SourceDocument, analysis: Pick<Analysis, 'tokens' | 'sentences'>): PropositionScope[] {
  const result: PropositionScope[] = [], all = new Map(analysis.tokens.map(token => [token.id, token]));
  for (const sentence of analysis.sentences) {
    const tokens = analysis.tokens.filter(token => overlaps(token.span, sentence));
    const predicates = tokens.filter(token => {
      if (!['VERB', 'ADJ', 'NOUN', 'PROPN'].includes(token.pos)) return false;
      // GiNZA analyses 悲しくない as an adjective advcl under the negative
      // adjective ROOT. This is one negated proposition, not a positive event.
      const head = all.get(token.head);
      if (token.dep === 'advcl' && head && negativeLemmas.has(head.lemma) && /形容詞/u.test(token.tag) && hasInflection(token, '連用形') && token.span.end === head.span.start) return false;
      return (predicateDependencies.has(token.dep) && (token.dep !== 'nmod' || ['VERB', 'ADJ'].includes(token.pos))) || token.pos === 'NOUN' && tokens.some(child => child.head === token.id && child.dep === 'nsubj');
    });
    if (!predicates.length) predicates.push(...tokens.filter(token => token.dep === 'ROOT'));
    const predicateIds = new Set(predicates.map(token => token.id));
    for (const predicate of predicates) {
      const owned = new Set([predicate.id]);
      for (let pass = 0; pass < tokens.length; pass++) {
        let changed = false;
        for (const token of tokens) if (owned.has(token.head) && !owned.has(token.id) && !predicateIds.has(token.id)) { owned.add(token.id); changed = true; }
        if (!changed) break;
      }
      const scoped = tokens.filter(token => owned.has(token.id));
      const children = scoped.filter(token => token.head === predicate.id && token.id !== predicate.id);
      const chain = new Set([predicate.id]);
      for (let pass = 0; pass < scoped.length; pass++) for (const token of scoped) if (chain.has(token.head) && ['aux', 'mark', 'cop', 'fixed'].includes(token.dep)) chain.add(token.id);
      const associated = scoped.filter(token => chain.has(token.id));
      const head = all.get(predicate.head);
      const quotative = scoped.some(token => token.head === predicate.id && token.text === 'と' && ['case', 'mark'].includes(token.dep));
      const reportHead = head && head.id !== predicate.id && reports.has(head.lemma) && (quotative || predicate.dep === 'ccomp') ? head : undefined;
      const thoughtComplement = head && head.id !== predicate.id && thoughts.has(head.lemma) && (quotative || predicate.dep === 'ccomp');
      const possibility = associated.find(token => token.text === 'か' && token.dep === 'mark' && scoped.some(child => child.head === token.id && child.dep === 'fixed' && ['しれる', '知れる'].includes(child.lemma)));
      const modalAux = associated.filter(token => token.id !== predicate.id && grammatical(token) && ['らしい', 'そう', 'よう', 'みたい'].includes(token.lemma));
      // によると / によれば is a source marker, not an experiencer or
      // event participant. Require the dependency-linked fixed expression.
      const accordingTo = scoped.find(token => token.text === 'に' && token.dep === 'case'
        && scoped.some(child => child.head === token.id && child.dep === 'fixed' && ['よる', '依る', '拠る'].includes(child.lemma))
        && scoped.some(child => child.head === token.id && child.dep === 'fixed' && ['と', 'ば'].includes(child.text)));
      const reportNoun = scoped.find(token => reportNouns.has(token.lemma) && ['obl', 'nmod'].includes(token.dep)
        && scoped.some(child => child.head === token.id && child.dep === 'case' && child.text === 'で')
        && scoped.some(child => child.head === token.id && child.dep === 'case' && child.text === 'は'));
      const reportSource = accordingTo ? all.get(accordingTo.head) : reportNoun
        ? scoped.find(token => token.head === reportNoun.id && token.dep === 'nmod' && scoped.some(child => child.head === token.id && child.text === 'の')) ?? reportNoun : undefined;
      const conditionalTo = predicate.dep === 'advcl' && associated.some(token => token.head === predicate.id && token.text === 'と' && token.pos === 'SCONJ' && token.dep === 'mark');
      const concessiveIf = scoped.some(token => token.head === predicate.id && token.text === 'と' && token.dep === 'case'
        && scoped.some(child => child.head === token.id && child.dep === 'fixed' && child.lemma === 'する')
        && scoped.some(child => child.head === token.id && child.dep === 'fixed' && (child.text === 'も' || hasInflection(child, '仮定形'))));
      const concessiveTe = predicate.dep === 'advcl' && children.some(token => ['て', 'で'].includes(token.text) && ['mark', 'cop', 'aux'].includes(token.dep)) && children.some(token => token.text === 'も' && ['case', 'mark'].includes(token.dep));
      const assumedComplement = predicate.dep === 'advcl' && head?.lemma === 'する' && quotative;
      const assumptionPredicate = predicate.dep === 'advcl' && predicate.lemma === 'する' && tokens.some(child => child.head === predicate.id && child.id !== predicate.id && ['VERB', 'ADJ'].includes(child.pos) && tokens.some(marker => marker.head === child.id && marker.dep === 'case' && marker.text === 'と'));
      const conditional = assumptionPredicate || conditionalTo || concessiveIf || concessiveTe || assumedComplement || associated.some(token => hasInflection(token, '仮定形') || grammatical(token) && ['ば', 'なら', 'たら'].includes(token.text))
        || scoped.some(token => ['もし', 'もしも'].includes(token.lemma) && token.pos === 'ADV')
        || predicate.dep === 'acl' && head?.lemma === '場合';
      const speculative = scoped.some(token => token.pos === 'ADV' && token.dep === 'advmod' && epistemicAdverbs.has(token.lemma)) || !!possibility || modalAux.length > 0 || associated.some(token => hasInflection(token, '意志推量形'))
        || !!thoughtComplement || thoughts.has(predicate.lemma) || modalNouns.has(predicate.lemma) || predicate.dep === 'acl' && !!head && modalNouns.has(head.lemma);
      const negative = associated.some(token => negativeLemmas.has(token.lemma) && ['ADJ', 'AUX'].includes(token.pos) && (!possibility || token.head !== possibility.id));
      const temporalTopic = predicate.dep === 'acl' && !!head && temporalNouns.has(head.lemma) && head.lemma !== '場合' && tokens.some(token => token.head === head.id && token.dep === 'case' && token.text === 'は');
      const ambiguous = temporalTopic || scoped.some(token => ['誰', 'それ', 'これ', 'あれ'].includes(token.lemma))
        || (['わけ', '訳', '限る'].includes(predicate.lemma) && negative)
        || !!head && ['わけ', '訳', '限る'].includes(head.lemma)
        || associated.filter(token => negativeLemmas.has(token.lemma) && (!possibility || token.head !== possibility.id)).length > 1;
      const prospective = scoped.some(token => ['予定', 'つもり', '明日', '来週', '今後', 'これから'].includes(token.lemma)) || predicate.dep === 'acl' && !!head && ['予定', 'つもり'].includes(head.lemma);
      const quoted = source.opaqueSpans.some(span => overlaps(span, predicate.span));
      const hearsay = !!reportSource || !!reportHead || modalAux.some(token => ['らしい', 'そう'].includes(token.lemma))
        || ['報告', '話', 'こと'].includes(predicate.lemma) && tokens.some(token => token.head === predicate.id && tokens.some(child => child.head === token.id && child.text === 'と'));
      const nonDeclarative = associated.some(token => hasInflection(token, '命令形') || token.text === 'か' && token.dep === 'mark')
        || scoped.some(token => ['?', '？'].includes(token.text) || ['ありがとう', '感謝', 'お礼', 'ごめん', 'すみません', '申し訳'].includes(token.lemma));
      const reportedContent = reports.has(predicate.lemma) && tokens.some(token => token.head === predicate.id && token.id !== predicate.id && (token.dep === 'ccomp' || tokens.some(child => child.head === token.id && child.text === 'と')));
      result.push({ predicate, tokens: scoped, associated, children, span: extent(scoped), conditional, speculative, negative, prospective, ambiguous, nonDeclarative, reportedContent,
        attribution: quoted ? 'quotation' : hearsay ? 'hearsay' : 'narrator', reportHead, reportSource });
    }
  }
  const byPredicate = new Map(result.map(scope => [scope.predicate.id, scope]));
  // A conditional's immediate consequent is conditional too. Do not let that
  // inherited scope leak through a subsequent contrast into an independent fact.
  for (const scope of result.filter(scope => scope.conditional)) {
    let head = all.get(scope.predicate.head);
    if (head?.lemma === '場合') head = all.get(head.head);
    const consequent = head && byPredicate.get(head.id);
    if (consequent && consequent !== scope && scope.attribution === consequent.attribution) consequent.conditional = true;
  }
  // A temporal topic can be habitual, prospective or recalled. Without a
  // resolved temporal relation, do not promote its matrix clause to certainty.
  for (const scope of result) {
    const head = all.get(scope.predicate.head);
    if (scope.ambiguous && scope.predicate.dep === 'acl' && head && temporalNouns.has(head.lemma)) {
      const matrix = result.find(candidate => candidate !== scope && candidate.tokens.some(token => token.id === head.id));
      if (matrix) matrix.ambiguous = true;
    }
  }
  return result;
}

/** Exact membership avoids treating an intervening embedded clause as owned. */
export function scopesForSpan(scopes: PropositionScope[], span: Span): PropositionScope[] {
  return scopes.filter(scope => scope.tokens.some(token => overlaps(token.span, span)));
}
export function scopeForSpan(scopes: PropositionScope[], span: Span): PropositionScope | undefined {
  const matches = scopesForSpan(scopes, span);
  return matches.length === 1 ? matches[0] : undefined;
}
export function permitsAssertiveScope(scope: PropositionScope): boolean {
  return scope.attribution === 'narrator' && !scope.conditional && !scope.speculative && !scope.ambiguous && !scope.nonDeclarative && !scope.reportedContent;
}

export function insideEnclosure(raw: string, start: number): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { '「': '」', '『': '』', '（': '）', '(': ')', '[': ']', '【': '】', '“': '”', '‘': '’', '"': '"', "'": "'", '`': '`' };
  for (const char of [...raw].slice(0, start)) {
    if (stack.at(-1) === char) stack.pop();
    else if (pairs[char]) stack.push(pairs[char]);
  }
  return stack.length > 0;
}
