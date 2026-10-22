# Builds src/app/fonts/Vazirmatn-Variable.woff2: the Vazirmatn variable font (npm package «vazirmatn») cut down to the
# characters the shop uses — Persian/Arabic, basic Latin, Latin-1 punctuation, general punctuation — with every weight
# (the wght axis) and every shaping feature kept. 108 KB -> 68 KB: on a slow phone network the text font arrives
# ~0.5 s sooner, and the page is laid out once with it instead of first in the fallback font (FCP −0.5…0.8 s measured).
#   pip install fonttools brotli
#   python scripts/subset-font.py        (from shop/; run again after updating the vazirmatn package)
import os
from fontTools import subset

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'node_modules', 'vazirmatn', 'fonts', 'webfonts', 'Vazirmatn[wght].woff2')
out = os.path.join(here, '..', 'src', 'app', 'fonts', 'Vazirmatn-Variable.woff2')

UNICODES = [
    *range(0x0020, 0x007F),  # basic Latin (digits, A-Z, brand names, URLs)
    *range(0x00A0, 0x0100),  # Latin-1: nbsp « » · × and accented letters (brand names: ü, è)
    0x060C, 0x061B, 0x061F, 0x0640, 0x066A, 0x066B, 0x066C,  # ، ؛ ؟ tatweel ٪ ٫ ٬
    *range(0x0621, 0x063B),  # Arabic letters ء…غ
    *range(0x0641, 0x0656),  # ف…ي, harakat, hamza above/below
    *range(0x0660, 0x066A),  # Arabic-Indic digits (pasted text)
    0x0670, 0x067E, 0x0686, 0x0698, 0x06A9, 0x06AF, 0x06C0, 0x06CC,  # Persian letters پ چ ژ ک گ ۀ ی
    0x06BE, 0x06C1,  # ھ ہ (seen in reviews)
    *range(0x06F0, 0x06FA),  # Persian digits ۰…۹
    *range(0x200B, 0x2010),  # ZWSP, ZWNJ, ZWJ, LRM, RLM
    *range(0x2010, 0x2027),  # dashes, quotes, bullet, ellipsis
    0x2030, 0x2039, 0x203A, 0x2122, 0x25CC,  # ‰ ‹ › ™ dotted circle
]

options = subset.Options()
options.layout_features = ['*']
options.name_IDs = ['*']
options.name_languages = ['*']
options.notdef_outline = True
options.flavor = 'woff2'
font = subset.load_font(src, options)
sub = subset.Subsetter(options)
sub.populate(unicodes=UNICODES)
sub.subset(font)
subset.save_font(font, out, options)
print(f'{os.path.getsize(src) // 1024} KB -> {os.path.getsize(out) // 1024} KB: {out}')
