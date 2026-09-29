#!/usr/bin/env python3
"""Local, offline DOCX page rendering pilot for synthetic STUDKAB requests.

This tool makes reviewable page images. It does not certify Microsoft Word
fidelity, inspect the pages, or write quality evidence to the application.
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from PIL import Image


MAX_DOCX_BYTES = 20 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_PAGES = 60


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args, timeout=90):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


def check_docx(path):
    if path.suffix.lower() != '.docx' or not 0 < path.stat().st_size <= MAX_DOCX_BYTES:
        raise ValueError('DOCX_REQUIRED_OR_TOO_LARGE')
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        if not {'[Content_Types].xml', 'word/document.xml'} <= names:
            raise ValueError('INVALID_DOCX')
        if sum(member.file_size for member in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
            raise ValueError('DOCX_EXPANDED_TOO_LARGE')


def check_image(path, text_chars=0):
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError('PAGE_IMAGE_MISSING')
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
            # A rasterizer may exit successfully and produce a valid but blank
            # PNG. Compare ink with the independently extracted PDF page text.
            if text_chars:
                gray = image.convert('L').resize((200, 280))
                ink = sum(value < 245 for value in gray.tobytes())
                if ink < (20 if text_chars >= 20 else 1):
                    raise RuntimeError('PAGE_IMAGE_BLANK_WITH_TEXT')
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError('PAGE_IMAGE_CORRUPT') from exc


def render(source, destination):
    source = source.resolve(strict=True)
    check_docx(source)
    if destination.exists():
        raise ValueError('OUTPUT_ALREADY_EXISTS')
    for name in ('soffice', 'pdfinfo', 'pdftocairo', 'pdftotext'):
        if shutil.which(name) is None:
            raise RuntimeError(f'MISSING_RENDERER:{name}')

    # Keep the converter profile and intermediate PDF separate from the output.
    with tempfile.TemporaryDirectory(prefix='studkab-pages-') as tmp:
        work = Path(tmp)
        docx = work / 'input.docx'
        shutil.copyfile(source, docx)
        version = run(['soffice', '--version']).strip()
        run(['soffice', '-env:UserInstallation=' + (work / 'profile').as_uri(),
             '--headless', '--convert-to', 'pdf:writer_pdf_Export',
             '--outdir', str(work), str(docx)])
        pdf = work / 'input.pdf'
        if not pdf.is_file():
            raise RuntimeError('PDF_NOT_CREATED')
        info = run(['pdfinfo', str(pdf)])
        match = re.search(r'^Pages:\s+(\d+)\s*$', info, re.M)
        if not match or not 1 <= int(match.group(1)) <= MAX_PAGES:
            raise ValueError('PAGE_COUNT_INVALID_OR_TOO_LARGE')
        pages = int(match.group(1))
        destination.mkdir(parents=True)
        try:
            rendered = []
            def rasterize(number, target):
                text_chars = len(run(['pdftotext', '-f', str(number), '-l', str(number),
                                      str(pdf), '-']).strip())
                for attempt in range(3):
                    target.unlink(missing_ok=True)
                    run(['pdftocairo', '-f', str(number), '-l', str(number),
                         '-singlefile', '-r', '120', '-png', str(pdf),
                         str(target.with_suffix(''))])
                    try:
                        check_image(target, text_chars)
                        return text_chars
                    except RuntimeError:
                        if attempt == 2:
                            raise

            for number in range(1, pages + 1):
                name = f'page-{number:03d}.png'
                target = destination / name
                text_chars = rasterize(number, target)
                rendered.append({'page': number, 'file': name, 'sha256': digest(target),
                                 'pdf_text_chars': text_chars})
            # Recheck the complete set after conversion: a truncated PNG may
            # appear even if a converter returned a successful process status.
            for page in rendered:
                target = destination / page['file']
                try:
                    check_image(target, page['pdf_text_chars'])
                    if digest(target) != page['sha256']:
                        raise RuntimeError('PAGE_IMAGE_CHANGED')
                except RuntimeError:
                    rasterize(page['page'], target)
                    page['sha256'] = digest(target)
            for page in rendered:
                target = destination / page['file']
                check_image(target, page['pdf_text_chars'])
                if digest(target) != page['sha256']:
                    raise RuntimeError('PAGE_IMAGE_CHANGED')
            manifest = {'source_sha256': digest(source), 'source_bytes': source.stat().st_size,
                        'renderer': version, 'page_count': pages, 'pdf_sha256': digest(pdf),
                        'rasterizer': 'pdftocairo 120 dpi PNG',
                        'pages': rendered,
                        'scope': 'synthetic local pilot; no visual or Microsoft Word certification'}
            (destination / 'manifest.json').write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            return manifest
        except BaseException:
            shutil.rmtree(destination)
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('docx', type=Path)
    parser.add_argument('output_dir', type=Path)
    args = parser.parse_args()
    result = render(args.docx, args.output_dir)
    print(json.dumps({'source_sha256': result['source_sha256'],
                      'page_count': result['page_count'], 'output_dir': str(args.output_dir)},
                     ensure_ascii=False))
