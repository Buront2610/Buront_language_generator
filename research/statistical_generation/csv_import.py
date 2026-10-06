"""Merge explicitly filled workbook CSV cells onto immutable source templates."""
import copy
import csv
import io
from pathlib import Path
from .data import DataError, SourceCatalog, load_annotations, validate_pairs
from .pipeline import write_json

HEADERS = ['番号','原文（変更不可）','普通の日本語（人が記入）','記入者ID','記入者の種別','人が作成','作成に生成AI等を不使用','確認者ID','確認者の種別','人が確認済み','意味の保持を確認','出典・帰属を確認','重複・派生関係を確認','確認に生成AI等を不使用','追加の同系統ID','ペアID（変更不可）','出典URL（変更不可）']
BOOLEANS = {'人が作成':('annotation','human_authored'),'作成に生成AI等を不使用':('annotation','no_llm_or_synthetic'),'人が確認済み':('review','reviewed'),'意味の保持を確認':('review','meaning_preserved'),'出典・帰属を確認':('review','source_verified'),'重複・派生関係を確認':('review','lineage_reviewed'),'確認に生成AI等を不使用':('review','no_llm_or_synthetic')}
TEXT_FIELDS = {'普通の日本語（人が記入）':(None,'ordinary_text'),'記入者ID':('annotation','annotator_id'),'記入者の種別':('annotation','author_type'),'確認者ID':('review','reviewer_id'),'確認者の種別':('review','author_type')}

def merge_csv(template, csv_file, repo):
    templates=load_annotations(template)
    catalog=SourceCatalog(repo)
    expected={}
    for number,row in enumerate(templates,1):
        original=catalog.annotation(row['source']['sentence_id'])
        for key in ('pair_id','original_text','source','context','lineage'):
            if row[key]!=original[key]: raise DataError('CSV_TEMPLATE_SOURCE_MISMATCH')
        if row['pair_id'] in expected: raise DataError('DUPLICATE_TEMPLATE_PAIR_ID')
        expected[row['pair_id']]=(number,original)
    path=Path(csv_file)
    if path.stat().st_size>32*1024*1024: raise DataError('CSV_TOO_LARGE')
    reader=csv.DictReader(io.StringIO(path.read_text(encoding='utf-8-sig'),newline=''))
    if reader.fieldnames!=HEADERS: raise DataError('CSV_HEADERS_MISMATCH')
    seen=set(); accepted=[]; excluded=[]
    for cells in reader:
        if None in cells or any(v is None for v in cells.values()): raise DataError('CSV_COLUMN_COUNT_MISMATCH')
        if not any(cells.values()): continue
        pair_id=cells['ペアID（変更不可）']
        if pair_id not in expected: raise DataError('CSV_UNKNOWN_PAIR_ID')
        if pair_id in seen: raise DataError('CSV_DUPLICATE_PAIR_ID')
        seen.add(pair_id)
        number,row=expected[pair_id]; row=copy.deepcopy(row)
        if cells['番号']!=str(number) or cells['原文（変更不可）']!=row['original_text'] or cells['出典URL（変更不可）']!=(row['source']['post_url'] or ''):
            raise DataError('CSV_IMMUTABLE_SOURCE_MISMATCH:'+pair_id)
        missing=[]
        for header,(section,key) in TEXT_FIELDS.items():
            value=cells[header]
            if not value.strip(): missing.append(header)
            if key=='author_type' and value not in ('','human'): raise DataError('CSV_HUMAN_DECLARATION_REQUIRED:'+header)
            (row if section is None else row[section])[key]=value
        for header,(section,key) in BOOLEANS.items():
            value=cells[header]
            if value not in ('','はい','いいえ'): raise DataError('CSV_INVALID_BOOLEAN:'+header)
            row[section][key]=value=='はい'
            if value!='はい': missing.append(header)
        row['lineage']['additional_family_ids']=[line.strip() for line in cells['追加の同系統ID'].splitlines() if line.strip()]
        if missing: excluded.append({'pair_id':pair_id,'unconfirmed_fields':missing})
        else: accepted.append(row)
    absent=sorted(set(expected)-seen)
    excluded.extend({'pair_id':pid,'unconfirmed_fields':['CSV行なし']} for pid in absent)
    validated=validate_pairs(accepted,repo) if accepted else []
    return validated,{'schema_version':1,'status':'human_rows_imported' if validated else 'no_approved_human_rows','template_rows':len(templates),'csv_rows':len(seen),'imported_rows':len(validated),'excluded_rows':excluded,'note':'Only explicit human declarations and all required はい cells are imported. Blank/いいえ never becomes approval.'}

def import_csv(template,csv_file,repo,out,report):
    out,report=Path(out),Path(report)
    if out.resolve()==report.resolve() or out.exists() or report.exists(): raise DataError('OUTPUT_ALREADY_EXISTS')
    rows,result=merge_csv(template,csv_file,repo)
    if rows:
        out.parent.mkdir(parents=True,exist_ok=True)
        with out.open('x',encoding='utf-8') as stream:
            import json
            for row in rows: stream.write(json.dumps(row,ensure_ascii=False)+'\n')
    report.parent.mkdir(parents=True,exist_ok=True)
    with report.open("x",encoding="utf-8") as stream:
        import json
        json.dump(result,stream,ensure_ascii=False,indent=2);stream.write("\n")
    return result
