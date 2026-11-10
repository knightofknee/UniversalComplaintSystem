import sys
# The pepper, drawn once in a 1024 box; each asset places it differently.
def pepper(mono=False):
    if mono:
        body = 'fill="#fff"'; stem = '#fff'; extra = ''
    else:
        body = 'fill="url(#body)"'; stem = 'url(#stem)'
        extra = '''
  <path d="M 742 372 C 772 470, 716 600, 566 708" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="30" stroke-linecap="round"/>'''
    return f'''
  <path d="M 606 292 C 700 236, 838 318, 816 474 C 792 664, 592 850, 318 834 C 228 828, 160 792, 132 716 C 190 772, 284 782, 372 744 C 478 696, 538 592, 542 452 C 545 378, 558 320, 606 292 Z" {body}/>{extra}
  <path d="M 676 300 C 682 236, 722 190, 786 172" fill="none" stroke="{stem}" stroke-width="50" stroke-linecap="round"/>
  <path d="M 548 346 C 584 262, 742 236, 812 334 C 772 306, 728 312, 700 344 C 670 306, 620 308, 590 344 C 578 336, 562 338, 548 346 Z" fill="{stem}"/>'''
DEFS = '''
  <defs>
    <linearGradient id="body" x1="0.85" y1="0.1" x2="0.2" y2="0.95">
      <stop offset="0" stop-color="#FF6A3D"/><stop offset=".45" stop-color="#F02D2D"/><stop offset="1" stop-color="#B0101F"/>
    </linearGradient>
    <linearGradient id="stem" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5BD06A"/><stop offset="1" stop-color="#22873A"/>
    </linearGradient>
    <radialGradient id="glow" cx=".52" cy=".56" r=".62">
      <stop offset="0" stop-color="#5C1B12"/><stop offset=".6" stop-color="#1D1217"/><stop offset="1" stop-color="#0E1117"/>
    </radialGradient>
  </defs>'''
def svg(inner): return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{DEFS}{inner}\n</svg>'
BG = '<rect width="1024" height="1024" fill="url(#glow)"/>'
def placed(scale, mono=False, dx=0, dy=0):
    # scale about the pepper's own center
    return f'<g transform="translate({512+dx} {512+dy}) scale({scale}) translate(-480 -500)">{pepper(mono)}</g>'
out = {
 'icon': svg(BG + placed(1.12)),
 'fg': svg(placed(0.70)),            # Android adaptive: keep inside the middle two thirds
 'bg': svg(BG),
 'mono': svg(placed(0.70, True)),
 'splash': svg(placed(1.25)),
 'mark': svg(placed(1.3)),
}
for k, v in out.items(): open(f'{k}.svg', 'w').write(v)
