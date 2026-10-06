"""Real fast_align/Moses/KenLM orchestration. No translation implementation here."""
from __future__ import annotations
import collections
import gzip
import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
from pathlib import Path
from .text import Tokenizer, decode

MODEL_VERSION = "moses-human-parallel-research-v1"
FEATURE_VERSION = "moses-kenlm-surface-diagnostics-v2"
REQUIRED_TOOLS = ("fast_align", "atools", "moses", "extract", "train_model", "score", "consolidate", "lmplz", "build_binary", "query")

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def toolchain(path):
    value = read_json(path)
    if value.get("schema_version") != 1:
        raise ValueError("INVALID_TOOLCHAIN_SCHEMA")
    lock_file = Path(__file__).with_name("dependencies.lock.json")
    lock = read_json(lock_file)
    expected_commits = {name: info["commit"] for name, info in lock["repositories"].items()}
    if value.get("commits") != expected_commits or value.get("dependency_lock_sha256") != sha(lock_file):
        raise ValueError("DEPENDENCY_LOCK_MISMATCH")
    if not value.get("helper_script_sha256") or not value.get("system_tool_sha256"):
        raise ValueError("TOOLCHAIN_HELPER_HASHES_REQUIRED")
    for name in REQUIRED_TOOLS:
        p = Path(value["executables"][name]).resolve()
        if not re.fullmatch(r"/[A-Za-z0-9_./-]+", str(p)):
            raise ValueError("MOSES_TOOL_PATH_REQUIRES_ASCII_NO_SPACES_OR_SHELL_METACHARACTERS")
        if not p.is_file() or sha(p) != value["binary_sha256"][name]:
            raise ValueError("TOOLCHAIN_BINARY_MISMATCH:" + name)
        value["executables"][name] = str(p)
    for filename, expected in value.get("helper_script_sha256", {}).items():
        root = Path(value["moses_scripts_root"]).resolve()
        helper = Path(filename).resolve()
        if not helper.is_relative_to(root) or not helper.is_file() or sha(helper) != expected:
            raise ValueError("TOOLCHAIN_HELPER_MISMATCH:" + filename)
    for filename, expected in value.get("system_tool_sha256", {}).items():
        if not Path(filename).is_file() or sha(filename) != expected:
            raise ValueError("SYSTEM_TOOL_MISMATCH:" + filename)
    return value

def implementation_hashes():
    return {p.name: sha(p) for p in sorted(Path(__file__).parent.glob("*.py")) if not p.name.startswith("test_")}

def run(command, log, stdin=None, stdout=None, timeout=900):
    with open(log, "ab") as err:
        err.write(("\n$ " + json.dumps([str(c) for c in command]) + "\n").encode()); err.flush()
        incoming = open(stdin, "rb") if stdin else subprocess.DEVNULL
        outgoing = open(stdout, "wb") if stdout else err
        try:
            subprocess.run([str(c) for c in command], stdin=incoming, stdout=outgoing, stderr=err, check=True, timeout=timeout, env={**os.environ, "LC_ALL": "C.UTF-8", "OMP_NUM_THREADS": "1"})
        finally:
            if stdin: incoming.close()
            if stdout: outgoing.close()

def train(rows, splits, out, tools_file, mechanical=False, split_manifest=None, repo=None, documentary_manifest=None):
    out = Path(out).resolve()
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", str(out)):
        raise ValueError("MOSES_MODEL_PATH_REQUIRES_ASCII_NO_SPACES_OR_SHELL_METACHARACTERS")
    if out.exists():
        raise ValueError("OUTPUT_ALREADY_EXISTS")
    if not splits.get("train") or (not mechanical and (not splits.get("dev") or not splits.get("test"))):
        raise ValueError("TRAIN_DEV_TEST_REQUIRED")
    if documentary_manifest is not None:
        if mechanical: raise ValueError("DOCUMENTARY_MODE_CONFLICT")
        from .documentary import validate_documentary_pairs, validate_documentary_split
        if repo is None: raise ValueError("SOURCE_REPOSITORY_REQUIRED")
        if out.is_relative_to(Path(repo).resolve()) or out.is_relative_to(Path(__file__).resolve().parents[2]): raise ValueError("DOCUMENTARY_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY")
        rows = validate_documentary_pairs(rows, documentary_manifest, repo=repo)
        if split_manifest is None or validate_documentary_split(rows, split_manifest, documentary_manifest, repo=repo) != splits:
            raise ValueError("FROZEN_DOCUMENTARY_SPLIT_REQUIRED")
    elif not mechanical:
        from .data import validate_pairs, validate_split
        if repo is not None: rows = validate_pairs(rows, repo)
        if split_manifest is None or validate_split(rows, split_manifest) != splits:
            raise ValueError("FROZEN_SPLIT_REQUIRED")
        if repo is None: raise ValueError("SOURCE_REPOSITORY_REQUIRED")
        for row in rows:
            ann, review = row.get("annotation", {}), row.get("review", {})
            if ann.get("author_type") != "human" or ann.get("human_authored") is not True or ann.get("no_llm_or_synthetic") is not True or review.get("author_type") != "human" or review.get("no_llm_or_synthetic") is not True or not all(review.get(k) is True for k in ("reviewed", "meaning_preserved", "source_verified", "lineage_reviewed")):
                raise ValueError("HUMAN_REVIEWED_PAIRS_REQUIRED")
    if mechanical:
        for row in rows:
            if row.get("provenance") != "algorithmic-token-map-fixture-not-human-not-language" or not re.fullmatch(r"[abcd]x [abcd]x", row.get("ordinary_text", "")) or row.get("original_text") != row["ordinary_text"].replace("x", "z"):
                raise ValueError("MECHANICAL_SYMBOL_FIXTURE_ONLY")
    tok = Tokenizer(mechanical=mechanical)
    tc = toolchain(tools_file); exe = tc["executables"]
    out.mkdir(parents=True)
    log = out / "training.log"
    write_json(out / "toolchain.json", tc)
    write_json(out / "pairs.json", rows)
    if documentary_manifest is not None:
        write_json(out/"documentary-input-reference.json", {"path":str(Path(documentary_manifest).resolve()),"sha256":sha(documentary_manifest),"rights_scope":"local limited research only; no redistribution authorization inferred"})
    if split_manifest is not None: write_json(out / "split-manifest.json", split_manifest)
    write_json(out / "splits.json", {k: [r["pair_id"] for r in v] for k, v in splits.items()})
    inputs, targets, align_input, metadata, rejected = [], [], [], [], []
    for row in splits["train"]:
        source = tok.tokenize(row["ordinary_text"])
        try:
            target = tok.tokenize(row["original_text"], source.protected)
        except ValueError as exc:
            if documentary_manifest is None or str(exc) != "PAIR_PROTECTED_VALUE_MISMATCH": raise
            rejected.append({"pair_id":row["pair_id"],"reason":str(exc),"interpretation":"Documentary pairing does not imply protected-fact correspondence; no human semantic judgment inferred"})
            continue
        i = len(inputs)
        a, b = " ".join(source.words), " ".join(target.words)
        inputs.append(a); targets.append(b); align_input.append(a + " ||| " + b)
        metadata.append({"line": i+1, "pair_id": row["pair_id"], "source": row.get("source"), "lineage": row.get("lineage"), "input_tokens": source.words, "target_tokens": target.words, "input_spans": source.spans, "target_spans": target.spans, "protected": source.protected})
    write_json(out/"training-diagnostics.json", {"offered_training_pairs":len(splits["train"]),"used_training_pairs":len(inputs),"rejected_training_pairs":rejected,"semantics":"unreviewed, including accepted pairs"})
    if not inputs: raise ValueError("NO_PROTECTED_INVENTORY_COMPATIBLE_TRAINING_PAIRS")
    for name, lines in (("train.f", inputs), ("train.e", targets), ("parallel.txt", align_input)):
        (out / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
    write_json(out / "training-rows.json", metadata)
    for reverse, name in ((False, "forward.align"), (True, "reverse.align")):
        command = [exe["fast_align"], "-i", out / "parallel.txt", "-d", "-o", "-v"]
        if reverse: command.append("-r")
        run(command, log, stdout=out/name)
    run([exe["atools"], "-i", out/"forward.align", "-j", out/"reverse.align", "-c", "grow-diag-final-and"], log, stdout=out/"aligned.grow-diag-final-and")
    run([exe["lmplz"], "-o", "3", "--discount_fallback", "--memory", "256M", "--temp_prefix", out/"lm-tmp"], log, stdin=out/"train.e", stdout=out/"target.arpa")
    run([exe["build_binary"], out/"target.arpa", out/"target.klm"], log)
    (out/"moses/model").mkdir(parents=True)
    run(["perl", exe["train_model"], "--root-dir", out/"moses", "--corpus", out/"train", "--f", "f", "--e", "e", "--alignment-file", out/"aligned", "--alignment", "grow-diag-final-and", "--first-step", "4", "--last-step", "9", "--reordering", "distance", "--max-phrase-length", "7", "--cores", "1", "--lm", f"0:3:{out/'target.klm'}:8"], log)
    # Run the official extractor again in its provenance format. This file is NEVER scored.
    run([exe["extract"], out/"train.e", out/"train.f", out/"aligned.grow-diag-final-and", out/"phrase-provenance", "7", "--IncludeSentenceId"], log)
    provenance = collections.defaultdict(set)
    raw_provenance = out/"phrase-provenance"
    with raw_provenance.open(encoding="utf-8") as src:
        for line in src:
            fields = line.rstrip("\n").split(" ||| ")
            if len(fields) < 4:
                raise ValueError("MOSES_PROVENANCE_FORMAT_MISMATCH")
            line_id = int(fields[3].strip())
            if line_id < 1 or line_id > len(metadata):
                raise ValueError("MOSES_PROVENANCE_LINE_MISMATCH")
            provenance[fields[0] + " ||| " + fields[1]].add(line_id)
    write_json(out/"phrase-provenance.json", {k: sorted(v) for k,v in sorted(provenance.items())})
    artifacts = [p for p in out.rglob("*") if p.is_file() and p.name != "training.log"]
    manifest = {"schema_version": 1, "model_version": MODEL_VERSION, "feature_version": FEATURE_VERSION, "status": "mechanical_wiring_only" if mechanical else "documentary_parallel_unreviewed" if documentary_manifest is not None else "human_parallel_research_unvalidated", "corpus_kind": "mechanical_fixture" if mechanical else "published_human_adaptations_tool_aligned" if documentary_manifest is not None else "human_annotated_original_pairs", "corpus_redistribution": "not_authorized" if documentary_manifest is not None else "not_granted_by_this_model", "rejected_training_pair_count":len(rejected), "production_enabled": False, "human_quality_evaluated": False, "S": None, "Q": None, "tokenizer": tok.metadata, "training_pair_count": len(inputs), "split_counts": {k:len(v) for k,v in splits.items()}, "pairs_sha256": digest(rows), "toolchain_sha256": sha(out/"toolchain.json"), "implementation_sha256": implementation_hashes(), "training_target_only_lm": True, "configuration": {"lm_order": 3, "max_phrase_length": 7, "distortion_limit": 0, "nbest_limit": 30, "weights": "Moses defaults, untuned"}, "artifacts": {str(p.relative_to(out)):sha(p) for p in sorted(artifacts)}}
    write_json(out/"manifest.json", manifest)
    return manifest

def verify_model(path):
    path = Path(path).resolve(); manifest = read_json(path/"manifest.json")
    if manifest.get("model_version") != MODEL_VERSION or manifest.get("feature_version") != FEATURE_VERSION:
        raise ValueError("MODEL_VERSION_MISMATCH")
    for name, expected in manifest["artifacts"].items():
        artifact = (path/name).resolve()
        if not artifact.is_relative_to(path) or not artifact.is_file() or sha(artifact) != expected:
            raise ValueError("MODEL_ARTIFACT_MISMATCH:" + name)
    if manifest.get("implementation_sha256") != implementation_hashes():
        raise ValueError("RESEARCH_IMPLEMENTATION_MISMATCH")
    rows = read_json(path/"pairs.json")
    if manifest.get("pairs_sha256") != digest(rows): raise ValueError("MODEL_PAIRS_HASH_MISMATCH")
    if manifest["status"] == "human_parallel_research_unvalidated":
        from .data import validate_split
        validate_split(rows, read_json(path/"split-manifest.json"))
    elif manifest["status"] == "documentary_parallel_unreviewed":
        from .documentary import validate_documentary_split
        reference = read_json(path/"documentary-input-reference.json")
        if sha(reference["path"]) != reference["sha256"]: raise ValueError("DOCUMENTARY_SOURCE_MANIFEST_CHANGED")
        validate_documentary_split(rows, read_json(path/"split-manifest.json"), reference["path"])
    elif manifest["status"] != "mechanical_wiring_only":
        raise ValueError("MODEL_STATUS_INVALID")
    tc = toolchain(path/"toolchain.json")
    tok = Tokenizer(mechanical=manifest["status"] == "mechanical_wiring_only")
    if tok.metadata != manifest["tokenizer"]:
        raise ValueError("TOKENIZER_VERSION_MISMATCH")
    return path, manifest, tc, tok

def parse_segmented(text, segmentation):
    # Pinned Moses Manager::OutputNBest writes segmentation in field 5,
    # as inclusive source=target ranges, not inline one-best |a-b| markers.
    words, segments = text.split(), []
    for item in segmentation.split():
        m = re.fullmatch(r"(\d+)(?:-(\d+))?=(\d+)(?:-(\d+))?", item)
        if not m: raise ValueError("MOSES_SEGMENTATION_REQUIRED")
        a,b,c,d = int(m[1]),int(m[2] or m[1])+1,int(m[3]),int(m[4] or m[3])+1
        if not a < b or not 0 <= c < d <= len(words): raise ValueError("MOSES_SEGMENTATION_INVALID")
        segments.append({"source_token_start":a,"source_token_end":b,"target_token_start":c,"target_token_end":d})
    if not segments or [i for s in segments for i in range(s["target_token_start"],s["target_token_end"])] != list(range(len(words))):
        raise ValueError("MOSES_SEGMENTATION_REQUIRED")
    return words, segments

def language_scores(query_output):
    results = []
    for line in query_output.splitlines():
        m = re.search(r"Total:\s*([-+\deE.]+)\s+OOV:\s*(\d+)", line)
        if m:
            results.append({"log10_probability": float(m[1]), "oov_count": int(m[2])})
    return results

def decode_inputs(model, inputs, nbest=30):
    if not 1 <= nbest <= 30: raise ValueError("NBEST_LIMIT")
    path, manifest, tc, tok = verify_model(model); exe = tc["executables"]
    if not inputs or len(inputs) > 200: raise ValueError("INPUT_BATCH_LIMIT")
    tokenized = [tok.tokenize(s) for s in inputs]
    provenance = read_json(path/"phrase-provenance.json")
    training_rows = read_json(path/"training-rows.json")
    with tempfile.TemporaryDirectory(prefix="buront-moses-") as tmp:
        tmp = Path(tmp)
        (tmp/"input.txt").write_text("\n".join(" ".join(x.words) for x in tokenized)+"\n", encoding="utf-8")
        run([exe["moses"], "-f", path/"moses/model/moses.ini", "-input-file", tmp/"input.txt", "-n-best-list", tmp/"nbest.txt", str(nbest), "distinct", "-include-segmentation-in-n-best", "-print-alignment-info-in-n-best", "-distortion-limit", "0", "-threads", "1"], tmp/"decode.log", stdout=tmp/"best.txt", timeout=300)
        batches = [[] for _ in inputs]; lm_lines = []; flat = []
        for line in (tmp/"nbest.txt").read_text(encoding="utf-8").splitlines():
            fields = line.split(" ||| ")
            if len(fields) < 6: raise ValueError("MOSES_NBEST_FORMAT_MISMATCH")
            idx = int(fields[0])
            if idx < 0 or idx >= len(inputs): raise ValueError("MOSES_SENTENCE_ID_INVALID")
            if len(batches[idx]) >= nbest: raise ValueError("MOSES_NBEST_LIMIT_EXCEEDED")
            source = tokenized[idx]
            words, segments = parse_segmented(fields[1],fields[4])
            coverage = [i for seg in segments for i in range(seg["source_token_start"], seg["source_token_end"])]
            if coverage != list(range(len(source.words))):
                raise ValueError("MOSES_SOURCE_COVERAGE_INVALID")
            text, diagnostics = tok.restore(words, source)
            protected_values = {p["token"]: p["text"] for p in source.protected}
            output_offsets = [0]
            for word in words:
                try: surface = protected_values[word] if word in protected_values else decode(word)
                except (ValueError, UnicodeDecodeError): surface = ""
                output_offsets.append(output_offsets[-1] + len(surface))
            for seg in segments:
                a,b = seg["source_token_start"],seg["source_token_end"]
                c,d = seg["target_token_start"],seg["target_token_end"]
                if not 0 <= a < b <= len(source.words): raise ValueError("MOSES_SOURCE_SPAN_INVALID")
                key = " ".join(source.words[a:b]) + " ||| " + " ".join(words[c:d])
                evidence = [training_rows[n-1] for n in provenance.get(key, [])]
                seg.update({"input_span": {"start":source.spans[a]["start"],"end":source.spans[b-1]["end"]}, "output_span": {"start": output_offsets[c], "end": output_offsets[d]}, "source_encoded": source.words[a:b], "target_encoded":words[c:d], "origin": "learned_phrase" if evidence else "copy_or_untraced", "training_pair_ids": [r["pair_id"] for r in evidence], "source_catalog": "training_source_catalog"})
                if not evidence and source.words[a:b] != words[c:d]:
                    diagnostics.append({"kind":"untraced_noncopy_phrase","severity":"reject"})
            score = float(fields[3])
            if not math.isfinite(score): raise ValueError("NONFINITE_DECODER_SCORE")
            candidate = {"id":digest({"input":inputs[idx],"words":words})[:24], "text":text,"decoder_score":score,"decoder_features":fields[2].strip(),"word_alignment": fields[5].strip(), "trace":segments,"diagnostics":diagnostics,"status":"rejected_by_diagnostics" if any(d["severity"]=="reject" for d in diagnostics) else "needs_human_review","verification_scope":"Research diagnostics only; not certified by the baseline closed rule registry", "S":None,"Q":None, "token_count":len(words)}
            batches[idx].append(candidate); flat.append(candidate); lm_lines.append(" ".join(words))
        (tmp/"lm-input.txt").write_text("\n".join(lm_lines)+"\n",encoding="utf-8")
        run([exe["query"], path/"target.klm"],tmp/"query.log",stdin=tmp/"lm-input.txt",stdout=tmp/"lm-output.txt")
        lms = language_scores((tmp/"lm-output.txt").read_text(encoding="utf-8"))
        if len(lms) != len(flat): raise ValueError("KENLM_QUERY_FORMAT_MISMATCH")
        for c,lm in zip(flat,lms):
            c["kenlm"] = {**lm,"log10_per_token":lm["log10_probability"]/max(1,c["token_count"]+1),"oov_rate":lm["oov_count"]/max(1,c["token_count"]),"interpretation":"local n-gram likelihood, not semantic safety or human quality"}
        return {"schema_version":1,"model_manifest_sha256":sha(path/"manifest.json"),"model_status":manifest["status"],"feature_version":FEATURE_VERSION,"production_enabled":False,"training_source_catalog":{r["pair_id"]:r["source"] for r in training_rows},"inputs":[{"source":s,"protected":t.protected,"candidates":c,"fallback":{"text":s,"reason":"research_backend_does_not_replace_default"}} for s,t,c in zip(inputs,tokenized,batches)]}
