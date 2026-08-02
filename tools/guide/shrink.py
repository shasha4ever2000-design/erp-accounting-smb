# Screenshots are captured at 2x for crisp print, which is far too heavy to
# embed directly. 1600px wide JPEG at q80 keeps the text readable on paper and
# takes the whole guide from ~41 MB of PNG to under 8 MB.
import glob, os
from PIL import Image

DIR = os.environ.get('GUIDE_DIR', '.guide-build')
src = os.path.join(DIR, 'shots')
dst = os.path.join(DIR, 'web', 'img')
os.makedirs(dst, exist_ok=True)

total = 0
for p in sorted(glob.glob(os.path.join(src, '*.png'))):
    im = Image.open(p).convert('RGB')
    w, h = im.size
    tw = 1600
    im = im.resize((tw, round(h * tw / w)), Image.LANCZOS)
    out = os.path.join(dst, os.path.basename(p).replace('.png', '.jpg'))
    im.save(out, 'JPEG', quality=80, optimize=True, progressive=True)
    total += os.path.getsize(out)

print(f'{len(glob.glob(os.path.join(dst, "*.jpg")))} images, {total / 1e6:.1f} MB')
