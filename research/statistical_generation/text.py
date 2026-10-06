"""Reversible surface tokens and conservative diagnostics, never semantic proof."""
from __future__ import annotations
import collections
import importlib.metadata
import re
from dataclasses import dataclass

TEXT_VERSION = "surface-protected-v1"
TOKEN_RE = re.compile(r"^(?:u[0-9a-f]+|P[0-9]{4})$")
QUOTE_RE = re.compile(r"「[^「」]*」|『[^『』]*』|\"[^\"\n]*\"|“[^“”]*”")
NUMBER_RE = re.compile(r"[+-]?(?:[0-9０-９]+(?:[,，.．][0-9０-９]+)*)(?:[%％]|円|ドル|人|個|本|枚|回|台|件|日|月|年|時|分|秒|kg|km|cm|mm|m|g)?")
OPAQUE_RE = re.compile(r"https?://[^\s「」『』]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|`[^`]*`")
CUES = {
    "polarity": r"ない|なかった|ません|ぬ\b|無い|ずに|未だ|未確認",
    "modality": r"かもしれない|かも知れない|だろう|でしょう|ようだ|そうだ|予定|はず|らしい|と思う|と思います",
    "condition": r"なら|たら|れば|場合|とき|時に",
}

@dataclass
class Tokens:
    raw: str
    words: list[str]
    spans: list[dict]
    protected: list[dict]


def encode(surface: str) -> str:
    if not surface:
        raise ValueError("EMPTY_SURFACE_TOKEN")
    return "u" + surface.encode("utf-8").hex()


def decode(word: str) -> str:
    if not re.fullmatch(r"u[0-9a-f]+", word) or len(word[1:]) % 2:
        raise ValueError("INVALID_SURFACE_TOKEN")
    return bytes.fromhex(word[1:]).decode("utf-8")


class Tokenizer:
    def __init__(self, mechanical: bool = False):
        self.mechanical = mechanical
        if mechanical:
            self.name = "mechanical-atom-surface-v1"
            self.versions = {}
        else:
            from sudachipy import dictionary, tokenizer
            self.sudachi = dictionary.Dictionary(dict="core").create()
            self.mode = tokenizer.Tokenizer.SplitMode.A
            self.name = "sudachi-a-surface-v1"
            self.versions = {name: importlib.metadata.version(name) for name in ("SudachiPy", "SudachiDict-core")}

    @property
    def metadata(self):
        return {"name": self.name, "versions": self.versions, "text_version": TEXT_VERSION, "offset_unit": "unicode_code_point", "normalization": "none"}

    def raw_tokens(self, text):
        if self.mechanical:
            return [(m.group(), m.start(), m.end(), False) for m in re.finditer(r"\s+|\S+", text)]
        return [(m.surface(), m.begin(), m.end(), "固有名詞" in m.part_of_speech()) for m in self.sudachi.tokenize(text, self.mode)]

    def protections(self, text):
        spans = []
        for kind, pattern in (("quotation", QUOTE_RE), ("opaque", OPAQUE_RE), ("quantity", NUMBER_RE)):
            spans.extend({"start": m.start(), "end": m.end(), "kind": kind, "text": m.group()} for m in pattern.finditer(text))
        if not self.mechanical:
            spans.extend({"start": a, "end": b, "kind": "proper_noun", "text": s} for s, a, b, proper in self.raw_tokens(text) if proper)
        # Prefer the widest protected span when overlapping, e.g. a number in a quotation.
        chosen = []
        for p in sorted(spans, key=lambda p: (-(p["end"] - p["start"]), p["start"])):
            if not any(p["start"] < x["end"] and x["start"] < p["end"] for x in chosen):
                chosen.append(p)
        return sorted(chosen, key=lambda p: p["start"])

    def tokenize(self, text: str, source_protected=None) -> Tokens:
        if not isinstance(text, str) or not text or len(text) > 5000 or any(0xD800 <= ord(c) <= 0xDFFF for c in text):
            raise ValueError("INVALID_SOURCE")
        if source_protected is None:
            protected = [{**p, "token": f"P{i:04d}"} for i, p in enumerate(self.protections(text))]
        else:
            protected, used = [], []
            for p in source_protected:
                match = next((m for m in re.finditer(re.escape(p["text"]), text) if not any(m.start() < b and a < m.end() for a, b in used)), None)
                if match is None:
                    raise ValueError("PAIR_PROTECTED_VALUE_MISMATCH")
                used.append((match.start(), match.end()))
                protected.append({**p, "start": match.start(), "end": match.end()})
            protected.sort(key=lambda p: p["start"])
            # This is a strict training precondition; a human must resolve it rather than silently erasing values.
            discovered = collections.Counter(p["text"] for p in self.protections(text))
            expected = collections.Counter(p["text"] for p in source_protected)
            if discovered != expected:
                raise ValueError("PAIR_PROTECTED_VALUE_MISMATCH")
        words, spans = [], []
        cursor = 0
        def add_plain(a, b):
            local_cursor = a
            for surface, x, y, _ in self.raw_tokens(text[a:b]):
                x, y = x + a, y + a
                # Sudachi A-mode can expose zero-width expansion morphemes for
                # normalized punctuation (e.g. … -> three analysis symbols).
                # They consume no original bytes and must not become LM tokens.
                if not surface and x == y: continue
                if not local_cursor <= x < y <= b or text[x:y] != surface:
                    raise ValueError("TOKENIZER_SURFACE_SPAN_MISMATCH")
                if x > local_cursor:
                    words.append(encode(text[local_cursor:x])); spans.append({"start": local_cursor, "end": x})
                words.append(encode(surface)); spans.append({"start": x, "end": y})
                local_cursor = y
            if local_cursor < b:
                words.append(encode(text[local_cursor:b])); spans.append({"start": local_cursor, "end": b})
        for p in protected:
            add_plain(cursor, p["start"])
            words.append(p["token"]); spans.append({"start": p["start"], "end": p["end"]})
            cursor = p["end"]
        add_plain(cursor, len(text))
        return Tokens(text, words, spans, protected)

    def restore(self, words: list[str], source: Tokens):
        values = {p["token"]: p["text"] for p in source.protected}
        actual = [w for w in words if re.fullmatch(r"P[0-9]{4}", w)]
        expected = [p["token"] for p in source.protected]
        diagnostics = []
        if collections.Counter(actual) != collections.Counter(expected):
            diagnostics.append({"kind": "protected_value_count", "severity": "reject", "expected": expected, "actual": actual})
        elif actual != expected:
            diagnostics.append({"kind": "protected_value_order", "severity": "reject", "expected": expected, "actual": actual})
        pieces = []
        for w in words:
            try:
                pieces.append(values[w] if w in values else decode(w))
            except (ValueError, UnicodeDecodeError):
                diagnostics.append({"kind": "invalid_output_token", "severity": "reject", "token": w})
        text = "".join(pieces)
        editable_surface = "".join(decode(word) for word in source.words if word not in values)
        if source.protected and not editable_surface.strip() and text != source.raw:
            diagnostics.append({"kind": "fully_protected_input_added_content", "severity": "reject", "detail": "The source contains only protected content/whitespace; adding material outside it is not a supported style edit."})
        for name, pattern in CUES.items():
            before = collections.Counter(re.findall(pattern, source.raw))
            after = collections.Counter(re.findall(pattern, text))
            if before != after:
                diagnostics.append({"kind": name + "_surface_cue_mismatch", "severity": "review", "input": dict(before), "output": dict(after)})
        for name, pattern in (("quantity", NUMBER_RE), ("quotation", QUOTE_RE), ("opaque", OPAQUE_RE)):
            before, after = collections.Counter(pattern.findall(source.raw)), collections.Counter(pattern.findall(text))
            if before != after:
                diagnostics.append({"kind": name + "_inventory_mismatch", "severity": "reject", "input": dict(before), "output": dict(after)})
        # Check literal counts as well as placeholders: a learned token must not
        # reinsert a protected name beside its required copy.
        for value in sorted({p["text"] for p in source.protected}):
            if source.raw.count(value) != text.count(value):
                diagnostics.append({"kind": "protected_literal_inventory_mismatch", "severity": "reject", "value": value, "input_count": source.raw.count(value), "output_count": text.count(value)})
        if not self.mechanical:
            before = collections.Counter(p["text"] for p in self.protections(source.raw) if p["kind"] == "proper_noun")
            after = collections.Counter(p["text"] for p in self.protections(text) if p["kind"] == "proper_noun")
            if before != after:
                diagnostics.append({"kind": "proper_noun_inventory_mismatch", "severity": "reject", "input": dict(before), "output": dict(after)})
        diagnostics.append({"kind": "semantics_unverified", "severity": "review", "detail": "Local surface checks cannot establish meaning, role, scope, attribution, or style preservation. Human review is required."})
        return text, diagnostics
