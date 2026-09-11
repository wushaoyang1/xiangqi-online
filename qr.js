/* qr.js —— 零依赖二维码生成器（只实现分享链接所需的最小子集）
 *
 * 支持：字节模式(byte mode) + 纠错等级 L + 版本 1~6（最多 134 字节，够放任何邀请链接）。
 * 之所以只到版本 6：版本 ≥ 7 才需要额外的「版本信息区」，限制在 6 以内可省掉那部分逻辑，
 * 代码更短、出错面更小；真扫不下时调用方会自动降级为「只显示文字链接」。
 *
 * 用法：const m = QR.encode('https://xxx');  // m = { size, modules:[[0|1,...],...] } 或 null（超长）
 */
var QR = (function () {
  'use strict';

  // 版本参数（纠错等级 L）：total=总码字, ecc=每块纠错码字数, blocks=块数, align=对齐图案中心坐标
  var VER = {
    1: { total: 26,  ecc: 7,  blocks: 1, align: [] },
    2: { total: 44,  ecc: 10, blocks: 1, align: [6, 18] },
    3: { total: 70,  ecc: 15, blocks: 1, align: [6, 22] },
    4: { total: 100, ecc: 20, blocks: 1, align: [6, 26] },
    5: { total: 134, ecc: 26, blocks: 1, align: [6, 30] },
    6: { total: 172, ecc: 18, blocks: 2, align: [6, 34] }
  };
  var ECC_L_BITS = 1;        // 纠错等级 L 在格式信息里的编码值

  /* ---------- GF(256) 有限域：二维码纠错（Reed-Solomon）的数学基础 ---------- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // 生成多项式：(x-α^0)(x-α^1)...(x-α^(n-1))
  function rsGen(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1);
      for (var k = 0; k < ng.length; k++) ng[k] = 0;
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }
  // 计算纠错码字（多项式除法的余数）
  function rsEncode(data, eccLen) {
    var g = rsGen(eccLen);
    var res = new Array(eccLen);
    for (var i = 0; i < eccLen; i++) res[i] = 0;
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ res[0];
      res.shift(); res.push(0);
      for (var j = 0; j < eccLen; j++) res[j] ^= gmul(g[j + 1], factor);
    }
    return res;
  }

  /* ---------- 文本 -> UTF-8 字节 ---------- */
  function toUtf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {   // 代理对（emoji 等）
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  /* ---------- 数据码字：模式标识 + 长度 + 内容 + 终止符 + 填充 ---------- */
  function makeDataCodewords(bytes, ver) {
    var info = VER[ver];
    var dataCw = info.total - info.ecc * info.blocks;
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    push(4, 4);                 // 0100 = 字节模式
    push(bytes.length, 8);      // 版本 1~9 的字节模式长度字段固定 8 bit
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var cap = dataCw * 8;
    var term = Math.min(4, cap - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var cws = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[b + j];
      cws.push(v);
    }
    var PAD = [0xEC, 0x11];     // 标准规定的交替填充字节
    var k = 0;
    while (cws.length < dataCw) cws.push(PAD[k++ % 2]);
    return cws;
  }

  // 分块 -> 各块算纠错 -> 交织成最终码字序列
  function interleave(dataCw, ver) {
    var info = VER[ver], nb = info.blocks, per = dataCw.length / nb;
    var dBlocks = [], eBlocks = [];
    for (var i = 0; i < nb; i++) {
      var d = dataCw.slice(i * per, (i + 1) * per);
      dBlocks.push(d);
      eBlocks.push(rsEncode(d, info.ecc));
    }
    var out = [];
    for (var r = 0; r < per; r++) for (var b = 0; b < nb; b++) out.push(dBlocks[b][r]);
    for (var e = 0; e < info.ecc; e++) for (var b2 = 0; b2 < nb; b2++) out.push(eBlocks[b2][e]);
    return out;
  }

  /* ---------- 矩阵：功能图形 + 数据 + 掩码 ---------- */
  function newMatrix(size) {
    var m = [];
    for (var r = 0; r < size; r++) { m.push(new Array(size)); for (var c = 0; c < size; c++) m[r][c] = 0; }
    return m;
  }

  function drawFunctions(m, fn, ver, size) {
    function set(r, c, v) { if (r >= 0 && r < size && c >= 0 && c < size) { m[r][c] = v; fn[r][c] = 1; } }
    // 三个定位图案（含 1 格分隔符）
    function finder(r0, c0) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var inner = (r >= 0 && r <= 6 && c >= 0 && c <= 6) &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(r0 + r, c0 + c, inner ? 1 : 0);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    // 定时图案（第 6 行 / 第 6 列的黑白相间线）
    for (var i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }
    // 对齐图案（版本 ≥ 2 才有；与定位图案重叠的三处跳过）
    var al = VER[ver].align, last = al[al.length - 1];
    for (var a = 0; a < al.length; a++) for (var b = 0; b < al.length; b++) {
      var ar = al[a], ac = al[b];
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === last) || (ar === last && ac === 6)) continue;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++)
        set(ar + dr, ac + dc, (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) ? 1 : 0);
    }
    // 格式信息区先占位（值随后写入），外加固定的「暗模块」
    for (var f = 0; f <= 8; f++) { if (f !== 6) { set(8, f, 0); set(f, 8, 0); } }
    for (var g = 0; g < 8; g++) { set(8, size - 1 - g, 0); set(size - 1 - g, 8, 0); }
    set(size - 8, 8, 1);
  }

  // 格式信息：5 位数据（纠错等级 + 掩码）经 BCH(15,5) 扩展后再异或掩码常量
  function drawFormat(m, size, mask) {
    var data = (ECC_L_BITS << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function bit(i) { return (bits >>> i) & 1; }
    for (var k = 0; k <= 5; k++) m[k][8] = bit(k);
    m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
    for (var j = 9; j < 15; j++) m[8][14 - j] = bit(j);
    for (var p = 0; p < 8; p++) m[8][size - 1 - p] = bit(p);
    for (var q = 8; q < 15; q++) m[size - 15 + q][8] = bit(q);
    m[size - 8][8] = 1;
  }

  // 数据码字按「右下角起、每两列一组、之字形上下」填入非功能模块
  function drawData(m, fn, size, cws) {
    var i = 0, total = cws.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                 // 跳过定时图案所在列
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var c = right - j;
          var upward = ((right + 1) & 2) === 0;
          var r = upward ? size - 1 - vert : vert;
          if (!fn[r][c] && i < total) {
            m[r][c] = (cws[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(c / 3) + Math.floor(r / 2)) % 2 === 0;
      case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
      case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0;
      case 7: return (((r + c) % 2 + (r * c) % 3) % 2) === 0;
    }
    return false;
  }
  function applyMask(m, fn, size, mask) {
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++)
      if (!fn[r][c] && maskBit(mask, r, c)) m[r][c] ^= 1;
  }

  // 惩罚评分：四条规则，分数越低越好扫（用于自动挑选最优掩码）
  function penalty(m, size) {
    var score = 0, r, c, i;
    // 规则 1：同色连续 5 格及以上
    for (r = 0; r < size; r++) {
      var runV = m[r][0], runLen = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === runV) { runLen++; if (runLen === 5) score += 3; else if (runLen > 5) score++; }
        else { runV = m[r][c]; runLen = 1; }
      }
    }
    for (c = 0; c < size; c++) {
      var runV2 = m[0][c], runLen2 = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === runV2) { runLen2++; if (runLen2 === 5) score += 3; else if (runLen2 > 5) score++; }
        else { runV2 = m[r][c]; runLen2 = 1; }
      }
    }
    // 规则 2：2x2 同色块
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      var v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    // 规则 3：形似定位图案的 1011101 + 四白 组合
    var P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matchAt(get, start) {
      var ok1 = true, ok2 = true;
      for (i = 0; i < 11; i++) { var g = get(start + i); if (g !== P1[i]) ok1 = false; if (g !== P2[i]) ok2 = false; }
      return ok1 || ok2;
    }
    for (r = 0; r < size; r++) {
      (function (rr) {
        for (var s = 0; s + 11 <= size; s++) if (matchAt(function (x) { return m[rr][x]; }, s)) score += 40;
      })(r);
    }
    for (c = 0; c < size; c++) {
      (function (cc) {
        for (var s = 0; s + 11 <= size; s++) if (matchAt(function (x) { return m[x][cc]; }, s)) score += 40;
      })(c);
    }
    // 规则 4：黑色比例偏离 50% 越多罚越重
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += m[r][c];
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ---------- 对外接口 ---------- */
  // 生成矩阵；text 过长（>134 字节）返回 null，调用方降级为纯文字链接
  function encode(text, forceVer, forceMask) {
    var bytes = toUtf8(String(text == null ? '' : text));
    var ver = forceVer || 0;
    if (!ver) {
      for (var v = 1; v <= 6; v++) {
        var info = VER[v];
        var cap = info.total - info.ecc * info.blocks - 2;   // 减去模式+长度共 12 bit（向下取整 = 2 字节）
        if (bytes.length <= cap) { ver = v; break; }
      }
      if (!ver) return null;
    }
    var size = ver * 4 + 17;
    var cws = interleave(makeDataCodewords(bytes, ver), ver);

    function build(mask) {
      var m = newMatrix(size), fn = newMatrix(size);
      drawFunctions(m, fn, ver, size);
      drawData(m, fn, size, cws);
      applyMask(m, fn, size, mask);
      drawFormat(m, size, mask);
      return m;
    }
    if (typeof forceMask === 'number') return { size: size, version: ver, mask: forceMask, modules: build(forceMask) };

    var best = null, bestScore = Infinity, bestMask = 0;
    for (var k = 0; k < 8; k++) {
      var mm = build(k), s = penalty(mm, size);
      if (s < bestScore) { bestScore = s; best = mm; bestMask = k; }
    }
    return { size: size, version: ver, mask: bestMask, modules: best };
  }

  // 直接画到 canvas 上下文：x/y 左上角，px 为整体边长（含 quiet zone 静默边框）
  function draw(ctx, text, x, y, px, opts) {
    opts = opts || {};
    var q = (opts.quiet == null) ? 4 : opts.quiet;      // 静默边框（标准要求 4 格）
    var res = encode(text);
    if (!res) return false;
    var n = res.size + q * 2;
    var cell = px / n;
    ctx.fillStyle = opts.bg || '#ffffff';
    ctx.fillRect(x, y, px, px);
    ctx.fillStyle = opts.fg || '#111111';
    for (var r = 0; r < res.size; r++) for (var c = 0; c < res.size; c++) {
      if (!res.modules[r][c]) continue;
      // 用 ceil 让相邻格子有 1px 重叠，避免缩放时出现白缝导致扫不出
      ctx.fillRect(x + (c + q) * cell, y + (r + q) * cell, Math.ceil(cell), Math.ceil(cell));
    }
    return true;
  }

  return { encode: encode, draw: draw };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = QR;   // 供 Node 测试引用
