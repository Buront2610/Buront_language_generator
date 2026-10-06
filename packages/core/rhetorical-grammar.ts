import type { DocumentIR, Span, Token } from '../contracts';
import { slice } from './source';

/** Inflection is a grammar primitive for embedding a proposition in a new
 * clause, not a learned style score or a free rewrite. Only a parser-owned
 * terminal auxiliary chain is changed; negation, tense and aspect survive. */
export type ClauseInflection = { sourceSpan: Span; text: string; tokenIds: number[]; kind: 'polite-copula' | 'negative-copula' | 'polite-predicate' | 'attributive-copula' };
const pastVerb = (token: Token): string | undefined => {
  const lemma = token.lemma, inflection = token.morphology.join('|');
  if (token.pos === 'AUX' && ['れる', 'られる'].includes(lemma) && /助動詞-(?:レル|ラレル)/u.test(inflection)) return lemma.slice(0, -1) + 'た';
  if (/サ行変格/u.test(inflection) && /(?:する|ずる)$/u.test(lemma)) return lemma.slice(0, -2) + (lemma.endsWith('ずる') ? 'じた' : 'した');
  if (/カ行変格/u.test(inflection) && lemma.endsWith('来る')) return lemma.slice(0, -2) + '来た';
  if (/上一段|下一段/u.test(inflection) && lemma.endsWith('る')) return lemma.slice(0, -1) + 'た';
  if (!/五段/u.test(inflection)) return;
  if (['行く', 'いく', 'ゆく', '逝く'].includes(lemma)) return lemma.slice(0, -1) + 'った';
  const end: Record<string, string> = { 'う': 'った', 'く': 'いた', 'ぐ': 'いだ', 'す': 'した', 'つ': 'った', 'ぬ': 'んだ', 'ぶ': 'んだ', 'む': 'んだ', 'る': 'った' };
  const replacement = end[lemma.at(-1)!]; return replacement ? lemma.slice(0, -1) + replacement : undefined;
};
const negativeVerb = (token: Token): string | undefined => {
  const lemma = token.lemma, inflection = token.morphology.join('|');
  if (token.pos === 'AUX' && ['れる', 'られる'].includes(lemma) && /助動詞-(?:レル|ラレル)/u.test(inflection)) return lemma.slice(0, -1) + 'ない';
  if (/サ行変格/u.test(inflection) && /(?:する|ずる)$/u.test(lemma)) return lemma.slice(0, -2) + (lemma.endsWith('ずる') ? 'じない' : 'しない');
  // A polite e-row stem is potential, despite GiNZA's imperative-lemma parse.
  if (/五段.*命令形/u.test(inflection)) return token.text + 'ない';
  if (/カ行変格/u.test(inflection) && lemma.endsWith('来る')) return lemma.slice(0, -2) + '来ない';
  if (/上一段|下一段/u.test(inflection) && lemma.endsWith('る')) return lemma.slice(0, -1) + 'ない';
  if (!/五段/u.test(inflection)) return;
  if (lemma === 'ある') return 'ない';
  const end: Record<string, string> = { 'う': 'わ', 'く': 'か', 'ぐ': 'が', 'す': 'さ', 'つ': 'た', 'ぬ': 'な', 'ぶ': 'ば', 'む': 'ま', 'る': 'ら' };
  const replacement = end[lemma.at(-1)!]; return replacement ? lemma.slice(0, -1) + replacement + 'ない' : undefined;
};
export function clauseInflection(ir: DocumentIR, span: Span): ClauseInflection | undefined {
  const tokens = ir.tokens.filter(token => span.start <= token.span.start && token.span.end <= span.end);
  const terminal = tokens.at(-1); if (!terminal || terminal.span.end !== span.end) return;
  const negativeCopula = tokens.find(token => token.pos === 'AUX' && ['aux', 'cop'].includes(token.dep) && ['で', 'じゃ'].includes(token.text)
    && /^(?:では|じゃ)ありません(?:でした)?$/u.test(slice(ir.source.raw, { start: token.span.start, end: span.end })));
  if (negativeCopula) {
    const chain = tokens.filter(token => token.span.start >= negativeCopula.span.start);
    if (chain.slice(1).every(token => token.head === negativeCopula.id && token.dep === 'fixed' || token.pos === 'AUX' && token.head === negativeCopula.head && ['aux', 'cop'].includes(token.dep))) {
      const sourceSpan = { start: negativeCopula.span.start, end: span.end }, from = slice(ir.source.raw, sourceSpan);
      return { sourceSpan, text: from.startsWith('じゃ') ? from.endsWith('でした') ? 'じゃなかった' : 'じゃない' : from.endsWith('でした') ? 'ではなかった' : 'ではない', tokenIds: chain.map(token => token.id), kind: 'negative-copula' };
    }
  }
  for (const predicate of [...tokens].reverse()) {
    const potentialNominalizer = predicate.pos === 'AUX' && predicate.lemma === 'できる' && predicate.dep === 'fixed'
      && tokens.some(token => token.id === predicate.head && token.lemma === 'こと' && token.dep === 'compound');
    if (!(predicate.pos === 'VERB' || predicate.pos === 'AUX' && predicate.dep === 'aux' && ['する', 'いる', 'ある', '来る', 'できる', 'れる', 'られる'].includes(predicate.lemma) || potentialNominalizer) || !predicate.morphology.some(value => value.startsWith('Inflection='))) continue;
    const suffix = slice(ir.source.raw, { start: predicate.span.end, end: span.end });
    if (!/^(?:ます|ました|ません|ませんでした)$/u.test(suffix)) continue;
    const aux = tokens.filter(token => token.span.start >= predicate.span.end);
    const nominalizerHead = potentialNominalizer ? tokens.find(token => token.id === predicate.head)?.head : undefined;
    const inheritedAuxiliaryHead = (() => {
      let current: Token | undefined = predicate;
      for (let i = 0; current && i < tokens.length; i++) {
        if (current.id === aux[0]?.head) return current.id;
        const parent: Token | undefined = tokens.find(token => token.id === current!.head);
        if (!parent || parent.id === current.id || !['advcl', 'fixed', 'mark', 'aux'].includes(current.dep)) return undefined;
        if (current.dep === 'advcl' && (parent.span.end !== current.span.start || !/連用形/u.test(parent.morphology.join('|')))) return undefined;
        current = parent;
      }
    })();
    if (!aux.length || aux.some(token => token.pos !== 'AUX' || !['aux', 'cop'].includes(token.dep)) || (aux[0].head !== predicate.id && !(inheritedAuxiliaryHead !== undefined && aux.every(token => token.head === inheritedAuxiliaryHead)) && !(predicate.pos === 'AUX' && aux.every(token => token.head === (nominalizerHead ?? predicate.head))))) return;
    let text: string | undefined;
    const politePotentialStem = /五段.*(?:命令形|仮定形)/u.test(predicate.morphology.join('|'));
    if (politePotentialStem) text = predicate.text + (suffix === 'ます' ? 'る' : suffix === 'ました' ? 'た' : suffix === 'ません' ? 'ない' : 'なかった');
    else if (suffix === 'ます') text = predicate.lemma;
    else if (suffix === 'ました') text = pastVerb(predicate);
    else { text = negativeVerb(predicate); if (text && suffix === 'ませんでした') text = text.slice(0, -1) + 'かった'; }
    if (!text) return;
    return { sourceSpan: { start: predicate.span.start, end: span.end }, text, tokenIds: [predicate.id, ...aux.map(token => token.id)], kind: 'polite-predicate' };
  }
  // Copular past has a distinct でし + た chain. Adjective + です only
  // drops politeness; adding だ to an adjective would be ungrammatical.
  const politeCopula = tokens.find(token => token.lemma === 'です' && token.pos === 'AUX' && /^(?:です|でした)$/u.test(slice(ir.source.raw, { start: token.span.start, end: span.end })));
  if (politeCopula) {
    // でした after an unresolved verbal ません chain is not a copula.
    // Never produce *られませんだった by treating its final token alone.
    if (/(?:ませ|ません)$/u.test(slice(ir.source.raw, { start: span.start, end: politeCopula.span.start }))) return;
    const tail = tokens.filter(token => token.span.start >= politeCopula.span.start), governor = ir.tokens[politeCopula.head];
    if (!['aux', 'cop'].includes(politeCopula.dep) || tail.some(token => token.pos !== 'AUX') || !governor || governor.span.end > politeCopula.span.start) return;
    const sourceSpan = { start: politeCopula.span.start, end: span.end }, past = slice(ir.source.raw, sourceSpan) === 'でした';
    // GiNZA also assigns ADJ to nominal/na-adjectives (便利, 苦手,
    // 不器用). Those require だ before が/から; only inflected i-adjectives
    // can drop です. POS alone is not a copula-deletion license.
    const inflectedAdjective = governor.pos === 'ADJ' && governor.morphology.some(value => /^Inflection=形容詞(?:;|$)/u.test(value));
    if (inflectedAdjective || governor.lemma === 'ない' || /かった$/u.test(slice(ir.source.raw, { start: span.start, end: politeCopula.span.start }))) {
      if (past) return; // Unsupported double adjective/polite past.
      return { sourceSpan, text: '', tokenIds: tail.map(token => token.id), kind: 'polite-copula' };
    }
    return { sourceSpan, text: past ? 'だった' : 'だ', tokenIds: tail.map(token => token.id), kind: 'polite-copula' };
  }

}
/** Reject unresolved polite auxiliaries before nominalizing/embedding. The
 * caller may still make other plans or retain the source unchanged. */
export function embeddableClause(text: string): boolean {
  return !!text.trim() && !/(?:ます|ました|ません|ませんでした|です|でした|でしょう|ましょう|ください|下さい|[?？])$/u.test(text);
}
