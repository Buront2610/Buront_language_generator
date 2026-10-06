import type { DocumentIR, OutputSpan, PlanNode, QuotePlan, RhetoricalPiece, RewriteEdit, Span } from '../contracts';
import { hash, slice } from './source';
import { factsIn, planNarrative } from './planning';
import { compareSourceEdits } from './rewrite-validation';
export const contained = (inner: Span, outer: Span) => outer.start <= inner.start && inner.end <= outer.end;
export const uniqueIds = (items: { evidenceIds: string[] }[]) => [...new Set(items.flatMap(item => item.evidenceIds))];
export function originalStructuralNodes(ir: DocumentIR): PlanNode[] {
  return planNarrative(ir, 'source_order').units.map((unit, index) => ({ id: `fact-node-${index}`, type: 'FactClause', text: slice(ir.source.raw, unit.sourceSpan), sourceSpan: { ...unit.sourceSpan }, factIds: [...unit.factIds], evidenceIds: [], mention: 'primary' }));
}
export function blockAlignsWithUnits(span: Span, nodes: PlanNode[]): boolean {
  const covered = nodes.filter(node => node.sourceSpan && contained(node.sourceSpan, span));
  return covered.length > 0 && covered[0].sourceSpan!.start === span.start && covered.at(-1)!.sourceSpan!.end === span.end
    && covered.every((node, index) => !index || covered[index - 1].sourceSpan!.end === node.sourceSpan!.start);
}
export function structuralSkeleton(ir: DocumentIR, plan: Pick<QuotePlan, 'structural'>): PlanNode[] {
  const blocks = plan.structural?.blocks ?? [], original = originalStructuralNodes(ir);
  return original.flatMap(node => {
    const block = blocks.find(block => contained(node.sourceSpan!, block.sourceSpan));
    if (!block) return [node];
    if (node.sourceSpan!.start !== block.sourceSpan.start) return [];
    return [{ id: block.nodeId, type: 'FactClause' as const, text: '', sourceSpan: { ...block.sourceSpan }, factIds: factsIn(ir, block.sourceSpan).map(fact => fact.id), evidenceIds: [], mention: 'primary' as const }];
  });
}
export function renderStructural(ir: DocumentIR, plan: QuotePlan): { text: string; spans: OutputSpan[]; nodes: PlanNode[] } {
  const program = plan.structural; if (!program) return { text: '', spans: [], nodes: [] };
  let text = '', offset = 0; const spans: OutputSpan[] = [], nodes = structuralSkeleton(ir, plan);
  for (const node of nodes) {
    const block = program.blocks.find(block => block.nodeId === node.id), start = offset;
    const pieces: RhetoricalPiece[] = block?.pieces ?? [{ kind: 'source', role: 'background', sourceSpan: node.sourceSpan! }];
    const nodeEvidence: string[] = [];
    const append = (value: string, sourceSpan: Span, origin: OutputSpan['origin'], evidenceIds: string[]) => {
      nodeEvidence.push(...evidenceIds); if (!value) return;
      const end = offset + [...value].length;
      spans.push({ span: { start: offset, end }, nodeId: node.id, origin, sourceSpan: { ...sourceSpan }, factIds: factsIn(ir, sourceSpan).map(fact => fact.id), evidenceIds: [...evidenceIds] });
      text += value; offset = end;
    };
    for (const piece of pieces) {
      if (piece.kind === 'form') {
        append(piece.text, piece.sourceSpan ?? { start: piece.anchor, end: piece.anchor }, 'paraphrase', piece.evidenceIds); continue;
      }
      const edits = program.localEdits.filter(edit => contained(edit.sourceSpan, piece.sourceSpan)).sort(compareSourceEdits);
      let cursor = piece.sourceSpan.start;
      for (const edit of edits) {
        append(slice(ir.source.raw, { start: cursor, end: edit.sourceSpan.start }), { start: cursor, end: edit.sourceSpan.start }, 'source_fact', []);
        append(edit.to, edit.sourceSpan, 'paraphrase', edit.evidenceIds); cursor = edit.sourceSpan.end;
      }
      append(slice(ir.source.raw, { start: cursor, end: piece.sourceSpan.end }), { start: cursor, end: piece.sourceSpan.end }, 'source_fact', []);
    }
    node.text = [...text].slice(start, offset).join(''); node.evidenceIds = [...new Set([...(block?.evidenceIds ?? []), ...nodeEvidence])];
  }
  return { text, spans, nodes };
}
export function structuralFamily(plan: QuotePlan): string {
  return [...new Set((plan.structural?.blocks ?? []).map(block => block.operatorId))].sort().join('+');
}
export function structuralEvidence(plan: QuotePlan): string[] {
  return uniqueIds([...(plan.structural?.blocks ?? []), ...(plan.structural?.localEdits ?? [])]);
}
export function refreshStructuralPlan(ir: DocumentIR, plan: QuotePlan): void {
  plan.nodes = renderStructural(ir, plan).nodes; plan.family = structuralFamily(plan); plan.evidenceIds = structuralEvidence(plan);
  plan.id = hash({ ...plan, id: '' }).slice(0, 24);
}
export function permittedStructuralLocalEdits(plan: QuotePlan, originalEdits: RewriteEdit[]): RewriteEdit[] {
  const blocks = plan.structural?.blocks ?? [];
  return structuredClone(originalEdits).filter(edit => {
    const block = blocks.find(block => contained(edit.sourceSpan, block.sourceSpan));
    // Every retained edit must fit completely in one emitted original-source
    // piece. A moved clause never lends permission to rewrite another clause.
    if (block && block.relation.slots.some(slot => contained(edit.sourceSpan, slot.span) && block.relation.conditions.some(condition => slot.factIds.includes(condition.factId) && ['literal-copy', 'embedded-scope'].includes(condition.preservation)))) return false;
    return !block || block.pieces.some(piece => piece.kind === 'source' && piece.role !== 'context' && contained(edit.sourceSpan, piece.sourceSpan));
  });
}
