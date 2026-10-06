"""Mechanical sentinel import tests, not real human annotations."""
import csv
import json
from pathlib import Path
import unittest
from . import test_statistical_data as data_fixtures
from .csv_import import HEADERS, BOOLEANS, import_csv, merge_csv
from .data import SourceCatalog, DataError

class CsvImportTests(unittest.TestCase):
    setUp = data_fixtures.StatisticalDataTests.setUp
    write_sources = data_fixtures.StatisticalDataTests.write_sources
    def rows(self,filled=False):
        originals=[SourceCatalog(self.repo).annotation('s0'),SourceCatalog(self.repo).annotation('s1')]
        template=self.repo/'template.jsonl';template.write_text('\n'.join(json.dumps(x) for x in originals))
        cells=[]
        for i,r in enumerate(originals,1):
            row={h:'' for h in HEADERS};row.update({'番号':str(i),'原文（変更不可）':r['original_text'],'ペアID（変更不可）':r['pair_id'],'出典URL（変更不可）':r['source']['post_url']})
            if filled:
                row.update({'普通の日本語（人が記入）':f'CSV_TEST_SENTINEL_{i}','記入者ID':'TEST_ONLY_FAKE_DECLARATION','記入者の種別':'human','確認者ID':'TEST_ONLY_FAKE_DECLARATION','確認者の種別':'human'})
                row.update({h:'はい' for h in BOOLEANS})
            cells.append(row)
        return template,cells
    def write_csv(self,cells):
        path=self.repo/'input.csv'
        with path.open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=HEADERS);writer.writeheader();writer.writerows(cells)
        return path
    def test_csv_blank_never_approved(self):
        template,cells=self.rows();result=import_csv(template,self.write_csv(cells),self.repo,self.repo/'out.jsonl',self.repo/'report.json')
        self.assertEqual(result['imported_rows'],0);self.assertFalse((self.repo/'out.jsonl').exists())
    def test_csv_explicit_only(self):
        template,cells=self.rows(True);cells[1]['意味の保持を確認']='いいえ'
        rows,report=merge_csv(template,self.write_csv(cells),self.repo)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['ordinary_text'],'CSV_TEST_SENTINEL_1');self.assertEqual(len(report['excluded_rows']),1)
    def test_csv_original_tamper_and_duplicate_rejected(self):
        template,cells=self.rows(True);cells[0]['原文（変更不可）']='ALTERED'
        with self.assertRaisesRegex(DataError,'IMMUTABLE'):merge_csv(template,self.write_csv(cells),self.repo)
        template,cells=self.rows(True);cells.append(cells[0])
        with self.assertRaisesRegex(DataError,'DUPLICATE'):merge_csv(template,self.write_csv(cells),self.repo)
    def test_csv_unknown_boolean_and_nonhuman_rejected(self):
        template,cells=self.rows(True);cells[0]['人が作成']='yes'
        with self.assertRaisesRegex(DataError,'INVALID_BOOLEAN'):merge_csv(template,self.write_csv(cells),self.repo)
        template,cells=self.rows(True);cells[0]['確認者の種別']='llm'
        with self.assertRaisesRegex(DataError,'HUMAN_DECLARATION'):merge_csv(template,self.write_csv(cells),self.repo)
    def test_csv_multiline_families_and_no_overwrite(self):
        template,cells=self.rows(True);cells[0]['追加の同系統ID']='family-a\nfamily-b'
        rows,_=merge_csv(template,self.write_csv(cells),self.repo)
        self.assertEqual(rows[0]['lineage']['additional_family_ids'],['family-a','family-b'])
        out=self.repo/'out.jsonl';out.write_text('existing')
        with self.assertRaisesRegex(DataError,'OUTPUT_ALREADY_EXISTS'):import_csv(template,self.write_csv(cells),self.repo,out,self.repo/'report.json')
