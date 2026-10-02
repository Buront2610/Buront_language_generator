import type { DocumentIR, GenerationRequest, QuotePlan, RewriteEdit } from '../contracts';
import type { Assets } from './assets';
import { hash, overlaps, slice } from './source';
import { planIntent, planNarrative } from './planning';
import { rewriteRules, createRewritePermission } from './rewrite-rules';
import { renderEdits } from './rewrite-validation';

export function makeRewritePlans(ir: DocumentIR, request: GenerationRequest, assets: Assets): QuotePlan[] {
  const narrative = planNarrative(ir, 'source_order'), intentPlan = planIntent(ir);
  const evidence = new Map(assets.evidence.map(item => [item.id, item]));
  const availablePunctuation = new Set<string>();
  const usable = rewriteRules.filter(rule => {
    const item = evidence.get(rule.evidenceId);
    return rule.level <= request.intensity && item?.sourceType === 'original_post' && item.text.includes(rule.needle) && (rule.kind !== 'punctuation' || !item.text.includes('。')) && (request.series === 'all' || item.series.includes(request.series));
  }).filter(rule => {
    if (rule.kind !== 'punctuation') return true;
    const key = `${rule.from}:${rule.to}`;
    if (availablePunctuation.has(key)) return false;
    availablePunctuation.add(key); return true;
  });
  const plans: QuotePlan[] = [], seen = new Set<string>();
  const permits = createRewritePermission(ir);
  // Variants use different construction choices, never unrelated images or
  // sentences added merely to obtain three outputs.
  for (const variant of [0, 1, 2, 3, 4, 5]) {
    const edits: RewriteEdit[] = [];
    let endingCount = 0;
    const nodes = narrative.units.map((unit, index) => {
      const node = { id: `fact-node-${index}`, type: 'FactClause' as const, text: slice(ir.source.raw, unit.sourceSpan), sourceSpan: unit.sourceSpan, factIds: unit.factIds, evidenceIds: [] as string[], mention: 'primary' as const };
      const proposals: RewriteEdit[] = [];
      for (const rule of usable) {
        if (rule.kind === 'ending' && (variant === 0 || endingCount >= (request.intensity === 3 ? 2 : 1) || rule.mode !== ((variant + endingCount) % 2 ? 'plain' : 'insistence'))) continue;
        if (variant >= 3 && rule.kind !== 'ending' && rule.level === 2 && (variant + index) % 2 === 0) continue;
        let offset = 0, found: number;
        while ((found = node.text.indexOf(rule.from, offset)) >= 0) {
          offset = found + rule.from.length;
          const start = unit.sourceSpan.start + [...node.text.slice(0, found)].length, sourceSpan = { start, end: start + [...rule.from].length };
          if (permits(unit.sourceSpan, sourceSpan, rule)) proposals.push({ nodeId: node.id, sourceSpan, ruleId: rule.id, from: rule.from, to: rule.to, evidenceIds: [rule.evidenceId] });
        }
      }
      // Longest source phrase wins. Every edit reads the original snapshot;
      // generated words are never fed back as another rule's input.
      const chosen: RewriteEdit[] = [];
      for (const proposal of proposals.sort((a, b) => b.from.length - a.from.length || a.sourceSpan.start - b.sourceSpan.start)) {
        if (!chosen.some(edit => overlaps(edit.sourceSpan, proposal.sourceSpan))) chosen.push(proposal);
      }
      chosen.sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
      if (chosen.some(edit => edit.ruleId.startsWith('ending-'))) endingCount++;
      edits.push(...chosen); node.evidenceIds = [...new Set(chosen.flatMap(edit => edit.evidenceIds))];
      node.text = renderEdits(ir.source.raw, node, chosen); return node;
    });
    const text = nodes.map(node => node.text).join('');
    if (!edits.length || seen.has(text)) continue;
    seen.add(text);
    const plan: QuotePlan = { id: '', intent: intentPlan.act, intentPlan, narrative,
      rewrite: { version: 1, seriesId: request.series, intensity: request.intensity, edits },
      mainOperator: 'REWRITE', auxiliaryOperators: [], family: edits.map(edit => edit.ruleId).join('+'),
      mapping: { source: 'adopted-source', target: 'attested-body-constructions', relation: 'bounded-rewrite' },
      backTranslation: '入力本文の語彙・重複表現・断言の形式を、出典のある有限規則で変換。未記載の出来事、原因、相手の反応は追加しない。',
      evidenceIds: [...new Set(edits.flatMap(edit => edit.evidenceIds))], forbiddenEffects: intentPlan.forbiddenEffects, nodes, experimental: true };
    plan.id = hash(plan).slice(0, 24); plans.push(plan);
  }
  return plans;
}
