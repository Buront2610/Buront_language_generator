import type { QuotePlan } from '../contracts';
import type { Assets } from './assets';

// A retained node can carry lexical and construction evidence from the parent's
// series. Changing the requested series never relabels those attestations.
export function lockedEvidenceCompatible(plan: QuotePlan | undefined, lockedNodeIds: string[], series: string, assets: Pick<Assets, 'evidence'>): boolean {
  if (!lockedNodeIds.length) return true;
  if (!plan || lockedNodeIds.some(id => !plan.nodes.some(node => node.id === id))) return false;
  // Old replacement-body programs cannot be silently reinterpreted as the new
  // prefix/source-body algebra. Old replay exports also fail the engine hash.
  if (plan.construction && (plan.construction.version !== 2 || plan.construction.edits.some(edit => !edit.operation || !['replace', 'prefix_source_body'].includes(edit.operation.kind)))) return false;
  const locked = new Set(lockedNodeIds), evidence = new Map(assets.evidence.map(item => [item.id, item]));
  const ids = new Set([
    ...plan.nodes.filter(node => locked.has(node.id)).flatMap(node => node.evidenceIds),
    ...(plan.rewrite?.edits ?? []).filter(edit => locked.has(edit.nodeId)).flatMap(edit => edit.evidenceIds),
    ...(plan.construction?.edits ?? []).filter(edit => locked.has(edit.nodeId)).flatMap(edit => edit.evidenceIds),
    ...(plan.structural?.lexicalEdits ?? []).filter(edit => locked.has(edit.nodeId)).flatMap(edit => edit.evidenceIds),
    ...(plan.construction?.lexicalEdits ?? []).filter(edit => locked.has(edit.nodeId)).flatMap(edit => edit.evidenceIds),
  ]);
  return [...ids].every(id => {
    const item = evidence.get(id);
    return item?.sourceType === 'original_post' && (series === 'all' || item.series.includes(series));
  });
}
