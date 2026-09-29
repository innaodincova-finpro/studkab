import importlib.util
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()
