#!/usr/bin/env python3
"""Bind local fictional-case pilots to a read-only Word/passport snapshot.

The binding JSON is supplied by the caller, not authenticated by this tool.
This report is diagnostic only and is never application quality evidence.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

from word_page_pilot import check_image, digest


HEX64 = re.compile(r'^[a-f0-9]{64}$')
UUID = re.compile(r'^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$')


def report(word, binding_path, manifest_path):
    binding = json.loads(binding_path.read_text(encoding='utf-8'))
    required_ids = ('request_id', 'passport_id', 'binding_id', 'version_id')
    required_hashes = ('file_hash', 'document_hash', 'source_fingerprint', 'document_fingerprint')
    if any(not UUID.fullmatch(str(binding.get(k, ''))) for k in required_ids):
        raise ValueError('BINDING_IDS_INVALID')
    if any(not HEX64.fullmatch(str(binding.get(k, ''))) for k in required_hashes):
        raise ValueError('BINDING_HASHES_INVALID')
    if binding.get('passport_status') != 'approved' or not isinstance(binding.get('passport_revision'), int) or binding['passport_revision'] < 1:
        raise ValueError('BINDING_CONTEXT_INVALID')
    word_hash = digest(word)
    if word_hash != binding['file_hash']:
        raise ValueError('WORD_NOT_STORED_VERSION')

    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    pages = manifest.get('pages')
    if manifest.get('source_sha256') != word_hash or manifest.get('source_bytes') != word.stat().st_size:
        raise ValueError('PAGE_MANIFEST_STALE')
    if not isinstance(pages, list) or len(pages) != manifest.get('page_count') or not pages:
        raise ValueError('PAGE_SET_INCOMPLETE')
    for number, page in enumerate(pages, 1):
        expected_name = f'page-{number:03d}.png'
        if page.get('page') != number or page.get('file') != expected_name or not HEX64.fullmatch(str(page.get('sha256', ''))):
            raise ValueError('PAGE_SET_INCOMPLETE')
        image = manifest_path.parent / expected_name
        check_image(image, page.get('pdf_text_chars', 0))
        if digest(image) != page['sha256']:
            raise ValueError('PAGE_IMAGE_CHANGED')

    calculation = subprocess.run([sys.executable, str(Path(__file__).with_name('tusur_case_calc_pilot.py')),
                                  str(word)], capture_output=True, text=True, timeout=30)
    if calculation.returncode not in (0, 1):
        raise ValueError('CALC_PILOT_UNAVAILABLE')
    calc = json.loads(calculation.stdout)
    if calc.get('word_sha256') != word_hash or calc.get('checked_cells') != 116:
        raise ValueError('CALC_PILOT_INCOMPLETE')
    context = {k: binding[k] for k in (*required_ids, *required_hashes, 'passport_revision')}
    result = {
        'context': context,
        'page_diagnostic': {'renderer': manifest['renderer'], 'page_count': len(pages),
                            'page_image_sha256': [p['sha256'] for p in pages],
                            'all_images_present_and_nonblank_when_text_exists': True,
                            'visually_reviewed': False},
        'calculation_diagnostic': {'scope': calc['scope'], 'checked_cells': calc['checked_cells'],
                                   'mismatches': calc['mismatches'],
                                   'rounding_observation': {
                                       'revenue_from_printed_prices': calc['revenue_from_printed_prices'],
                                       'revenue_from_unrounded_prices': calc['revenue_from_unrounded_prices']}},
        'requirement_status': {'CALCULATIONS': 'not_checked', 'FORMATTING': 'not_checked'},
        'limits': 'Caller-supplied binding snapshot; fixed fictional inputs; LibreOffice render; no visual review, source-item provenance, app ingestion or delivery approval.'
    }
    result['diagnostic_sha256'] = hashlib.sha256(json.dumps(result, ensure_ascii=False, sort_keys=True,
                                                            separators=(',', ':')).encode()).hexdigest()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('word', type=Path)
    parser.add_argument('binding_json', type=Path)
    parser.add_argument('page_manifest_json', type=Path)
    parser.add_argument('output_json', type=Path)
    args = parser.parse_args()
    if args.output_json.exists():
        parser.error('OUTPUT_ALREADY_EXISTS')
    try:
        result = report(args.word, args.binding_json, args.page_manifest_json)
    except (ValueError, KeyError, OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        parser.error(str(error))
    args.output_json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'diagnostic_sha256': result['diagnostic_sha256'],
                      'word_sha256': result['context']['file_hash'],
                      'pages': result['page_diagnostic']['page_count'],
                      'checked_cells': result['calculation_diagnostic']['checked_cells']}, ensure_ascii=False))
