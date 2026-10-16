/* QR 校验：导出本实现在各版本/等级/掩码下的矩阵，供 Python 参考实现比对
 * 用法（先装参考库）: pip install qrcode
 *     node tools/qr-verify.js && python tools/qr-verify.py
 */
const QR = require('../public/js/qrcode.js');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'qr-js-output.json');

const TEXTS = [
  'http://127.0.0.1:3210/p/AB12CD34',
  'https://example.com/e/7k2m9q1z?from=qr',
  'HELLO WORLD 1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '你好，世界！这是一张二维码',
  'A'
];

const LEVELS = ['L', 'M', 'Q', 'H'];
const out = {};

for (const text of TEXTS) {
  for (const ec of LEVELS) {
    // 找到最小可容纳版本
    let version = -1;
    for (let v = 1; v <= 10; v++) {
      try { QR.encode(text, { ecLevel: ec, version: v, mask: 0 }); version = v; break; } catch (e) { /* 放不下 */ }
    }
    if (version < 0) continue;
    for (let mask = 0; mask < 8; mask++) {
      const qr = QR.encode(text, { ecLevel: ec, version, mask });
      const key = [text, ec, version, mask].join('|');
      out[key] = qr.modules.map((r) => r.join(''));
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
console.log('JS 已生成', Object.keys(out).length, '个矩阵 ->', OUT);
