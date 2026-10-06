import type { DocumentIR, QuotePlan, RewriteEdit, PlanNode, Span } from '../contracts';
import { hash, slice } from './source';
import { createRewritePermission, rewriteRuleById } from './rewrite-rules';

// Zero-width registered prefixes sort before a body edit at the same source offset.
export const compareSourceEdits = (a: { sourceSpan: Span }, b: { sourceSpan: Span }) => a.sourceSpan.start - b.sourceSpan.start || a.sourceSpan.end - b.sourceSpan.end;

export function renderEdits(raw: string, node: PlanNode, edits: RewriteEdit[]): string {
  let cursor = node.sourceSpan!.start, text = '';
  for (const edit of [...edits].sort(compareSourceEdits)) {
    text += slice(raw, { start: cursor, end: edit.sourceSpan.start }) + edit.to;
    cursor = edit.sourceSpan.end;
  }
  return text + slice(raw, { start: cursor, end: node.sourceSpan!.end });
}

// Validate the submitted edit program against the immutable input, not against
// the planner's output or its claimed back-translation. Unknown/free edits fail.
export function validateRewrite(ir: DocumentIR, plan: QuotePlan, references?: Map<string, string>): boolean {
  const program = plan.rewrite;
  if (!program || program.version !== 1 || !program.edits.length || ![1, 2, 3].includes(program.intensity) || plan.structural || plan.surface || plan.rhetoric || plan.rhetoricEdits?.length || plan.mainOperator !== 'REWRITE' || plan.nodes.some(node => node.type !== 'FactClause')) return false;
  // The document-level budget limits added insistence, not independently
  // permitted neutral inflection. Counting every ending used to reject a
  // consistent plain-form paragraph after its first one or two clauses.
  if (program.edits.filter(edit => rewriteRuleById.get(edit.ruleId)?.mode === 'insistence').length > (program.intensity === 3 ? 2 : 1)) return false;
  if (program.edits.some(edit => !plan.nodes.some(node => node.id === edit.nodeId))) return false;
  // Rebuild once for this proof; never reuse planner-owned derived state.
  const permits = createRewritePermission(ir);
  for (const node of plan.nodes) {
    if (!node.sourceSpan) return false;
    const edits = program.edits.filter(edit => edit.nodeId === node.id).sort(compareSourceEdits);
    let cursor = node.sourceSpan.start;
    for (const edit of edits) {
      const rule = rewriteRuleById.get(edit.ruleId);
      if (!rule || edit.sourceSpan.start < cursor || rule.level > program.intensity || edit.from !== rule.from || edit.to !== rule.to || edit.sourceSpan.end - edit.sourceSpan.start !== [...rule.from].length
        || !permits(node.sourceSpan, edit.sourceSpan, rule) || hash(edit.evidenceIds) !== hash([rule.evidenceId]) || references && (!references.get(rule.evidenceId)?.includes(rule.needle) || rule.kind === 'punctuation' && references.get(rule.evidenceId)!.includes('。'))) return false;
      cursor = edit.sourceSpan.end;
    }
    if (node.text !== renderEdits(ir.source.raw, node, edits) || hash(node.evidenceIds) !== hash([...new Set(edits.flatMap(edit => edit.evidenceIds))])) return false;
  }
  return hash(plan.evidenceIds) === hash([...new Set(program.edits.flatMap(edit => edit.evidenceIds))]);
}
