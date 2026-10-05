"""Capture unedited production analyses for past auxiliaries and context guards.

Run with .venv/bin/python test/fixtures/capture-ginza-discourse-recognition.py.
The fixture records original JSONL responses; no morphology is synthesized.
"""
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [
    '大したことはしていない。届けただけだ。',
    '大したことはしていない。運んだだけだ。',
    '大したことはしていない。荷物を届けただけだ。',
    '大したことはしていない。荷物を運んだだけだ。',
    '大したことはしていない。機械を修理しただけだ。',
    '大したことはしていない。荷物を運ぶだけだ。',
    '大したことはしていない。荷物を運ばなかっただけだ。',
    '大したことはしていない。太郎が荷物を運んだだけだ。',
    '大したことはしていない。荷物を運んだだけだと思う。',
    '大したことはしていない。太郎と荷物を運んだだけだ。',
    '大したことはしていない。「荷物を運んだだけだ。」',
    '大したことはしていない。荷物を運んだだけだ？',
    '大したことはしていない。もし荷物を運んだなら、帰る。',
    '大したことはしていない。荷物を運んでいるだけだ。',
]
CONTEXT_SOURCES = [
    '電車がよいらしい。\n私には速さが大切だからです。',
    '電車を選ぶ？\n私には速さが大切だからです。',
    '電車がよいらしい。\n \nしかし私には速さが大切です。',
    '電車を選ぶ？\n \nしかし私には速さが大切です。',
    '電車を選ぶ。\n私には速さが大切だからです。',
    'この傘は軽い。\n \nしかし値段は高い。',
]
DESIRE_SOURCES = [
    '大したことはしていない。私は荷物を運びたいだけだ。',
    '大したことはしていない。私は荷物を届けたいだけだ。',
    '大したことはしていない。私は荷物を運びたかっただけだ。',
    '大したことはしていない。私は荷物を届けたかっただけだ。',
    '大したことはしていない。私は荷物を運びたくないだけだ。',
    '大したことはしていない。私は荷物を運びたくなかっただけだ。',
]


def main():
    process = subprocess.Popen(
        [sys.executable, str(ROOT / 'services/japanese-analysis/service.py')],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding='utf-8')
    try:
        ready = json.loads(process.stdout.readline())
        assert ready['ok'], ready
        cases = []
        for index, source in enumerate(SOURCES + CONTEXT_SOURCES + DESIRE_SOURCES):
            process.stdin.write(json.dumps({
                'protocolVersion': 1, 'requestId': str(index), 'operation': 'analyze',
                'payload': {'source': source}, 'deadline': time.time() * 1000 + 30000,
            }, ensure_ascii=False) + '\n')
            process.stdin.flush()
            frame = json.loads(process.stdout.readline())
            assert frame['ok'], frame
            cases.append({'source': source, 'analysis': frame['result']})
        provenance = {
            'producer': 'services/japanese-analysis/service.py',
            'captureScript': 'test/fixtures/capture-ginza-discourse-recognition.py',
            'versions': ready['result']['versions'], 'pythonVersion': platform.python_version(),
            'requirementsSha256': hashlib.sha256((ROOT / 'services/japanese-analysis/requirements.lock.txt').read_bytes()).hexdigest(),
            'description': 'Unedited real GiNZA responses captured through the production JSONL interface',
        }
        for filename, captured in [
            ('ginza-discourse-past.json', cases[:len(SOURCES)]),
            ('ginza-discourse-context-boundaries.json', cases[len(SOURCES):len(SOURCES) + len(CONTEXT_SOURCES)]),
            ('ginza-discourse-desire.json', cases[len(SOURCES) + len(CONTEXT_SOURCES):]),
        ]:
            result = {'provenance': provenance, 'cases': captured}
            destination = ROOT / 'test/fixtures' / filename
            destination.write_text(json.dumps(result, ensure_ascii=False) + '\n', encoding='utf-8')
            print(f'Captured {len(captured)} real analyses in {destination.relative_to(ROOT)}')
    finally:
        process.terminate()
        process.wait(timeout=5)


if __name__ == '__main__':
    main()
