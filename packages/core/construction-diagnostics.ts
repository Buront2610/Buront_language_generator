import type { Candidate, ConstructionDiagnostic, GenerationResult } from '../contracts';

// Candidate outcomes are observations, never permissions or semantic evidence.
// Replaced after final independent validation/selection so a provisional winner
// cannot leave a misleading selected diagnostic behind.
export function updateConstructionOutcomes(result: Pick<GenerationResult, 'inputHash' | 'diagnostics' | 'candidates'>, pool: Candidate[], phase: 'finite_validation' | 'independent_validation'): void {
  const outcomes = new Set(['verification_rejected', 'verified', 'selected', 'not_selected']);
  const diagnostics = (result.diagnostics ?? []).filter(item => !outcomes.has(item.stage));
  const selected = new Set(result.candidates.map(candidate => `${candidate.id}:${candidate.plan.id}`));
  for (const candidate of pool) {
    const edits = candidate.plan.construction?.edits ?? [];
    for (const edit of edits) {
      const base = { inputHash: result.inputHash, nodeId: edit.nodeId, constructionId: edit.constructionId, candidateId: candidate.id, planId: candidate.plan.id, sourceSpan: edit.sourceSpan };
      if (candidate.verificationStatus !== 'passed') diagnostics.push({ ...base, stage: 'verification_rejected', reason: `${phase}:${candidate.verificationStatus}:${candidate.checks.filter(check => check.required && check.status !== 'pass').map(check => check.code).join(',')}` });
      else {
        diagnostics.push({ ...base, stage: 'verified', reason: phase });
        diagnostics.push({ ...base, stage: selected.has(`${candidate.id}:${candidate.plan.id}`) ? 'selected' : 'not_selected', reason: selected.has(`${candidate.id}:${candidate.plan.id}`) ? 'displayed_after_validation' : 'valid_but_not_displayed_by_quality_diversity_cap' });
      }
    }
  }
  result.diagnostics = diagnostics as ConstructionDiagnostic[];
}
