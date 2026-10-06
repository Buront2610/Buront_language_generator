"""Candidate-pool comparison, blank blinded human review, and strict label import."""
from __future__ import annotations
import json
import subprocess
from pathlib import Path
from .pipeline import decode_inputs, digest, read_json, run, sha, verify_model, write_json

def evaluate(model, repo, out):
    out = Path(out).resolve()
    if out.exists(): raise ValueError("OUTPUT_ALREADY_EXISTS")
    model, manifest, _, _ = verify_model(model)
    if manifest["status"] == "documentary_parallel_unreviewed" and (out.is_relative_to(Path(repo).resolve()) or out.is_relative_to(Path(__file__).resolve().parents[2])):
        raise ValueError("DOCUMENTARY_COMPARISON_MUST_BE_OUTSIDE_REPOSITORY")
    rows = read_json(model/"pairs.json"); split_ids = read_json(model/"splits.json")
    tests = [r for r in rows if r["pair_id"] in split_ids["test"]]
    if not tests: raise ValueError("TEST_INPUTS_REQUIRED")
    out.mkdir(parents=True)
    inputs = [r["ordinary_text"] for r in tests]
    write_json(out/"inputs.json",inputs)
    research = decode_inputs(model, inputs)
    write_json(out/"research.json",research)
    run(["node",Path(__file__).with_name("baseline.cjs"),Path(repo).resolve(),out/"inputs.json",out/"baseline.json"],out/"baseline.log",timeout=1200)
    baseline = read_json(out/"baseline.json")
    if len(research["inputs"]) != len(tests) or len(baseline["inputs"]) != len(tests):
        raise ValueError("COMPARISON_INPUT_COUNT_MISMATCH")
    pack, private, metrics = [], [], []
    for row, new, old in zip(tests,research["inputs"],baseline["inputs"]):
        if new["source"] != row["ordinary_text"] or old["source"] != row["ordinary_text"]:
            raise ValueError("COMPARISON_INPUT_MISMATCH")
        if (old.get("fallback") or {}).get("reason") == "unsupported_generation_mode":
            raise ValueError("BASELINE_UNSUPPORTED_MODE")
        baseline_candidates = list(old["candidate_pool"])
        if old.get("fallback"):
            baseline_candidates.append({"text":old["fallback"]["text"]})
        baseline_texts = {c["text"] for c in baseline_candidates} | {new["source"]}
        by_text = {}
        for method, candidates in (("baseline",baseline_candidates),("research",new["candidates"])):
            for c in candidates:
                entry=by_text.setdefault(c["text"],{"methods":[],"diagnostics":[],"eligible_research":False})
                if method not in entry["methods"]: entry["methods"].append(method)
                if method == "research":
                    entry["diagnostics"].extend(c["diagnostics"])
                    entry["eligible_research"] |= c["status"] == "needs_human_review"
        case_id=row["pair_id"]
        # Blinding hides method and score, not the source needed to assess preservation.
        candidates=[]
        for text, info in sorted(by_text.items(),key=lambda kv:digest({"case":case_id,"candidate":kv[0]})):
            if text == new["source"]: info["methods"].append("input_copy")
            cid=digest({"case":case_id,"text":text})[:24]
            candidates.append({"candidate_id":cid,"text":text,"meaning_preserved":None,"buront_style_good":None,"readable":None,"reason":""})
            private.append({"case_id":case_id,"candidate_id":cid,**info})
        pack.append({"case_id":case_id,"input":new["source"],"group":row.get("lineage",{}).get("component_id",case_id),"candidates":candidates})
        metrics.append({"case_id":case_id,"baseline_pool":len(old["candidate_pool"]),"research_pool":len(new["candidates"]),"distinct_new_texts":len({c["text"] for c in new["candidates"]}-baseline_texts),"diagnostic_rejections":sum(c["status"]=="rejected_by_diagnostics" for c in new["candidates"]),"human_confirmed_new_good_candidates":None})
    blind={"schema_version":1,"purpose":"mechanical_wiring_only" if manifest["status"]=="mechanical_wiring_only" else "documentary_candidate_pool_human_review" if manifest["status"]=="documentary_parallel_unreviewed" else "candidate_pool_human_review","annotation":{"author_type":"","annotator_id":"","no_llm_or_synthetic":False},"cases":pack}
    # Hash covers immutable rendered review content only; label slots remain blank.
    blind["review_content_sha256"]=review_content_hash(blind)
    write_json(out/"review.blank.json",blind)
    write_json(out/"review.private.json",{"schema_version":1,"review_content_sha256":blind["review_content_sha256"],"candidate_origins":private,"baseline_sha256":sha(out/"baseline.json"),"research_sha256":sha(out/"research.json"),"test_pair_ids":[r["pair_id"] for r in tests]})
    summary={"schema_version":1,"purpose":blind["purpose"],"training_source_kind":manifest.get("corpus_kind"),"meaning_correspondence":"unreviewed_documentary_pairs" if manifest["status"]=="documentary_parallel_unreviewed" else "see_pair_provenance","model_manifest_sha256":sha(model/"manifest.json"),"baseline_revision":baseline["revision"],"input_count":len(inputs),"metrics":metrics,"human_reviews":0,"quality_gain":None,"acceptance":"not_evaluated_no_human_judgments","note":"Text novelty and successful binary execution are not meaning preservation or quality improvement. No LightGBM ranker is trained."}
    write_json(out/"summary.json",summary)
    return summary

def review_content_hash(pack):
    return digest({"purpose":pack["purpose"],"cases":[{"case_id":c["case_id"],"input":c["input"],"group":c["group"],"candidates":[{"candidate_id":x["candidate_id"],"text":x["text"]} for x in c["candidates"]]} for c in pack["cases"]]})

def summarize_reviews(comparison, reviewed):
    comparison=Path(comparison); private=read_json(comparison/"review.private.json"); pack=read_json(reviewed)
    if pack.get("purpose") not in ("candidate_pool_human_review","documentary_candidate_pool_human_review"): raise ValueError("MECHANICAL_FIXTURE_NOT_QUALITY_EVIDENCE")
    if review_content_hash(pack)!=private["review_content_sha256"] or pack.get("review_content_sha256")!=private["review_content_sha256"]:
        raise ValueError("REVIEW_CONTENT_MISMATCH")
    for filename,field in (("baseline.json","baseline_sha256"),("research.json","research_sha256")):
        if sha(comparison/filename)!=private[field]: raise ValueError("COMPARISON_ARTIFACT_MISMATCH")
    ann=pack.get("annotation",{})
    if ann.get("author_type")!="human" or not ann.get("annotator_id","").strip() or ann.get("no_llm_or_synthetic") is not True:
        raise ValueError("HUMAN_REVIEW_REQUIRED")
    mapping={(r["case_id"],r["candidate_id"]):r for r in private["candidate_origins"]}
    cases=[]
    for case in pack["cases"]:
        new_good=[]; completed=0
        for c in case["candidates"]:
            judgments=[c.get(k) for k in ("meaning_preserved","buront_style_good","readable")]
            if any(v is not None and type(v) is not bool for v in judgments): raise ValueError("INVALID_HUMAN_JUDGMENT")
            if any(v is None for v in judgments): continue
            completed+=1
            origin=mapping[(case["case_id"],c["candidate_id"])]
            if all(judgments) and origin["methods"]==["research"] and origin["eligible_research"]:
                new_good.append(c["candidate_id"])
        cases.append({"case_id":case["case_id"],"group":case["group"],"reviewed_candidates":completed,"candidate_count":len(case["candidates"]),"new_good_candidate_ids":new_good})
    complete=[c for c in cases if c["reviewed_candidates"]==c["candidate_count"] and c["candidate_count"]>0]
    return {"schema_version":1,"annotator_id":ann["annotator_id"],"reviewed_content_sha256":private["review_content_sha256"],"cases":cases,"fully_reviewed_inputs":len(complete),"inputs_with_new_good_candidate":sum(bool(c["new_good_candidate_ids"]) for c in complete),"rate":sum(bool(c["new_good_candidate_ids"]) for c in complete)/len(complete) if complete else None,"uncertainty":"Descriptive personal human judgment only; dependent inputs within the same source group are not independent trials. No general quality claim or statistical significance is established.","production_enabled":False,"ranker_trained":False}
