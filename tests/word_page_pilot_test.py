import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw


spec = importlib.util.spec_from_file_location(
    'word_page_pilot', Path(__file__).resolve().parents[1] / 'tools' / 'word_page_pilot.py'
)
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class PageImageCheck(unittest.TestCase):
    def test_valid_blank_png_cannot_stand_in_for_text_page(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'page.png'
            Image.new('RGB', (993, 1404), 'white').save(path)
            with self.assertRaisesRegex(RuntimeError, 'PAGE_IMAGE_BLANK_WITH_TEXT'):
                pilot.check_image(path, text_chars=927)
            image = Image.new('RGB', (993, 1404), 'white')
            ImageDraw.Draw(image).text((150, 100), 'A page with visible content', fill='black')
            image.save(path)
            pilot.check_image(path, text_chars=27)

    def test_saved_page_set_is_rechecked_before_use(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            word = base / 'source.docx'
            with zipfile.ZipFile(word, 'w') as archive:
                archive.writestr('[Content_Types].xml', '<Types/>')
                archive.writestr('word/document.xml', '<document/>')
            pages = base / 'pages'
            pages.mkdir()
            image = pages / 'page-001.png'
            canvas = Image.new('RGB', (200, 280), 'white')
            ImageDraw.Draw(canvas).text((20, 30), 'Synthetic page', fill='black')
            canvas.save(image)
            entry = {'page': 1, 'file': image.name, 'sha256': pilot.digest(image),
                     'pdf_text_chars': 0}
            manifest = {'source_sha256': pilot.digest(word), 'source_bytes': word.stat().st_size,
                        'page_count': 1, 'pages': [entry]}
            (pages / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            self.assertEqual(pilot.verify_output(word, pages)['page_count'], 1)

            image.write_bytes(image.read_bytes()[:100])
            with self.assertRaisesRegex(RuntimeError, 'PAGE_IMAGE_CORRUPT'):
                pilot.verify_output(word, pages)
            canvas.save(image)
            word.write_bytes(word.read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, 'PAGE_MANIFEST_STALE'):
                pilot.verify_output(word, pages)
            word.write_bytes(word.read_bytes()[:-7])
            manifest['page_count'] = 2
            (pages / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'PAGE_SET_INCOMPLETE'):
                pilot.verify_output(word, pages)


if __name__ == '__main__':
    unittest.main()
