"""Capture unchanged production GiNZA output for the causal-ending regression.

Run with .venv/bin/python test/fixtures/capture-ginza-explanatory-copula.py.
No token IDs, dependencies, morphology or offsets are synthesized.
"""
import json
import platform
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [
    '車より電車で行くほうがよいと思う。駐車場を探す必要がなく、到着時刻も読みやすいからだ。',
    '来るからだ。', '楽しいからだ。', '雨だからだ。', '雨だったからだ。',
    '来るからだった。', '来るからです。', '来るからでした。', '来るから だ。',
    '必要がないからだ。', '必要がなかったからだ。',
    '来るからではない。', '雨だからではなかった。', '来るからではありません。',
    '雨だからな。', '来るからな。',
    '雨だ。', '雨です。', '雨だった。', '雨でした。', '空からだ。', '空からです。',
    'からだは健康だ。', '田中から３冊もらった。',
    '雨だから安全だ。', '雨だからだが、私は健康だ。',
    '雨だからだ。私は健康だ。', '私は健康だ。雨だからだ。',
    '「雨だからだ」と彼は言った。私は健康だ。',
    '「雨だからだ。」', '（雨だからだ。）', '「雨だからだ。',
    '彼は雨だからだと言った。', '雨だからだと思う。', '雨だからでしょう。',
    'もし雨だからだとしたら、私は確認する。', '雨だからだ？',
    '😀田中から３冊もらったからだ。', '到着は３時だからだ。',
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
        for index, source in enumerate(SOURCES):
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
            'captureScript': 'test/fixtures/capture-ginza-explanatory-copula.py',
            'versions': ready['result']['versions'], 'pythonVersion': platform.python_version(),
            'description': 'Unedited real GiNZA responses, captured through the production JSONL interface',
        }
        # Keep publication payloads small while retaining every original frame.
        for filename, captured in [
            ('ginza-explanatory-copula.json', cases[:24]),
            ('ginza-explanatory-copula-safeguards.json', cases[24:]),
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
