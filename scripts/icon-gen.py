"""
Rudy the red pepper: the app's icon and the little guy beside the spice meter.
Drawn once here in a 1024 box; each asset places him differently.

  python3 scripts/icon-gen.py <out-dir>      writes the SVGs
  swiftc -O scripts/icon-render.swift -o render && ./render in.svg out.png 1024
"""
import os, sys

def rudy(mono=False):
    if mono:  # one flat shape, for Android's themed icon
        return '''
  <path d="M 512 262 C 380 262, 262 330, 262 480 C 262 640, 380 800, 560 890 C 610 915, 680 910, 720 860 C 650 880, 640 820, 690 720 C 740 620, 762 550, 762 480 C 762 330, 644 262, 512 262 Z" fill="#fff"/>
  <path d="M 512 250 C 510 190, 540 140, 600 120" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round"/>
  <path d="M 292 336 C 322 214, 702 214, 732 336 C 690 292, 644 292, 612 344 C 582 292, 542 284, 512 334 C 482 284, 442 292, 412 344 C 380 292, 334 292, 292 336 Z" fill="#fff"/>'''
    return '''
  <path d="M 512 262 C 380 262, 262 330, 262 480 C 262 640, 380 800, 560 890 C 610 915, 680 910, 720 860 C 650 880, 640 820, 690 720 C 740 620, 762 550, 762 480 C 762 330, 644 262, 512 262 Z" fill="url(#body)"/>
  <path d="M 312 470 C 312 560, 356 660, 430 740" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="26" stroke-linecap="round"/>
  <path d="M 512 250 C 510 190, 540 140, 600 120" fill="none" stroke="url(#stem)" stroke-width="56" stroke-linecap="round"/>
  <path d="M 292 336 C 322 214, 702 214, 732 336 C 690 292, 644 292, 612 344 C 582 292, 542 284, 512 334 C 482 284, 442 292, 412 344 C 380 292, 334 292, 292 336 Z" fill="url(#stem)"/>
  <!-- eyes -->
  <ellipse cx="430" cy="478" rx="64" ry="80" fill="#fff"/>
  <ellipse cx="594" cy="478" rx="64" ry="80" fill="#fff"/>
  <circle cx="446" cy="492" r="32" fill="#1B1216"/>
  <circle cx="610" cy="492" r="32" fill="#1B1216"/>
  <circle cx="458" cy="478" r="11" fill="#fff"/>
  <circle cx="622" cy="478" r="11" fill="#fff"/>
  <!-- eyebrows: friendly, one a little cocked -->
  <path d="M 366 388 Q 428 352 486 384" fill="none" stroke="#7A0C14" stroke-width="18" stroke-linecap="round"/>
  <path d="M 540 372 Q 600 336 660 372" fill="none" stroke="#7A0C14" stroke-width="18" stroke-linecap="round"/>
  <!-- nose -->
  <ellipse cx="512" cy="574" rx="36" ry="27" fill="#FF7A55"/>
  <!-- grin -->
  <path d="M 404 628 Q 512 752 620 628 Q 512 668 404 628 Z" fill="#5A0A10"/>
  <path d="M 470 668 Q 512 708 554 668 Q 512 684 470 668 Z" fill="#FF7A8A"/>'''

DEFS = '''
  <defs>
    <linearGradient id="body" x1="0.8" y1="0.05" x2="0.25" y2="0.95">
      <stop offset="0" stop-color="#FF5A3A"/><stop offset=".5" stop-color="#EE2B2B"/><stop offset="1" stop-color="#B8121F"/>
    </linearGradient>
    <linearGradient id="stem" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5BD06A"/><stop offset="1" stop-color="#22873A"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".55" r=".62">
      <stop offset="0" stop-color="#5C1B12"/><stop offset=".6" stop-color="#1D1217"/><stop offset="1" stop-color="#0E1117"/>
    </radialGradient>
  </defs>'''

def svg(inner):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{DEFS}{inner}\n</svg>'

BG = '<rect width="1024" height="1024" fill="url(#glow)"/>'

def placed(scale, mono=False):
    # scale about Rudy's own center
    return f'<g transform="translate(512 512) scale({scale}) translate(-512 -512)">{rudy(mono)}</g>'

OUT = {
    'icon': svg(BG + placed(1.08)),
    'fg': svg(placed(0.66)),        # Android adaptive: inside the middle two thirds
    'bg': svg(BG),
    'mono': svg(placed(0.66, True)),
    'splash': svg(placed(1.15)),
    'mark': svg(placed(1.2)),
    'rudy': svg(placed(1.2)),       # in the app, beside the spice meter
}
out = sys.argv[1] if len(sys.argv) > 1 else '.'
for name, text in OUT.items():
    open(os.path.join(out, f'{name}.svg'), 'w').write(text)
