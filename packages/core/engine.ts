import type { Analysis, Candidate, GenerationRequest, GenerationResult, QuotePlan } from '../contracts';
import { validateRequest } from '../contracts';
import { Assets, retrievalFor } from './assets';
import { sourceDocument, hash } from './source';
import { extractFacts } from './facts';
import { makeRewritePlans } from './rewrite';
import { makeConstructionPlans, constructionFamily } from './constructions';
import { lockedEvidenceCompatible } from './lock-compatibility';
import { unsupportedGenerationMode } from './capabilities';
import { realize, validateCandidate, verification } from './validator';
import { applyDictionary } from './dictionary';
import { evaluateNovelty, HistoryEntry, select, score, ruleQuality, featureVersion } from './evaluation';
import { frameRhetoric } from './series';
import Ajv2020 from 'ajv/dist/2020';
import { GenerationResultSchema } from '../contracts/results';
const validateResult = new Ajv2020({ strict: true }).compile(GenerationResultSchema);
export type GenerationOptions = { history?: HistoryEntry[]; deadline?: number; stage?: (stage: string) => void; cancelled?: () => boolean; lockedPlan?: QuotePlan; lockedNodeIds?: string[]; operator?: string; engineVersion?: string; experimentalOperators?: boolean; replayParent?: Record<string, any>; parentCandidateId?: string };
export function generate(request: GenerationRequest, analysis: Analysis, assets: Assets, options: GenerationOptions = {}): GenerationResult {
  validateRequest(request);
  if ((options.replayParent?.replayDepth ?? 0) >= 19) throw new Error('REPLAY_DEPTH_LIMIT');
  if (request.backend !== 'structured') throw new Error('MODEL_BACKEND_NOT_ENABLED');
  if (!lockedEvidenceCompatible(options.lockedPlan, options.lockedNodeIds ?? [], request.series, assets)) throw new Error('LOCK_CONFLICT');
  const checkpoint = (stage: string) => { if (options.cancelled?.()) throw new Error('CANCELLED'); if (Date.now() > (options.deadline ?? Infinity)) throw new Error('DEADLINE_EXCEEDED'); options.stage?.(stage); };
  checkpoint('planning');
  const source = sourceDocument(request.source), ir = extractFacts(source, analysis, request);
  const unsupported = unsupportedGenerationMode(request);
  const rewrites = unsupported ? [] : makeRewritePlans(ir, request, assets);
  const plans = unsupported ? [] : [...makeConstructionPlans(ir, request, assets, rewrites), ...rewrites].filter(plan => !options.operator || plan.mainOperator === options.operator);
  if (options.lockedNodeIds?.length && options.operator && options.lockedPlan && options.operator !== options.lockedPlan.mainOperator) throw new Error('LOCK_CONFLICT');
  const retrieval = retrievalFor(assets), evidenceIds = new Set(assets.evidence.map(item => item.id));
  const generated: Candidate[] = []; let total = 0;
  checkpoint('generating');
  for (const original of plans.slice(0, 36)) {
    if (options.lockedNodeIds?.length && options.lockedPlan && !!original.construction !== !!options.lockedPlan.construction) continue;
    checkpoint('generating');
    const plan = structuredClone(original);
    for (const id of options.lockedNodeIds ?? []) {
      const node = options.lockedPlan?.nodes.find(node => node.id === id), index = plan.nodes.findIndex(node => node.id === id);
      if (!node || index < 0) throw new Error('LOCK_CONFLICT');
      plan.nodes[index] = structuredClone(node);
      if (plan.construction && options.lockedPlan?.construction) {
        for (const key of ['edits', 'lexicalEdits'] as const) {
          const retained = plan.construction[key].filter(edit => edit.nodeId !== id);
          const locked = structuredClone(options.lockedPlan.construction[key].filter(edit => edit.nodeId === id));
          (plan.construction[key] as any[]) = [...retained, ...locked].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
        }
        const edits = [...plan.construction.edits, ...plan.construction.lexicalEdits].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
        plan.evidenceIds = [...new Set(edits.flatMap(edit => edit.evidenceIds))];
      }
      if (plan.rewrite && options.lockedPlan?.rewrite) {
        plan.rewrite.edits = [...plan.rewrite.edits.filter(edit => edit.nodeId !== id), ...structuredClone(options.lockedPlan.rewrite.edits.filter(edit => edit.nodeId === id))].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start);
        plan.evidenceIds = [...new Set(plan.rewrite.edits.flatMap(edit => edit.evidenceIds))];
      }
    }
    if (options.lockedNodeIds?.includes('main-quote') && options.lockedPlan) {
      plan.mainOperator = options.lockedPlan.mainOperator; plan.family = options.lockedPlan.family; plan.mapping = options.lockedPlan.mapping; plan.backTranslation = options.lockedPlan.backTranslation;
      plan.intent = options.lockedPlan.intent; plan.intentPlan = options.lockedPlan.intentPlan; plan.surface = options.lockedPlan.surface;
      plan.rhetoric = options.lockedPlan.rhetoric; plan.rhetoricEdits = options.lockedPlan.rhetoricEdits;
      plan.evidenceIds = [...new Set(plan.nodes.flatMap(node => node.evidenceIds))];
      if (options.operator && options.operator !== plan.mainOperator) throw new Error('LOCK_CONFLICT');
    }
    if (plan.construction) { plan.family = constructionFamily(plan.construction.edits); plan.id = hash({ ...plan, id: '' }).slice(0, 24); }
    if (plan.rewrite) { plan.family = plan.rewrite.edits.map(edit => edit.ruleId).join('+'); plan.id = hash({ ...plan, id: '' }).slice(0, 24); }
    // Dictionary changes only editable rhetoric; factual, quoted and opaque source
    // nodes remain immutable. Every edit is validated as part of the complete result.
    // Locked rhetoric already includes the parent's edits; never apply twice.
    if (plan.surface && !options.lockedNodeIds?.includes('main-quote')) {
      const before = plan.surface.coreText, edited = applyDictionary(before, request.customRules ?? [], [], 12000);
      plan.rhetoricEdits = edited.edits.map(edit => ({ ...edit, from: [...before].slice(edit.sourceSpan.start, edit.sourceSpan.end).join(''), to: [...edited.text].slice(edit.outputSpan.start, edit.outputSpan.end).join('') }));
      plan.surface.coreText = edited.text;
      plan.nodes.find(node => node.id === 'main-quote')!.text = frameRhetoric(edited.text, plan.surface.constructionId);
    }
    const { text, spans } = realize(plan, ir);
    const length = [...text].length;
    if (length > (request.task === 'quote' ? 240 : 12000) || total + length > 120000) continue;
    total += length;
    checkpoint('validating');
    const checks = validateCandidate(ir, plan, text, spans, evidenceIds, undefined, new Map(assets.evidence.map(item => [item.id, item.text])), assets.seriesProfiles);
    if ((plan.rewrite || plan.construction) && request.customRules?.length) checks.push({ code: 'V-dictionary', status: 'unknown', required: true, explanation: '本文の自由置換は出典付きの有限変換として検証できないため適用していません。辞書を外すか、本文変換とは別に確認してください。', factIds: [], checkerVersion: 'bounded-body-rewrite-v1' });
    const quality = ruleQuality(ir, plan);
    const candidate: Candidate = { id: hash({ inputHash: source.inputHash, text, datasetId: assets.datasetId }).slice(0, 24), text, plan, spans, checks, verificationStatus: verification(checks), verificationScope: plan.construction ? '登録済みの意味構文について原文のスロット・適用条件・活用・出典を再束縛して照合。任意の言い換え・自然さ・文体品質は未保証。' : plan.rewrite ? '原文範囲・保護値・引用の保持と、出典付き有限変換の適用条件を検査。自然さ・文体の良さは未評価。' : '原文を保持した事実節・型付き修辞の構成検査（修辞の品質は実験段階）',
      scores: { S: null, Q: null, ...quality },
      novelty: { classification: 'undetermined', text: null, structure: null, concept: null, nearestIds: [], datasetId: assets.datasetId, historySnapshot: hash(options.history ?? []), window: '' },
      evidence: plan.evidenceIds.map(id => assets.evidence.find(item => item.id === id)).filter(item => !!item).map(item => ({ id: item!.id, kind: plan.rewrite || plan.construction ? 'construction_evidence' : plan.mainOperator === 'QUOTE' ? 'direct_quote' : (plan.surface?.evidenceIds.includes(item!.id) || plan.rhetoric?.discourseEvidenceIds.includes(item!.id)) ? 'construction_evidence' : 'related_example', text: item!.text, ...(typeof item!.url === 'string' && item!.url ? { url: item!.url } : {}) })) };
    checkpoint('evaluating'); candidate.novelty = evaluateNovelty(candidate, assets, retrieval, options.history ?? []);
    if (plan.mainOperator === 'QUOTE') candidate.novelty = { ...candidate.novelty, classification: 'known_quote', text: 0, structure: 0, concept: null, nearestIds: plan.evidenceIds };
    candidate.scores.S = score(candidate, assets.evaluators?.S); candidate.scores.Q = score(candidate, assets.evaluators?.Q);
    generated.push(candidate);
  }
  const candidates = select(generated, request.noveltyMode, request.seed ?? source.inputHash);
  const shortfallReason = unsupported ? 'unsupported_generation_mode' : candidates.length === 3 ? null : candidates.length ? 'candidate_shortage' : generated.some(candidate => candidate.verificationStatus === 'needs_review' && candidate.checks.some(check => check.code === 'V-dictionary' && check.status === 'unknown')) ? 'dictionary_needs_review' : generated.some(candidate => candidate.checks.some(check => check.code === 'V-dictionary' && check.status === 'fail')) ? 'dictionary_rejected' : !plans.length ? 'unsupported_relation' : generated.every(candidate => candidate.verificationStatus !== 'passed') ? 'no_valid_candidate' : request.noveltyMode === 'invent' ? 'no_novel_candidate' : 'quality_rejected';
  const result: GenerationResult = { inputHash: source.inputHash, clientRevision: request.clientRevision, selectedCandidateId: candidates[0]?.id ?? null, candidates, candidatePool: generated, reviewCandidates: generated.filter(candidate => candidate.verificationStatus === 'needs_review').slice(0, 3),
    fallback: candidates.length ? null : { text: request.source, reason: shortfallReason! }, shortfallReason, ir,
    replayManifest: { schemaVersion: 1, request, seed: request.seed ?? source.inputHash, inputHash: source.inputHash, candidateSetHash: hash(generated.map(candidate => ({ id: candidate.id, text: candidate.text })).sort((a, b) => a.id.localeCompare(b.id))),
      historySnapshot: hash(options.history ?? []), history: options.history ?? [], datasetId: assets.datasetId, assets: assets.manifest, parserVersion: analysis.parserVersion,
      engineVersion: options.engineVersion ?? assets.manifest.engine?.sourceHash ?? 'structured-v1', backend: request.backend, profile: 'registered-constructions-and-rewrites-36drafts-3results', deterministic: true, generated: generated.length,
      replayDepth: options.replayParent ? Number(options.replayParent.replayDepth ?? 0) + 1 : 0,
      experimentalOperators: options.experimentalOperators ?? false, regeneration: options.lockedPlan ? { lockedPlan: options.lockedPlan, lockedNodeIds: options.lockedNodeIds, operator: options.operator, parent: options.replayParent, candidateId: options.parentCandidateId } : null,
      evaluator: { S: assets.evaluators?.S ? { version: hash(assets.evaluators.S), personal: assets.evaluators.S.personal, meaning: 'relative-preference-not-probability' } : 'untrained', Q: assets.evaluators?.Q ? { version: hash(assets.evaluators.Q), personal: assets.evaluators.Q.personal, meaning: 'relative-preference-not-probability' } : 'untrained', C: 'finite-rewrite-and-registered-construction-proof-v2', R: 'bounded-adaptation-size-v2', featureVersion }, experimental: true } };
  if (!validateResult(result)) throw Object.assign(new Error('INVALID_RESULT_CONTRACT'), { validationErrors: validateResult.errors });
  return result;
}
