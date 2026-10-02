import type { DocumentIR, Span } from '../contracts';
import { overlaps, slice } from './source';
import { propositionScopes, scopesForSpan, permitsAssertiveScope, insideEnclosure, hasInflection, type PropositionScope } from './grammar-scope';

// These are adaptations of attested constructions, not quotations or proof of
// authorship. Each rule names the exact archived sentence used when reading it.
export type RewriteRule = { id: string; from: string; to: string; kind: 'word' | 'phrase' | 'ending' | 'punctuation'; evidenceId: string; needle: string; level: number; mode?: 'plain' | 'insistence' };
const rules: RewriteRule[] = [];
const add = (id: string, from: string, to: string, evidenceId: string, needle: string, kind: RewriteRule['kind'] = 'word', level = 1) => rules.push({ id, from, to, evidenceId, needle, kind, level });
add('narrator-watashi', '私', '俺', 'post_00016_82d78e65bd643a54_22', '俺は');
add('narrator-boku', '僕', '俺', 'post_00016_82d78e65bd643a54_22', '俺は');
add('fuinki', '雰囲気', 'ふいんき', 'post_02212_b32699bc7773619d_8422', 'ふいんき');
add('zei-in', '全員', 'ぜいいん', 'post_01694_7cde927e1222c449_5687', 'ぜいいん');
add('appiru', 'アピール', 'アッピル', 'post_01729_3578425f6701ad48_5839', 'アッピル');
add('ikue', '行方不明', 'いくえ不明', 'post_02081_5ca60ec0410b726f_7787', 'いくえ不明', 'phrase');
add('shinkotto', '真骨頂', '真骨董', 'post_01882_872015ebf79b88bf_6682', '真骨董');
add('muchiron', 'もちろん', 'むちろん', 'post_02189_550fd44ba9504790_8266', 'むちろん');
add('dochika', 'どちらかというと', 'どちかというと', 'post_02225_3cdc00b977942e5b_8505', 'どちかというと', 'phrase');
add('speed-doubling', '速さ', '速さとスピード', 'post_02421_ef97fdc26a351d5a_9490', '速さとスピード', 'word', 2);
add('velocity-doubling', '速度', '速さとスピード', 'post_02421_ef97fdc26a351d5a_9490', '速さとスピード', 'word', 2);
add('advice-doubling', '助言', 'アドバイスを助言', 'post_01805_0227b0b27aaf7c48_6214', 'アドバイスを助言', 'word', 2);
add('precious-doubling', '貴重', '貴重に大切', 'post_01561_67ee10dc8b7f3d90_5087', '貴重に大切', 'word', 2);
add('negative-doubling', '全然', '全然全く', 'post_02029_95798251b01b7494_7533', '全然全く', 'word', 2);
add('anger-peak', '怒りが頂点に達した', '怒りが有頂天になった', 'post_01635_41e56849e981c8e0_5432', '怒りが有頂天になった', 'phrase', 2);
add('anger-peak-present', '怒りが頂点に達する', '怒りが有頂天になる', 'post_01635_41e56849e981c8e0_5432', '怒りが有頂天になった', 'phrase', 2);
add('deep-sadness', 'とても悲しかった', '深い悲しみに包まれた', 'post_01958_a99dd6788275096d_7231', '深い悲しみに包まれた', 'phrase', 2);
add('definite', '確実', '確定的', 'post_01674_cb7c3a70cfcf77ea_5602', '確定的', 'word', 2);
add('suguru', 'すぎる', 'すぐる', 'post_01653_8e421a4e4cb481c1_5516', 'すぐる', 'word', 2);
add('strongest-doubling', '最強だ', '最強に強い', 'post_00131_5a2310ec15e6e767_195', '最強に強い', 'phrase', 2);
add('strongest-polite-doubling', '最強です', '最強に強い', 'post_00131_5a2310ec15e6e767_195', '最強に強い', 'phrase', 2);
add('instant-doubling', '瞬殺した', '瞬殺で倒した', 'post_00183_b6f4c9698d481765_516', '瞬殺で倒した', 'phrase', 2);
add('presence-doubling', '存在感が桁外れ', '存在感が桁外れな存在感', 'post_02043_9c60365c91c5d963_7604', '存在感が桁外れな存在感', 'phrase', 3);
add('time-doubling', 'すでに時間切れ', '時既に時間切れ', 'post_01944_f7cb32dab8e25e5a_7155', '時既に時間切れ', 'phrase', 2);

// Only declarative endings are transformed. Past, negation and prospective
// expressions remain inside the clause. No new event or causal premise is added.
const tails: [string, string, string][] = [
  ['しています', 'している', 'している'], ['していました', 'していた', 'していた'],
  ['しました', 'した', 'した'], ['します', 'する', 'する'],
  ['していません', 'していない', 'していない'], ['していませんでした', 'していなかった', 'していなかった'],
  ['しません', 'しない', 'しない'], ['しませんでした', 'しなかった', 'しなかった'],
  ['ではありません', 'ではない', 'ではない'], ['でした', 'だった', 'だった'],
  ['です', 'な', 'だ'], ['だ', 'な', 'だ'],
  ['した', 'した', 'した'], ['する', 'する', 'する'], ['いる', 'いる', 'いる'],
  ['ある', 'ある', 'ある'], ['ない', 'ない', 'ない'], ['かった', 'かった', 'かった'],
  ['い', 'い', 'い'], ['だった', 'だった', 'だった'],
  ['いです', 'い', 'い'], ['た', 'た', 'た'], ['る', 'る', 'る'],
  ['ないです', 'ない', 'ない'],
  ['う', 'う', 'う'], ['く', 'く', 'く'], ['ぐ', 'ぐ', 'ぐ'], ['す', 'す', 'す'],
  ['つ', 'つ', 'つ'], ['ぬ', 'ぬ', 'ぬ'], ['ぶ', 'ぶ', 'ぶ'], ['む', 'む', 'む'],
  ['助けました', '助けた', '助けた'], ['言いました', '言った', '言った'],
  ['疲れました', '疲れた', '疲れた'], ['終わりました', '終わった', '終わった'],
];
for (const [i, [from, , plain]] of tails.entries()) for (const mode of ['plain', 'insistence'] as const) {
  if (mode === 'plain' && from === plain) continue;
  rules.push({ id: `ending-${mode}-${i}`, from, to: mode === 'plain' ? plain : `${plain}からな`, kind: 'ending', level: 2, mode,
    evidenceId: 'post_00016_82d78e65bd643a54_22', needle: 'だからな' });
}
// Use an available original-post example from the selected series. Its lack of
// full stops supports this layout convention, not an invented lexical quotation.
for (const [i, example] of [...new Map(rules.map(rule => [rule.evidenceId, rule])).values()].entries()) {
  for (const [name, from, to] of [['linebreak', '。', '\n'], ['end', '。', ''], ['comma', '、', '']] as const)
    add(`punctuation-${name}-${i}`, from, to, example.evidenceId, example.needle, 'punctuation');
}
// Attestation is not etymology. These shared readings must not be injected as
// Buront-specific spelling. Keep their declarations above only as an audit trail
// and to keep the existing punctuation evidence IDs stable; neither planning nor
// independent validation accepts the withdrawn lexical rules.
// Semantic paraphrases are now recognized and validated by the construction
// stage; these old literal shortcuts may not bypass its slot/scope checks.
const withdrawnLexicalRuleIds = new Set(['fuinki', 'zei-in', 'anger-peak', 'anger-peak-present', 'deep-sadness', 'time-doubling']);
export const rewriteRules: readonly RewriteRule[] = rules.filter(rule => !withdrawnLexicalRuleIds.has(rule.id));
export const rewriteRuleById = new Map(rewriteRules.map(rule => [rule.id, rule]));

// A short-lived guard owns its derived scopes for one synchronous planning or
// verification pass. Nothing is stored on the IR, returned in the plan, or kept
// globally. A verifier must create its own guard from the original input.
export function createRewritePermission(ir: DocumentIR): (unit: Span, span: Span, rule: RewriteRule) => boolean {
  const scopes = propositionScopes(ir.source, ir);
  return (unit, span, rule) => permitsRewriteInScopes(ir, unit, span, rule, scopes);
}

// Standalone callers retain the same independent validation behavior.
export function permitsRewrite(ir: DocumentIR, unit: Span, span: Span, rule: RewriteRule): boolean {
  return createRewritePermission(ir)(unit, span, rule);
}

function permitsRewriteInScopes(ir: DocumentIR, unit: Span, span: Span, rule: RewriteRule, scopes: PropositionScope[]): boolean {
  if (span.start < unit.start || span.end > unit.end || slice(ir.source.raw, span) !== rule.from) return false;
  if ([...ir.source.opaqueSpans, ...ir.source.protectedValues.map(value => value.span)].some(protectedSpan => overlaps(span, protectedSpan))) return false;
  if (insideEnclosure(ir.source.raw, span.start)) return false;
  if (rule.kind === 'punctuation') return permitsPunctuation(ir, span, rule);
  const tokens = ir.tokens.filter(token => overlaps(token.span, span));
  if (!tokens.length || tokens.some(token => /固有名詞/u.test(token.tag))) return false;
  const grammaticalScopes = scopesForSpan(scopes, span);
  // A separate reported/uncertain clause must not suppress a safe narrator
  // clause in the same sentence. Token ownership, not overlapping hulls, decides.
  if (!grammaticalScopes.length || grammaticalScopes.some(scope => !permitsAssertiveScope(scope))) return false;
  const original = slice(ir.source.raw, unit), after = slice(ir.source.raw, { start: span.end, end: unit.end });
  if (rule.kind !== 'ending' && (tokens[0].span.start !== span.start || tokens.at(-1)!.span.end !== span.end)) return false;
  if (rule.id.startsWith('narrator-') && (tokens.length !== 1 || tokens[0].pos !== 'PRON')) return false;
  if (rule.kind === 'word' && tokens.some(token => token.pos === 'NOUN') && ir.tokens.some(token => token.pos === 'NOUN' && (token.span.start === span.end || token.span.end === span.start))) return false;
  // Doubling has syntactic conditions; replacing every noun occurrence would
  // produce e.g. アドバイスを助言を or 貴重に大切な incorrectly.
  if (rule.id === 'advice-doubling' && !/^(?:する|した|して|しな|します|しました)/u.test(after)) return false;
  if (rule.id === 'precious-doubling' && !/^(?:だ|です|だった|でした)(?:[。！!\s]|$)/u.test(after)) return false;
  if (rule.id === 'negative-doubling' && (!/(?:ない|なかった|ません)/u.test(after) || /^全く/u.test(after))) return false;
  if (rule.id.endsWith('doubling') && /スピード|アドバイス|全く|大切/u.test(original)) return false;
  if (rule.id === 'definite' && !/^(?:だ|です|だった|でした)(?:[。！!\s]|$)/u.test(after)) return false;
  if (['strongest-doubling', 'strongest-polite-doubling'].includes(rule.id) && !/^[。！!]?\s*$/u.test(after)) return false;
  if (rule.id === 'presence-doubling' && !/^(?:だ|です)(?:[。！!\s]|$)/u.test(after)) return false;
  if (rule.kind === 'ending') {
    if (!/^[。！!]?\s*$/u.test(after) || grammaticalScopes.length !== 1 || ir.topicOnly) return false;
    const scope = grammaticalScopes[0];
    const local = scope.tokens.map(token => token.text).join('');
    // Explanatory 〜からだ already closes a causal construction. Appending
    // another assertive からな would produce 〜からだからな (or duplicate its
    // past/negative continuation). Plain inflection changes remain available.
    if (rule.mode === 'insistence' && hasExplanatoryCausalTail(ir, scope, span)) return false;
    // Any replacement that changes conjugation must begin on a morpheme
    // boundary. 話します and 許します do not contain the する auxiliary します.
    if (rule.to.replace(/からな$/u, '') !== rule.from && !['いです', 'かった'].includes(rule.from) && tokens[0].span.start !== span.start) return false;
    const before = ir.tokens.find(token => token.span.end === span.start);
    // A short past suffix must not leave polite auxiliaries behind and then
    // append the plain assertive tail (e.g. 達しましたからな).
    if (scope.associated.some(token => ['ます', 'です'].includes(token.lemma) && token.span.start < span.start)) return false;
    if (rule.from === 'でした' && before && (['VERB', 'AUX'].includes(before.pos) || /形容詞/u.test(before.tag))) return false;
    if (/^(?:し(?:て|ま|な)|する|した)/u.test(rule.from) && !tokens.some(token => token.span.start === span.start && token.lemma === 'する' && ['VERB', 'AUX'].includes(token.pos))) return false;
    if (rule.from === 'かった' && !tokens.some(token => /形容詞/u.test(token.tag) && token.lemma.endsWith('い'))) return false;
    if (rule.from === 'だった' && !tokens.some(token => token.span.start === span.start && token.lemma === 'だ' && token.pos === 'AUX')) return false;
    if (rule.from === 'ない' && !tokens.some(token => token.lemma === 'ない' && ['ADJ', 'AUX'].includes(token.pos) && token.span.end === span.end)) return false;
    if (['いる', 'ある'].includes(rule.from) && !tokens.some(token => ['VERB', 'AUX'].includes(token.pos) && token.span.end === span.end)) return false;
    // Do not turn an arbitrary final い (e.g. 乾杯) into an adjective ending.
    if (rule.from === 'い' && !tokens.some(token => token.pos === 'ADJ' && token.span.end === span.end)) return false;
    if (rule.from === 'いです' && !tokens.some(token => token.pos === 'ADJ' && token.span.end === span.start + 1)) return false;
    if (rule.from === 'ないです' && !tokens.some(token => ['ADJ', 'AUX'].includes(token.pos) && token.text === 'ない' && token.span.start === span.start)) return false;
    if (rule.from === 'た' && !tokens.some(token => token.pos === 'AUX' && token.lemma === 'た' && token.span.start === span.start && token.span.end === span.end)) return false;
    if (/^[るうくぐすつぬぶむ]$/u.test(rule.from) && !tokens.some(token => token.pos === 'VERB' && token.span.end === span.end)) return false;
    if (rule.from === 'です' && before && (['VERB', 'AUX'].includes(before.pos) || /形容詞/u.test(before.tag))) return false;
    if (rule.from === 'だ' && !tokens.some(token => token.pos === 'AUX' && token.lemma === 'だ' && token.span.start === span.start && token.span.end === span.end)) return false;
    if (/んだが|からな|べき|ほしい|欲しい|なさい|ださい|ください/u.test(local)) return false;
  }
  return true;
}

function hasExplanatoryCausalTail(ir: DocumentIR, scope: PropositionScope, span: Span): boolean {
  return scope.associated.some(marker => marker.text === 'から' && marker.lemma === 'から' && marker.pos === 'SCONJ' && marker.dep === 'mark'
    && scope.associated.some(copula => copula.pos === 'AUX' && ['だ', 'です'].includes(copula.lemma)
      && hasInflection(copula, copula.lemma === 'だ' ? '助動詞-ダ' : '助動詞-デス')
      && ['aux', 'cop', 'fixed'].includes(copula.dep) && (copula.head === marker.head || copula.head === marker.id)
      && marker.span.end <= copula.span.start && copula.span.start <= span.start
      && /^\s*$/u.test(slice(ir.source.raw, { start: marker.span.end, end: copula.span.start }))
      // GiNZA links both copula and から to the same predicate; negative/past
      // auxiliaries can be fixed dependents of that copula. Require this local
      // grammatical chain, not a substring or a causal clause elsewhere.
      && scope.tokens.filter(token => overlaps(token.span, { start: copula.span.start, end: span.end }))
        .every(token => token.pos === 'SPACE' || scope.associated.includes(token))));
}

function permitsPunctuation(ir: DocumentIR, span: Span, rule: RewriteRule): boolean {
  const chars = [...ir.source.raw];
  if (rule.from === '、') {
    const previous = ir.tokens.filter(token => token.span.end <= span.start && token.pos !== 'SPACE').at(-1);
    // Leave list separators and numeric punctuation intact. Only remove an
    // optional pause directly after a particle or conjunction.
    return !!previous && previous.span.end === span.start && ['ADP', 'SCONJ', 'CCONJ'].includes(previous.pos);
  }
  const after = chars.slice(span.end).join('');
  if (chars[span.start - 1] === '。' || after.startsWith('。') || /^[」』）)\]】]/u.test(after)) return false;
  const alreadySeparated = /^\s*$/u.test(after) || /^[ \t\r]*\n/u.test(after);
  return rule.to === (alreadySeparated ? '' : '\n');
}
