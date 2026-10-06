"""Symbol alignment mechanics only, not language or semantic-quality labels."""
import unittest
from .alignment import sentence_spans,align_windows

class AlignmentTests(unittest.TestCase):
    def test_boundaries_preserve_quoted_punctuation(self):
        text='ax。\n「bx。cx。」\ndx。'
        spans=sentence_spans(text,0,len(text))
        self.assertEqual([text[a:b] for a,b in spans],['ax。','「bx。cx。」','dx。'])
    def test_pair_spans_are_original_slices(self):
        a='ax bx。cx dx。ex fx。';b='ax bz。cx dz。ex fz。'
        pairs,_=align_windows(a,b,(0,len(a)),(0,len(b)))
        self.assertEqual(len(pairs),3)
        self.assertEqual([(a[x['source'][0]:x['source'][1]],b[x['target'][0]:x['target'][1]]) for x in pairs],[('ax bx。','ax bz。'),('cx dx。','cx dz。'),('ex fx。','ex fz。')])
    def test_unmatched_insertions_are_recorded(self):
        a='aaaa。bbbb。';b='aaaa。ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ。bbbb。'
        pairs,report=align_windows(a,b,(0,len(a)),(0,len(b)))
        self.assertEqual(len(pairs),2);self.assertEqual(report['unmatched_target_units'],1)
    def test_no_overlap_not_fabricated(self):
        a='aaaa。';b='zzzz。'
        pairs,report=align_windows(a,b,(0,len(a)),(0,len(b)))
        self.assertEqual(pairs,[]);self.assertEqual(report['unmatched_source_units'],1)

if __name__=='__main__':unittest.main()
