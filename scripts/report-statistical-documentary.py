"""Produce metadata/aggregate-only documentary research evidence; never corpus/weights."""
import collections
import gzip
import hashlib
import json
import sys
from pathlib import Path

root, out = map(Path, sys.argv[1:3])
out.mkdir(parents=True, exist_ok=True)
def load(path): return json.loads(Path(path).read_text(encoding='utf-8'))
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(name, obj): (out/name).write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
manifest=load(root/'paired-spans-v2.json'); rows=load(root/'model-v3/pairs.json'); split=load(root/'frozen-split.json')
research=load(root/'comparison-v3/research.json'); baseline=load(root/'comparison-v3/baseline.json')
diag=load(root/'model-v3/training-diagnostics.json'); used={r['pair_id'] for r in load(root/'model-v3/training-rows.json')}
source_lookup={r['ordinary_text']:r for r in rows}
source_catalog={'schema_version':1,'scope':'metadata_only_no_corpus_or_weights',
 'documents':[{k:d[k] for k in ('document_id','url','title','version','retrieved_at','raw_kind','raw_sha256','text_sha256','authorship_evidence','rights')} for d in manifest['documents']],
 'works':[{**{k:w[k] for k in ('work_id','title','original_author','source_document_ids','adaptation_document_ids','version_status')},'family_ids':w.get('family_ids',[])} for w in manifest['works']],
 'source_manifest_sha256':sha(root/'source-manifest.json'),'paired_manifest_sha256':sha(root/'paired-spans-v2.json'),'meaning_review':'unreviewed','human_quality_labels':0,
 'rights_notice':'Unknown license is not clearance. Published-human attribution and hashes do not prove semantic equivalence or permission. No protected full text or memorizing weights included.'}
save('source-catalog.json',source_catalog)
counts=collections.Counter(); diagnostics=collections.Counter(); by_work={}
for row,old in zip(research['inputs'],baseline['inputs']):
 assert row['source']==old['source']
 candidates=row['candidates']; seen={c['text'] for c in old['candidate_pool']}|{row['source']}; fresh=[c for c in candidates if c['text'] not in seen]
 wid=source_lookup[row['source']]['source']['work']['work_id']; wc=by_work.setdefault(wid,collections.Counter())
 wc['cases']+=1;wc['baseline_cases_with_candidates']+=bool(old['candidate_pool']);wc['research_cases_with_new_text']+=bool(fresh);wc['research_cases_with_nonrejected_new_text']+=any(c['status']!='rejected_by_diagnostics' for c in fresh)
 counts['test_cases']+=1;counts['raw_research_candidates']+=len(candidates);counts['per_case_new_texts']+=len(fresh);counts['cases_with_new_text']+=bool(fresh);counts['cases_with_nonrejected_new_text']+=any(c['status']!='rejected_by_diagnostics' for c in fresh);counts['baseline_pool']+=len(old['candidate_pool']);counts['baseline_displayed']+=len(old['displayed']);counts['baseline_cases_with_candidates']+=bool(old['candidate_pool'])
 for candidate in candidates:
  counts[candidate['status']]+=1
  for item in candidate['diagnostics']:diagnostics[item['kind']]+=1
save('metrics.json',{'schema_version':1,'source_documents':len(manifest['documents']),'original_work_families':len(manifest['works']),
 'documented_parent_passages':len(load(root/'source-manifest.json')['pairs']),'derived_exact_span_pairs':len(rows),'split_counts':split['counts'],'split_work_counts':split['work_counts'],
 'train_offered':diag['offered_training_pairs'],'train_used':diag['used_training_pairs'],'train_protected_inventory_excluded':len(diag['rejected_training_pairs']),
 'scored_phrase_pairs':sum(1 for _ in gzip.open(root/'model-v3/moses/model/phrase-table.gz','rt')),
 'distinct_test_input_strings':len({r['source'] for r in research['inputs']}),'counts':dict(counts),'diagnostics':dict(diagnostics),'by_held_out_work':{k:dict(v) for k,v in by_work.items()},
 'human_quality_reviews':0,'meaning_preserving_good_candidate_rate':None,'quality_improvement':None,'production_enabled':False,
 'baseline_request':{'task':'rewrite','contextMode':'faithful','noveltyMode':'blend','intensity':2,'series':'all','backend':'structured'},
 'limits':['Case rows are not independent human-quality trials;65cases include64distinct strings and2held-out works','Candidate novelty is a string metric, not meaning preservation or style quality','Documentary adaptations are noisy and may deliberately change facts, roles and viewpoint','Fully-protected-input insertion diagnostic was added after first test exposure; no prospective claim','Initial unsupported invent-mode baseline comparison is invalid and excluded from final coverage']})
examples=[]
# Fixed short examples from a public-domain original; generated outputs are copied
# exactly from the decoder log, not written or labeled by an assistant.
for text in ('と書いてありました。','犬がふうとうなって戻ってきました。','WILDCAT HOUSE'):
 row=next(r for r in research['inputs'] if r['source']==text); old=next(r for r in baseline['inputs'] if r['source']==text); meta=source_lookup[text]; candidate=row['candidates'][0]
 examples.append({'case_id':meta['pair_id'],'original_input':text,'original_source_url':meta['source']['original']['url'],
  'baseline_displayed':[x['text'] for x in old['displayed']],'baseline_fallback':old['fallback']['text'] if old['fallback'] else None,
  'research_decoder_rank':1,'research_candidate':candidate['text'],'candidate_id':candidate['id'],'diagnostic_status':candidate['status'],
  'diagnostics':[d['kind'] for d in candidate['diagnostics']],'kenlm_oov_rate':candidate['kenlm']['oov_rate'],'human_review':None})
save('short-examples.json',{'schema_version':1,'selection':'Three short public-domain-original cases with actual rank1 outputs, including one unchanged case. Descriptive examples, not a random quality sample or LLM quality labels.','examples':examples})
with (out/'pair-locators.jsonl').open('w',encoding='utf-8') as stream:
 for row in rows:
  source=row['source']; item={'pair_id':row['pair_id'],'work_id':source['work']['work_id'],'split':split['assignments'][row['pair_id']],'used_for_training':row['pair_id'] in used,
   'original':{k:source['original'][k] for k in ('document_id','start','end','text_sha256')},
   'adaptation':{k:source['adaptation'][k] for k in ('document_id','start','end','text_sha256')},'semantic_review_status':'unreviewed'}
  stream.write(json.dumps(item,ensure_ascii=False,separators=(',',':'))+'\n')
save('reproducibility.json',{'schema_version':1,'baseline_commit':baseline['revision'],'baseline_source_hash':baseline['source_hash'],'baseline_adapter_sha256':baseline['adapter_sha256'],
 'model_manifest_sha256':sha(root/'model-v3/manifest.json'),'frozen_split_sha256':sha(root/'frozen-split.json'),'model_implementation_sha256':load(root/'model-v3/manifest.json')['implementation_sha256'],
 'toolchain_sha256':sha(root/'model-v3/toolchain.json'),'training_artifact_sha256':{name:sha(root/'model-v3'/name) for name in ('train.f','train.e','forward.align','reverse.align','aligned.grow-diag-final-and','target.arpa','target.klm','phrase-provenance.json')},
 'private_outputs_sha256':{name:sha(root/'comparison-v3'/name) for name in ('research.json','baseline.json','review.blank.json','review.private.json','summary.json')},
 'private_outputs_bytes':{name:(root/'comparison-v3'/name).stat().st_size for name in ('research.json','baseline.json')},'source_corpus_and_weights_included':False,'remote_publication':'This local reporter does not publish. Corpus/weights are excluded; exact published revision and CI are reported on the PR.'})
print(json.dumps(dict(counts),ensure_ascii=False))
