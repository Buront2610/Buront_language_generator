import type { GenerationRequest } from '../contracts';

// The same capability contract drives admission, status and the UI. Registered
// constructions are attested adaptations, not an open-ended creative backend.
export const generationCapabilities = () => ({
  pipeline: 'typed-rhetorical-adaptation-v3',
  finiteRewrite: true,
  registeredConstruction: true,
  typedRhetoricalComposition: true,
  creativeGeneration: false,
  generationModes: { canonical: true, blend: true, invent: false },
  tasks: { rewrite: true, quote: false },
  contextModes: { faithful: true, full: false },
  maxCandidates: 3,
  unsupportedReason: 'unsupported_generation_mode',
  limitations: {
    invent: '新作生成は未実装です。現在は出典付きの語句変換と登録構文の応用に対応しています。',
    quote: '一句の創作は未実装です。現在は原文全体を保持する変換に対応しています。',
    full: '文脈の創作的な展開は未実装です。原文の事実と明示された関係を保ち、対応範囲で節構成を組み替えます。',
  },
});

export function unsupportedGenerationMode(request: Pick<GenerationRequest, 'noveltyMode' | 'task' | 'contextMode'>): boolean {
  const capabilities = generationCapabilities();
  const supports = (modes: Record<string, boolean>, mode: string) => modes[mode] === true;
  return !supports(capabilities.generationModes, request.noveltyMode) || !supports(capabilities.tasks, request.task) || !supports(capabilities.contextModes, request.contextMode);
}
