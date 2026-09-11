/* poster.js —— 战绩海报 / 邀请海报（Canvas 绘制，零依赖）
 *
 * 只负责「把数据画成一张 750x1000 的图」以及保存/复制/分享，
 * 不读取任何对局内部状态（数据由 game.js 传入），因此不会碰到暗棋坐标。
 */
var Poster = (function () {
  'use strict';

  var W = 750, H = 1000;
  var FONT = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  var SERIF = '"KaiTi","STKaiti",serif';

  var GOLD = '#e9cf94', RED = '#e2564a', PURPLE = '#b06fd6', DIM = '#9a9aad';

  var _canvas = null;   // 最近一次生成的画布（保存/复制时复用）

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(ctx, str, x, y, size, color, opts) {
    opts = opts || {};
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = (opts.bold ? 'bold ' : '') + size + 'px ' + (opts.serif ? SERIF : FONT);
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = opts.glowBlur || 24; }
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  // 画一枚象棋棋子（米黄底 + 描边 + 字），暗棋则用紫色虚线圈
  function drawPiece(ctx, x, y, r, ch, kind) {
    ctx.save();
    if (kind === 'hidden') {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(155,89,182,.20)'; ctx.fill();
      ctx.setLineDash([6, 5]); ctx.lineWidth = 3; ctx.strokeStyle = PURPLE; ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, ch, x, y + r * 0.34, r * 0.95, PURPLE, { bold: true, serif: true });
    } else {
      var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.15, x, y, r);
      g.addColorStop(0, '#fbeecb'); g.addColorStop(1, '#e0c082');
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = (kind === 'red') ? '#c0392b' : '#161616'; ctx.stroke();
      text(ctx, ch, x, y + r * 0.34, r * 0.95, (kind === 'red') ? '#c0392b' : '#161616', { bold: true, serif: true });
    }
    ctx.restore();
  }

  // 背景：深色渐变 + 两团柔光 + 淡淡的棋盘格线
  function drawBackground(ctx, win) {
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#232430'); g.addColorStop(0.55, '#2b2634'); g.addColorStop(1, '#1e1f28');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    function glow(cx, cy, r, color) {
      var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, color); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    glow(120, 130, 320, win === false ? 'rgba(90,110,160,.20)' : 'rgba(192,57,43,.20)');
    glow(660, 620, 340, 'rgba(155,89,182,.16)');

    ctx.save();
    ctx.strokeStyle = 'rgba(233,207,148,.055)'; ctx.lineWidth = 1;
    for (var i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(i * 75, 0); ctx.lineTo(i * 75, H); ctx.stroke(); }
    for (var j = 1; j < 14; j++) { ctx.beginPath(); ctx.moveTo(0, j * 75); ctx.lineTo(W, j * 75); ctx.stroke(); }
    ctx.restore();
  }

  function card(ctx, x, y, w, h, r) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r || 20);
    ctx.fillStyle = 'rgba(255,255,255,.055)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(233,207,148,.22)'; ctx.stroke();
    ctx.restore();
  }

  // 一列数据：大数字 + 小标题
  function stat(ctx, x, y, value, label, color) {
    text(ctx, String(value), x, y, 44, color || GOLD, { bold: true });
    text(ctx, label, x, y + 30, 19, DIM);
  }

  function fmtDate(ts) {
    var d = new Date(ts || Date.now());
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 过长链接截断显示（二维码里仍是完整链接）
  function ellipsis(ctx, str, size, maxW) {
    ctx.save();
    ctx.font = size + 'px ' + FONT;
    var s = String(str || '');
    if (ctx.measureText(s).width <= maxW) { ctx.restore(); return s; }
    while (s.length > 4 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    ctx.restore();
    return s + '…';
  }

  /* ---------------- 主入口：生成海报画布 ----------------
   * d = {
   *   kind:'result'|'invite', win:true/false, sideName:'红方', room, steps,
   *   rating, ratingDelta, wins, losses, games, link, code, invited, ts
   * }
   */
  function build(d) {
    d = d || {};
    var cv = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!cv || !cv.getContext) return null;
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    if (!ctx) return null;

    var isInvite = (d.kind === 'invite');
    drawBackground(ctx, isInvite ? null : !!d.win);

    /* —— 头部 —— */
    drawPiece(ctx, 96, 96, 40, '帥', 'red');
    drawPiece(ctx, 654, 96, 40, '將', 'black');
    text(ctx, '暗 棋 象 棋', W / 2, 92, 52, GOLD, { bold: true, serif: true, glow: 'rgba(233,207,148,.35)' });
    text(ctx, '多一枚只有自己看得见的棋子', W / 2, 128, 20, DIM);

    /* —— 主卡片 —— */
    card(ctx, 40, 170, 670, 390, 24);

    if (isInvite) {
      text(ctx, '邀 你 来 一 局', W / 2, 258, 60, '#f5f0e6', { bold: true, serif: true });
      text(ctx, '埋伏 · 挡路 · 同归于尽', W / 2, 306, 24, GOLD);

      drawPiece(ctx, 205, 400, 46, '車', 'black');
      drawPiece(ctx, 320, 400, 46, '炮', 'red');
      drawPiece(ctx, 435, 400, 46, '密', 'hidden');
      drawPiece(ctx, 550, 400, 46, '兵', 'red');
      text(ctx, '↑ 紫色这枚是暗棋，只有它的主人能看到位置', W / 2, 470, 19, DIM);

      var iy = 520;
      if (d.code) text(ctx, '我的邀请码  ' + d.code, W / 2 - (d.invited ? 150 : 0), iy, 26, GOLD, { bold: true });
      if (d.invited) text(ctx, '已邀请 ' + d.invited + ' 位好友', W / 2 + 150, iy, 26, PURPLE, { bold: true });
    } else {
      var win = !!d.win;
      var title = win ? '胜' : '负';
      var titleColor = win ? RED : '#8fa0c4';

      // 结果大字（用棋子样式呈现，红胜蓝负）
      ctx.save();
      var cx = W / 2, cy = 300, r = 82;
      var rg = ctx.createRadialGradient(cx - 26, cy - 30, 12, cx, cy, r);
      rg.addColorStop(0, '#fbeecb'); rg.addColorStop(1, '#e0c082');
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = rg; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = titleColor;
      ctx.shadowColor = win ? 'rgba(226,86,74,.55)' : 'rgba(143,160,196,.45)'; ctx.shadowBlur = 30;
      ctx.stroke(); ctx.restore();
      text(ctx, title, cx, cy + 30, 86, titleColor, { bold: true, serif: true });

      text(ctx, win ? '这一局，我赢了' : '这一局，惜败', W / 2, 428, 30, '#f0ebe0', { bold: true });

      var sub = [];
      if (d.sideName) sub.push('执' + d.sideName);
      if (d.room) sub.push('房间 ' + d.room);
      if (d.steps) sub.push(d.steps + ' 手');
      sub.push(fmtDate(d.ts));
      text(ctx, sub.join('  ·  '), W / 2, 464, 20, DIM);

      // 三列数据：段位 / 战绩 / 胜率
      var games = d.games || 0, wins = d.wins || 0;
      var rate = games ? Math.round(wins * 100 / games) : 0;
      var deltaTxt = '';
      if (typeof d.ratingDelta === 'number' && d.ratingDelta !== 0)
        deltaTxt = (d.ratingDelta > 0 ? '+' : '') + d.ratingDelta;
      stat(ctx, 190, 526, d.rating == null ? '—' : d.rating, '段位分', GOLD);
      if (deltaTxt) text(ctx, deltaTxt, 190 + 74, 526, 22, d.ratingDelta > 0 ? '#5fd08a' : '#e2564a', { bold: true });
      stat(ctx, 375, 526, wins + '/' + (d.losses || 0), '胜 / 负', '#f0ebe0');
      stat(ctx, 560, 526, rate + '%', '胜率', PURPLE);
    }

    /* —— 二维码卡片 —— */
    card(ctx, 40, 590, 670, 300, 24);
    var link = d.link || '';
    var qrOK = false;
    if (typeof QR !== 'undefined' && link) {
      // 白底留边，避免深色背景吃掉定位图案导致扫不出
      ctx.save();
      roundRect(ctx, 78, 628, 224, 224, 14); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
      qrOK = QR.draw(ctx, link, 84, 634, 212, { quiet: 2, bg: '#ffffff', fg: '#161616' });
    }
    if (!qrOK) {
      ctx.save(); roundRect(ctx, 78, 628, 224, 224, 14);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill(); ctx.restore();
      text(ctx, '链接见下方', 190, 748, 22, DIM);
    }

    var tx = 340;
    text(ctx, isInvite ? '扫码 · 立刻开战' : '扫码 · 接受挑战', tx, 682, 32, GOLD, { bold: true, align: 'left' });
    text(ctx, isInvite ? '手机、电脑都能玩，不限同一 WiFi' : '同一房间号，等你来复仇', tx, 720, 19, DIM, { align: 'left' });
    if (d.code) text(ctx, '邀请码：' + d.code, tx, 762, 21, '#f0ebe0', { align: 'left' });
    text(ctx, ellipsis(ctx, link, 17, 330), tx, 798, 17, '#8d8da0', { align: 'left' });
    drawPiece(ctx, tx + 30, 848, 26, '密', 'hidden');
    text(ctx, '暗棋位置只存在你自己的设备上', tx + 66, 856, 17, DIM, { align: 'left' });

    text(ctx, '暗棋象棋 · 埋伏与反杀的中式博弈', W / 2, 946, 19, 'rgba(233,207,148,.55)');

    _canvas = cv;
    return cv;
  }

  /* ---------------- 导出：保存 / 复制 / 系统分享 ---------------- */
  function toBlob(cv) {
    return new Promise(function (resolve) {
      if (!cv) return resolve(null);
      if (cv.toBlob) cv.toBlob(function (b) { resolve(b); }, 'image/png');
      else resolve(null);
    });
  }

  function download(filename) {
    if (!_canvas) return false;
    try {
      var a = document.createElement('a');
      a.download = filename || ('暗棋象棋-' + Date.now() + '.png');
      a.href = _canvas.toDataURL('image/png');
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return true;
    } catch (e) { return false; }
  }

  async function copy() {
    if (!_canvas) return false;
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
      var b = await toBlob(_canvas);
      if (!b) return false;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      return true;
    } catch (e) { return false; }
  }

  // 手机端调用系统分享面板（可直接发微信）；不支持则返回 false，由调用方提示改用保存
  async function share(title) {
    if (!_canvas) return false;
    try {
      if (!navigator.share || !navigator.canShare) return false;
      var b = await toBlob(_canvas);
      if (!b) return false;
      var f = new File([b], 'xiangqi.png', { type: 'image/png' });
      if (!navigator.canShare({ files: [f] })) return false;
      await navigator.share({ files: [f], title: title || '暗棋象棋', text: title || '来下一局暗棋象棋' });
      return true;
    } catch (e) { return false; }
  }

  function dataURL() { return _canvas ? _canvas.toDataURL('image/png') : ''; }

  return { build: build, download: download, copy: copy, share: share, dataURL: dataURL, W: W, H: H };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Poster;
