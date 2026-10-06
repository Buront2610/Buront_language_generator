"""Non-generative span refinement inside documented original/adaptation windows.

Lexical/positional matching is a tool-produced alignment, never a meaning label.
Every output span still slices an existing cached published document verbatim.
"""
from __future__ import annotations
import copy
import difflib
import hashlib
import json
import math
import re
import unicodedata
from pathlib import Path

ALIGNMENT_VERSION = 'monotonic-lexical-span-v1'

def _comparison(text):
    return ''.join(unicodedata.normalize('NFKC',text).casefold().split())

def sentence_spans(text,start,end):
    units=[];stack=[];cursor=start
    pairs={'「':'」','『':'』','“':'”'}
    def append(stop):
        nonlocal cursor
        a,b=cursor,stop
        while a<b and text[a].isspace():a+=1
        while b>a and text[b-1].isspace():b-=1
        if a<b:units.append((a,b))
        cursor=stop
    for i in range(start,end):
        c=text[i]
        if c in pairs:stack.append(pairs[c])
        elif stack and c==stack[-1]:stack.pop()
        elif c=='"':
            if stack and stack[-1]=='"':stack.pop()
            else:stack.append('"')
        if not stack and (c in '。！？!?\n'):
            append(i+1)
    append(end)
    return units

def align_windows(source,target,source_span,target_span,max_chars=320,min_similarity=.35):
    a=sentence_spans(source,*source_span);b=sentence_spans(target,*target_span)
    if len(a)>500 or len(b)>500:raise ValueError('ALIGNMENT_UNIT_LIMIT')
    clusters_a={(i,n):(a[i][0],a[i+n-1][1]) for i in range(len(a)) for n in (1,2) if i+n<=len(a)}
    clusters_b={(j,n):(b[j][0],b[j+n-1][1]) for j in range(len(b)) for n in (1,2) if j+n<=len(b)}
    norm_a={k:_comparison(source[x:y]) for k,(x,y) in clusters_a.items()}
    norm_b={k:_comparison(target[x:y]) for k,(x,y) in clusters_b.items()}
    scores={};back={};best={(0,0):0.0}
    def update(i,j,score,previous,action):
        if score>best.get((i,j),-math.inf):best[i,j]=score;back[i,j]=(previous,action)
    for i in range(len(a)+1):
        for j in range(len(b)+1):
            value=best.get((i,j),-math.inf)
            if value==-math.inf:continue
            if i<len(a):update(i+1,j,value-.15,(i,j),('skip_source',i))
            if j<len(b):update(i,j+1,value-.15,(i,j),('skip_target',j))
            for na in (1,2):
                for nb in (1,2):
                    ka,kb=(i,na),(j,nb)
                    if ka not in clusters_a or kb not in clusters_b:continue
                    aa,bb=clusters_a[ka],clusters_b[kb]
                    if max(aa[1]-aa[0],bb[1]-bb[0])>max_chars:continue
                    sa,sb=norm_a[ka],norm_b[kb]
                    if not sa or not sb or not .25<=len(sa)/len(sb)<=4:continue
                    score=difflib.SequenceMatcher(None,sa,sb,autojunk=False).ratio()
                    if score<min_similarity:continue
                    scores[ka,kb]=score
                    update(i+na,j+nb,value+score*2-.65-.12*(na+nb-2),(i,j),('match',ka,kb))
    result=[];skipped_a=skipped_b=0;cursor=(len(a),len(b))
    while cursor!=(0,0):
        previous,action=back[cursor]
        if action[0]=='match':
            ka,kb=action[1:];result.append({'source':clusters_a[ka],'target':clusters_b[kb],'lexical_similarity':scores[ka,kb]})
        elif action[0]=='skip_source':skipped_a+=1
        else:skipped_b+=1
        cursor=previous
    result.reverse()
    return result,{'source_units':len(a),'target_units':len(b),'unmatched_source_units':skipped_a,'unmatched_target_units':skipped_b}

def refine_manifest(manifest_path,out_path,report_path):
    manifest_path=Path(manifest_path).resolve();out_path=Path(out_path);report_path=Path(report_path)
    if out_path.exists() or report_path.exists() or out_path.resolve()==report_path.resolve():raise ValueError('OUTPUT_ALREADY_EXISTS')
    if out_path.resolve().is_relative_to(Path(__file__).resolve().parents[2]) or report_path.resolve().is_relative_to(Path(__file__).resolve().parents[2]):raise ValueError('DOCUMENTARY_REFINEMENT_MUST_BE_OUTSIDE_REPOSITORY')
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    # Full documentary validation occurs at intake. Verify the text used here,
    # and retain normalized absolute cache paths when writing beside another file.
    texts={}
    for doc in manifest['documents']:
        for field in ('raw_path','text_path'):
            path=Path(doc[field]);path=path if path.is_absolute() else manifest_path.parent/path
            doc[field]=str(path.resolve())
        raw=Path(doc['text_path']).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=doc['text_sha256']:raise ValueError('DOCUMENTARY_TEXT_HASH_MISMATCH')
        texts[doc['document_id']]=raw.decode('utf-8')
    rows=[];details=[]
    for index,pair in enumerate(manifest['pairs']):
        s,t=pair['source'],pair['target'];sa=(s['start'],s['end']);ta=(t['start'],t['end'])
        source,target=texts[s['document_id']],texts[t['document_id']]
        if not 0<=sa[0]<sa[1]<=len(source) or not 0<=ta[0]<ta[1]<=len(target):raise ValueError('DOCUMENTARY_SPAN_INVALID')
        if max(sa[1]-sa[0],ta[1]-ta[0])<=240:
            rows.append(copy.deepcopy(pair));details.append({'parent_index':index,'mode':'retained_documented_window','pairs':1});continue
        matched,diagnostics=align_windows(source,target,sa,ta)
        for item in matched:
            child=copy.deepcopy(pair)
            child['source']={**s,'start':item['source'][0],'end':item['source'][1]}
            child['target']={**t,'start':item['target'][0],'end':item['target'][1]}
            for side,document in (('source',source),('target',target)):
                span=child[side]
                if 'sha256_utf8' in span:
                    span['sha256_utf8']=hashlib.sha256(document[span['start']:span['end']].encode('utf-8')).hexdigest()
            child['alignment']={'method':'tool','notes':f'{ALIGNMENT_VERSION}; lexical_similarity={item["lexical_similarity"]:.6f}; comparison-only NFKC/casefold/whitespace; teacher text is unchanged document slice; not semantic equivalence'}
            previous_notes=pair.get('notes',[])
            if isinstance(previous_notes,str):previous_notes=[previous_notes]
            child['notes']=[*previous_notes,f'Parent manifest SHA256 {hashlib.sha256(manifest_path.read_bytes()).hexdigest()}; pair index {index}; source span {sa}; target span {ta}; any unmatched inserted content omitted by alignment, not rewritten']
            rows.append(child)
        details.append({'parent_index':index,'work_id':pair['work_id'],'mode':'tool_refined','pairs':len(matched),**diagnostics})
    manifest['pairs']=rows
    report={'schema_version':1,'version':ALIGNMENT_VERSION,'source_manifest_sha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),'input_passage_pairs':len(details),'output_paired_spans':len(rows),'details':details,'semantic_review_status':'unreviewed','human_quality_labels':0,'note':'Lexical/positional alignment of existing published strings; no generated teacher text or inferred human reviews.'}
    for path,value in ((out_path,manifest),(report_path,report)):
        path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('x',encoding='utf-8') as stream:json.dump(value,stream,ensure_ascii=False,indent=2);stream.write('\n')
    return report
