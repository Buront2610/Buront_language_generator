import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Candidate, DocumentIR, GenerationRequest, GenerationResult } from '../../../packages/contracts';
import './style.css';
import { ReviewPanel } from './ReviewPanel';

const states: Record<string, string> = { queued: '順番を待っています', analyzing: '原文を解析しています', planning: '語り方を組み立てています', generating: '候補を生成しています', validating: '原文との対応を検査しています', evaluating: '新規性を比較しています', completed: '生成しました', cancelled: '取り消しました', failed: '生成できませんでした' };
const noveltyLabels = { known_quote: '既知句', adaptation: '応用', candidate_novel: '表現上の新作候補', undetermined: '新規性未確認' };
const initial = { task: 'rewrite', contextMode: 'faithful', noveltyMode: 'blend', intensity: 2, series: 'all', backend: 'structured' } as const;
function App() {
  const [view, setView] = useState(location.hash === '#review' ? 'review' : 'generator');
  const [source, setSource] = useState(''), [settings, setSettings] = useState<Partial<GenerationRequest>>(initial), [dictionary, setDictionary] = useState('');
  const [status, setStatus] = useState<any>(null), [message, setMessage] = useState('解析器を準備しています…'), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null), [selectedId, setSelectedId] = useState<string | null>(null), [jobId, setJobId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ start: number; end: number }[]>([]), [saveInput, setSaveInput] = useState(false), [legacyStorage, setLegacyStorage] = useState(false);
  const [locks, setLocks] = useState<string[]>([]), [operator, setOperator] = useState(''), [comparison, setComparison] = useState<any>(null), [dimension, setDimension] = useState('S'), [reason, setReason] = useState('');
  const [annotator, setAnnotator] = useState('local-reviewer');
  const token = useRef(''), revision = useRef(0), active = useRef<{ revision: number; jobId?: string } | null>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const selected = result?.candidates.find(candidate => candidate.id === selectedId);
  async function api(url: string, options: RequestInit = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}`, ...options.headers } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error === 'unsupported_generation_mode' ? 'この生成方式は未対応です。全文の限定変換・事実と順序を保持・登録構文の応用または既知表現を選んでください。' : `${response.status}: ${data.error}`); return data;
  }
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    setLegacyStorage(Object.keys(localStorage).some(key => /buront|bront/i.test(key) && key !== 'buront-v1-input' && key !== 'buront-v1-save'));
    const enabled = localStorage.getItem('buront-v1-save') === 'true'; setSaveInput(enabled); if (enabled) setSource(localStorage.getItem('buront-v1-input') || '');
    (async () => {
      try {
        const session = await api('/api/v1/session', { method: 'POST', headers: { 'X-Buront-Client': '1' }, body: '{}' }); token.current = session.token;
        async function poll() { const data = await api('/api/v1/status'); if (disposed) return; setStatus(data); setMessage(data.ready ? '入力を用意して、生成してください。' : data.startupError ? '解析器を起動できません。セットアップ診断を確認してください。' : '解析器を準備しています…'); if (!data.ready && !data.startupError) timer = setTimeout(() => void poll().catch(error => setMessage(error.message)), 1000); }
        await poll();
      } catch (error) { if (!disposed) setMessage((error as Error).message); }
    })(); return () => { disposed = true; clearTimeout(timer); };
  }, []);
  function invalidate() {
    revision.current++; const previous = active.current; active.current = null;
    if (previous?.jobId) void api(`/api/v1/generations/${previous.jobId}`, { method: 'DELETE' }).catch(() => {});
    setBusy(false); setResult(null); setSelectedId(null); setJobId(null); setComparison(null); setLocks([]); setOperator('');
  }
  function changeSource(value: string) { invalidate(); setSource(value); setFocus([]); if (saveInput) localStorage.setItem('buront-v1-input', value); }
  function setting(key: keyof GenerationRequest, value: any) { invalidate(); setSettings(previous => ({ ...previous, [key]: value })); }
  async function submit(partial = false) {
    if (active.current || !status?.ready || !source.trim()) return;
    if ([...source].length > 5000) { setMessage('入力は5,000文字までです。'); return; }
    const current = { revision: revision.current } as { revision: number; jobId?: string }; active.current = current; setBusy(true); setMessage('要求を送っています…');
    const currentResult = result, currentSelected = selected;
    try {
      const rules = dictionary.split('\n').filter(line => line.trim()).map((line, i) => { const index = line.indexOf('='); if (index <= 0) throw new Error('追加辞書は「元の語=置き換える語」で指定してください。'); return { id: `rule-${i}`, from: line.slice(0, index), to: line.slice(index + 1), priority: 0 }; });
      const request = { ...settings, source, focusSpans: focus, customRules: rules, clientRevision: current.revision, seed: crypto.randomUUID() };
      const body = partial && currentResult && currentSelected ? { analysisId: currentResult.analysisId, candidateId: currentSelected.id, lockedNodeIds: locks, seed: request.seed, ...(operator ? { operator } : {}), clientRevision: current.revision } : request;
      const accepted = await api(partial ? '/api/v1/regenerations' : '/api/v1/generations', { method: 'POST', body: JSON.stringify(body) }); current.jobId = accepted.jobId;
      if (active.current !== current || revision.current !== current.revision) { await api(`/api/v1/generations/${accepted.jobId}`, { method: 'DELETE' }); return; }
      setJobId(accepted.jobId);
      while (active.current === current && revision.current === current.revision) {
        const job = await api(`/api/v1/generations/${accepted.jobId}`);
        if (active.current !== current || revision.current !== current.revision) return;
        setMessage(states[job.state] || job.state);
        if (job.state === 'completed') { setResult(job.result); setSelectedId(job.result.selectedCandidateId); setComparison(null); void api('/api/v1/status').then(setStatus).catch(() => {}); break; }
        if (job.state === 'failed') throw new Error(job.error || '生成失敗');
        if (job.state === 'cancelled') break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) { if (active.current === current) setMessage((error as Error).message); }
    finally { if (active.current === current) { active.current = null; setBusy(false); } }
  }
  function download(name: string, data: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function act(action: () => Promise<any>, success: string) { try { await action(); setMessage(success); } catch (error) { setMessage((error as Error).message); } }
  return <main>
    <header><div className="eyebrow">LOCAL / EXPERIMENTAL</div><h1>ブロント語<span>生成器</span></h1><p>言い回しを試し、原文とのつながりを確かめる。</p><div className="status"><span className={status?.ready ? 'dot ready' : 'dot'} />{status?.ready ? 'ローカルで稼働中' : '準備中'} · 本文の外部送信なし</div></header>
    <nav className="mode-tabs" aria-label="作業を選択"><button aria-pressed={view === 'generator'} onClick={() => { setView('generator'); history.replaceState(null, '', '#generator'); }}>生成する</button><button disabled={!status} aria-pressed={view === 'review'} onClick={() => { setView('review'); history.replaceState(null, '', '#review'); }}>人間チェック</button></nav>
    {view === 'review' ? status ? <ReviewPanel api={api} /> : <p role="status">接続を準備しています…</p> : <>
    <div className="workspace"><section className="editor" aria-labelledby="input-title"><div className="section-top"><h2 id="input-title">01 <span>原文</span></h2><span>{[...source].length.toLocaleString()} / 5,000</span></div>
      <label className="sr-only" htmlFor="source">変換する原文</label><textarea id="source" ref={textarea} rows={9} value={source} placeholder="例：田中がAを復旧した。Bは停止中で、私は明日確認する。" onChange={event => changeSource(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); } }} />
      <div className="inline"><button onClick={() => changeSource('田中がAを復旧した。Bは停止中で、私は明日確認する。')}>例文を使う</button><button onClick={() => { changeSource(''); localStorage.removeItem('buront-v1-input'); setMessage('入力と結果を消去しました。'); }}>消去</button>{settings.task === 'quote' && <button onClick={() => { const field = textarea.current!; const start = [...source.slice(0, field.selectionStart)].length, end = [...source.slice(0, field.selectionEnd)].length; if (start < end) { invalidate(); setFocus([{ start, end }]); } }}>選択範囲を焦点にする</button>}</div>
      {focus.length > 0 && <p className="note">焦点：文字 {focus[0].start}〜{focus[0].end}。文の一部だけの指定は話題として扱います。</p>}
      <div className="settings"><label>用途<select value={settings.task} onChange={event => setting('task', event.target.value)}><option value="rewrite" disabled={!status?.capabilities?.tasks?.rewrite}>全文の限定変換</option><option value="quote" disabled={!status?.capabilities?.tasks?.quote}>一句の創作（未対応）</option></select></label><label>文脈<select value={settings.contextMode} onChange={event => setting('contextMode', event.target.value)}><option value="faithful" disabled={!status?.capabilities?.contextModes?.faithful}>{settings.experimentalStructural ? '事実を保持（理由の句順は変更可）' : '事実と順序を保持'}</option><option value="full" disabled={!status?.capabilities?.contextModes?.full}>創作的な展開（未対応）</option></select></label><label>新規性<select value={settings.noveltyMode} onChange={event => setting('noveltyMode', event.target.value)}><option value="invent" disabled={!status?.capabilities?.generationModes?.invent}>新作生成（未対応）</option><option value="blend" disabled={!status?.capabilities?.generationModes?.blend}>登録構文・語句の応用</option><option value="canonical" disabled={!status?.capabilities?.generationModes?.canonical}>既知表現も許可</option></select></label><label>濃さ<select value={settings.intensity} onChange={event => setting('intensity', Number(event.target.value))}><option value={1}>控えめ</option><option value={2}>標準</option><option value={3}>濃いめ</option></select></label><label className="wide">系列<select value={settings.series} onChange={event => setting('series', event.target.value)}>{(status?.series ?? [{ id: 'all', label: '全系列' }]).map((item: any) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
      <p className="note" role="note">出典付きの有限な語句変換と登録構文の応用を行います。新作生成・一句の創作・文脈の創作的な展開は未対応です。</p>
      <label className="inline"><input type="checkbox" checked={settings.experimentalStructural === true} disabled={!status?.capabilities?.experimentalStructural?.supported} onChange={event => setting('experimentalStructural', event.target.checked)} />明示理由の組み替え（実験・既定OFF）</label>
      {settings.experimentalStructural && <p className="note">標準・濃いめで、原文の「主張。理由からだ」を「理由から、主張」へ組み替えます。手書きの限定文法です。未対応の作用域は動かさず、自然さ・文体品質は未評価です。</p>}
      <details><summary>追加辞書</summary><p className="note">現在の本文変換は出典付きの規則に限定しています。自由な置換は適用せず、辞書を入力した場合は要確認として表示します。</p><label className="sr-only" htmlFor="dictionary">追加辞書</label><textarea id="dictionary" value={dictionary} rows={3} onChange={event => { invalidate(); setDictionary(event.target.value); }} placeholder="寒さ=冷え込み" /></details>
      <div className="actions"><button className="primary" disabled={busy || !status?.ready || !source.trim()} onClick={() => void submit()}>生成する <span>Ctrl + Enter</span></button>{busy && <button onClick={() => { invalidate(); setMessage('取消を要求しました。'); }}>中止</button>}</div>
      <label className="check"><input type="checkbox" checked={saveInput} onChange={event => { const enabled = event.target.checked; setSaveInput(enabled); localStorage.setItem('buront-v1-save', String(enabled)); if (enabled) localStorage.setItem('buront-v1-input', source); else localStorage.removeItem('buront-v1-input'); }} />このブラウザーに入力を保存する</label>
      {legacyStorage && <div className="notice">旧版の保存データが残っています。<button onClick={() => { for (const key of Object.keys(localStorage)) if (/buront|bront/i.test(key) && !key.startsWith('buront-v1-')) localStorage.removeItem(key); setLegacyStorage(false); }}>旧データを削除</button></div>}
    </section>
    <section className="results" aria-labelledby="output-title"><div className="section-top"><h2 id="output-title">02 <span>候補</span></h2><span>{result ? `${result.candidates.length} 案` : '—'}</span></div><p role="status" aria-live="polite" className="live-status">{message}</p>
      {!result && <div className="empty"><span>文の意味を保ち、<br/>言い回しを広げる。</span><p>原文との対応、操作の根拠、新規性の比較範囲を<br/>候補ごとに確認できます。</p></div>}
      {result?.shortfallReason && <div className="notice">{result.candidates.length ? '条件を満たす案だけを表示しています。' : '条件を満たす案がありません。原文を保持しました。'}<small>{result.shortfallReason === 'unsupported_generation_mode' ? 'この生成方式は未対応です。全文の限定変換・事実と順序を保持・登録構文の応用を選んでください。' : result.shortfallReason === 'dictionary_needs_review' ? '現在の本文変換には追加辞書を適用していません。辞書を空にして生成できます。' : result.shortfallReason === 'dictionary_rejected' ? '追加辞書が参照する人物や文の意味を変えたため、案を除外しました。' : result.shortfallReason === 'unsupported_relation' ? 'この入力・系列・濃さで適用できる、出典付き本文変換がありません。' : result.shortfallReason === 'no_novel_candidate' ? '現在の本文変換は既知構文の応用です。「登録構文・語句の応用」で確認できます。' : result.shortfallReason === 'candidate_shortage' ? '条件と多様性の検査を通った案だけを残しました。' : 'この入力に使える語彙・構成、または検査を通る案が不足しています。'}</small></div>}
      {result?.fallback && <pre className="output">{result.fallback.text}</pre>}
      {result?.candidates.map((candidate, index) => <button className={`candidate ${selectedId === candidate.id ? 'selected' : ''}`} key={candidate.id} aria-pressed={selectedId === candidate.id} onClick={() => { setSelectedId(candidate.id); setLocks([]); setOperator(''); }}><div><span>案 {index + 1} · {noveltyLabels[candidate.novelty.classification]}</span><strong>{selectedId === candidate.id ? '採用中' : 'この案を採用'}</strong></div><p>{candidate.text}</p></button>)}
      {!!result?.reviewCandidates.length && <details><summary>要確認の候補 {result.reviewCandidates.length} 件</summary>{result.reviewCandidates.map(candidate => <article key={candidate.id}><p>{candidate.text}</p><p className="note">{candidate.checks.filter(check => check.status !== 'pass').map(check => check.explanation).join(' / ')}</p></article>)}</details>}
      {selected && <><div className="inline"><button onClick={() => void act(() => navigator.clipboard.writeText(selected.text), '本文をコピーしました。評価ラベルは保存していません。')}>本文をコピー</button><button onClick={() => void act(() => api('/api/v1/history', { method: 'POST', body: JSON.stringify({ jobId, candidateId: selected.id }) }), '採用履歴をこのセッションに保存しました。')}>履歴に保存</button></div><CandidateDetails candidate={selected} ir={result!.ir} />
        <details><summary>部分再生成</summary><p className="note">固定する部分を選びます。候補全体を再検証します。</p>{selected.plan.nodes.filter(node => ['FactClause', 'RhetoricalClause', 'Reference'].includes(node.type)).map(node => <label className="check" key={node.id}><input type="checkbox" checked={locks.includes(node.id)} onChange={event => setLocks(previous => event.target.checked ? [...previous, node.id] : previous.filter(id => id !== node.id))} />{node.type === 'FactClause' ? `事実節「${[...node.text].slice(0, 22).join('')}${[...node.text].length > 22 ? '…' : ''}」` : node.id === 'main-quote' ? '中心句' : '結び'}を固定</label>)}<label>操作<select value={operator} onChange={event => setOperator(event.target.value)}><option value="">変更を任せる</option>{[selected.plan.mainOperator].map(id => <option key={id}>{id}</option>)}</select></label><button disabled={busy} onClick={() => void submit(true)}>固定して再生成</button></details></>}
      {result && <><details><summary>焦点・省略と再現資料</summary><p>採用範囲：{JSON.stringify(result.ir.adoptedSpans)} / 省略範囲：{JSON.stringify(result.ir.omittedSpans)}</p><p>{result.ir.topicOnly ? '話題のみ。事実を主張する一句ではありません。' : '採用範囲の事実節を保持しています。'}</p><p className="note">出力には原文、候補、辞書、比較履歴を含みます。</p><button onClick={() => download('buront-replay.json', result)}>本文を含む再現資料を保存</button></details>{result.candidates.length >= 2 && <button onClick={() => void act(async () => setComparison(await api('/api/v1/comparisons', { method: 'POST', body: JSON.stringify({ jobId }) })), '方式・順位を隠した比較を表示しました。')}>二案を比較評価する</button>}</>}
    </section></div>
    {comparison && <section className="comparison"><h2>比較評価</h2><p>順位や自動点数を見ず、観点を分けて回答してください。両案とも不適切、判断不能も記録できます。</p><div className="pair"><article><h3>左</h3><p>{comparison.left}</p></article><article><h3>右</h3><p>{comparison.right}</p></article></div><div className="settings"><label>観点<select value={dimension} onChange={event => setDimension(event.target.value)}><option value="S">S：語り口</option><option value="Q">Q：句の魅力</option><option value="C">C：意味保持</option></select></label><label>評価者ID<input value={annotator} onChange={event => setAnnotator(event.target.value)} /></label></div><label>判断理由<textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} /></label><div className="inline">{[['left', '左がよい'], ['right', '右がよい'], ['tie', '同点'], ['both_bad', '両方不適切'], ['cannot_judge', '判断不能']].map(([choice, label]) => <button key={choice} onClick={() => void act(() => api('/api/v1/preferences', { method: 'POST', body: JSON.stringify({ comparisonId: comparison.comparisonId, annotatorId: annotator, dimension, choice, reason }) }), '明示した評価を保存しました。')}>{label}</button>)}</div></section>}
    <footer><p>{status?.capabilities?.learnedStyle || status?.capabilities?.learnedQuoteability ? '実験版。S/Qは学習済みの観点だけ相対選好点を表示します。確率ではありません。' : '実験版。語り口 S・魅力 Q は未学習です。'}現在の候補は登録構文・語句の応用であり、新作性や自然さの評価は未完了です。入力保存は初期状態でオフ。履歴に保存した候補だけが、以後の新規性比較に加わります。</p><div className="inline"><button onClick={() => void act(async () => download('buront-evaluation.json', await api('/api/v1/export')), '本文を含む履歴・評価資料を出力しました。')}>本文を含む履歴・評価を出力</button><button onClick={() => void act(async () => { invalidate(); await api('/api/v1/history', { method: 'DELETE' }); }, '履歴・評価・生成結果を削除しました。')}>履歴と評価を削除</button></div></footer>
    </>}
  </main>;
}
const actLabels: Record<string, string> = { observation: '状況', achievement: '成果', unresolved: '残件', prospect: '予定', gratitude: '感謝', warning: '注意', rebuttal: '反論', self_justification: '自己弁護', reported: '発言', conditional: '条件' };
const anchorLabels: Record<string, string> = { reply: '返信', evaluation: '評価', agreement: '同意', evidence: '根拠', vocative: '呼びかけ', gratitude: '感謝', unknown: '用途未確定' };
const constructionLabels: Record<string, string> = { plain: '標準', explanation: '説明を添える', digression: '説明から一言を添える', inference: '「つまり」でまとめる', parenthetical: '括弧で補足する', be_question: '「だべ？」で問いかける', question: '「だろう」で問いかける' };
function CandidateDetails({ candidate, ir }: { candidate: Candidate; ir: DocumentIR }) {
  const { plan } = candidate;
  const displayOrder = plan.structural && plan.narrative ? plan.structural.emissionOrder.map(id => plan.narrative!.sourceOrder[plan.structural!.sourceOrder.indexOf(id)]) : plan.narrative?.displayOrder ?? [];
  const sourceSlice = (span: { start: number; end: number }) => [...ir.source.raw].slice(span.start, span.end).join('');
  return <div className="candidate-details">
    <p className="note">{candidate.verificationScope}</p>
    <details><summary>構成と焦点</summary>
      {plan.intentPlan && <p>中心句の焦点：{actLabels[plan.intentPlan.act]} — {sourceSlice(plan.intentPlan.targetSpan)}</p>}
      {plan.narrative && <><p>{plan.structural ? '原文の節を型付きスロットとして保持し、明示理由の実現計画に従って次の表示順へ並べています。原文順と表示順は別々に検査しています。' : plan.narrative.orderingReason}</p><ol className="narrative-list">{displayOrder.map(id => {
        const unit = plan.narrative!.units.find(unit => unit.id === id)!;
        return <li key={id}><strong>{actLabels[unit.role]}</strong><span className="note">原文の {plan.narrative!.sourceOrder.indexOf(id) + 1} 番目</span><p>{sourceSlice(unit.sourceSpan)}</p></li>;
      })}</ol></>}
      {!!ir.anchors.length && <p>参照：{ir.anchors.map(anchor => `${anchor.raw}（${anchorLabels[anchor.usage]}）`).join('、')}</p>}
      {plan.surface && <p className="note">語り方：{constructionLabels[plan.surface.constructionId] ?? plan.surface.constructionId}。語法の用例と、新しく組み立てた句は区別しています。</p>}
    </details>
    <details><summary>原文との対応・検査</summary>
      <p className="legend">緑：原文の保持。青：出典付きの語句変換または検証された文法操作。黄：追加した修辞。紫：別文の引用。</p>
      <p className="annotated">{candidate.spans.map((span, index) => <mark className={span.origin === 'source_fact' ? 'fact' : span.origin === 'paraphrase' ? 'paraphrase' : span.origin === 'direct_quote' ? 'quotation' : 'rhetoric'} key={index} title={`${span.origin} ${span.sourceSpan ? JSON.stringify(span.sourceSpan) : ''}`}>{[...candidate.text].slice(span.span.start, span.span.end).join('')}</mark>)}</p>
      <ul>{candidate.checks.map(check => <li key={check.code}><strong>{check.status === 'pass' ? '確認' : check.status === 'fail' ? '不適合' : '未確認'} · {check.code}</strong> {check.explanation}</li>)}</ul>
    </details>
    {plan.structural && <details><summary>実験的な構造操作</summary><p className="note">学習済みのブロント構文ではなく、原文の明示理由を使う手書き文法です。述語・否定・時制を原文のまま射影し、局所の語句変換だけを別途合成します。</p><ul>{plan.structural.bindings.map(binding => <li key={binding.id}>{binding.realizationId === 'reason-claim' ? '理由を主張の前へ移し、から＋読点で接続' : '主張と理由の順序を保ち、出典のある「何故なら」を付加'}</li>)}</ul></details>}
    {plan.construction && <details><summary>登録構文の変更箇所</summary><p className="note">原文から束縛した語と事実の特徴を使う、閉じた登録構文です。自由な創作や一般的な意味同値性の保証ではありません。</p><ul>{plan.construction.edits.map((edit, index) => <li key={index}><strong>「{edit.from}」→「{edit.to}」</strong><p className="note">{edit.constructionId} / {candidate.evidence.find(item => edit.evidenceIds.includes(item.id))?.text}</p></li>)}</ul></details>}
    {!!(plan.rewrite?.edits.length || plan.construction?.lexicalEdits.length || plan.structural?.lexicalEdits.length) && <details><summary>語句の変更箇所</summary><p className="note">出典は収録ログでの使用例です。語の発祥やブロント語固有の表現であることを示すものではありません。</p><ul>{(plan.rewrite?.edits ?? plan.construction?.lexicalEdits ?? plan.structural?.lexicalEdits ?? []).map((edit, index) => <li key={index}><strong>「{edit.from}」→{edit.to === '\n' ? '改行' : edit.to === '' ? '削除' : `「${edit.to}」`}</strong><p className="note">{candidate.evidence.find(item => edit.evidenceIds.includes(item.id))?.text}</p></li>)}</ul></details>}
    <details><summary>語り方・根拠・新規性</summary>
      <p>{plan.mainOperator} / {actLabels[plan.intent] ?? plan.intent} / {plan.family}</p><p>{plan.backTranslation}</p>
      <p>S：{candidate.scores.S === null ? '未学習' : candidate.scores.S.toFixed(2)}　Q：{candidate.scores.Q === null ? '未学習' : candidate.scores.Q.toFixed(2)}　長さ・構成：規則検査（自然さは未評価）</p><p>{candidate.novelty.window}</p>
      {candidate.evidence.map(item => <blockquote key={item.id}><small>{item.kind === 'direct_quote' ? '原句の引用' : item.kind === 'construction_evidence' ? '語法の用例' : '語彙の用例'}</small><p>{item.text}</p>{item.url && /^https?:\/\//u.test(item.url) && <a href={item.url} rel="noreferrer" target="_blank">出典を確認</a>}</blockquote>)}
    </details>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
