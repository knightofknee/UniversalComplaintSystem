"""
Rudy the red pepper: the app's icon and the little guy beside the spice meter.
Drawn once here in a 1024 box; each asset places him differently.

  python3 scripts/icon-gen.py <out-dir>      writes the SVGs
  swiftc -O scripts/icon-render.swift -o render && ./render in.svg out.png 1024
"""
import os, sys

def face(mood):
    """His expression. 1 beaming, 2 happy, 3 neutral, 4 worried, 5 crying."""
    sad = mood >= 4
    py = 506 if sad else 492          # sad eyes look down
    hy = py - 14
    out = f'''
  <ellipse cx="430" cy="478" rx="64" ry="80" fill="#fff"/>
  <ellipse cx="594" cy="478" rx="64" ry="80" fill="#fff"/>
  <circle cx="{438 if sad else 446}" cy="{py}" r="32" fill="#1B1216"/>
  <circle cx="{602 if sad else 610}" cy="{py}" r="32" fill="#1B1216"/>
  <circle cx="{450 if sad else 458}" cy="{hy}" r="11" fill="#fff"/>
  <circle cx="{614 if sad else 622}" cy="{hy}" r="11" fill="#fff"/>'''
    brow = 'fill="none" stroke="#7A0C14" stroke-width="18" stroke-linecap="round"'
    if mood <= 2:
        out += f'''
  <path d="M 366 388 Q 428 352 486 384" {brow}/>
  <path d="M 540 372 Q 600 336 660 372" {brow}/>'''
    elif mood == 3:
        out += f'''
  <path d="M 370 380 L 486 378" {brow}/>
  <path d="M 540 378 L 656 380" {brow}/>'''
    else:  # inner ends lifted
        out += f'''
  <path d="M 362 408 Q 428 380 488 352" {brow}/>
  <path d="M 536 352 Q 596 380 662 408" {brow}/>'''
    out += '''
  <ellipse cx="512" cy="574" rx="36" ry="27" fill="#FF7A55"/>'''
    line = 'fill="none" stroke="#5A0A10" stroke-width="24" stroke-linecap="round"'
    if mood == 1:
        out += '''
  <circle cx="350" cy="596" r="40" fill="#FF9AA8" fill-opacity=".45"/>
  <circle cx="674" cy="596" r="40" fill="#FF9AA8" fill-opacity=".45"/>
  <path d="M 404 628 Q 512 752 620 628 Q 512 668 404 628 Z" fill="#5A0A10"/>
  <path d="M 470 668 Q 512 708 554 668 Q 512 684 470 668 Z" fill="#FF7A8A"/>'''
    elif mood == 2:
        out += f'''
  <path d="M 420 640 Q 512 726 604 640" {line}/>'''
    elif mood == 3:
        out += f'''
  <path d="M 440 672 L 584 672" {line}/>'''
    elif mood == 4:
        out += f'''
  <path d="M 440 696 Q 512 640 584 696" {line}/>'''
    else:
        out += '''
  <path d="M 424 712 Q 512 616 600 712 Q 512 676 424 712 Z" fill="#5A0A10"/>
  <path d="M 388 556 C 356 606, 352 644, 388 656 C 424 644, 420 606, 388 556 Z" fill="#7FD0FF"/>
  <path d="M 640 556 C 608 606, 604 644, 640 656 C 676 644, 672 606, 640 556 Z" fill="#7FD0FF"/>'''
    return out

def rudy(mono=False, mood=1):
    if mono:  # one flat shape, for Android's themed icon
        return '''
  <path d="M 512 262 C 380 262, 262 330, 262 480 C 262 640, 380 800, 560 890 C 610 915, 680 910, 720 860 C 650 880, 640 820, 690 720 C 740 620, 762 550, 762 480 C 762 330, 644 262, 512 262 Z" fill="#fff"/>
  <path d="M 512 250 C 510 190, 540 140, 600 120" fill="none" stroke="#fff" stroke-width="56" stroke-linecap="round"/>
  <path d="M 292 336 C 322 214, 702 214, 732 336 C 690 292, 644 292, 612 344 C 582 292, 542 284, 512 334 C 482 284, 442 292, 412 344 C 380 292, 334 292, 292 336 Z" fill="#fff"/>'''
    return '''
  <path d="M 512 262 C 380 262, 262 330, 262 480 C 262 640, 380 800, 560 890 C 610 915, 680 910, 720 860 C 650 880, 640 820, 690 720 C 740 620, 762 550, 762 480 C 762 330, 644 262, 512 262 Z" fill="url(#body)"/>
  <path d="M 312 470 C 312 560, 356 660, 430 740" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="26" stroke-linecap="round"/>
  <path d="M 512 250 C 510 190, 540 140, 600 120" fill="none" stroke="url(#stem)" stroke-width="56" stroke-linecap="round"/>
  <path d="M 292 336 C 322 214, 702 214, 732 336 C 690 292, 644 292, 612 344 C 582 292, 542 284, 512 334 C 482 284, 442 292, 412 344 C 380 292, 334 292, 292 336 Z" fill="url(#stem)"/>{FACE}'''.replace('{FACE}', face(mood))

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

def placed(scale, mono=False, mood=1):
    # scale about Rudy's own center
    return f'<g transform="translate(512 512) scale({scale}) translate(-512 -512)">{rudy(mono, mood)}</g>'

OUT = {
    'icon': svg(BG + placed(1.08)),
    'fg': svg(placed(0.66)),        # Android adaptive: inside the middle two thirds
    'bg': svg(BG),
    'mono': svg(placed(0.66, True)),
    'splash': svg(placed(1.15)),
    'mark': svg(placed(1.2)),
    # In the app, beside the spice meter: one face per pepper level.
    **{f'rudy-{m}': svg(placed(1.2, mood=m)) for m in range(1, 6)},
}
out = sys.argv[1] if len(sys.argv) > 1 else '.'
for name, text in OUT.items():
    open(os.path.join(out, f'{name}.svg'), 'w').write(text)
