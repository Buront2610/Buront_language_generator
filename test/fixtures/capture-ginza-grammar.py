"""Refresh the real parser regression snapshot using the production JSONL service.
Run with the project environment: .venv/bin/python test/fixtures/capture-ginza-grammar.py
No token IDs, dependency labels, morphology or offsets are synthesized.
"""
import json
import platform
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [
    '来てもとても悲しい。', '来たとしたらとても悲しい。', '来るとするととても悲しい。', '来たとしてとても悲しい。',
    '来ないととても悲しい。', '来ると休む。', '来ると私は確認した。',
    '来たとしてもとても悲しい。', '来た時はとても悲しい。', '来た際はとても悲しい。',
    '多分とても悲しい。', 'たぶんとても悲しい。', 'おそらく怒りが頂点に達した。',
    '恐らくすでに時間切れだ。', 'きっととても悲しい。', 'もしかするととても悲しい。', 'ひょっとすると時間切れだ。',
    '田中によると怒りが頂点に達した。', '田中によれば怒りが頂点に達した。',
    '報告によるとすでに時間切れだ。', '噂では怒りが頂点に達した。', '田中の話ではとても悲しい。',
    '田中によると彼は来たが、私は確認した。', 'もし来ないととても悲しいが、私は作業した。',
    '彼と私はとても悲しい。', '多分野にわたる研究は素晴らしい。', '田中によって怒りが頂点に達した。',
    '全員に助言したが、雰囲気は悪かった。', '素晴らしい。', '素晴らしいです。', 'おもしろい。', 'おもしろいです。',
    '来るらしい。', '来るそうだ。', '来るようだ。', '来るでしょう。', '来るかもしれない。', '来ると思う。',
    'もし来たら、私は確認する。', '来れば休む。', '雨なら休む。', '来る場合は確認する。',
    'もし来たら確認するが、私は今日は休む。',
    '危険がない。', '危険ではない。', '危険はなかった。', '悲しくない。', '悲しくないです。',
    '彼が来るらしいが、私は確認した。', '彼は「私は来る」と言ったが、私は確認した。',
    '来ると聞いたが、私は確認した。', '私は助言したと田中が言った。',
    '来るとの報告だ。', '彼が来るという話だ。', '来ないとは限らない。', '来ないわけではない。',
    '私は明日確認する予定だ。', '私は来るはずだ。', '来てください。', '来るのか。',
    '確認してくれてありがとうございます。', '昨日確認したが、彼は来るらしい。',
    '危険がないと私は確認した。', '彼は来るが、私は来ない。',
    '寒かったです。', '食べました。', '食べませんでした。', '悲しいです。', '騒がしいです。', '同じです。',
    '勉強します。', '話します。', '話しました。', '渡した。', '果たした。', '許します。', '読んだ。',
    '私は確認しませんでした。', '私は確認した。', '私は確認しました。', '私は行く。', '雨だった。',
    '今日は寒い。', '私は助けました。', '私は助けませんでした。', '私は疲れました。', '私は終わりました。',
    '私は怒りが頂点に達した。', '太郎の怒りが頂点に達しました。', '怒りが頂点に達する。',
    '私はとても悲しかった。', '太郎は大変悲しい。', 'すでに時間切れだ。', 'もう時間切れだった。',
]

def main():
    process = subprocess.Popen([sys.executable, str(ROOT / 'services/japanese-analysis/service.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    try:
        ready = json.loads(process.stdout.readline())
        assert ready['ok'], ready
        cases = []
        for index, source in enumerate(SOURCES):
            process.stdin.write(json.dumps({'protocolVersion': 1, 'requestId': str(index), 'operation': 'analyze', 'payload': {'source': source}, 'deadline': time.time() * 1000 + 30000}, ensure_ascii=False) + '\n')
            process.stdin.flush()
            frame = json.loads(process.stdout.readline())
            assert frame['ok'], frame
            cases.append({'source': source, 'analysis': frame['result']})
        result = {'provenance': {'producer': 'services/japanese-analysis/service.py', 'captureScript': 'test/fixtures/capture-ginza-grammar.py', 'versions': ready['result']['versions'], 'pythonVersion': platform.python_version(), 'description': 'Unedited real GiNZA responses, captured through the production JSONL interface'}, 'cases': cases}
        destination = ROOT / 'test/fixtures/ginza-grammar-scope.json'
        destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'Captured {len(cases)} real analyses in {destination.relative_to(ROOT)}')
    finally:
        process.terminate()
        process.wait(timeout=5)

if __name__ == '__main__':
    main()
