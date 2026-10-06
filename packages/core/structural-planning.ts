import type { ConstructionDiagnostic, DocumentIR, GenerationRequest, QuotePlan, RhetoricalBlock } from '../contracts';
import type { Assets } from './assets';
import { overlaps } from './source';
import { planIntent, planNarrative } from './planning';
import { recognizeRhetoricalRelations, literalRhetoricalContextSpans } from './rhetorical-recognition';
import { rhetoricalOperatorById, operatorEvidence, realizeRhetoricalBlock, relationRealizations } from './rhetorical-operators';
import { blockAlignsWithUnits, originalStructuralNodes, permittedStructuralLocalEdits, refreshStructuralPlan } from './structural-realization';
import { rewriteRuleById } from './rewrite-rules';
export const structuralSearch = { policy: 'bounded-relation-composition-v3' as const, maxBlocks: 8, maxPlans: 12 };
export function makeStructuralPlans(ir: DocumentIR, request: GenerationRequest, assets: Assets, rewrites: QuotePlan[], diagnostics: ConstructionDiagnostic[] = []): QuotePlan[] {
  if (request.task !== 'rewrite' || request.intensity < 2 || ir.topicOnly) return [];
  const literalContexts = literalRhetoricalContextSpans(ir);
  const units = originalStructuralNodes(ir), recognized = recognizeRhetoricalRelations(ir), available: RhetoricalBlock[][] = [];
  for (const relation of recognized) {
    const report = (stage: ConstructionDiagnostic['stage'], reason: string) => diagnostics.push({ inputHash: ir.source.inputHash, nodeId: null, constructionId: `structural:${relation.kind}`, candidateId: null, planId: null, stage, reason, sourceSpan: relation.sourceSpan });
    report('recognized', 'source_bound_rhetorical_relation');
    if (!blockAlignsWithUnits(relation.sourceSpan, units) || available.some(choices => overlaps(choices[0].sourceSpan, relation.sourceSpan))) { report('scope_blocked', 'relation_not_an_independent_adopted_block'); continue; }
    const choices = relationRealizations(relation, request.intensity).flatMap(choice => {
      const operator = rhetoricalOperatorById.get(choice.operatorId)!, ids = operatorEvidence(operator, request.series, assets);
      if (!ids.length) return [];
      const block = realizeRhetoricalBlock(ir, relation, choice.operatorId, choice.realizationId, ids); return block ? [block] : [];
    });
    if (!choices.length) { report('unsupported_form', 'no_registered_grammar_or_two_source_examples_for_series'); continue; }
    if (available.length >= structuralSearch.maxBlocks) { report('scope_blocked', 'bounded_structural_block_budget'); continue; }
    available.push(choices);
  }
  if (!available.length) return [];
  const intentPlan = planIntent(ir), narrative = planNarrative(ir, 'source_order'), plans: QuotePlan[] = [], seen = new Set<string>();
  // A bounded covering design, not exponential beam search: rotate alternative
  // realizations over independently recognized blocks, then compose source-bound
  // lexical edits. Retain a grammar-only ablation even with no rewrite proposal.
  // Large documents reserve cost for independent proof and source analysis.
  // Above 2,000 source scalars, keep at most two distinct plans: the first
  // grammar-only composition and its source-lexical companion when available.
  // Per-block rotation still permits different operators within the document.
  // This is a candidate-choice budget, never source truncation or proof reuse.
  // Short/ordinary inputs retain the full covering design.
  const largeDocument = [...ir.source.raw].length > 2000;
  const maxPlans = largeDocument ? 2 : structuralSearch.maxPlans;
  const bases = [undefined, ...rewrites].slice(0, largeDocument ? 2 : 4);
  for (let variant = 0; variant < 3; variant++) for (const base of bases) {
    const plan: QuotePlan = { id: '', intent: intentPlan.act, intentPlan, narrative, mainOperator: 'STRUCTURAL', auxiliaryOperators: [], family: '',
      mapping: { source: 'original-propositions-and-illocution', target: 'source-grounded-rhetorical-operators', relation: 'typed-rhetorical-composition-v3' },
      backTranslation: '原文の明示された理由・謙遜と完了行為・対象命題への証拠要求を再束縛し、同じ命題と確度の節を組み替える。未記載の主体・相手・原因・功績・反応は追加しない。',
      evidenceIds: [], forbiddenEffects: [...intentPlan.forbiddenEffects, 'promote_mentioned_target', 'duplicate_premise', 'remove_limitation'], nodes: [], experimental: true,
      structural: { version: 3, seriesId: request.series, intensity: request.intensity, blocks: available.map((choices, index) => structuredClone(choices[(variant + index) % choices.length])), localEdits: [], search: { ...structuralSearch } } };
    const lexical = (base?.rewrite?.edits ?? []).filter(edit => { const rule = rewriteRuleById.get(edit.ruleId); return rule?.kind !== 'punctuation' && rule?.mode !== 'insistence' && !literalContexts.some(span => overlaps(span, edit.sourceSpan)); });
    plan.structural!.localEdits = permittedStructuralLocalEdits(plan, lexical); refreshStructuralPlan(ir, plan);
    const text = plan.nodes.map(node => node.text).join(''); if (seen.has(text)) continue;
    seen.add(text); plans.push(plan);
    for (const block of plan.structural!.blocks) diagnostics.push({ inputHash: ir.source.inputHash, nodeId: block.nodeId, constructionId: `structural:${block.operatorId}`, candidateId: null, planId: plan.id, stage: 'planned', reason: block.realizationId, sourceSpan: block.sourceSpan });
    if (plans.length >= maxPlans) return plans;
  }
  return plans;
}
