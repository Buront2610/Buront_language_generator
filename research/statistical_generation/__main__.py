"""Run with the project's pinned Python environment: python -m research.statistical_generation."""
from __future__ import annotations
import argparse
import itertools
import json
import sys
from pathlib import Path
from .data import audit_sources, export_annotations, load_annotations, make_split, validate_pairs, validate_split
from .pipeline import decode_inputs, read_json, train, write_json
from .evaluation import evaluate, summarize_reviews

REPO = Path(__file__).resolve().parents[2]

def exclusive_json(path, value):
    path=Path(path)
    if path.exists(): raise ValueError("OUTPUT_ALREADY_EXISTS")
    path.parent.mkdir(parents=True,exist_ok=True)
    write_json(path,value)

def fixture_rows():
    # Algorithmic symbol substitution is a plumbing test, not natural language,
    # not human parallel data, and not a learned Buront capability claim.
    source_atoms = ["ax","bx","cx","dx"]
    target_atoms = ["az","bz","cz","dz"]
    mapping=dict(zip(source_atoms,target_atoms))
    rows=[]
    for i,atoms in enumerate(itertools.product(source_atoms,repeat=2)):
        rows.append({"pair_id":f"mechanical-{i:03d}","ordinary_text":" ".join(atoms),"original_text":" ".join(mapping[a] for a in atoms),"provenance":"algorithmic-token-map-fixture-not-human-not-language","source":None})
    # Fixture-only split on atomic test sequence. Deliberately NOT a linguistic
    # source-family holdout; the manifest labels this distinction explicitly.
    return rows,{"train":rows[:14],"dev":[rows[14]],"test":[rows[15]]}

def main(argv=None):
    parser=argparse.ArgumentParser(description="Isolated Moses+fast_align+KenLM research. Human data required; no production switch.")
    parser.add_argument("--repo",type=Path,default=REPO)
    sub=parser.add_subparsers(dest="command",required=True)
    sub.add_parser("audit")
    p=sub.add_parser("export-annotations");p.add_argument("--out",required=True);p.add_argument("--limit",type=int,default=12)
    p=sub.add_parser("import-csv");p.add_argument("--template",required=True);p.add_argument("--csv",required=True);p.add_argument("--out",required=True);p.add_argument("--report",required=True)
    p=sub.add_parser("split");p.add_argument("--pairs",required=True);p.add_argument("--out",required=True);p.add_argument("--seed",required=True)
    p=sub.add_parser("train");p.add_argument("--pairs",required=True);p.add_argument("--split",required=True);p.add_argument("--tools",required=True);p.add_argument("--out",required=True)
    p=sub.add_parser("documentary-audit");p.add_argument("--manifest",required=True)
    p=sub.add_parser("documentary-split");p.add_argument("--manifest",required=True);p.add_argument("--seed",required=True);p.add_argument("--out",required=True)
    p=sub.add_parser("train-documentary");p.add_argument("--manifest",required=True);p.add_argument("--split",required=True);p.add_argument("--tools",required=True);p.add_argument("--out",required=True)
    p=sub.add_parser("smoke");p.add_argument("--tools",required=True);p.add_argument("--out",required=True)
    p=sub.add_parser("decode");p.add_argument("--model",required=True);p.add_argument("--source",required=True);p.add_argument("--out",required=True)
    p=sub.add_parser("evaluate");p.add_argument("--model",required=True);p.add_argument("--out",required=True)
    p=sub.add_parser("summarize-reviews");p.add_argument("--comparison",required=True);p.add_argument("--reviewed",required=True);p.add_argument("--out",required=True)
    a=parser.parse_args(argv)
    if a.command=="audit": result=audit_sources(a.repo)
    elif a.command=="export-annotations": result=export_annotations(a.repo,Path(a.out),a.limit)
    elif a.command=="import-csv":
        from .csv_import import import_csv
        result=import_csv(a.template,a.csv,a.repo,a.out,a.report)
    elif a.command=="split":
        rows=validate_pairs(load_annotations(a.pairs),a.repo)
        result=make_split(rows,a.seed);exclusive_json(a.out,result)
    elif a.command=="train":
        rows=validate_pairs(load_annotations(a.pairs),a.repo)
        split_manifest=read_json(a.split)
        splits=validate_split(rows,split_manifest)
        result=train(rows,splits,a.out,a.tools,split_manifest=split_manifest,repo=a.repo)
    elif a.command in ("documentary-audit","documentary-split","train-documentary"):
        from .documentary import load_documentary_pairs, make_documentary_split, validate_documentary_split
        rows=load_documentary_pairs(a.manifest,repo=a.repo)
        if a.command=="documentary-audit":
            result={"mode":"documentary_published_pairs","pairs":len(rows),"semantic_review_status":"unreviewed","human_quality_labels":0,"source_kind":"literary_adaptation","publication":"not_authorized","manifest_path":str(Path(a.manifest).resolve())}
        elif a.command=="documentary-split":
            result=make_documentary_split(rows,a.seed);exclusive_json(a.out,result)
        else:
            frozen=read_json(a.split)
            splits=validate_documentary_split(rows,frozen,a.manifest,repo=a.repo)
            result=train(rows,splits,a.out,a.tools,split_manifest=frozen,repo=a.repo,documentary_manifest=a.manifest)
    elif a.command=="smoke":
        root=Path(a.out)
        if root.exists(): raise ValueError("OUTPUT_ALREADY_EXISTS")
        root.mkdir(parents=True)
        rows,splits=fixture_rows()
        manifest=train(rows,splits,root/"model",a.tools,mechanical=True)
        decoded=decode_inputs(root/"model",[r["ordinary_text"] for r in splits["test"]])
        write_json(root/"decode.json",decoded)
        observed=decoded["inputs"][0]["candidates"]
        target=splits["test"][0]["original_text"]
        if not any(c["text"]==target and c["status"]=="needs_human_review" for c in observed):
            raise ValueError("MECHANICAL_WIRING_EXPECTATION_FAILED")
        result={"status":"passed_mechanical_wiring_only","human_training_pairs":0,"human_quality_labels":0,"buront_quality_tested":False,"fixture_expected":target,"fixture_observed":[c["text"] for c in observed],"training_rows":manifest["training_pair_count"],"model_status":manifest["status"]}
        write_json(root/"smoke-report.json",result)
    elif a.command=="decode": result=decode_inputs(a.model,[a.source]);exclusive_json(a.out,result)
    elif a.command=="evaluate": result=evaluate(a.model,a.repo,a.out)
    else: result=summarize_reviews(a.comparison,a.reviewed);exclusive_json(a.out,result)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    try: main()
    except (ValueError,KeyError,FileNotFoundError) as e:
        print(json.dumps({"error":str(e)},ensure_ascii=False),file=sys.stderr);sys.exit(2)
