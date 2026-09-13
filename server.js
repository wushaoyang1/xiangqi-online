'use strict';
/*
 * 暗棋象棋 · 联机服务器
 * 只用 Node.js 内置模块，零第三方依赖。
 *   1) 提供网页静态文件（index.html / styles.css / game.js / net.js）
 *   2) 提供房间匹配 + 消息中转（长轮询实现，回合制游戏足够）
 *
 * 重要：服务器完全不懂象棋规则，也不保存任何暗棋位置。
 *       暗棋位置只存在于各自玩家的电脑里，服务器只是"传话筒"。
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const POLL_TIMEOUT = 25000;              // 长轮询挂起上限 25 秒
const MATCH_TIMEOUT = 25000;             // 随机匹配挂起上限 25 秒（无对手时返回 waiting，客户端会再排一次）
const ROOM_TTL     = 6 * 60 * 60 * 1000; // 房间 6 小时无活动自动回收
const DISCONNECT_GRACE   = Number(process.env.DCG || 30000);   // 无心跳判定掉线的宽限（默认30s；DCG 可覆盖，便于测试）
const DISCONNECT_TIMEOUT = Number(process.env.DCT || 70000);   // 掉线后最多多久判在线方胜（默认70s；DCT 可覆盖）

/* ===================== 段位 ELO 持久化 ===================== */
// 段位分按 clientId 记录，存到服务器同目录的 ratings.json（重启不丢）。
// 只在「对局结束」时由胜方客户端调用 /api/result 结算，服务器据此更新双方分并广播。
const RATINGS_FILE = path.join(ROOT, 'ratings.json');
const DEFAULT_RATING = 1200;
let ratings = {};
function loadRatings(){
  try { const s = fs.readFileSync(RATINGS_FILE, 'utf8'); ratings = JSON.parse(s) || {}; }
  catch(e){ ratings = {}; }
}
function saveRatings(){
  try { fs.writeFileSync(RATINGS_FILE, JSON.stringify(ratings)); } catch(e){}
}
function getRating(cid){ return ratings[String(cid)] || DEFAULT_RATING; }

/* ===================== 邀请裂变（专属邀请码 + 邀请关系） =====================
 * 每个 clientId 分配一个 6 位邀请码；好友通过 ?inv=码 打开页面时上报绑定一次。
 * 只记「谁邀请了几个人」，不记任何对局内容，更不涉及暗棋，隐私与保密不受影响。
 */
const INVITES_FILE = path.join(ROOT, 'invites.json');
let invites = { codes: {}, owners: {}, bound: {}, counts: {} };
function loadInvites(){
  try {
    const s = fs.readFileSync(INVITES_FILE, 'utf8');
    const j = JSON.parse(s) || {};
    invites = {
      codes:  j.codes  || {},   // clientId -> code
      owners: j.owners || {},   // code -> clientId
      bound:  j.bound  || {},   // 被邀请者 clientId -> 邀请码（一人只绑一次）
      counts: j.counts || {}    // code -> 已邀请人数
    };
  } catch(e){ invites = { codes:{}, owners:{}, bound:{}, counts:{} }; }
}
function saveInvites(){
  try { fs.writeFileSync(INVITES_FILE, JSON.stringify(invites)); } catch(e){}
}
// 去掉了容易看错的 0/O/1/I，方便口头/手抄传播
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function makeCode(){
  let c = '';
  do {
    c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (invites.owners[c]);      // 极小概率撞码，撞了就重生成
  return c;
}
function getInviteCode(cid){
  cid = String(cid || '').slice(0, 64);
  if (!cid) return null;
  if (invites.codes[cid]) return invites.codes[cid];
  const c = makeCode();
  invites.codes[cid] = c;
  invites.owners[c] = cid;
  saveInvites();
  return c;
}

/* ===================== 赛季 / 段位天梯 =====================
 * 段位天梯分两层：
 *   - ratings.json：历史总积分（all-time），跨赛季累计，永不重置。
 *   - seasons.json：当前赛季积分，每赛季（按季度）重置，用于天梯排名与护盾保护。
 * 两者都不涉及任何棋局内容或暗棋坐标，保密不受影响。
 */
const SEASONS_FILE = path.join(ROOT, 'seasons.json');
const SEASON_GOLD   = 1500;        // 黄金段位门槛：达到后失败有护盾保护
const SEASON_SHIELD = 3;           // 每赛季护盾次数：黄金及以上段位失败可抵消扣分
function seasonIdFromDate(d){
  const q = Math.floor(d.getMonth() / 3) + 1;
  return d.getFullYear() + 'Q' + q;
}
let seasons = { current: null, players: {} };
function loadSeasons(){
  try {
    const s = JSON.parse(fs.readFileSync(SEASONS_FILE, 'utf8') || '{}');
    seasons = { current: s.current || null, players: s.players || {} };
  } catch(e){ seasons = { current: null, players: {} }; }
}
function saveSeasons(){ try { fs.writeFileSync(SEASONS_FILE, JSON.stringify(seasons)); } catch(e){} }
function ensureSeason(){
  const id = seasonIdFromDate(new Date());
  if (seasons.current !== id){ seasons.current = id; seasons.players = {}; saveSeasons(); }  // 赛季滚动：旧玩家归档、新赛季清零
  return id;
}
function getSeasonPlayer(cid){
  cid = String(cid || '');
  if (!seasons.players[cid]) seasons.players[cid] = { rating: DEFAULT_RATING, wins:0, losses:0, shield: SEASON_SHIELD, updated:0 };
  return seasons.players[cid];
}

/* ===================== 全局私信 / 在线状态（好友约战用） ===================== */
// 好友可能不在同一个房间，约战消息走"全局收件箱"，不依赖房间。
const presence  = new Map();       // clientId -> 最近活跃时间戳
const inboxes   = new Map();       // clientId -> [{ seq, from, type, data, t }]
const imWaiters = new Map();       // clientId -> [挂起的长轮询 waiter]
let   imSeq = 0;
function touchGlobal(cid){ if (cid) presence.set(String(cid), Date.now()); }
function isOnlineGlobal(cid){ const t = presence.get(String(cid)); return !!(t && (Date.now() - t < 90000)); }
function resolveTarget(t){          // to 可以是邀请码（解析成 cid）或直接的 cid
  t = String(t || '').trim().toUpperCase();
  if (invites.owners[t]) return invites.owners[t];
  return t;
}
function pushIM(toCid, from, type, data){
  toCid = String(toCid);
  imSeq++;
  const m = { seq: imSeq, from: String(from || ''), type, data: data || null, t: Date.now() };
  if (!inboxes.has(toCid)) inboxes.set(toCid, []);
  inboxes.get(toCid).push(m);
  const ws = (imWaiters.get(toCid) || []).splice(0);
  for (const w of ws) flushIM(w);
  return m;
}
function flushIM(w){
  if (w.done) return;
  w.done = true; clearTimeout(w.timer);
  const out = (inboxes.get(w.cid) || []).filter(m => m.seq > w.since);
  sendJSON(w.res, 200, { ok: true, seq: imSeq, msgs: out });
}

/* ===================== 好友（按浏览器 clientId 持久化） ===================== */
const FRIENDS_FILE = path.join(ROOT, 'friends.json');
let friends = {};
function loadFriends(){ try { friends = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8') || '{}'); } catch(e){ friends = {}; } }
function saveFriends(){ try { fs.writeFileSync(FRIENDS_FILE, JSON.stringify(friends)); } catch(e){} }

/* ===================== 随机匹配队列 ===================== */
const matchQueue   = [];                  // 等待匹配的 clientId 列表（先进先出）
const matchWaiters = new Map();           // clientId -> { res, done, timer }（挂起中的请求）
const rankedRooms = new Map();           // 房间名 -> 是否排位赛（仅 /api/match 撮合时写入；自建房间不写=休闲）

// 把某客户端移出匹配队列，并释放它可能挂起的请求（用于取消匹配 / 断线清理）
function removeFromMatch(cid){
  const i = matchQueue.indexOf(cid);
  if (i >= 0) matchQueue.splice(i, 1);
  const w = matchWaiters.get(cid);
  if (w){
    clearTimeout(w.timer);
    matchWaiters.delete(cid);
    if (!w.done){ w.done = true; try { sendJSON(w.res, 200, { ok:true, cancelled:true }); } catch(e){} }
  }
}

/* ===================== 房间 ===================== */
const rooms = new Map();

function getRoom(name){
  let r = rooms.get(name);
  if (!r){
    r = { name, seq: 0, msgs: [], waiters: [], players: {}, clients: {}, spectators: new Map(), lastSeen: { red: 0, black: 0 }, offlineSince: { red: 0, black: 0 }, touched: Date.now(), resultApplied: false };
    rooms.set(name, r);
  }
  r.touched = Date.now();
  return r;
}

function flushWaiter(room, w){
  if (w.done) return;
  w.done = true;
  clearTimeout(w.timer);
  // 只把"别人发的"消息回给他，自己发的不回传，避免自己处理自己的着法
  const out = room.msgs.filter(m => m.seq > w.since && m.from !== w.side);
  sendJSON(w.res, 200, { ok: true, seq: room.seq, msgs: out });
}

function pushMsg(room, from, type, data){
  room.seq++;
  const m = { seq: room.seq, from, type, data: data || null, t: Date.now() };
  room.msgs.push(m);
  if (room.msgs.length > 5000) room.msgs.splice(0, room.msgs.length - 5000); // 保留整局（含观战/回放用），5000 步足够一局象棋
  const ws = room.waiters.splice(0);
  for (const w of ws) flushWaiter(room, w);
  return m;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.touched > ROOM_TTL) rooms.delete(k);
}, 10 * 60 * 1000).unref?.();

/* ===================== 断线检测 ===================== */
// 长轮询下，活跃玩家每 <25s 必有一次 poll 到达并更新 lastSeen。
// 若某方超过 GRACE 秒无心跳，视为掉线：先广播"对手掉线"给在线方（让其进入等待重连态）；
// 若超过 TIMEOUT 秒仍无重连，则广播 opponentLeft 判在线方胜。
setInterval(() => {
  const now = Date.now();
  for (const [, r] of rooms){
    for (const side of ['red', 'black']){
      if (!r.players[side] || !r.lastSeen[side]) continue;
      const gone = now - r.lastSeen[side];
      if (gone <= DISCONNECT_GRACE) continue;
      const other = side === 'red' ? 'black' : 'red';
      if (!r.offlineSince[side]){
        // 首次检测到掉线：通知在线方"对手掉线"
        r.offlineSince[side] = now;
        pushMsg(r, 'server', 'peer', {
          red:   !!(r.players.red   && side !== 'red'),
          black: !!(r.players.black && side !== 'black'),
          joined: other, rejoined: true, offline: true
        });
      } else if (gone > DISCONNECT_TIMEOUT){
        // 掉线超时：判在线方胜（仅当在线方确实在线）
        if (r.players[other] && (!r.lastSeen[other] || now - r.lastSeen[other] < DISCONNECT_GRACE)){
          pushMsg(r, 'server', 'opponentLeft', { winner: other, reason: 'timeout' });
        }
        r.offlineSince[side] = 0;   // 重置，避免重复广播
      }
    }
  }
}, Number(process.env.DCINT || 5000)).unref?.();

/* ===================== HTTP 工具 ===================== */
function sendJSON(res, code, obj){
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit = 1 * 1024 * 1024){   // 限制请求体最大 1MB，防止超大 POST 撑爆内存（公开部署防 DoS）
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', d => {
      total += d.length;
      if (total > limit){ try { req.destroy(); } catch(e){} resolve({}); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');   // 先拼 Buffer 再解码，避免中文被截断
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon'
};

function serveStatic(req, res, urlPath){
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); }   // 畸形 % 序列会抛 URIError，不能让它带崩进程
  catch(e){ res.writeHead(400); res.end('bad request'); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
  // —— 安全：禁止访问隐藏文件(.git/.env 等)、源码与数据文件，避免公开后源码/用户数据被下载 ——
  if (rel.split('/').some(seg => seg.startsWith('.'))){
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('forbidden'); return;
  }
  const _base = path.basename(rel).toLowerCase();
  if (['server.js','package.json','render.yaml','.gitignore','ratings.json','invites.json','friends.json','seasons.json'].includes(_base)){
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('forbidden'); return;
  }
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)){ res.writeHead(403); res.end('forbidden'); return; }   // 防目录穿越
  fs.readFile(full, (err, buf) => {
    if (err){ res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('404 not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'     // 永远拿最新代码，避免浏览器缓存旧版本
    });
    res.end(buf);
  });
}

function localIPs(){
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)){
    for (const ni of ifs[name] || []){
      if (ni.family === 'IPv4' && !ni.internal) out.push({ iface: name, ip: ni.address });
    }
  }
  return out;
}

/* ===================== 路由 ===================== */
const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, 'http://x'); }
  catch(e){ res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('bad request'); return; }
  const p = u.pathname;

  // —— 加入房间：先到者执红先手，后到者执黑 ——
  if (p === '/api/join' && req.method === 'POST'){
    const b = await readBody(req);
    const name = String(b.room || '').trim().slice(0, 24);
    const cid  = String(b.clientId || '').slice(0, 64);
    const role = b.role === 'spectator' ? 'spectator' : 'player';
    touchGlobal(cid);
    if (!name || !cid) return sendJSON(res, 400, { ok:false, error:'缺少房间号' });
    const room = getRoom(name);

    // —— 观战者：不占红黑位，只取当前完整棋局历史（不含任何暗棋坐标）——
    if (role === 'spectator'){
      const hist = room.msgs.slice();          // 先快照历史，避免把下面的"观战通知"也算进初始同步
      room.spectators.set(cid, true);
      const count = room.spectators.size;
      pushMsg(room, 'server', 'spectator', { count });  // 通知在场玩家有人观战（无暗棋信息）
      return sendJSON(res, 200, {
        ok: true, role:'spectator', seq: room.seq, msgs: hist
      });
    }

    let side = room.clients[cid];             // 已在房间里 => 刷新页面重连，沿用原来的一方
    let rejoined = !!side;
    if (!side){
      if (!room.players.red)        side = 'red';
      else if (!room.players.black) side = 'black';
      else return sendJSON(res, 200, { ok:false, error:'房间已满（已有两位玩家）' });
      room.players[side] = cid;
      room.clients[cid]  = side;
    }
    room.lastSeen[side] = Date.now();      // 记录活跃时间，用于掉线检测
    room.offlineSince[side] = 0;
    pushMsg(room, 'server', 'peer', {
      red: !!room.players.red, black: !!room.players.black, joined: side, rejoined
    });
    return sendJSON(res, 200, {
      ok: true, side, seq: room.seq, rejoined,
      both: !!(room.players.red && room.players.black),
      rating: getRating(cid)
    });
  }

  // —— 发消息（着法 / 裁决 / 结束回合 / 重开）——
  if (p === '/api/send' && req.method === 'POST'){
    const b = await readBody(req);
    const name = String(b.room || '').trim().slice(0, 24);
    const side = (b.side === 'red' || b.side === 'black' || b.side === 'spectator') ? b.side : null;
    if (!name || !side || !b.type) return sendJSON(res, 400, { ok:false, error:'参数不完整' });
    const room = getRoom(name);
    const m = pushMsg(room, side, String(b.type), b.data);
    return sendJSON(res, 200, { ok:true, seq: m.seq });
  }

  // —— 长轮询取消息：没有新消息就挂住，最多 25 秒 ——
  if (p === '/api/poll' && req.method === 'GET'){
    const name  = String(u.searchParams.get('room') || '').trim().slice(0, 24);
    const side  = u.searchParams.get('side');
    const since = Number(u.searchParams.get('since') || 0);
    const cid   = String(u.searchParams.get('cid') || '').slice(0, 64);
    if (!name || !side) return sendJSON(res, 400, { ok:false, error:'参数不完整' });
    const room = getRoom(name);
    if (side === 'red' || side === 'black') room.lastSeen[side] = Date.now();  // 玩家心跳
    touchGlobal(cid);

    // 观战者收全部消息（没有任何消息的 from 是 'spectator'），玩家只收"别人发的"
    const isSpec = side === 'spectator';
    const pending = room.msgs.filter(m => m.seq > since && (isSpec || m.from !== side));
    if (pending.length) return sendJSON(res, 200, { ok:true, seq: room.seq, msgs: pending });

    const w = { res, side, since, done:false, timer:null };
    w.timer = setTimeout(() => {
      const i = room.waiters.indexOf(w);
      if (i >= 0) room.waiters.splice(i, 1);
      if (!w.done){ w.done = true; sendJSON(res, 200, { ok:true, seq: room.seq, msgs: [] }); }
    }, POLL_TIMEOUT);
    room.waiters.push(w);
    req.on('close', () => {
      const i = room.waiters.indexOf(w);
      if (i >= 0) room.waiters.splice(i, 1);
      if (isSpec && cid && room.spectators.has(cid)){
        room.spectators.delete(cid);
        pushMsg(room, 'server', 'spectator', { count: room.spectators.size });
      }
      w.done = true; clearTimeout(w.timer);
    });
    return;
  }

  // —— 整局回放记录：返回该房间完整消息流（不含任何暗棋坐标），供"保存回放/观战同步"使用 ——
  if (p === '/api/record' && req.method === 'GET'){
    const name = String(u.searchParams.get('room') || '').trim().slice(0, 24);
    const room = rooms.get(name);
    if (!room) return sendJSON(res, 404, { ok:false, error:'房间不存在或已过期' });
    return sendJSON(res, 200, { ok:true, room: name, seq: room.seq, msgs: room.msgs.slice() });
  }

  // —— 本机局域网地址，用于生成邀请链接 ——
  if (p === '/api/ip'){
    return sendJSON(res, 200, { ok:true, port: PORT, ips: localIPs() });
  }

  // —— 当前活跃房间（方便排查）——
  if (p === '/api/rooms'){
    const list = [...rooms.values()].map(r => ({
      room: r.name,
      red: !!r.players.red, black: !!r.players.black,
      msgs: r.msgs.length, idleSec: Math.round((Date.now() - r.touched)/1000)
    }));
    return sendJSON(res, 200, { ok:true, rooms: list });
  }

  // —— 随机匹配：进队列 -> 系统自动分配在线对手 ——
  if (p === '/api/match' && req.method === 'POST'){
    const b = await readBody(req);
    const cid = String(b.clientId || '').slice(0, 64);
    if (!cid) return sendJSON(res, 400, { ok:false, error:'缺少 clientId' });
    touchGlobal(cid);

    // 取消匹配：把本客户端移出队列，并释放可能挂起的请求
    if (b.cancel){
      removeFromMatch(cid);
      return sendJSON(res, 200, { ok:true, cancelled:true });
    }

    // 找一个"不是自己"的等待者进行配对
    const idx = matchQueue.findIndex(id => id !== cid);
    if (idx >= 0){
      const wcid = matchQueue.splice(idx, 1)[0];
      const waiter = matchWaiters.get(wcid);
      if (waiter) matchWaiters.delete(wcid);
      const roomName = 'm_' + Math.random().toString(36).slice(2, 8);
      const room = getRoom(roomName);
      const ranked = !!(b.ranked || (waiter && waiter.ranked));   // 任意一方选排位即按排位结算
      rankedRooms.set(roomName, ranked);   // 排位赛标记：终局据此决定是否走 ELO
      room.players.red   = wcid; room.clients[wcid] = 'red';    // 先进入队列者执红（先手），与下方 resultRed→waiter 一致
      room.players.black = cid; room.clients[cid]  = 'black';
      const m = pushMsg(room, 'server', 'peer', { red:true, black:true, joined:'red', rejoined:false });
      const seq = m.seq;
      const resultBlack = { ok:true, matched:true, room:roomName, side:'black', seq, rating: getRating(wcid) };
      const resultRed   = { ok:true, matched:true, room:roomName, side:'red',   seq, rating: getRating(cid) };
      if (waiter){ clearTimeout(waiter.timer); waiter.done = true; sendJSON(waiter.res, 200, resultRed); }
      return sendJSON(res, 200, resultBlack);
    }

    // 没有等待者：加入队列并挂起，直到有人匹配或超时
    matchQueue.push(cid);
    const w = { res, done:false, timer:null, ranked: !!b.ranked };
    w.timer = setTimeout(() => {
      const i = matchQueue.indexOf(cid);
      if (i >= 0) matchQueue.splice(i, 1);
      if (matchWaiters.get(cid) === w) matchWaiters.delete(cid);
      if (!w.done){ w.done = true; sendJSON(res, 200, { ok:true, waiting:true }); }
    }, MATCH_TIMEOUT);
    matchWaiters.set(cid, w);
    req.on('close', () => {
      const i = matchQueue.indexOf(cid);
      if (i >= 0) matchQueue.splice(i, 1);
      if (matchWaiters.get(cid) === w) matchWaiters.delete(cid);
      w.done = true; clearTimeout(w.timer);
    });
    return;
  }

  // —— 查询某 clientId 的当前段位（进房后展示用）——
  if (p === '/api/rating' && req.method === 'GET'){
    const cid = String(u.searchParams.get('clientId') || '').slice(0, 64);
    return sendJSON(res, 200, { ok:true, rating: getRating(cid) });
  }

  // —— 对局结束结算：由客户端（胜方或认输方）上报胜方，服务器按 ELO 更新双方段位并广播 ——
  // 同一局只结算一次（room.resultApplied 去重），避免双方都上报导致重复加减。
  if (p === '/api/result' && req.method === 'POST'){
    const b = await readBody(req);
    const name = String(b.room || '').trim().slice(0, 24);
    const winnerSide = b.winner === 'red' || b.winner === 'black' ? b.winner : null;
    const room = rooms.get(name);
    if (!room) return sendJSON(res, 404, { ok:false, error:'房间不存在或已过期' });
    if (room.resultApplied) return sendJSON(res, 200, { ok:true, already:true });
    if (!winnerSide) return sendJSON(res, 400, { ok:false, error:'缺少胜方' });
    const ra = room.players.red, rb = room.players.black;
    if (!ra || !rb) return sendJSON(res, 400, { ok:false, error:'双方未到齐，无法结算' });
    const rated = rankedRooms.get(name) === true;   // 仅「排位赛」影响段位；匹配/开房间不计分
    if (!rated){
      // 休闲模式：不计段位，仅广播胜负结果与不变的段位分（让客户端正常结束对局）
      room.resultApplied = true;
      const r0 = getRating(ra), r1 = getRating(rb);
      pushMsg(room, 'server', 'rating', { winnerSide, rated:false, ratings: { red: r0, black: r1 } });
      return sendJSON(res, 200, { ok:true, rated:false, ratings: { red: r0, black: r1 } });
    }
    const redWon = (winnerSide === 'red');
    const Ra = getRating(ra), Rb = getRating(rb);
    const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));   // 红方期望胜率
    const Eb = 1 - Ea;
    const K = 32;
    // 按实际胜方结算：胜者加分、负者扣分（旧版写死按"红胜"方向，黑胜时会反向加减分）
    ratings[ra] = Math.round(Ra + K * (redWon ? (1 - Ea) : -Ea));
    ratings[rb] = Math.round(Rb + K * (redWon ? -Eb : (1 - Eb)));
    saveRatings();
    // —— 赛季积分 + 护盾保护（仅排位赛）：胜方必涨，负方达黄金后先用护盾抵消扣分 ——
    ensureSeason();
    const pa = getSeasonPlayer(ra), pb = getSeasonPlayer(rb);
    const esa = 1 / (1 + Math.pow(10, (pb.rating - pa.rating) / 400));   // 红方期望胜率
    const esb = 1 - esa;
    if (redWon){
      pa.wins++; pb.losses++;
      pa.rating = Math.round(pa.rating + K * (1 - esa));
      if (pb.rating >= SEASON_GOLD && pb.shield > 0) pb.shield--;   // 护盾抵消：不扣分
      else pb.rating = Math.round(pb.rating + K * (0 - esb));
    } else {
      pb.wins++; pa.losses++;
      pb.rating = Math.round(pb.rating + K * (1 - esb));
      if (pa.rating >= SEASON_GOLD && pa.shield > 0) pa.shield--;
      else pa.rating = Math.round(pa.rating + K * (0 - esa));
    }
    saveSeasons();
    room.resultApplied = true;
    // 广播给房间所有人（含观战者）：双方新段位 + 胜方 + 赛季信息
    pushMsg(room, 'server', 'rating', {
      winnerSide,
      rated:true,
      ratings: { red: ratings[ra], black: ratings[rb] },
      season: {
        red:   { rating: pa.rating, shield: pa.shield, gold: pa.rating >= SEASON_GOLD },
        black: { rating: pb.rating, shield: pb.shield, gold: pb.rating >= SEASON_GOLD }
      }
    });
    return sendJSON(res, 200, { ok:true, rated:true, ratings: { red: ratings[ra], black: ratings[rb] },
      season: { red:{rating:pa.rating,shield:pa.shield}, black:{rating:pb.rating,shield:pb.shield} } });
  }

  // —— 取得本机专属邀请码（没有就分配一个）+ 已邀请人数 ——
  if (p === '/api/invite/code' && req.method === 'GET'){
    const cid = String(u.searchParams.get('clientId') || '').slice(0, 64);
    if (!cid) return sendJSON(res, 400, { ok:false, error:'缺少 clientId' });
    const code = getInviteCode(cid);
    return sendJSON(res, 200, { ok:true, code, count: invites.counts[code] || 0 });
  }

  // —— 绑定邀请关系：新用户带 ?inv=码 打开页面时调用一次 ——
  if (p === '/api/invite/bind' && req.method === 'POST'){
    const b = await readBody(req);
    const code = String(b.code || '').trim().toUpperCase().slice(0, 8);
    const cid  = String(b.clientId || '').slice(0, 64);
    if (!code || !cid) return sendJSON(res, 400, { ok:false, error:'参数不完整' });
    const owner = invites.owners[code];
    if (!owner) return sendJSON(res, 404, { ok:false, error:'邀请码无效' });
    if (owner === cid) return sendJSON(res, 200, { ok:true, bound:false, reason:'self' });        // 不能邀请自己
    if (invites.bound[cid]) return sendJSON(res, 200, { ok:true, bound:false, reason:'already' }); // 一人只算一次
    invites.bound[cid] = code;
    invites.counts[code] = (invites.counts[code] || 0) + 1;
    saveInvites();
    return sendJSON(res, 200, { ok:true, bound:true, count: invites.counts[code] });
  }

  // —— 查询某邀请码已邀请多少人（邀请面板刷新用）——
  if (p === '/api/invite/stats' && req.method === 'GET'){
    const code = String(u.searchParams.get('code') || '').trim().toUpperCase().slice(0, 8);
    if (!code || !invites.owners[code]) return sendJSON(res, 404, { ok:false, error:'邀请码无效' });
    return sendJSON(res, 200, { ok:true, count: invites.counts[code] || 0 });
  }

  // —— 段位天梯排行榜：取当前赛季积分 Top 50 ——
  if (p === '/api/leaderboard' && req.method === 'GET'){
    ensureSeason();
    const arr = [];
    for (const [cid, pl] of Object.entries(seasons.players)){
      if (pl.rating > DEFAULT_RATING || pl.wins > 0)
        arr.push({ cid, rating: pl.rating, wins: pl.wins, losses: pl.losses, shield: pl.shield });
    }
    arr.sort((a, b) => b.rating - a.rating);
    return sendJSON(res, 200, { ok:true, season: seasons.current, list: arr.slice(0, 50) });
  }

  // —— 当前赛季信息（客户端展示赛季分/护盾/是否达黄金）——
  if (p === '/api/season' && req.method === 'GET'){
    const cid = String(u.searchParams.get('clientId') || '').slice(0, 64);
    const id  = ensureSeason();
    const pl  = cid ? getSeasonPlayer(cid) : null;
    return sendJSON(res, 200, {
      ok: true, season: id,
      player: pl ? { rating: pl.rating, wins: pl.wins, losses: pl.losses, shield: pl.shield, gold: pl.rating >= SEASON_GOLD } : null
    });
  }

  // —— 全局私信 / 约战：发送（to 可为邀请码或 clientId）——
  if (p === '/api/im/send' && req.method === 'POST'){
    const b = await readBody(req);
    const from = String(b.from || '').slice(0, 64);
    const to   = resolveTarget(b.to);
    if (!from || !to) return sendJSON(res, 400, { ok:false, error:'参数不完整' });
    if (to === from)  return sendJSON(res, 200, { ok:true, self:true });
    touchGlobal(from); touchGlobal(to);
    const m = pushIM(to, from, String(b.type || 'msg'), b.data);
    return sendJSON(res, 200, { ok:true, seq: m.seq });
  }

  // —— 全局私信长轮询拉取（好友约战通知走这里，与房间消息相互独立）——
  if (p === '/api/im/pull' && req.method === 'GET'){
    const cid   = String(u.searchParams.get('cid') || '').slice(0, 64);
    const since = Number(u.searchParams.get('since') || 0);
    if (!cid) return sendJSON(res, 400, { ok:false, error:'缺少 cid' });
    touchGlobal(cid);
    const pend = (inboxes.get(cid) || []).filter(m => m.seq > since);
    if (pend.length) return sendJSON(res, 200, { ok:true, seq: imSeq, msgs: pend });
    const w = { res, cid, since, done:false, timer:null };
    w.timer = setTimeout(() => {
      const i = (imWaiters.get(cid) || []).indexOf(w);
      if (i >= 0) imWaiters.get(cid).splice(i, 1);
      if (!w.done){ w.done = true; sendJSON(res, 200, { ok:true, seq: imSeq, msgs: [] }); }
    }, POLL_TIMEOUT);
    if (!imWaiters.has(cid)) imWaiters.set(cid, []);
    imWaiters.get(cid).push(w);
    req.on('close', () => {
      const i = (imWaiters.get(cid) || []).indexOf(w);
      if (i >= 0) imWaiters.get(cid).splice(i, 1);
      w.done = true; clearTimeout(w.timer);
    });
    return;
  }

  // —— 查询某 clientId / 邀请码 当前是否在线（好友列表用）——
  if (p === '/api/im/online' && req.method === 'GET'){
    const cid = resolveTarget(u.searchParams.get('cid') || '');
    return sendJSON(res, 200, { ok:true, online: isOnlineGlobal(cid) });
  }

  // —— 好友列表（带在线状态）——
  if (p === '/api/friend/list' && req.method === 'GET'){
    const cid  = String(u.searchParams.get('cid') || '').slice(0, 64);
    const list = (friends[cid] || []).map(f => {
      const fid = invites.owners[f.code];
      return { code: f.code, name: f.name || '', online: fid ? isOnlineGlobal(fid) : false };
    });
    return sendJSON(res, 200, { ok:true, list });
  }

  // —— 添加好友（凭对方邀请码）——
  if (p === '/api/friend/add' && req.method === 'POST'){
    const b    = await readBody(req);
    const cid  = String(b.cid || '').slice(0, 64);
    const code = String(b.code || '').trim().toUpperCase().slice(0, 8);
    const name = String(b.name || '').slice(0, 24);
    if (!cid || !code) return sendJSON(res, 400, { ok:false, error:'参数不完整' });
    const owner = invites.owners[code];
    if (!owner) return sendJSON(res, 404, { ok:false, error:'邀请码无效' });
    if (owner === cid) return sendJSON(res, 200, { ok:false, reason:'self' });
    if (!friends[cid]) friends[cid] = [];
    if (friends[cid].some(f => f.code === code)) return sendJSON(res, 200, { ok:true, dup:true });
    friends[cid].push({ code, name });
    saveFriends();
    return sendJSON(res, 200, { ok:true });
  }

  // —— 删除好友 ——
  if (p === '/api/friend/remove' && req.method === 'POST'){
    const b    = await readBody(req);
    const cid  = String(b.cid || '').slice(0, 64);
    const code = String(b.code || '').trim().toUpperCase().slice(0, 8);
    if (friends[cid]){ friends[cid] = friends[cid].filter(f => f.code !== code); saveFriends(); }
    return sendJSON(res, 200, { ok:true });
  }

  serveStatic(req, res, p);
});

// 不指定 host：Node 默认双栈监听，IPv4(192.168.x.x) 和 IPv6(localhost/::1) 都能连
server.maxConnections = 2000;   // 超过则拒绝新连接，防止公开部署被大量连接耗尽文件描述符
server.timeout = 60000;          // 单个连接最长 60s 未活动即断开，回收空闲长轮询
loadRatings();   // 启动即加载已有段位，保证断线/重启后段位不丢
loadInvites();   // 邀请码与邀请关系同理，重启不丢
loadSeasons();   // 赛季状态：按季度自动滚动，跨赛季清零
loadFriends();   // 好友关系：按浏览器 clientId 持久化，重启不丢
server.listen(PORT, () => {
  const ips = localIPs();
  console.log('===============================================');
  console.log(' 暗棋象棋 · 联机服务器已启动');
  console.log('-----------------------------------------------');
  console.log(' 本机打开：      http://localhost:' + PORT);
  for (const { iface, ip } of ips){
    console.log(' 同一局域网可用： http://' + ip + ':' + PORT + '   [' + iface + ']');
  }
  if (!ips.length) console.log(' （未检测到局域网网卡，可能未连 WiFi/网线）');
  console.log('-----------------------------------------------');
  console.log(' 本地/局域网：把上面地址发给对方，输同一个房间号即可开战');
  console.log(' 部署到云(如 Render/Fly)：用平台提供的域名访问，对方无需同 WiFi');
  console.log(' 关闭此窗口即停止服务');
  console.log('===============================================');
});
