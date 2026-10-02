import type { Analysis, GenerationResult, QuotePlan } from '../contracts';
import { validateRequest } from '../contracts';
import type { Assets } from './assets';
import { generate } from './engine';
import { hash } from './source';
import { finishSemanticVerification } from './semantic';

// Exported plans are untrusted. Rebuild each parent and select an actually
// validated candidate before its nodes are allowed into a regeneration.
export function replayGeneration(manifest: Record<string, any>, analysis: Analysis, assets: Assets, depth = 0): GenerationResult {
  if (depth >= 20) throw new Error('REPLAY_DEPTH_LIMIT');
  validateRequest(manifest.request);
  if (manifest.datasetId !== assets.datasetId || manifest.inputHash !== hash(manifest.request.source)) throw new Error('REPLAY_ASSET_OR_INPUT_MISMATCH');
  if (manifest.parserVersion !== analysis.parserVersion) throw new Error('REPLAY_PARSER_MISMATCH');
  if (manifest.engineVersion !== assets.manifest.engine?.sourceHash) throw new Error('REPLAY_ENGINE_MISMATCH');
  if (!Array.isArray(manifest.history) || manifest.history.length > 80 || manifest.historySnapshot !== hash(manifest.history)) throw new Error('REPLAY_HISTORY_MISMATCH');
  const regeneration = manifest.regeneration;
  let lockedPlan: QuotePlan | undefined;
  if (regeneration) {
    if (!regeneration.parent || regeneration.parent.inputHash !== manifest.inputHash) throw new Error('REPLAY_PARENT_REQUIRED');
    const parent = replayGeneration(regeneration.parent, analysis, assets, depth + 1);
    // Locks refer to the final accepted parent, never its provisional top three.
    // The active finite pipelines need no output reparse; a future free-form
    // path requiring fresh analysis fails closed instead of trusting the export.
    finishSemanticVerification(parent, {});
    lockedPlan = parent.candidates.find(candidate => candidate.id === regeneration.candidateId)?.plan;
    if (!lockedPlan || hash(lockedPlan) !== hash(regeneration.lockedPlan)) throw new Error('REPLAY_LOCK_MISMATCH');
    if (!Array.isArray(regeneration.lockedNodeIds) || regeneration.lockedNodeIds.length > 100 || regeneration.lockedNodeIds.some((id: string) => !lockedPlan!.nodes.some(node => node.id === id))) throw new Error('REPLAY_LOCK_MISMATCH');
  }
  const result = generate(manifest.request, analysis, assets, { history: manifest.history, experimentalOperators: manifest.experimentalOperators,
    ...(regeneration ? { lockedPlan, lockedNodeIds: regeneration.lockedNodeIds, operator: regeneration.operator, replayParent: regeneration.parent, parentCandidateId: regeneration.candidateId } : {}) });
  if (result.replayManifest.candidateSetHash !== manifest.candidateSetHash) throw new Error('REPLAY_CANDIDATES_MISMATCH');
  return result;
}
