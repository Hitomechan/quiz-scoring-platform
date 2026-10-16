"""用 Python qrcode 参考实现校验 JS 二维码编码器的每一个矩阵"""
import json, os, sys
import qrcode
from qrcode.util import QRData, MODE_8BIT_BYTE

HERE = os.path.dirname(os.path.abspath(__file__))

EC = {
    'L': qrcode.constants.ERROR_CORRECT_L,
    'M': qrcode.constants.ERROR_CORRECT_M,
    'Q': qrcode.constants.ERROR_CORRECT_Q,
    'H': qrcode.constants.ERROR_CORRECT_H,
}

with open(os.path.join(HERE, 'qr-js-output.json'), encoding='utf-8') as f:
    js = json.load(f)

total = ok = bad = 0
failures = []
for key, js_matrix in js.items():
    text, ec, version, mask = key.split('|')
    version, mask = int(version), int(mask)
    qr = qrcode.QRCode(version=version, error_correction=EC[ec], box_size=1, border=0,
                       mask_pattern=mask)
    qr.add_data(QRData(text.encode('utf-8'), mode=MODE_8BIT_BYTE))
    qr.make(fit=False)
    ref = [''.join('1' if c else '0' for c in row) for row in qr.modules]
    total += 1
    if ref == js_matrix:
        ok += 1
    else:
        bad += 1
        if len(failures) < 3:
            diff = sum(1 for a, b in zip(ref, js_matrix) for x, y in zip(a, b) if x != y)
            failures.append(f'  {text!r} ec={ec} v={version} mask={mask} 差异模块数={diff}')

print(f'比对矩阵总数 : {total}')
print(f'完全一致     : {ok}')
print(f'不一致       : {bad}')
for f in failures:
    print(f)
sys.exit(1 if bad else 0)
