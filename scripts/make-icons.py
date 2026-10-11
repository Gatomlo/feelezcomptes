"""Régénère les icônes PNG de l'app à partir de public/logo.svg.

Rendu par Edge ou Chrome en mode sans fenêtre (à 1024 px), puis réduction avec Pillow.
Usage : python scripts/make-icons.py
- logo.png (512), icon-384.png, icon-192.png : icône aux coins arrondis (fond transparent autour) ;
- icon-maskable-512.png, apple-touch-icon.png (180) : fond plein jusqu'aux bords, dessin
  réduit à 80 % (zone sûre des icônes « maskable » Android ; iOS arrondit lui-même).
"""
import os
import re
import subprocess
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
]
SIZE = 1024
BG = '#B4532F'


def render(svg_markup, out_png, transparent):
    browser = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not browser:
        raise SystemExit('Edge ou Chrome introuvable.')
    html = ('<!doctype html><html><head><style>html,body{margin:0;background:%s}svg{display:block;width:%dpx;height:%dpx}</style>'
            '</head><body>%s</body></html>') % ('transparent' if transparent else BG, SIZE, SIZE, svg_markup)
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, 'logo.html')
        with open(page, 'w', encoding='utf-8') as f:
            f.write(html)
        args = [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                '--window-size=%d,%d' % (SIZE, SIZE), '--screenshot=' + out_png]
        if transparent:
            args.append('--default-background-color=00000000')
        subprocess.run(args + ['file:///' + page.replace('\\', '/')], check=True, capture_output=True, timeout=60)


def main():
    with open(os.path.join(PUBLIC, 'logo.svg'), encoding='utf-8') as f:
        svg = f.read()
    inner = svg[svg.index('>') + 1:svg.rindex('</svg>')]
    # Version pleine (maskable) : fond carré, dessin réduit à 80 % au centre, sans le fond arrondi.
    body = re.sub(r'<rect width="512" height="512" rx="114"[^>]*></rect>', '', inner, count=1)
    full = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="%s"/>'
            '<g transform="translate(51.2 51.2) scale(0.8)">%s</g></svg>') % (BG, body)

    with tempfile.TemporaryDirectory() as tmp:
        rounded_png = os.path.join(tmp, 'rounded.png')
        full_png = os.path.join(tmp, 'full.png')
        render(svg, rounded_png, transparent=True)
        render(full, full_png, transparent=False)
        rounded = Image.open(rounded_png).convert('RGBA')
        plain = Image.open(full_png).convert('RGB')
        for name, size in [('logo.png', 512), ('icon-384.png', 384), ('icon-192.png', 192)]:
            rounded.resize((size, size), Image.LANCZOS).save(os.path.join(PUBLIC, name), optimize=True)
        plain.resize((512, 512), Image.LANCZOS).save(os.path.join(PUBLIC, 'icon-maskable-512.png'), optimize=True)
        plain.resize((180, 180), Image.LANCZOS).save(os.path.join(PUBLIC, 'apple-touch-icon.png'), optimize=True)
    print('Icônes régénérées dans public/.')


if __name__ == '__main__':
    main()
