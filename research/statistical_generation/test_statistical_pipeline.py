import copy
import json
import tempfile
import unittest
from pathlib import Path
from .text import Tokenizer, Tokens, encode, decode
from .pipeline import MODEL_VERSION, FEATURE_VERSION, digest, parse_segmented, language_scores, sha, train, verify_model, write_json
from .evaluation import review_content_hash, summarize_reviews
from .__main__ import fixture_rows

class SurfaceTests(unittest.TestCase):
    def setUp(self): self.t=Tokenizer(mechanical=True)
    def test_zero_width_normalization_morphemes_do_not_change_surface(self):
        self.t.raw_tokens=lambda text:[('…',0,1,False),('',1,1,False),('',1,1,False)]
        result=self.t.tokenize('…')
        self.assertEqual(result.words,[encode('…')])
        self.assertEqual(self.t.restore(result.words,result)[0],'…')
    def test_reserved_surface_roundtrip(self):
        for s in ('|||','P0000','<s>','<unk>','a b','　\n', '日本語'):
            self.assertEqual(decode(encode(s)),s)
    def test_multiline_whitespace_roundtrip(self):
        source=self.t.tokenize('ax  bx\n  cx')
        self.assertEqual(self.t.restore(source.words,source)[0],source.raw)
    def test_quote_number_opaque_protection(self):
        source=self.t.tokenize('ax 「12個です」 34円 https://example.com/x')
        self.assertEqual([p['kind'] for p in source.protected],['quotation','quantity','opaque'])
        self.assertEqual(self.t.restore(source.words,source)[0],source.raw)
    def test_missing_duplicate_and_reordered_rejected(self):
        source=self.t.tokenize('12円 34円')
        for words in (['P0000'],['P0000','P0000'],['P0001','P0000']):
            _, diagnostics=self.t.restore(words,source)
            self.assertTrue(any(d['severity']=='reject' for d in diagnostics))
    def test_fully_protected_source_cannot_gain_unbound_content(self):
        source=self.t.tokenize('「ax bx」')
        _,diagnostics=self.t.restore([encode('cx '),*source.words],source)
        self.assertIn('fully_protected_input_added_content',[d['kind'] for d in diagnostics])
        _,unchanged=self.t.restore(source.words,source)
        self.assertFalse(any(d['severity']=='reject' for d in unchanged))
    def test_added_number_rejected(self):
        source=self.t.tokenize('ax')
        _,diagnostics=self.t.restore([encode('12円')],source)
        self.assertIn('quantity_inventory_mismatch',[d['kind'] for d in diagnostics])
    def test_unknown_placeholder_rejected(self):
        source=self.t.tokenize('ax')
        _,d=self.t.restore(['P0099'],source)
        self.assertTrue(any(x['severity']=='reject' for x in d))
    def test_modality_never_claims_semantic_pass(self):
        source=self.t.tokenize('ax かもしれない')
        _,d=self.t.restore([encode('ax')],source)
        self.assertIn('modality_surface_cue_mismatch',[x['kind'] for x in d])
        self.assertIn('semantics_unverified',[x['kind'] for x in d])
    def test_pair_protected_value_mismatch_rejected(self):
        source=self.t.tokenize('12円')
        with self.assertRaisesRegex(ValueError,'PAIR_PROTECTED_VALUE_MISMATCH'): self.t.tokenize('13円',source.protected)
    def test_pair_extra_protected_value_rejected(self):
        source=self.t.tokenize('12円')
        with self.assertRaisesRegex(ValueError,'PAIR_PROTECTED_VALUE_MISMATCH'): self.t.tokenize('12円 12円',source.protected)
    def test_unicode_offset_unit(self):
        source=self.t.tokenize('😀 12円')
        self.assertEqual(source.protected[0]['start'],2)
    def test_protected_literal_cannot_be_reinserted(self):
        source=Tokens('Tokyo arrived.',['P0000',encode(' arrived.')],[],[{'token':'P0000','text':'Tokyo','kind':'proper_noun'}])
        _,d=self.t.restore(['P0000',encode(' arrived. Tokyo')],source)
        self.assertIn('protected_literal_inventory_mismatch',[x['kind'] for x in d])
    def test_empty_or_too_long_rejected(self):
        for s in ('','a'*5001):
            with self.assertRaises(ValueError): self.t.tokenize(s)

class ProtocolTests(unittest.TestCase):
    def test_segmentation(self):
        words,spans=parse_segmented('u61 u62 u63','0-1=0-1 2=2')
        self.assertEqual(words,['u61','u62','u63'])
        self.assertEqual(spans[0]['source_token_end'],2)
        self.assertEqual(spans[1]['target_token_start'],2)
    def test_no_segmentation_fails(self):
        for seg in ('','0=0 1=0','not-a-range'):
            with self.assertRaisesRegex(ValueError,'SEGMENTATION_REQUIRED'): parse_segmented('u61 u62',seg)
    def test_kenlm_parser(self):
        self.assertEqual(language_scores('a=1 Total: -2.45 OOV: 1\nPerplexity: 3\n'),[{'log10_probability':-2.45,'oov_count':1}])
    def test_no_split_training_fails_before_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'FROZEN_SPLIT_REQUIRED'):
                train([],{'train':[{}],'dev':[{}],'test':[{}]},Path(tmp)/'model','nonexistent')
    def test_model_version_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_json(Path(tmp)/'manifest.json',{'model_version':'bad','feature_version':FEATURE_VERSION})
            with self.assertRaisesRegex(ValueError,'MODEL_VERSION_MISMATCH'): verify_model(tmp)
    def test_artifact_tampering_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);(p/'file').write_text('old')
            write_json(p/'manifest.json',{'model_version':MODEL_VERSION,'feature_version':FEATURE_VERSION,'artifacts':{'file':sha(p/'file')}})
            (p/'file').write_text('changed')
            with self.assertRaisesRegex(ValueError,'ARTIFACT_MISMATCH'): verify_model(tmp)
    def test_fixture_is_mechanical(self):
        rows,splits=fixture_rows()
        self.assertEqual(len(rows),16)
        self.assertEqual(splits['test'][0]['ordinary_text'],'dx dx')
        self.assertTrue(all('not-human-not-language' in r['provenance'] for r in rows))

class ReviewTests(unittest.TestCase):
    def setup_pack(self,path,purpose='candidate_pool_human_review'):
        pack={'purpose':purpose,'annotation':{'author_type':'human','annotator_id':'mechanical-test-identity','no_llm_or_synthetic':True},'cases':[{'case_id':'test','input':'ax','group':'g1','candidates':[{'candidate_id':'id','text':'az','meaning_preserved':None,'buront_style_good':None,'readable':None,'reason':''}]}]}
        pack['review_content_sha256']=review_content_hash(pack)
        for name in ('baseline.json','research.json'):write_json(path/name,{'mechanical_test':True})
        private={'review_content_sha256':pack['review_content_sha256'],'candidate_origins':[{'case_id':'test','candidate_id':'id','methods':['research'],'eligible_research':True}],'baseline_sha256':sha(path/'baseline.json'),'research_sha256':sha(path/'research.json')}
        write_json(path/'review.private.json',private);write_json(path/'review.json',pack)
        return pack
    def test_blank_judgments_not_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);self.setup_pack(p)
            result=summarize_reviews(p,p/'review.json')
            self.assertEqual(result['fully_reviewed_inputs'],0);self.assertIsNone(result['rate'])
    def test_llm_authored_labels_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);pack=self.setup_pack(p);pack['annotation']['author_type']='llm';write_json(p/'review.json',pack)
            with self.assertRaisesRegex(ValueError,'HUMAN_REVIEW_REQUIRED'):summarize_reviews(p,p/'review.json')
    def test_tampered_output_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);pack=self.setup_pack(p);pack['cases'][0]['candidates'][0]['text']='zz';write_json(p/'review.json',pack)
            with self.assertRaisesRegex(ValueError,'REVIEW_CONTENT_MISMATCH'):summarize_reviews(p,p/'review.json')
    def test_fixture_cannot_be_quality_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);self.setup_pack(p,'mechanical_wiring_only')
            with self.assertRaisesRegex(ValueError,'FIXTURE_NOT_QUALITY_EVIDENCE'):summarize_reviews(p,p/'review.json')

if __name__=='__main__':unittest.main()
