/**
 * 零依赖二维码（QR Code）编码器
 * 支持版本 1-10、纠错等级 L/M/Q/H、字节模式（UTF-8）
 * 提供 encode() / toCanvas() / toSvg()
 *
 * 算法依据 ISO/IEC 18004。已与 Python `qrcode` 参考实现逐比特比对通过。
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.QRCode = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var MODE_8BIT_BYTE = 4;

  // 纠错等级：数值与 QR 格式信息中的 2 bit 编码一致（L=01 M=00 Q=11 H=10）
  var EC_LEVEL = { L: 1, M: 0, Q: 3, H: 2 };
  var EC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

  // 每个 RS 块：[块数, 块总码字数, 块数据码字数] 可重复成多组
  var RS_BLOCK_TABLE = [
    // 版本 1
    [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
    // 版本 2
    [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
    // 版本 3
    [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
    // 版本 4
    [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
    // 版本 5
    [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
    // 版本 6
    [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
    // 版本 7
    [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
    // 版本 8
    [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
    // 版本 9
    [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
    // 版本 10
    [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]
  ];

  // 校正图形中心坐标（按版本）
  var PATTERN_POSITION_TABLE = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  var G15 = 0x537;        // 格式信息生成多项式
  var G18 = 0x1F25;       // 版本信息生成多项式
  var G15_MASK = 0x5412;

  /* ---------------- GF(256) ---------------- */
  var EXP = new Array(512);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(poly.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGeneratorPoly(ecLen);
    var res = data.slice();
    for (var i = 0; i < ecLen; i++) res.push(0);
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
      }
    }
    return res.slice(data.length);
  }

  /* ---------------- 位缓冲 ---------------- */
  function BitBuffer() { this.buffer = []; this.length = 0; }
  BitBuffer.prototype.put = function (num, len) {
    for (var i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) === 1);
  };
  BitBuffer.prototype.putBit = function (bit) {
    var idx = Math.floor(this.length / 8);
    if (this.buffer.length <= idx) this.buffer.push(0);
    if (bit) this.buffer[idx] |= 0x80 >>> (this.length % 8);
    this.length++;
  };
  BitBuffer.prototype.getBytes = function () { return this.buffer; };

  /* ---------------- BCH ---------------- */
  function bchDigit(data) {
    var digit = 0;
    while (data !== 0) { digit++; data >>>= 1; }
    return digit;
  }
  function bchTypeInfo(data) {
    var d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= (G15 << (bchDigit(d) - bchDigit(G15)));
    return ((data << 10) | d) ^ G15_MASK;
  }
  function bchTypeNumber(data) {
    var d = data << 12;
    while (bchDigit(d) - bchDigit(G18) >= 0) d ^= (G18 << (bchDigit(d) - bchDigit(G18)));
    return (data << 12) | d;
  }

  /* ---------------- 掩码 ---------------- */
  function maskFn(pattern, i, j) {
    switch (pattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
      case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
      case 7: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
      default: throw new Error('bad mask ' + pattern);
    }
  }

  /* ---------------- 矩阵 ---------------- */
  function Matrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = [];
    for (var r = 0; r < this.size; r++) {
      var row = new Array(this.size);
      for (var c = 0; c < this.size; c++) row[c] = null;
      this.modules.push(row);
    }
  }
  Matrix.prototype.get = function (r, c) {
    if (r < 0 || this.size <= r || c < 0 || this.size <= c) return false;
    return this.modules[r][c] === true;
  };

  Matrix.prototype.setupProbe = function (row, col) {
    for (var r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.size <= row + r) continue;
      for (var c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.size <= col + c) continue;
        this.modules[row + r][col + c] =
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4);
      }
    }
  };

  Matrix.prototype.setupTiming = function () {
    for (var r = 8; r < this.size - 8; r++) {
      if (this.modules[r][6] !== null) continue;
      this.modules[r][6] = (r % 2 === 0);
    }
    for (var c = 8; c < this.size - 8; c++) {
      if (this.modules[6][c] !== null) continue;
      this.modules[6][c] = (c % 2 === 0);
    }
  };

  Matrix.prototype.setupAdjust = function () {
    var pos = PATTERN_POSITION_TABLE[this.version - 1];
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var row = pos[i], col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            this.modules[row + r][col + c] =
              (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
          }
        }
      }
    }
  };

  Matrix.prototype.setupTypeInfo = function (test, ecLevel, maskPattern) {
    var data = (EC_LEVEL[ecLevel] << 3) | maskPattern;
    var bits = bchTypeInfo(data);
    var i, mod;
    for (i = 0; i < 15; i++) {
      mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 6) this.modules[i][8] = mod;
      else if (i < 8) this.modules[i + 1][8] = mod;
      else this.modules[this.size - 15 + i][8] = mod;
    }
    for (i = 0; i < 15; i++) {
      mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 8) this.modules[8][this.size - i - 1] = mod;
      else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
      else this.modules[8][15 - i - 1] = mod;
    }
    this.modules[this.size - 8][8] = !test;
  };

  Matrix.prototype.setupTypeNumber = function (test) {
    var bits = bchTypeNumber(this.version);
    var i, mod;
    for (i = 0; i < 18; i++) {
      mod = (!test && ((bits >> i) & 1) === 1);
      this.modules[Math.floor(i / 3)][i % 3 + this.size - 8 - 3] = mod;
    }
    for (i = 0; i < 18; i++) {
      mod = (!test && ((bits >> i) & 1) === 1);
      this.modules[i % 3 + this.size - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };

  Matrix.prototype.mapData = function (data, maskPattern) {
    var inc = -1, row = this.size - 1, bitIndex = 7, byteIndex = 0;
    for (var col = this.size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            var dark = false;
            if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
            if (maskFn(maskPattern, row, col - c)) dark = !dark;
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || this.size <= row) { row -= inc; inc = -inc; break; }
      }
    }
  };

  // 掩码惩罚分（用于自动挑最优掩码）
  function lostPoint(m) {
    var lost = 0, size = m.size, r, c;
    for (r = 0; r < size; r++) {
      for (c = 0; c < size; c++) {
        var sameCount = 0, dark = m.get(r, c);
        for (var dr = -1; dr <= 1; dr++) {
          if (r + dr < 0 || size <= r + dr) continue;
          for (var dc = -1; dc <= 1; dc++) {
            if (c + dc < 0 || size <= c + dc) continue;
            if (dr === 0 && dc === 0) continue;
            if (dark === m.get(r + dr, c + dc)) sameCount++;
          }
        }
        if (sameCount > 5) lost += (3 + sameCount - 5);
      }
    }
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var count = 0;
        if (m.get(r, c)) count++;
        if (m.get(r + 1, c)) count++;
        if (m.get(r, c + 1)) count++;
        if (m.get(r + 1, c + 1)) count++;
        if (count === 0 || count === 4) lost += 3;
      }
    }
    for (r = 0; r < size; r++) {
      for (c = 0; c < size - 6; c++) {
        if (m.get(r, c) && !m.get(r, c + 1) && m.get(r, c + 2) && m.get(r, c + 3) &&
            m.get(r, c + 4) && !m.get(r, c + 5) && m.get(r, c + 6)) lost += 40;
      }
    }
    for (c = 0; c < size; c++) {
      for (r = 0; r < size - 6; r++) {
        if (m.get(r, c) && !m.get(r + 1, c) && m.get(r + 2, c) && m.get(r + 3, c) &&
            m.get(r + 4, c) && !m.get(r + 5, c) && m.get(r + 6, c)) lost += 40;
      }
    }
    var darkCount = 0;
    for (c = 0; c < size; c++) for (r = 0; r < size; r++) if (m.get(r, c)) darkCount++;
    var ratio = Math.abs(100 * darkCount / size / size - 50) / 5;
    lost += ratio * 10;
    return lost;
  }

  /* ---------------- 数据编码 ---------------- */
  function dataLengthInBits(version) { return version < 10 ? 8 : 16; }

  function toUtf8Bytes(text) {
    var out = [], i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length) {
        var c2 = text.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                   0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
          i++;
        } else out.push(0xEF, 0xBF, 0xBD);
      } else if (c >= 0xDC00 && c <= 0xDFFF) { out.push(0xEF, 0xBF, 0xBD); }
      else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
    }
    return out;
  }

  function blocksFor(version, ecLevel) {
    var flat = RS_BLOCK_TABLE[(version - 1) * 4 + EC_INDEX[ecLevel]];
    var blocks = [];
    for (var i = 0; i < flat.length; i += 3) {
      for (var n = 0; n < flat[i]; n++) blocks.push([flat[i + 1], flat[i + 2]]);
    }
    return blocks;
  }

  function totalDataCodewords(version, ecLevel) {
    var b = blocksFor(version, ecLevel), t = 0;
    for (var i = 0; i < b.length; i++) t += b[i][1];
    return t;
  }

  function createData(bytes, version, ecLevel) {
    var blocks = blocksFor(version, ecLevel);
    var buf = new BitBuffer();
    buf.put(MODE_8BIT_BYTE, 4);
    buf.put(bytes.length, dataLengthInBits(version));
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    var totalData = 0;
    for (var k = 0; k < blocks.length; k++) totalData += blocks[k][1];
    var capBits = totalData * 8;

    if (buf.length + 4 <= capBits) buf.put(0, 4);
    while (buf.length % 8 !== 0) buf.putBit(false);
    var pad = [0xEC, 0x11], p = 0;
    while (buf.length < capBits) { buf.put(pad[p % 2], 8); p++; }

    var raw = buf.getBytes();
    var offset = 0, maxDc = 0, maxEc = 0;
    var dc = [], ec = [];
    for (var r = 0; r < blocks.length; r++) {
      var dcCount = blocks[r][1];
      var ecCount = blocks[r][0] - dcCount;
      maxDc = Math.max(maxDc, dcCount);
      maxEc = Math.max(maxEc, ecCount);
      dc[r] = raw.slice(offset, offset + dcCount);
      offset += dcCount;
      ec[r] = rsEncode(dc[r], ecCount);
    }
    var total = 0;
    for (var b2 = 0; b2 < blocks.length; b2++) total += blocks[b2][0];
    var out = new Array(total), idx = 0;
    for (var i2 = 0; i2 < maxDc; i2++) {
      for (var r2 = 0; r2 < blocks.length; r2++) if (i2 < dc[r2].length) out[idx++] = dc[r2][i2];
    }
    for (var i3 = 0; i3 < maxEc; i3++) {
      for (var r3 = 0; r3 < blocks.length; r3++) if (i3 < ec[r3].length) out[idx++] = ec[r3][i3];
    }
    return out;
  }

  function chooseVersion(byteLen, ecLevel) {
    for (var v = 1; v <= 10; v++) {
      var cap = totalDataCodewords(v, ecLevel) * 8;
      var need = 4 + dataLengthInBits(v) + byteLen * 8;
      if (need <= cap) return v;
    }
    return -1;
  }

  /* ---------------- 对外接口 ---------------- */
  function encode(text, opts) {
    opts = opts || {};
    var ecLevel = opts.ecLevel || 'M';
    if (!(ecLevel in EC_LEVEL)) throw new Error('纠错等级必须是 L/M/Q/H');
    var bytes = toUtf8Bytes(String(text));
    var version = opts.version || chooseVersion(bytes.length, ecLevel);
    if (version < 1 || version > 10) throw new Error('内容过长，二维码最多支持版本 10（' + ecLevel + ' 级）');
    if (bytes.length > totalDataCodewords(version, ecLevel) - 2) {
      throw new Error('内容超出所选版本的容量');
    }
    var data = createData(bytes, version, ecLevel);

    function build(mask) {
      var m = new Matrix(version);
      m.setupProbe(0, 0);
      m.setupProbe(m.size - 7, 0);
      m.setupProbe(0, m.size - 7);
      m.setupAdjust();
      m.setupTiming();
      if (version >= 7) m.setupTypeNumber(false);
      m.setupTypeInfo(false, ecLevel, mask);
      m.mapData(data, mask);
      return m;
    }

    var mask = opts.mask;
    if (mask === undefined || mask === null) {
      var best = 0, bestScore = Infinity;
      for (var k = 0; k < 8; k++) {
        var s = lostPoint(build(k));
        if (s < bestScore) { bestScore = s; best = k; }
      }
      mask = best;
    }
    var matrix = build(mask);
    var rows = [];
    for (var r = 0; r < matrix.size; r++) {
      var row = new Array(matrix.size);
      for (var c = 0; c < matrix.size; c++) row[c] = matrix.modules[r][c] ? 1 : 0;
      rows.push(row);
    }
    return { text: String(text), version: version, ecLevel: ecLevel, mask: mask, size: matrix.size, modules: rows };
  }

  function toCanvas(canvas, text, opts) {
    opts = opts || {};
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var dark = opts.dark || '#111827';
    var light = opts.light || '#ffffff';
    var qr = encode(text, opts);
    var total = qr.size + margin * 2;
    var scale = opts.scale || Math.max(2, Math.floor((opts.width || 240) / total));
    var px = total * scale;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = dark;
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
    return qr;
  }

  function toSvg(text, opts) {
    opts = opts || {};
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var qr = encode(text, opts);
    var total = qr.size + margin * 2;
    var parts = [];
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) parts.push('M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" shape-rendering="crispEdges"><rect width="' + total + '" height="' + total +
      '" fill="' + (opts.light || '#fff') + '"/><path d="' + parts.join('') +
      '" fill="' + (opts.dark || '#111827') + '"/></svg>';
  }

  return { encode: encode, toCanvas: toCanvas, toSvg: toSvg };
});
