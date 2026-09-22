"""墨の入っていない列を、学習から外す（消さない）。
   彫刻原稿 v35.3 より前に登録した分の片づけ用。
     python3 off_noink.py         … 外す
     python3 off_noink.py --back  … 外したのを戻す
"""
import os, sys
import numpy as np
from PIL import Image
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dataset", "lines")
back = "--back" in sys.argv
n = 0
for name in sorted(os.listdir(R)):
    d = os.path.join(R, name)
    if not os.path.isdir(d):
        continue
    f = os.path.join(d, "off")
    if back:
        if os.path.exists(f):
            os.remove(f); n += 1; print("戻しました", name)
        continue
    p = os.path.join(d, "ink.png")
    v = 0.0
    if os.path.exists(p):
        a = np.asarray(Image.open(p).convert("L"), dtype=np.float32) / 255.0
        v = float((a > 0.5).mean()) * 100
    if v < 1:
        open(f, "w").close(); n += 1
        print("学習から外しました（墨 %.1f%%）: %s" % (v, name))
print("― %d 本 %s" % (n, "戻しました" if back else "外しました"))
