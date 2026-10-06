import type { Candidate, Check, DocumentIR, QuotePlan, OutputSpan } from '../contracts';
import { hash, slice, outputProtectedValues } from './source';
import { discourseLabels, factsIn, planNarrative, planIntent, roleOf, equivalentEvent } from './planning';
import { validateSurface, validateDiscourse, type SeriesProfile } from './series';
import { validateRewrite } from './rewrite-validation';
import { validateConstruction } from './constructions';
import { constructionEdits } from './construction-edits';
import { renderEdits } from './rewrite-validation';
import { validateRhetoric } from './rhetoric-validation';
export function realize(plan: QuotePlan, ir?: DocumentIR) {
  let text = '', length = 0; const spans: OutputSpan[] = [];
  const edits = plan.construction ? constructionEdits(plan) : [];
  for (const node of plan.nodes) {
    const start = length;
    // Preserve cumulative scalar counting even for a malformed plan splitting
    // a surrogate pair between nodes (later validation still rejects it).
    const joinedPair = /[\uD800-\uDBFF]$/.test(text) && /^[\uDC00-\uDFFF]/.test(node.text);
    text += node.text; length += [...node.text].length - Number(joinedPair);
    const local = edits.filter(edit => edit.nodeId === node.id);
    // Composed plans expose the prefix's zero-width source, every independently
    // permitted local edit, and exact copied body fragments separately.
    if (ir && node.sourceSpan && local.length && renderEdits(ir.source.raw, node, local.map(edit => ({ ...edit, ruleId: 'ruleId' in edit ? edit.ruleId : edit.constructionId }))) === node.text) {
      let sourceCursor = node.sourceSpan.start, outputCursor = start;
      const append = (value: string, sourceSpan: OutputSpan['sourceSpan'], origin: OutputSpan['origin'], evidenceIds: string[]) => {
        if (!value) return;
        const end = outputCursor + [...value].length;
        spans.push({ span: { start: outputCursor, end }, nodeId: node.id, origin, sourceSpan, factIds: node.factIds, evidenceIds }); outputCursor = end;
      };
      for (const edit of local) {
        const copied = { start: sourceCursor, end: edit.sourceSpan.start };
        append(slice(ir.source.raw, copied), copied, 'source_fact', []);
        append(edit.to, edit.sourceSpan, 'paraphrase', edit.evidenceIds);
        sourceCursor = edit.sourceSpan.end;
      }
      const copied = { start: sourceCursor, end: node.sourceSpan.end };
      append(slice(ir.source.raw, copied), copied, 'source_fact', []);
    } else if (node.text) spans.push({ span: { start, end: length }, nodeId: node.id,
      origin: node.type === 'FactClause' ? ir && node.sourceSpan && slice(ir.source.raw, node.sourceSpan) !== node.text ? 'paraphrase' : 'source_fact' : node.type === 'Reference' ? 'direct_quote' : 'rhetoric', sourceSpan: node.sourceSpan, factIds: node.factIds, evidenceIds: node.evidenceIds });
  }
  return { text, spans };
}
export function validateCandidate(ir: DocumentIR, plan: QuotePlan, text: string, spans: OutputSpan[], evidenceIds: Set<string>, allowedRhetoric = new Set<string>(), references = new Map<string, string>(), profiles: SeriesProfile[] = []): Check[] {
  const check = (code: string, status: Check['status'], explanation: string): Check => ({ code, status, explanation, required: true, factIds: ir.facts.map(fact => fact.id), checkerVersion: 'literal-event-and-relation-proof-v2' });
  const rewriteValid = !!plan.rewrite && validateRewrite(ir, plan, references) && !!plan.narrative && plan.narrative.strategy === 'source_order';
  const constructionValid = !!plan.construction && validateConstruction(ir, plan, references) && !!plan.narrative && plan.narrative.strategy === 'source_order';
  const facts = plan.nodes.filter(node => node.type === 'FactClause');
  const protectedMismatch = facts.some(node => {
    if (!node.sourceSpan) return true;
    const original = slice(ir.source.raw, node.sourceSpan);
    if (original === node.text) return false;
    const signature = (value: string) => outputProtectedValues(value).map(item => [item.kind, item.raw, item.role, item.comparator ?? null]);
    try { return hash(signature(original)) !== hash(signature(node.text)); }
    catch { return true; }
  });
  const exactFacts = facts.every(node => node.sourceSpan && (rewriteValid || constructionValid || equivalentEvent(ir, node.sourceSpan, node.text)) && spans.filter(span => span.nodeId === node.id).map(span => slice(text, span.span)).join('') === node.text);
  const orderedFacts = [...facts].sort((a, b) => (a.sourceSpan?.start ?? -1) - (b.sourceSpan?.start ?? -1));
  let factIndex = 0;
  const coverage = ir.adoptedSpans.every(adopted => {
    let cursor = adopted.start;
    while (factIndex < orderedFacts.length && cursor < adopted.end) { const span = orderedFacts[factIndex++].sourceSpan; if (!span || span.start !== cursor || span.end <= cursor || span.end > adopted.end) return false; cursor = span.end; }
    return cursor === adopted.end;
  }) && factIndex === orderedFacts.length;
  const narrative = plan.narrative;
  const validNarrative = !narrative || ['source_order', 'status_order'].includes(narrative.strategy) && (hash(narrative) === hash(planNarrative(ir, 'source_order')) || hash(narrative) === hash(planNarrative(ir, 'status_order')))
    && hash(facts.map(node => node.id)) === hash(narrative.displayOrder.map(id => `fact-node-${narrative.sourceOrder.indexOf(id)}`))
    && facts.every(node => !!node.sourceSpan && hash(node.factIds) === hash(factsIn(ir, node.sourceSpan).map(fact => fact.id)) && node.mention === 'primary');
  const validIntent = !plan.intentPlan || hash(plan.intentPlan) === hash(planIntent(ir)) && plan.intent === plan.intentPlan.act;
  const supportedNodes = new Set(plan.nodes.map(node => node.id)).size === plan.nodes.length && plan.nodes.every(node => ['FactClause', 'RhetoricalClause', 'Connective', 'Reference', 'QuoteBoundary'].includes(node.type));
  const textLength = [...text].length;
  const partition = spans.every((span, i) => span.span.start === (i ? spans[i - 1].span.end : 0) && span.span.end > span.span.start && span.span.end <= textLength) && spans.at(-1)?.span.end === textLength;
  const reconstructed = realize(plan, ir);
  const rhetoric = plan.nodes.filter(node => node.type === 'RhetoricalClause');
  // allowedRhetoric remains for old internal callers. The compiler's allowlist
  // is deliberately never read: it is not evidence of a safe semantic effect.
  const quotes = plan.nodes.filter(node => node.type === 'Reference');
  const safeQuotes = quotes.length > 0 && quotes.every(node => {
    const index = plan.nodes.indexOf(node), before = plan.nodes[index - 1], after = plan.nodes[index + 1];
    return node.evidenceIds.length === 1 && references.get(node.evidenceIds[0]) === node.text && before?.type === 'QuoteBoundary' && before.text === '「' && after?.type === 'QuoteBoundary' && after.text === '」';
  }) && plan.nodes.some(node => node.type === 'Connective' && node.text === '\n関連する語録（引用）：');
  const safeConnectives = plan.nodes.filter(node => node.type === 'Connective').every(node => {
    if (['\n', '\n関連する語録（引用）：'].includes(node.text)) return true;
    const next = plan.nodes[plan.nodes.indexOf(node) + 1];
    return narrative?.strategy === 'status_order' && next?.type === 'FactClause' && !!next.sourceSpan && node.text === discourseLabels[roleOf(ir, next.sourceSpan)];
  }) && plan.nodes.filter(node => node.type === 'QuoteBoundary').every(node => ['「', '」'].includes(node.text));
  const meaning = validateRhetoric(ir, plan);
  const safeRhetoric = rewriteValid || constructionValid || safeQuotes && rhetoric.length === 0 || meaning.valid && rhetoric.every(node => node.evidenceIds.length > 0 && node.evidenceIds.every(id => evidenceIds.has(id))) && !!plan.surface && !!plan.rhetoric && validateDiscourse(plan.rhetoric, profiles.find(profile => profile.id === plan.surface!.seriesId));
  const provenance = reconstructed.text === text && hash(reconstructed.spans) === hash(spans);
  const checks = [check('V-span', partition && provenance && supportedNodes ? 'pass' : 'fail', '出力全体の範囲分割・対応するAST型・一意なnode IDからの再構築を照合'), check('V-coverage', coverage ? 'pass' : 'fail', '採用対象の原文範囲が一度ずつ現れ、欠落も事実の二重記載もないことを照合')];
  const surfaceValid = !plan.surface || validateSurface(plan.surface, plan.nodes.find(node => node.id === 'main-quote')?.text ?? '', profiles, references);
  checks.push(check('V-plan', validNarrative && validIntent && surfaceValid ? 'pass' : 'fail', '原文から構成順・節の役割・焦点を再計算し、系列構文の出典と外枠を照合'));
  checks.push(check('V-quantity', protectedMismatch ? 'fail' : exactFacts && coverage ? 'pass' : 'unknown', '原値・符号・比較条件・単位・出現順・役割を事実節ごとに独立抽出して照合'));
  for (const code of ['V-roles', 'V-polarity', 'V-temporal', 'V-attribution']) checks.push(check(code, exactFacts && coverage ? 'pass' : 'unknown', '原文一致・限定変換と適用条件の照合。文体の自然さと任意の言い換えの意味同値性は保証しない'));
  checks.push(check('V-rhetoric', safeRhetoric && safeConnectives && provenance ? 'pass' : 'fail', constructionValid ? '登録済み意味構文の原文スロット・意味特徴・適用条件・出典と活用を再計算。未記載の出来事を追加しない。' : rewriteValid ? '本文の各変更を、原文範囲・有限規則・適用条件・出典と照合。比喩や出来事の追加なし。' : safeQuotes ? '出典と一致する別文の引用を照合' : meaning.explanation));
  if (plan.construction) checks.push(check('V-construction', constructionValid ? 'pass' : 'fail', '閉じた構文台帳から束縛と表層文を独立再計算し、語彙編集も原文から再構築して照合'));
  if (plan.rewrite) checks.push(check('V-rewrite', rewriteValid ? 'pass' : 'fail', '出典付き本文変換の編集履歴を原文から再構築して照合'));
  if (plan.rhetoricEdits?.length) checks.push(check('V-dictionary', meaning.dictionary, meaning.explanation));
  return checks;
}
export function verification(checks: Check[]): Candidate['verificationStatus'] { return checks.some(check => check.required && check.status === 'fail') ? 'rejected' : checks.some(check => check.required && check.status === 'unknown') ? 'needs_review' : 'passed'; }
