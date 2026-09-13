'use strict';

/* ===================== 配置 ===================== */
const CELL = 58;
const MARGIN = 34;
const ROWS = 10;
const COLS = 9;
const PR = 24;

const CHARS = {
  red:   { general:'帅', advisor:'仕', elephant:'相', horse:'马', chariot:'车', cannon:'炮', soldier:'兵' },
  black: { general:'将', advisor:'士', elephant:'象', horse:'马', chariot:'车', cannon:'炮', soldier:'卒' }
};
const NAME = { red:'红方', black:'黑方' };

/* ===================== 全局状态 ===================== */
let state;
let config = { mode: 'pvp', aiSide: 'black', difficulty: 'normal' };
let aiTimer = null;
let piecesEl, hitsEl, hlEl, statusEl, logEl, endBtn, newGameBtn,
    redTokensEl, blackTokensEl, gateEl, gateTextEl, gateBtn, fxEl, toastEl,
    modeSel, aiSideSel, diffSel, applyBtn, aiOptsEl,
    onlineOptsEl, roomInput, joinBtn, netInfoEl, inviteBoxEl,
    matchBtn, createBtn, matchStatusEl, cancelMatchBtn,
    spectateBtn, recordBoxEl, replayBtn, replayPanelEl, replayListEl,
    replayPlayBtn, replayImportBtn, replayFileEl, replayBarEl,
    replayRestartBtn, replayStepBtn, replaySliderEl, replayStepEl,
    replayShowHiddenEl,
    handoffEl, handoffTextEl,
    menuEl, menuMainEl, menuStartEl, menuStartBtnEl, menuBackBtnEl, menuHomeBtnEl,
    ladderModalEl, ladderMyEl, ladderBarEl, ladderNextEl, ladderSeasonEl, leaderboardEl,
    achModalEl, achGridEl,
    friendsModalEl, friendCodeEl, friendNameEl, friendAddBtnEl, friendListEl,
    tutorialModalEl, tutorialTextEl, tutorialSkipEl, tutorialNextEl, tutorialDotsEl,
    reviewModalEl, reviewScoreEl, reviewListEl,
    danmakuLayerEl, danmakuInputEl, danmakuSendEl, reviewBtnEl,
    victoryEl, victoryTextEl, victorySubEl, victoryRestartBtn, victoryCloseBtn;
let stateRanked = false;         // 当前这局是否排位赛（影响终局段位结算的展示标志）
let handoffTimer = null;       // 交接遮罩自动消失的计时器
let handoffActive = false;     // 交接遮罩显示期间为 true（短暂屏蔽棋盘输入，保护对方暗棋）

/* —— 走子动画（FLIP）相关 ——
   lastMove 记录最近一步的起止格，用于「最后一步标记」与落子弹性动画；
   seq 每走一步自增，render 用它区分「新的一步」与「同一帧的重复重绘」，避免动画反复重放。 */
let lastMove = null;             // { fr, fc, tr, tc, seq }
let lastMoveSeq = 0;
let lastMarkShownSeq = -1;       // 已画过标记的 seq（避免每次 render 重放入场动画）
let landedShownSeq = -1;         // 已播过落子弹跳的 seq

let specCount = 0;   // 当前观战人数（由服务器 'spectator' 消息更新）

// 本机暗棋坐标轨迹：仅在「本机已知的暗棋坐标」上记录（联机时对手是 -1,-1，本机根本没有），
// 用于「回放显示暗棋」。绝不发送到服务器、也绝不出现在观战流里 —— 保密设计不破。
let liveHidden = null;          // { seqs:[...], snaps:[ {red,black} 的浅拷贝 ] }
let _spectateMode = false;      // startSpectate 进入期间为 true，避免把观战当成本局来记录

/* ===================== 段位 / 悔棋 / 聊天 的模块级状态 ===================== */
let myRating = 1200;            // 本机玩家当前段位（进房时从服务器拉取；结算后更新）
let prevRatingShown = null;     // 上一次展示的段位，用于显示本局增减
let snapHistory = [];           // 悔棋快照栈：每个回合开始时记录的整局状态（含本机暗棋坐标）
let _applyingHistory = false;   // 正在回放历史消息（重连/观战）时，禁止记录快照
let undoRequestSide = null;     // 收到的「悔棋请求」来自哪一方（待本机同意/拒绝）
let chatMsgsEl = null, chatInputEl = null, chatSendEl = null, chatPanelEl = null;
let infoPanelEl = null, tabChatEl = null, tabRulesEl = null, infoCollapseEl = null, rulesPanelEl = null;
let infoTab = 'chat';          // 信息面板当前标签：'chat' 聊天 / 'rules' 规则
let infoCollapsed = false;     // 信息面板是否收起（收起后只剩头部按钮）
let ratingLineEl = null, soundBtnEl = null, undoBtnEl = null, resignBtnEl = null, undoPromptEl = null;
// 邀请裂变 / 海报相关 DOM
let inviteBtnEl = null, invitePanelEl = null, inviteLinkEl = null, inviteStatEl = null,
    inviteCopyBtn = null, invitePosterBtn = null, posterBtnEl = null,
    posterModalEl = null, posterImgEl = null;

/* ===================== 音效系统（Web Audio 合成，无需音频文件） ===================== */
const Sound = {
  ctx: null,
  enabled: (function(){ try { return localStorage.getItem('xq_sound') !== 'off'; } catch(e){ return true; } })(),
  vol: 0.7,
  setVol(v){ this.vol = v; },
  init(){
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch(e){}
  },
  // 单个音：freq 频率 / dur 时长(秒) / type 波形 / vol 音量
  beep(freq, dur, type, vol){
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime((vol || 0.06) * (this.vol == null ? 1 : this.vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.12));
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + (dur || 0.12) + 0.02);
  },
  move(){    this.beep(440, 0.08, 'triangle', 0.05); },
  capture(){ this.beep(240, 0.12, 'square', 0.06); setTimeout(() => this.beep(170, 0.12, 'square', 0.06), 55); },
  explode(){ this.beep(110, 0.28, 'sawtooth', 0.09); setTimeout(() => this.beep(80, 0.22, 'sawtooth', 0.08), 80); },
  hidden(){  this.beep(660, 0.10, 'sine', 0.05); },
  win(){     [523, 659, 784, 1047].forEach((f,i) => setTimeout(() => this.beep(f, 0.16, 'triangle', 0.08), i*130)); },
  lose(){    [392, 330, 262].forEach((f,i) => setTimeout(() => this.beep(f, 0.20, 'sine', 0.07), i*150)); },
  click(){   this.beep(330, 0.04, 'sine', 0.035); },
  chat(){    this.beep(880, 0.06, 'sine', 0.04); },
  message(){ this.beep(720, 0.07, 'sine', 0.045); },
  toggle(){
    this.enabled = !this.enabled;
    try { localStorage.setItem('xq_sound', this.enabled ? 'on' : 'off'); } catch(e){}
    if (this.enabled){ this.init(); this.click(); }
    if (soundBtnEl) soundBtnEl.textContent = this.enabled ? '🔊 音效' : '🔇 静音';
    return this.enabled;
  }
};

/* ===================== 设置（持久化到 localStorage） ===================== */
const SETTINGS_KEY = 'xq_settings';
const SETTING_DEFAULTS = {
  music: false,             // 背景音乐开关
  musicVol: 0.5,            // 背景音乐音量 0~1
  sfx: true,                // 音效开关（落子/吃子/胜负等）
  sfxVol: 0.7,              // 音效音量 0~1
  allowMatch: true,         // 隐私：允许被随机匹配
  hideRatingPoster: false,  // 隐私：战绩海报上隐藏段位分
  boardTheme: 'classic',    // 外观：棋盘主题 classic / dark / light
  showHighlights: true,     // 外观：高亮可走位置
  fx: true,                 // 外观：爆炸/吃子等特效动画
  vibrate: true             // 手感：翻棋/吃子时手机震动（仅真实对局触发，iOS web-view 不支持则自动跳过）
};
const Settings = {
  data: Object.assign({}, SETTING_DEFAULTS),
  load(){
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) this.data = Object.assign({}, SETTING_DEFAULTS, JSON.parse(s));
      // 兼容旧版“音效”开关（xq_sound）：若曾手动关过，沿用
      const sv = localStorage.getItem('xq_sound');
      if (sv) this.data.sfx = (sv !== 'off');
    } catch(e){}
  },
  save(){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data)); } catch(e){} },
  get(k){ return this.data[k]; },
  set(k, v){ this.data[k] = v; this.save(); this.apply(k); },
  applyAll(){ for (const k in this.data) this.apply(k); },
  apply(k){
    switch(k){
      case 'music':           if (this.data.music) Music.start(); else Music.stop(); break;
      case 'musicVol':        Music.setVolume(this.data.musicVol); break;
      case 'sfx':             Sound.enabled = !!this.data.sfx; break;
      case 'sfxVol':          Sound.setVol(this.data.sfxVol); break;
      case 'boardTheme':      applyBoardTheme(); break;
      case 'showHighlights':  render(); break;
      case 'fx':              break;   // 仅影响后续特效，无需即时重绘
      // allowMatch / hideRatingPoster 在对应逻辑里实时读取
    }
  },
  toggleSfx(){
    this.set('sfx', !this.data.sfx);
    if (soundBtnEl) soundBtnEl.textContent = this.data.sfx ? '🔊 音效' : '🔇 静音';
    if (this.data.sfx){ Sound.init(); Sound.click(); }
    return this.data.sfx;
  }
};

/* 背景音乐：默认用 Web Audio 合成柔和环境和弦（零依赖、可离线）；
   若 xiangqi 目录下放了 music.mp3，则优先播放该文件（循环）。 */
const Music = {
  ctx: null, gain: null, vol: 0.5, playing: false, nodes: [],
  audioEl: null, useFile: false, t: null,
  ensure(){
    try {
      if (!this.ctx){
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch(e){}
  },
  startSynth(){
    if (!this.ctx) this.ensure();
    if (!this.ctx || this.nodes.length) return;
    const ctx = this.ctx;
    [220.00, 261.63, 329.63].forEach(f => {            // A3 + C4 + E4 柔和铺底
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.30;
      o.connect(g); g.connect(this.gain); o.start();
      this.nodes.push(o);
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;   // 极慢起伏（呼吸感）
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(this.gain.gain); lfo.start();
    this.nodes.push(lfo);
    this.gain.gain.value = this.vol * 0.16;
  },
  stopSynth(){
    this.nodes.forEach(n => { try { n.stop(); } catch(e){} });
    this.nodes = [];
    if (this.gain) this.gain.gain.value = 0;
  },
  initFile(){
    if (this.audioEl) return;
    try {
      this.audioEl = new Audio('music.mp3');
      this.audioEl.loop = true;
      this.audioEl.volume = this.vol;
      this.audioEl.addEventListener('error', () => { this.useFile = false; this.startSynth(); });
    } catch(e){}
  },
  start(){
    if (this.playing) return;
    this.playing = true;
    this.ensure();
    this.initFile();
    if (this.audioEl){
      this.audioEl.volume = this.vol;
      this.audioEl.oncanplay = () => { if (!this.playing) return; this.stopSynth(); this.useFile = true; this.audioEl.play().catch(()=>{}); };
      this.audioEl.onerror  = () => { this.useFile = false; this.startSynth(); };
      this.audioEl.load();
      this.t = setTimeout(() => { if (!this.useFile) this.startSynth(); }, 1500);  // 兜底：文件缺失则用合成音
    } else {
      this.startSynth();
    }
  },
  stop(){
    this.playing = false;
    if (this.t){ clearTimeout(this.t); this.t = null; }
    this.stopSynth();
    if (this.audioEl){ try { this.audioEl.pause(); } catch(e){} }
  },
  resumeIfNeeded(){
    if (!this.playing) return;
    this.ensure();
    if (this.useFile && this.audioEl) this.audioEl.play().catch(()=>{});
    else if (this.ctx && this.ctx.state === 'running' && !this.nodes.length) this.startSynth();
  },
  setVolume(v){
    this.vol = v;
    if (this.audioEl) this.audioEl.volume = v;
    if (this.gain && this.playing && this.nodes.length) this.gain.gain.value = v * 0.16;
  }
};

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ===================== 工具函数 ===================== */
function opponent(p){ return p === 'red' ? 'black' : 'red'; }
function inPalace(o, r, c){
  if (c < 3 || c > 5) return false;
  if (o === 'red')   return r >= 7 && r <= 9;
  return r >= 0 && r <= 2;
}
function crossedRiver(o, r){ return o === 'red' ? r < 5 : r > 4; }

function hiddenAt(r, c){
  for (const o of ['red','black']){
    const h = state.hidden[o];
    if (h.alive && h.r === r && h.c === c) return o;
  }
  return null;
}

// 记录本机当前暗棋坐标快照（仅真实对局；回放/观战不记录）
function snapshotHidden(){
  if (!liveHidden || config.mode === 'replay' || _spectateMode || state.isSpectator) return;
  const seq = (typeof Net !== 'undefined' && Net.since) ? Net.since : 0;
  liveHidden.seqs.push(seq);
  liveHidden.snaps.push(JSON.parse(JSON.stringify(state.hidden)));
  saveMyHiddenCache();   // 暗棋坐标每次变化都落盘，重连后能精确恢复自己的暗棋
}

// —— 自己暗棋坐标持久化：联机重连/刷新后，从本机 localStorage 恢复自己的暗棋（含 sinceHidden/hiddenReady），
//    这样重连不会让暗棋位置"变回随机"、棋局能连续。对手暗棋永远是 -1,-1，本机压根没有，符合保密设计。
function hiddenCacheKey(){ return (typeof Net !== 'undefined' && Net.room) ? 'xq_hidden_' + Net.room + '_' + Net.clientId : null; }
function saveMyHiddenCache(){
  if (!isOnline() || typeof Net === 'undefined' || !Net.room || !state.mySide) return;
  const k = hiddenCacheKey(); if (!k) return;
  try {
    localStorage.setItem(k, JSON.stringify({
      hidden: state.hidden[state.mySide],
      sinceHidden: state.sinceHidden,
      hiddenReady: state.hiddenReady,
      ts: Date.now()
    }));
  } catch(e){}
}
function loadMyHiddenCache(){
  const k = hiddenCacheKey(); if (!k) return null;
  try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch(e){ return null; }
}
function clearMyHiddenCache(){
  const k = hiddenCacheKey(); if (k){ try { localStorage.removeItem(k); } catch(e){} }
}
function findGeneralOn(board, owner){
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++){
      const p = board[r][c];
      if (p && p.type === 'general' && p.owner === owner) return { r, c };
    }
  return null;
}
function findGeneral(owner){ return findGeneralOn(state.board, owner); }

// 当前棋盘的"观看者"：双人模式=当前操作者；人机模式=人类玩家；联机模式=本机玩家
// （始终只显示观看者自己的暗棋，避免泄露对方暗棋）
function viewerSide(){
  if (state.isSpectator) return null;   // 观战者看不到任何一方暗棋，不高亮
  if (state.gameMode === 'online') return state.mySide || 'red';
  return state.gameMode === 'ai' ? opponent(state.aiSide) : state.turn;
}
function isOnline(){ return state.gameMode === 'online'; }
// 联机时：是否轮到本机、且没有卡在"等待对手裁决"里
function onlineCanAct(){
  if (!isOnline()) return true;
  if (typeof Net === 'undefined' || !Net.ready) return false;
  return state.turn === state.mySide && !state.pending;
}

// 棋子从 from 到 to 实际经过的格子（含终点，不含起点），用于暗棋"挡路"判定
// 仅对直线移动（车/炮/将/士/兵）有意义；马/象为跳跃，无扫过路径（由调用方只检查落点）
function getPath(from, to){
  if (from.r === to.r && from.c === to.c) return [];
  const dr = to.r - from.r, dc = to.c - from.c;
  // 非直线（马/象的跳跃）无中间路径，仅返回落点，由调用方作为"落地"处理
  if (dr !== 0 && dc !== 0) return [{ r: to.r, c: to.c }];
  const sr = Math.sign(dr), sc = Math.sign(dc);
  const path = [];
  let r = from.r + sr, c = from.c + sc;
  while (r !== to.r || c !== to.c){
    path.push({ r, c });
    r += sr; c += sc;
    if (path.length > 18) break;   // 安全兜底，防止异常输入导致死循环
  }
  path.push({ r: to.r, c: to.c });
  return path;
}

/* ===================== 棋盘初始化 ===================== */
function initialBoard(){
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const back = ['chariot','horse','elephant','advisor','general','advisor','elephant','horse','chariot'];
  for (let c = 0; c < COLS; c++){
    b[9][c] = { type: back[c], owner:'red'   };
    b[0][c] = { type: back[c], owner:'black' };
  }
  b[7][1] = { type:'cannon', owner:'red'   };
  b[7][7] = { type:'cannon', owner:'red'   };
  b[2][1] = { type:'cannon', owner:'black' };
  b[2][7] = { type:'cannon', owner:'black' };
  for (const c of [0,2,4,6,8]){
    b[6][c] = { type:'soldier', owner:'red'   };
    b[3][c] = { type:'soldier', owner:'black' };
  }
  return b;
}

// 联机时暗棋起始位置随机（己方后三行任意点），避免对手靠"固定开局位"猜到
function randomHiddenStart(side){
  const rows = side === 'red' ? [7,8,9] : [0,1,2];
  return {
    r: rows[Math.floor(Math.random()*rows.length)],
    c: Math.floor(Math.random()*COLS),
    alive: true
  };
}

function newGame(){
  const online  = config.mode === 'online';
  const mySide  = online ? ((typeof Net !== 'undefined' && Net.side) || 'red') : null;

  state = {
    board: initialBoard(),
    turn: 'red',
    hidden: {
      red:   { r: 8, c: 4, alive: true },
      black: { r: 1, c: 4, alive: true }
    },
    hiddenReady:    { red: false, black: false },  // 暗棋是否就绪（不叠加，最多 1 次）
    sinceHidden:    { red: 0,    black: 0    },     // 距离上次暗棋行动已走几步普通棋子
    phase: 'choose',                              // choose=需走普通棋子；postMove=普通已走，可走暗棋/结束
    selected: null,
    selectedHidden: null,
    mode: 'normal',
    gameOver: false,
    winner: null,
    showGate: false,                            // 回合交接遮罩已取消（改由「结束回合」按钮 + 状态栏提示）
    decidedByGeneral: false,                    // 本局是否以「吃将」终结（用于斩将特效 + 胜利弹窗延迟）
    _victoryShown: false,                       // 防止胜利弹窗被重复触发
    gameMode: config.mode,
    aiSide: config.aiSide,
    difficulty: config.difficulty,
    mySide: mySide,          // 联机时本机执哪一方
    pending: false,          // 联机时：着法已发出，正等对手裁决
    pendingMove: null,
    isSpectator: false,      // 是否观战（只看不动，暗棋坐标不可见）
    opponentOffline: false,  // 对手是否掉线（等待重连中）
    offlineSince: 0,         // 对手掉线时刻
    recorded: false,         // 本局战绩是否已计入（防止刷新重复计）
    savedReplay: false,      // 本局回放是否已存档（防止重复存）
    plies: 0,                // 已走手数（海报展示用）
    moveLog: [],             // 本局走子记录（供 AI 复盘分析；只存本机已知信息，不含对方暗棋坐标）
    log: ['游戏开始，红方先手。每回合先走 1 步普通棋子，暗棋就绪后可紧接着行动。']
  };

  if (online){
    // 关键：本机只知道自己的暗棋真实坐标；
    // 对方暗棋用 (-1,-1) 占位 —— 位置根本不在本机内存里，翻代码也看不到。
    const cache = loadMyHiddenCache();
    if (cache && cache.hidden && typeof cache.hidden.r === 'number' && cache.hidden.r >= 0){
      // 重连/刷新：恢复自己之前的暗棋位置，保证棋局连续（对手暗棋始终是 -1,-1）
      state.hidden[mySide]      = cache.hidden;
      state.sinceHidden[mySide] = cache.sinceHidden || 0;
      state.hiddenReady[mySide] = !!(cache.hiddenReady);
    } else {
      state.hidden[mySide] = randomHiddenStart(mySide);
      saveMyHiddenCache();            // 首次进房：存下自己的暗棋，供后续重连
    }
    state.hidden[opponent(mySide)] = { r: -1, c: -1, alive: true };
    state.showGate = false;                       // 联机各看各的屏幕，不需要交接遮罩
    state.log = [`联机对战开始 · 你执 ${NAME[mySide]}${mySide === 'red' ? '（先手）' : '（后手）'}。`];
  }

  // 本局暗棋轨迹：只在「真实对局」（非回放、非观战）时记录，用于回放显示暗棋
  if (config.mode !== 'replay' && !_spectateMode && !state.isSpectator){
    liveHidden = { seqs: [0], snaps: [JSON.parse(JSON.stringify(state.hidden))] };
  }

  lastMove = null;              // 新局清掉「最后一步」标记
  lastMarkShownSeq = -1;
  landedShownSeq = -1;

  // 悔棋快照：全新一局先清空，再记录「开局」这一帧（联机时本机暗棋坐标独立保存，回滚不破保密）
  snapHistory = [];
  pushSnap();
}

/* ===================== 着法生成 ===================== */
function rawMoves(board, r, c){
  const p = board[r][c];
  if (!p) return [];
  const o = p.owner;
  const moves = [];

  switch (p.type){
    case 'general': {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dr,dc] of dirs){
        const rr = r+dr, cc = c+dc;
        if (!inPalace(o, rr, cc)) continue;
        const t = board[rr][cc];
        if (t){ if (t.owner !== o) moves.push([rr,cc]); } else moves.push([rr,cc]);
      }
      let rr = r-1;
      while (rr >= 0){ const t = board[rr][c]; if (t){ if (t.type==='general' && t.owner!==o) moves.push([rr,c]); break; } rr--; }
      rr = r+1;
      while (rr < ROWS){ const t = board[rr][c]; if (t){ if (t.type==='general' && t.owner!==o) moves.push([rr,c]); break; } rr++; }
      break;
    }
    case 'advisor': {
      const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
      for (const [dr,dc] of dirs){
        const rr = r+dr, cc = c+dc;
        if (!inPalace(o, rr, cc)) continue;
        const t = board[rr][cc];
        if (t){ if (t.owner !== o) moves.push([rr,cc]); } else moves.push([rr,cc]);
      }
      break;
    }
    case 'elephant': {
      const dirs = [[2,2],[2,-2],[-2,2],[-2,-2]];
      for (const [dr,dc] of dirs){
        const rr = r+dr, cc = c+dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        if (crossedRiver(o, rr)) continue;
        if (board[r+dr/2][c+dc/2]) continue;
        const t = board[rr][cc];
        if (t){ if (t.owner !== o) moves.push([rr,cc]); } else moves.push([rr,cc]);
      }
      break;
    }
    case 'horse': {
      const cand = [
        [2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0],
        [1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1]
      ];
      for (const [dr,dc,lr,lc] of cand){
        const rr = r+dr, cc = c+dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        if (board[r+lr][c+lc]) continue;
        const t = board[rr][cc];
        if (t){ if (t.owner !== o) moves.push([rr,cc]); } else moves.push([rr,cc]);
      }
      break;
    }
    case 'chariot': {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dr,dc] of dirs){
        let rr = r+dr, cc = c+dc;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS){
          const t = board[rr][cc];
          if (t){ if (t.owner !== o) moves.push([rr,cc]); break; }
          moves.push([rr,cc]);
          rr += dr; cc += dc;
        }
      }
      break;
    }
    case 'cannon': {
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dr,dc] of dirs){
        let rr = r+dr, cc = c+dc, jumped = false;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS){
          const t = board[rr][cc];
          if (!jumped){
            if (t) jumped = true; else moves.push([rr,cc]);
          } else {
            if (t){ if (t.owner !== o) moves.push([rr,cc]); break; }
          }
          rr += dr; cc += dc;
        }
      }
      break;
    }
    case 'soldier': {
      const fwd = o === 'red' ? -1 : 1;
      const dirs = [[fwd,0]];
      if (crossedRiver(o, r)) dirs.push([0,1],[0,-1]);
      for (const [dr,dc] of dirs){
        const rr = r+dr, cc = c+dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        const t = board[rr][cc];
        if (t){ if (t.owner !== o) moves.push([rr,cc]); } else moves.push([rr,cc]);
      }
      break;
    }
  }
  return moves;
}

// 暗棋可走点：八方向 1 格。空格、友方(重叠)、敌方(主动吃掉) 都允许
function hiddenMoves(owner){
  const h = state.hidden[owner];
  if (!h || !h.alive) return [];
  if (h.r < 0 || h.c < 0) return [];   // 联机时对手暗棋位置未知（-1,-1），本机不生成任何着法
  const res = [];
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (const [dr,dc] of dirs){
    const rr = h.r+dr, cc = h.c+dc;
    if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
    res.push([rr,cc]);
  }
  return res;
}

/* ===================== 将军 / 攻击判定 ===================== */
function isAttacked(board, r, c, by){
  for (let rr = 0; rr < ROWS; rr++)
    for (let cc = 0; cc < COLS; cc++){
      const p = board[rr][cc];
      if (p && p.owner === by){
        if (rawMoves(board, rr, cc).some(([tr,tc]) => tr === r && tc === c)) return true;
      }
    }
  return false;
}
function isInCheck(board, player){
  const g = findGeneralOn(board, player);
  if (!g) return true;
  return isAttacked(board, g.r, g.c, opponent(player));
}
// 普通棋子的合法着法：直接返回全部伪合法着法。
// 设计取舍：不再强制"应将"（走完不得让己方主帅被将军）——
// 被将军时仍可自由走任意子，再用暗棋（后置阶段）或其他手段解围；
// 只有真正"无任何子可动（全部被堵死）"才算无着可走。
function legalMovesForPiece(r, c){
  const p = state.board[r][c];
  if (!p) return [];
  return rawMoves(state.board, r, c);
}
function hasAnyLegalMove(player){
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++){
      const p = state.board[r][c];
      if (p && p.owner === player && rawMoves(state.board, r, c).length > 0) return true;
    }
  return false;
}

/* ===================== 执行着法 ===================== */
/*
 * 执行一步普通棋子。
 * forced 参数（仅联机用）：
 *   undefined            —— 本机自行裁决（本机知道己方暗棋，能判断敌子是否撞上来）
 *   {explode:false}      —— 对手已裁决"没撞到"，直接按普通移动执行
 *   {explode:true, at}   —— 对手已裁决"撞上了他的暗棋"，在 at 处同归于尽
 * 返回 { explode, at }，联机时用来把裁决结果回传给对手。
 */
function executeNormalMove(from, to, forced){
  const p = state.board[from.r][from.c];
  state.lastMoveResult = { explode: false, at: null };
  if (!p) return state.lastMoveResult;

  // 暗棋"挡路/同归于尽"：扫描棋子飞行路径（落点也计入）。
  // 马/象为跳跃，无扫过路径，只检查落点；其余直线棋子检查整条路径。
  // 友方暗棋=空气，不影响移动；只有"敌方暗棋"在路径上才触发事件。
  let colSq = null, ho = null;
  if (forced && forced.explode){
    colSq = forced.at;
    ho = opponent(p.owner);            // 远端裁决：炸的必然是对手那枚暗棋
  } else if (!forced){
    const swept = (p.type === 'horse' || p.type === 'elephant')
      ? [{ r: to.r, c: to.c }]
      : getPath(from, to);
    const idx = swept.findIndex(s => { const h = hiddenAt(s.r, s.c); return h && h !== p.owner; });
    if (idx >= 0){ colSq = swept[idx]; ho = hiddenAt(colSq.r, colSq.c); }
  }

  if (colSq){
    state.board[from.r][from.c] = null;                 // 移动棋子离场（撞上即自爆）
    const tgt = state.board[colSq.r][colSq.c];
    if (tgt && tgt.owner !== p.owner){ state.board[colSq.r][colSq.c] = null; spawnGhost(colSq.r, colSq.c, tgt.owner, tgt.type); } // 若落点有敌子，先吃掉
    state.hidden[ho].alive = false;                     // 暗棋同归于尽
    // 先把裁决结论记下来，再放动画：万一动画/渲染报错，联机裁决仍能正确回传给对手
    state.lastMoveResult = { explode: true, at: { r: colSq.r, c: colSq.c } };
    log(`💥 ${NAME[p.owner]} 的${CHARS[p.owner][p.type]}撞上 ${NAME[ho]} 暗棋，同归于尽！`);
    // 进攻棋子先飞向爆点再起爆（特效关闭 / 重建历史时立即爆）
    spawnFlyGhost(from, colSq, p.owner, p.type, () => {
      Sound.explode();
      showExplosion(colSq.r, colSq.c, '同归于尽');
    });
    setLastMove(from.r, from.c, colSq.r, colSq.c);
    if (isRealGame()) state.moveLog.push({ side: p.owner, fr: from.r, fc: from.c, tr: to.r, tc: to.c, captured: 'hidden', byHidden: false });
    finishNormalMove(p);
    return state.lastMoveResult;
  }

  // 正常移动 / 吃子
  const target = state.board[to.r][to.c];
  state.board[to.r][to.c] = p;
  state.board[from.r][from.c] = null;
  state.lastMoveResult = { explode: false, at: null };
  if (isRealGame()) state.moveLog.push({ side: p.owner, fr: from.r, fc: from.c, tr: to.r, tc: to.c, captured: target ? target.type : null, byHidden: false });
  // 音效延迟到棋子滑动落点时再响，声画同步更"脆"
  if (target){
    log(`${NAME[p.owner]} 吃掉 ${CHARS[target.owner][target.type]}`);
    spawnGhost(to.r, to.c, target.owner, target.type);   // 被吃棋子原地缩小淡出
    if (!_applyingHistory) setTimeout(() => Sound.capture(), 150);
    if (isRealGame()) vibrate(35);                       // 吃子震动（仅真实对局，手机有效）
    if (target.type === 'general'){ state.decidedByGeneral = true; showKill(to.r, to.c); }  // 吃将 → 特殊斩将特效
  } else {
    if (!_applyingHistory) setTimeout(() => Sound.move(), 150);
  }
  setLastMove(from.r, from.c, to.r, to.c);
  finishNormalMove(p);
  return state.lastMoveResult;
}

// 普通棋子走完后的统一处理：胜负判定、暗棋计数、进入后置阶段或结束回合
function finishNormalMove(p){
  state.selected = null;
  state.mode = 'normal';

  const oppGen = findGeneral(opponent(p.owner));
  const myGen  = findGeneral(p.owner);
  if (!myGen){
    state.gameOver = true;
    state.winner = opponent(p.owner);
    log(`🏁 ${NAME[opponent(p.owner)]} 获胜！（${NAME[p.owner]} 主帅阵亡）`);
    state.showGate = (state.gameMode === 'pvp');
    render();
    return;
  }
  if (!oppGen){
    state.gameOver = true;
    state.winner = p.owner;
    log(`🏁 ${NAME[p.owner]} 获胜！`);
    state.showGate = (state.gameMode === 'pvp');
    snapshotHidden();
    render();
    return;
  }

  // 暗棋计数：每走 2 步普通棋子 -> 就绪（不叠加，封顶 1 次）
  state.sinceHidden[p.owner]++;
  if (state.sinceHidden[p.owner] >= 2){
    state.sinceHidden[p.owner] = 2;
    state.hiddenReady[p.owner] = true;
  }
  snapshotHidden();

  if (state.hiddenReady[p.owner] && state.hidden[p.owner].alive){
    state.phase = 'postMove';   // 同一回合内可紧接着走暗棋（也可结束回合跳过）
    render();
    announceCheck();
  } else {
    endTurn();
    render();
    announceCheck();
  }
}

function executeHiddenMove(to){
  const owner = state.turn;
  const target = state.board[to.r][to.c];
  const prevH = state.hidden[owner];
  let capturedGeneral = false;
  let capturedPos = null;
  if (target && target.owner !== owner){
    // 主动出击：吃掉敌方棋子，暗棋存活
    state.board[to.r][to.c] = null;
    capturedPos = { r: to.r, c: to.c };
    if (target.type === 'general'){ capturedGeneral = true; state.decidedByGeneral = true; }
    log(`🗡️ ${NAME[owner]} 暗棋主动出击，吃掉 ${CHARS[target.owner][target.type]}！`);
    spawnGhost(to.r, to.c, target.owner, target.type);
    showCapture(to.r, to.c);
    if (capturedGeneral) showKill(to.r, to.c);           // 暗棋直取敌帅 → 斩将特效
    showToast(`🗡️ 暗棋出击，吃掉${CHARS[target.owner][target.type]}！`, 'kill');
    if (!_applyingHistory) setTimeout(() => Sound.capture(), 150);
  } else {
    log(`${NAME[owner]} 移动暗棋`);
    if (!_applyingHistory) setTimeout(() => Sound.hidden(), 150);
  }
  if (isRealGame()) vibrate(capturedPos ? [25, 20, 45] : 22);   // 暗棋出击吃子 / 单纯移动 → 手机震动
  state.hidden[owner] = { r: to.r, c: to.c, alive: true };
  if (isRealGame()) state.moveLog.push({ side: owner, fr: prevH.r, fc: prevH.c, tr: to.r, tc: to.c, captured: target ? target.type : null, byHidden: true });
  setLastMove(prevH.r, prevH.c, to.r, to.c);
  snapshotHidden();                   // 记录暗棋新坐标（仅本机），供回放显示
  state.hiddenReady[owner] = false;   // 行动后重新累计
  state.sinceHidden[owner] = 0;
  state.selectedHidden = null;
  state.mode = 'normal';
  state.phase = 'choose';

  // 联机：只告诉对手"我的暗棋吃掉了哪个格子的子"（或什么都没吃），绝不发送暗棋坐标
  if (isOnline() && owner === state.mySide) netSend('hiddenmove', { captured: capturedPos });

  if (capturedGeneral){
    state.gameOver = true;
    state.winner = owner;
    log(`🏁 ${NAME[owner]} 暗棋直取敌帅，获胜！`);
    state.showGate = (state.gameMode === 'pvp');   // 仅同屏双人需要结算遮罩，人机/联机不弹
    endTurn();
    render();
    return;
  }
  endTurn();
  render();
  announceCheck();
}

function endTurn(){
  const prev = state.turn;
  state.plies = (state.plies || 0) + 1;   // 手数计数（海报上显示"本局 N 手"；随快照一起回滚）
  state.turn = opponent(prev);
  state.phase = 'choose';
  state.selected = null;
  state.selectedHidden = null;
  state.mode = 'normal';

  if (!state.gameOver && !hasAnyLegalMove(state.turn)){
    state.gameOver = true;
    state.winner = prev;
    log(`💀 ${NAME[state.turn]} 无子可动，判负`);
  }
  // 普通回合交接不再弹「轮到 X 行动」遮罩（改由右侧「结束回合」按钮 + 状态栏提示）；
  // 仅游戏结束时（pvp）保留「游戏结束」遮罩，作为结算前的提示。
  state.showGate = state.gameOver && state.gameMode === 'pvp';
  if (state.gameMode === 'ai' && !state.gameOver && state.turn === state.aiSide) scheduleAI();
  if (!state.gameOver) pushSnap();               // 每回合开始记录一帧，供悔棋回滚
  // 已去掉回合交接遮罩：走子滑动动画全程可见。
  // 代价：同屏双人时，切换回合后新行动方的暗棋会直接显示在屏幕上，请注意别让上一手玩家看到。
}

// 同屏双人交接遮罩：过场式、非阻塞。盖住棋盘约 0.5 秒后自动淡出，也可点一下立即消失。
function showHandoff(side){
  if (!handoffEl) return;
  handoffTextEl.textContent = `轮到 ${NAME[side]} 行动`;
  handoffEl.style.display = 'flex';
  handoffEl.classList.remove('hide');
  handoffActive = true;
  if (handoffTimer) clearTimeout(handoffTimer);
  handoffTimer = setTimeout(hideHandoff, 500);
}
function hideHandoff(){
  if (!handoffEl) return;
  handoffActive = false;
  if (handoffTimer){ clearTimeout(handoffTimer); handoffTimer = null; }
  handoffEl.classList.add('hide');          // 触发淡出动画
  setTimeout(() => { if (handoffEl && handoffEl.classList.contains('hide')) handoffEl.style.display = 'none'; }, 360);
}

function log(msg){
  state.log.push(msg);
  if (state.log.length > 60) state.log.shift();
}

/* ===================== 悔棋（本地快照回滚） ===================== */
// 在「真实对局」的每个回合开始时记录整局状态（含本机已知的暗棋坐标）。
// 联机时本机暗棋坐标独立保存，对手暗棋始终是 -1,-1，回滚后保密设计不破。
function pushSnap(){
  if (state.isSpectator || state.gameMode === 'replay' || _spectateMode || _applyingHistory) return;
  snapHistory.push({
    side: state.turn,                                          // 该帧轮到谁行动
    state: JSON.parse(JSON.stringify(state)),
    liveHidden: liveHidden ? JSON.parse(JSON.stringify(liveHidden)) : null
  });
}
// 计算「回滚到 side 上一回合开始」的目标快照序号
function undoTargetIndex(side){
  if (!side) return -1;
  const arr = [];
  for (let i = 0; i < snapHistory.length; i++) if (snapHistory[i].side === side) arr.push(i);
  if (!arr.length) return -1;
  const isMyTurnNow = (state.turn === side) && !state.gameOver;
  if (isMyTurnNow) return arr.length >= 2 ? arr[arr.length - 2] : -1; // 当前正轮到他 → 回滚到他上一回合
  return arr[arr.length - 1];                                          // 当前是对手回合 → 回滚到他刚走完的那一步
}
// 真正执行回滚
function restoreSnapshot(idx){
  const snap = snapHistory[idx];
  if (!snap) return false;
  state = JSON.parse(JSON.stringify(snap.state));
  liveHidden = snap.liveHidden ? JSON.parse(JSON.stringify(snap.liveHidden)) : null;
  snapHistory = snapHistory.slice(0, idx + 1);   // 丢弃回滚点之后的所有快照
  state.selected = null; state.selectedHidden = null;
  state.pending = false; state.pendingMove = null; state.mode = 'normal';
  lastMove = null; lastMarkShownSeq = -1; landedShownSeq = -1;   // 回滚后清掉最后一步标记
  saveMyHiddenCache();
  render();
  return true;
}
// 本地（双人/AI）直接回滚；联机则需走「请求 → 对手同意」
function performUndo(side){
  const idx = undoTargetIndex(side);
  if (idx < 0) return false;
  return restoreSnapshot(idx);
}

// 将军横幅：全屏红边光晕 + 大红「将军！」+ 刀光划过（戏剧化，参考天天象棋/JJ象棋）
function showCheckBanner(side){
  // 先清掉上一条，避免连续将军时横幅叠层
  document.querySelectorAll('.check-banner,.check-vignette').forEach(el => el.remove());
  if (!Settings.get('fx')){ showToast(`⚠️ 将军！${NAME[side]} 主帅被将`, 'check'); return; }
  const v = document.createElement('div');
  v.className = 'check-vignette';
  document.body.appendChild(v);
  setTimeout(() => { if (v.parentNode) v.parentNode.removeChild(v); }, 950);
  const b = document.createElement('div');
  b.className = 'check-banner';
  b.innerHTML = `<div class="cb-text">将军！</div><div class="cb-slash"></div><div class="cb-sub">${NAME[side]} 主帅被将</div>`;
  document.body.appendChild(b);
  setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 1050);
}
// 将军 / 被将军 提示：若轮到的一方主帅正被将军，弹出全屏将军横幅（将/帅上的红环由 render 单独叠加）
function announceCheck(){
  if (state.gameOver) return;
  const g = findGeneral(state.turn);
  if (g && isInCheck(state.board, state.turn)){
    showCheckBanner(state.turn);
  }
}

/* ===================== AI 对手 ===================== */
const PIECE_VALUE = { general:10000, chariot:90, cannon:45, horse:40, advisor:20, elephant:20, soldier:10 };

// 评估一个普通着法（AI 看不见敌方暗棋，故忽略暗棋影响，按"可见棋盘"模拟）
function aiEvalNormal(me, m){
  const nb = state.board.map(row => row.slice());
  const p = nb[m.fr][m.fc];
  const tgt = nb[m.tr][m.tc];
  nb[m.tr][m.tc] = p; nb[m.fr][m.fc] = null;
  let score = 0;
  if (tgt){
    if (tgt.type === 'general') return 1e7;          // 直接吃将获胜
    score += PIECE_VALUE[tgt.type] * 1.4 + 8;         // 吃子收益
  }
  const opp = opponent(me);
  if (isInCheck(nb, me)) score -= (state.difficulty === 'easy' ? 250 : 800);  // 避免送将
  const eg = findGeneralOn(nb, opp);
  if (eg){
    const d = Math.abs(eg.r - m.tr) + Math.abs(eg.c - m.tc);
    score += (18 - d) * 0.3;                          // 向敌方将靠近
  }
  if (p.type === 'soldier' && crossedRiver(me, m.tr)) score += 3;
  score += Math.random() * 10 - 5;                    // 轻微随机，避免呆板
  return score;
}

function aiPickNormal(){
  const me = state.aiSide;
  const cands = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++){
      const p = state.board[r][c];
      if (p && p.owner === me)
        for (const [tr,tc] of rawMoves(state.board, r, c)) cands.push({ fr:r, fc:c, tr, tc });
    }
  if (!cands.length) return null;
  let best = [], bestScore = -1e18;
  for (const m of cands){
    const s = aiEvalNormal(me, m);
    if (s > bestScore){ bestScore = s; best = [m]; }
    else if (s === bestScore) best.push(m);
  }
  return best[Math.floor(Math.random() * best.length)];
}

// AI 暗棋行动：优先吃将 > 吃大子(普通难度) > 概率骚扰 > 不动
function aiPickHidden(){
  const me = state.aiSide;
  const h = state.hidden[me];
  if (!h.alive) return null;
  const hm = hiddenMoves(me);
  if (!hm.length) return null;
  let capGen = null, capBest = null, capVal = -1;
  for (const [r,c] of hm){
    const t = state.board[r][c];
    if (t && t.owner !== me){
      if (t.type === 'general') capGen = [r,c];
      if (PIECE_VALUE[t.type] > capVal){ capVal = PIECE_VALUE[t.type]; capBest = [r,c]; }
    }
  }
  if (capGen) return { r: capGen[0], c: capGen[1] };
  if (capBest && state.difficulty !== 'easy') return { r: capBest[0], c: capBest[1] };
  if (Math.random() < (state.difficulty === 'easy' ? 0.15 : 0.4)){
    const opp = opponent(me);
    const eg = findGeneralOn(state.board, opp);
    let best = null, bd = 1e9;
    for (const [r,c] of hm){
      const t = state.board[r][c];
      if (t && t.owner !== me) continue;          // 吃子已在上面处理
      if (t) continue;                            // 只走空位骚扰
      const d = eg ? Math.abs(eg.r - r) + Math.abs(eg.c - c) : 0;
      if (d < bd){ bd = d; best = [r,c]; }
    }
    if (best) return { r: best[0], c: best[1] };
  }
  return null;   // 不动，留着
}

// 一步 AI 行动：先走普通子，若暗棋就绪再决定是否走暗棋
function aiTurn(){
  if (state.gameOver || state.showGate || state.turn !== state.aiSide) return;
  if (state.phase === 'choose'){
    const m = aiPickNormal();
    if (!m){ endTurn(); render(); return; }
    executeNormalMove({ r:m.fr, c:m.fc }, { r:m.tr, c:m.tc });
  }
  if (state.gameOver) return;
  if (state.phase === 'postMove' && state.hiddenReady[state.aiSide] && state.hidden[state.aiSide].alive){
    const hm = aiPickHidden();
    if (hm) executeHiddenMove(hm);
    else { endTurn(); render(); }
  }
}

function scheduleAI(){
  if (state.gameMode !== 'ai' || state.gameOver || state.showGate) return;
  if (state.turn !== state.aiSide) return;
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = setTimeout(() => { aiTimer = null; aiTurn(); }, 450);
}

/* ===================== 联机对战 ===================== */
/*
 * 同步思路（重点：暗棋位置永不出本机）
 *   我方走子 -> 只把 from/to 发给对手 -> 对手用"他自己的暗棋"裁决有没有撞上
 *            -> 对手回传裁决结果 -> 我方按结果落子（可能同归于尽）
 *   对手走子 -> 我方本地裁决（我知道我的暗棋）-> 落子 -> 把结果回传给对手
 *   暗棋行动 -> 只广播"吃掉了哪个格子的子"，坐标本身不发送
 * 服务器全程只转发消息，不懂规则、也不存暗棋。
 */
function netSend(type, data){
  if (typeof Net !== 'undefined' && Net.joined) Net.send(type, data);
}

// 我方提交着法：先不落子，等对手裁决回来再落
function onlineSubmitMove(from, to){
  state.pending = true;
  state.pendingMove = { from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c } };
  state.selected = null;
  netSend('move', state.pendingMove);
  render();
  clearTimeout(onlineSubmitMove._t);
  onlineSubmitMove._t = setTimeout(() => {
    if (state.pendingMove) showToast('⏳ 还在等对手响应…（对方可能已断线）', 'check');
  }, 8000);
}

// 对手的暗棋行动传过来了：只知道结果，不知道他暗棋在哪
function applyRemoteHiddenMove(d){
  const owner = state.turn;
  const cap = d && d.captured;
  let capturedGeneral = false;

  if (cap){
    const t = state.board[cap.r][cap.c];
    if (t){
      state.board[cap.r][cap.c] = null;
      if (t.type === 'general'){ capturedGeneral = true; state.decidedByGeneral = true; }
      log(`🗡️ ${NAME[owner]} 暗棋主动出击，吃掉 ${CHARS[t.owner][t.type]}！`);
      spawnGhost(cap.r, cap.c, t.owner, t.type);
      showCapture(cap.r, cap.c);
      if (capturedGeneral) showKill(cap.r, cap.c);     // 联机对手暗棋直取敌帅 → 斩将特效
      if (!_applyingHistory) setTimeout(() => Sound.capture(), 150);
      showToast(state.isSpectator
        ? `🗡️ ${NAME[owner]} 暗棋出击，吃掉${CHARS[t.owner][t.type]}！`
        : `🗡️ 对方暗棋出击，吃掉你的${CHARS[t.owner][t.type]}！`, 'kill');
    }
  } else {
    log(`${NAME[owner]} 移动暗棋`);
  }
  if (cap) setLastMove(-1, -1, cap.r, cap.c);   // 对方暗棋起点保密，只标出击格
  state.hiddenReady[owner] = false;
  state.sinceHidden[owner] = 0;
  state.phase = 'choose';

  if (capturedGeneral){
    state.gameOver = true;
    state.winner = owner;
    log(`🏁 ${NAME[owner]} 暗棋直取敌帅，获胜！`);
    endTurn();
    render();
    return;
  }
  endTurn();
  render();
  announceCheck();
}

function setNetInfo(html, cls){
  if (!netInfoEl) return;
  netInfoEl.innerHTML = html;
  netInfoEl.className = 'net-info' + (cls ? ' ' + cls : '');
}

function renderNetInfo(){
  if (typeof Net === 'undefined' || !Net.joined) return;
  const sideTxt = Net.side === 'red' ? '红方（先手）' : '黑方（后手）';
  if (Net.peerOnline) setNetInfo(`✅ 房间 <b>${Net.room}</b> 已连通 · 你执 <b>${sideTxt}</b>`, 'ok');
  else setNetInfo(`⏳ 已进入房间 <b>${Net.room}</b> · 你执 <b>${sideTxt}</b><br>正在等待对手加入…`, 'wait');
}

// 恢复匹配相关 UI（隐藏"匹配中"提示、隐藏"取消匹配"按钮、恢复两个主按钮）
function resetMatchUI(){
  if (matchStatusEl)   matchStatusEl.style.display   = 'none';
  if (cancelMatchBtn) cancelMatchBtn.style.display   = 'none';
  if (matchBtn)       matchBtn.disabled             = false;
  if (createBtn)      createBtn.disabled            = false;
}

// 显示给对方的邀请链接：直接用网页自身的公网地址（部署到云后就是 https://xxx.onrender.com）
// 链接同时带上本机邀请码，好友点开即计入"我邀请的人数"
async function showInvite(room){
  if (!inviteBoxEl) return;
  await ensureInviteCode();
  const url = buildInviteLink(room);
  inviteBoxEl.style.display = 'block';
  inviteBoxEl.innerHTML =
    `<div class="tag">把下面这个链接发给好友，他点开就能进同一房间（无需同 WiFi）：</div>` +
    `<div class="invite-link"><b>${url}</b></div>` +
    `<div class="tag" style="margin-top:6px">或让好友选「联机对战」并输入房间号：<b>${room}</b></div>` +
    `<button id="inviteQrBtn" class="btn sm" style="margin-top:8px">🖼 生成邀请海报（带二维码）</button>`;
  const qb = document.getElementById('inviteQrBtn');
  if (qb) qb.addEventListener('click', openInvitePoster);
}

// ===================== 主菜单 =====================
function showMenu(){ if (menuEl) menuEl.style.display = 'flex'; }
function hideMenu(){ if (menuEl) menuEl.style.display = 'none'; }

// 显示「开始游戏」子视图（匹配/排位/开房间）
function showStartView(){
  if (menuMainEl)  menuMainEl.style.display  = 'none';
  if (menuStartEl) menuStartEl.style.display = 'block';
}
// 回到主视图（开始游戏 + 次级功能）
function showMainView(){
  if (menuStartEl) menuStartEl.style.display = 'none';
  if (menuMainEl)  menuMainEl.style.display  = 'block';
}

function setupMenu(){
  if (!menuEl) return;
  // 开始游戏 → 展开子视图；返回 → 主视图
  if (menuStartBtnEl) menuStartBtnEl.addEventListener('click', showStartView);
  if (menuBackBtnEl)  menuBackBtnEl.addEventListener('click', showMainView);
  // 顶部 ☰ 随时回主菜单
  if (menuHomeBtnEl)  menuHomeBtnEl.addEventListener('click', () => { showMainView(); showMenu(); });

  // 次级功能（接已有逻辑）
  menuEl.querySelectorAll('.menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-act');
      if (act === 'ai' || act === 'pvp'){
        // 切模式后复用「应用设置并重开」：applySettings 在 init 闭包里，点按钮即可触发
        modeSel.value = act;
        aiOptsEl.style.display     = act === 'ai' ? 'block' : 'none';
        onlineOptsEl.style.display = 'none';
        if (typeof Net !== 'undefined' && Net.joined && act !== 'online') Net.leave();
        applyBtn.click();
        hideMenu(); scrollToPanel();
      }
      else if (act === 'replay'){ hideMenu(); if (replayBtn) replayBtn.click(); }
      else if (act === 'invite'){ hideMenu(); if (inviteBtnEl) inviteBtnEl.click(); }
      else if (act === 'rank'){ hideMenu(); openLadder(); }
      else if (act === 'ach'){ hideMenu(); openAch(); }
      else if (act === 'friends'){ hideMenu(); openFriends(); }
      else if (act === 'tutorial'){ hideMenu(); startTutorial(); }
      else if (act === 'settings'){ hideMenu(); openSettings(); }
      else { showToast('该功能敬请期待（待定）', 'check'); }   // rank 等占位
    });
  });

  // 开始游戏子视图：匹配 / 排位 / 开房间
  // 注意：startMatch / createRoom 定义在 init() 内部（同 applySettings），顶层 setupMenu 拿不到，
  // 直接裸调会抛 ReferenceError 导致点击静默无反应 —— 改走 init 里挂到 window 的入口。
  menuEl.querySelectorAll('.mode-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      hideMenu();
      if (mode === 'match')       { if (window.__startMatch) window.__startMatch(false); }   // 休闲匹配，不计段位
      else if (mode === 'ranked') { if (window.__startMatch) window.__startMatch(true); }    // 排位赛，影响段位
      else if (mode === 'room')   { if (window.__createRoom) window.__createRoom(); }        // 开房间（休闲）
    });
  });
}

// ===================== 设置面板 =====================
function setupSettings(){
  const m = document.getElementById('settingsModal');
  if (!m) return;
  const elMusic    = document.getElementById('setMusic');
  const elMusicVol = document.getElementById('setMusicVol');
  const elMusicVal = document.getElementById('setMusicVolVal');
  const elSfx      = document.getElementById('setSfx');
  const elSfxVol   = document.getElementById('setSfxVol');
  const elSfxVal   = document.getElementById('setSfxVolVal');
  const elAllow    = document.getElementById('setAllowMatch');
  const elHide     = document.getElementById('setHideRating');
  const elTheme    = document.getElementById('setBoardTheme');
  const elShowHl   = document.getElementById('setShowHl');
  const elFx       = document.getElementById('setFx');
  const elVibrate  = document.getElementById('setVibrate');

  function fill(){
    elMusic.checked    = !!Settings.get('music');
    elMusicVol.value   = Math.round(Settings.get('musicVol') * 100);
    elMusicVal.textContent = elMusicVol.value + '%';
    elSfx.checked      = !!Settings.get('sfx');
    elSfxVol.value     = Math.round(Settings.get('sfxVol') * 100);
    elSfxVal.textContent  = elSfxVol.value + '%';
    elAllow.checked    = !!Settings.get('allowMatch');
    elHide.checked     = !!Settings.get('hideRatingPoster');
    elTheme.value      = Settings.get('boardTheme');
    elShowHl.checked   = !!Settings.get('showHighlights');
    elFx.checked       = !!Settings.get('fx');
    elVibrate.checked  = !!Settings.get('vibrate');
  }
  window.__fillSettings = fill;
  fill();

  elMusic.addEventListener('change', () => Settings.set('music', elMusic.checked));
  elMusicVol.addEventListener('input', () => { Settings.set('musicVol', elMusicVol.value / 100); elMusicVal.textContent = elMusicVol.value + '%'; });
  elSfx.addEventListener('change', () => { Settings.set('sfx', elSfx.checked); if (soundBtnEl) soundBtnEl.textContent = elSfx.checked ? '🔊 音效' : '🔇 静音'; });
  elSfxVol.addEventListener('input', () => { Settings.set('sfxVol', elSfxVol.value / 100); elSfxVal.textContent = elSfxVol.value + '%'; });
  elAllow.addEventListener('change', () => Settings.set('allowMatch', elAllow.checked));
  elHide.addEventListener('change',  () => Settings.set('hideRatingPoster', elHide.checked));
  elTheme.addEventListener('change',  () => Settings.set('boardTheme', elTheme.value));
  elShowHl.addEventListener('change', () => Settings.set('showHighlights', elShowHl.checked));
  elFx.addEventListener('change',    () => Settings.set('fx', elFx.checked));
  elVibrate.addEventListener('change', () => Settings.set('vibrate', elVibrate.checked));

    const closeBtn = document.getElementById('settingsCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => { closeSettings(); showMenu(); });
  const clearBtn = document.getElementById('setClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => { clearLocalData(); showToast('本机数据已清除（段位与服务端数据不受影响）', 'check'); });
  const fullBtn = document.getElementById('setFullBtn');
  if (fullBtn) fullBtn.addEventListener('click', () => {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } catch(e){ showToast('当前浏览器不支持全屏', 'check'); }
  });
  const resetBtn = document.getElementById('setResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    Settings.data = Object.assign({}, SETTING_DEFAULTS);
    Settings.save(); Settings.applyAll(); fill();
    showToast('已恢复默认设置', 'check');
  });
  m.addEventListener('click', e => { if (e.target === m){ closeSettings(); showMenu(); } });
}
function openSettings(){ const m = document.getElementById('settingsModal'); if (m){ if (window.__fillSettings) window.__fillSettings(); m.style.display = 'flex'; } }
function closeSettings(){ const m = document.getElementById('settingsModal'); if (m) m.style.display = 'none'; }
// 清除本机所有 xq_ 数据（保留 xq_settings 本身）
function clearLocalData(){
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.indexOf('xq_') === 0) keys.push(k); }
    keys.forEach(k => { if (k !== SETTINGS_KEY) localStorage.removeItem(k); });
  } catch(e){}
}

// 选了菜单里的本地模式后，把右侧面板滚到可见位置（菜单已隐藏）
function scrollToPanel(){
  const p = document.querySelector('.panel');
  if (p && p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupNetHandlers(){
  if (typeof Net === 'undefined') return;

  Net.on('joined', (d) => {
    if (d && d.role === 'spectator'){ startSpectate(d); return; }
    config.mode = 'online';
    // 拉取本机段位（进房/匹配成功后展示；结算后由 rating 广播更新）
    fetch('/api/rating?clientId=' + encodeURIComponent(Net.clientId))
      .then(x => x.json()).then(r => { if (r && r.ok){ myRating = r.rating; prevRatingShown = r.rating; updateRatingUI(0); } })
      .catch(() => {});
    // 持久化房间，供刷新/关闭页面后自动续局（随机匹配成功后也会走到这，从而支持"匹配后刷新重连"）
    try { localStorage.setItem('xq_last_room_' + Net.clientId, Net.room); } catch(e){}
    if (d && d.rejoined && !state.gameOver){
      recoverGame();          // 重连：重建棋局而非重开（保留暗棋坐标与棋盘进度）
    } else {
      clearMyHiddenCache();   // 全新一局：清掉旧暗棋缓存，newGame 会生成新的
      newGame();
    }
    renderNetInfo();
    render();
    resetMatchUI();   // 隐藏"匹配中"状态、恢复按钮（无论进房还是匹配成功都走这）
  });

  // 取消匹配后：恢复 UI，提示可重新匹配 / 开房间
  Net.on('matchCancelled', () => {
    resetMatchUI();
    setNetInfo('已取消匹配。可重新点「随机匹配」，或「创建房间」把链接发给好友。', 'wait');
  });

  Net.on('peerJoined', () => {
    if (state.opponentOffline){
      state.opponentOffline = false;
      showToast('✅ 对手已重新连接，继续对战！', 'kill');
    } else {
      showToast('✅ 对手已进入房间，开战！', 'kill');
    }
    renderNetInfo();
    render();
  });

  // 双方在线状态变化（用于刷新提示文案）
  Net.on('peerStatus', () => { if (isOnline()) renderNetInfo(); });

  // 对手掉线：进入"等待重连"态 —— 不卡死、不丢棋局，给最多 70 秒让对方回来
  Net.on('peerLeft', () => {
    if (!isOnline() || state.isSpectator || state.gameOver) return;
    state.opponentOffline = true;
    state.offlineSince = Date.now();
    showToast('⚠️ 对手掉线，等待重连…（最多 70 秒）', 'check');
    render();
  });

  // 对手掉线超时：服务器已判在线方胜，本机结束对局
  Net.on('opponentLeft', (d) => {
    if (!isOnline() || state.isSpectator || state.gameOver) return;
    state.gameOver = true;
    state.winner = (d && d.winner) || state.mySide;
    const won = state.winner === state.mySide;
    log(`🏁 对手掉线${won ? '，你获胜' : '超时判负'}！`);
    showToast(won ? '🎉 对手掉线，你获胜！' : '💀 对手掉线判负', won ? 'kill' : 'check');
    render();
  });

  // 服务器通知有观战者加入/离开（无暗棋信息，仅用于显示人数）
  Net.on('spectator', d => {
    if (d && typeof d.count === 'number'){
      specCount = d.count;
      if (state.isSpectator) renderSpectatorInfo();
    }
  });

  // 对手走了一步普通棋子 -> 本机裁决（本机知道自己暗棋在哪）-> 落子 -> 回传结果
  Net.on('move', d => {
    if (state.isSpectator){ applyReplayMessage('move', d); return; }   // 观战：只记录，不裁决
    if (!isOnline() || !d || !d.from || !d.to) return;
    state.lastMoveResult = null;
    try {
      executeNormalMove(d.from, d.to);
    } finally {
      // 放 finally 里：哪怕动画或渲染出异常，也必须把裁决发回去，
      // 否则对手会永远卡在"等待对手确认…"动不了。
      const res = state.lastMoveResult || { explode: false, at: null };
      netSend('verdict', { explode: !!res.explode, at: res.at || null });
    }
    render();
  });

  // 对手对我方着法的裁决回来了 -> 按裁决落子
  Net.on('verdict', d => {
    if (state.isSpectator){ applyReplayMessage('verdict', d); return; }
    if (!isOnline() || !state.pendingMove) return;
    const pm = state.pendingMove;
    state.pendingMove = null;
    state.pending = false;
    executeNormalMove(pm.from, pm.to, { explode: !!(d && d.explode), at: (d && d.at) || null });
    render();
  });

  Net.on('hiddenmove', d => {
    if (state.isSpectator){ applyReplayMessage('hiddenmove', d); return; }
    if (isOnline()) applyRemoteHiddenMove(d);
  });

  Net.on('endturn', d => {
    if (state.isSpectator){ applyReplayMessage('endturn', d); return; }
    if (isOnline()){ endTurn(); render(); }
  });

  Net.on('restart', () => {
    if (state.isSpectator){ applyReplayMessage('restart'); return; }
    if (!isOnline()) return;
    newGame();
    showToast('🔄 对手重开了一局', 'check');
    render();
  });

  // —— 悔棋：对方发来请求，本机选择同意/拒绝 ——
  Net.on('undoRequest', (d) => {
    if (!isOnline() || state.isSpectator || state.gameOver) return;
    const side = (d && d.side) || null;
    if (!side || side === state.mySide) return;   // 不能对自己请求
    undoRequestSide = side;
    Sound.message();
    showUndoPrompt(side);
  });
  // 对手同意悔棋：本机也回滚到对方上一回合开始（暗棋坐标一并还原，保密不破）
  Net.on('undoAccept', (d) => {
    if (!isOnline() || state.isSpectator) return;
    hideUndoPrompt();
    const side = (d && d.side) || state.mySide;
    if (performUndo(side)) showToast('🔄 悔棋成功，已退回上一步', 'check');
    if (undoBtnEl) undoBtnEl.disabled = true;
  });
  Net.on('undoReject', () => {
    if (!isOnline()) return;
    hideUndoPrompt();
    showToast('⛔ 对手拒绝了悔棋', 'check');
    if (undoBtnEl) undoBtnEl.disabled = false;
  });

  // —— 认输：对方认输，本机判其负、己方胜 ——
  Net.on('resign', (d) => {
    if (!isOnline() || state.isSpectator || state.gameOver) return;
    const loser = (d && d.side) || null;
    const winner = loser ? opponent(loser) : state.mySide;
    state.gameOver = true;
    state.winner = winner;
    log(`🏳️ ${NAME[loser]} 认输，${NAME[winner]} 获胜！`);
    showToast(winner === state.mySide ? '🎉 对手认输，你获胜！' : '💀 你认输，对手获胜', winner === state.mySide ? 'kill' : 'check');
    render();
  });

  // —— 联机聊天（玩家 + 观战者可见）——
  Net.on('chat', (d) => {
    if (!d || !d.text) return;
    const mine = (d.from === Net.side);
    const who = d.from === 'spectator' ? '观战者' : (NAME[d.from] || '对手');
    appendChat(who, d.text, mine);
    if (!mine) Sound.chat();
  });

  // —— 段位结算广播：刷新双方段位并显示本局增减 ——
  Net.on('rating', (d) => {
    if (!d || !d.ratings) return;
    const newR = d.ratings[state.mySide];
    if (typeof newR === 'number'){
      const diff = newR - (prevRatingShown == null ? newR : prevRatingShown);
      myRating = newR;
      updateRatingUI(diff);
      if (d.rated === false){
        // 休闲模式（匹配/开房间）：段位不变，仅提示胜负
        const won = d.winnerSide === state.mySide;
        setNetInfo('🎲 休闲模式 · 本局段位不变（' + (won ? '获胜 🎉' : '惜败') + '）', 'kill');
      }
    }
    // 赛季信息（排位赛广播携带）：更新护盾/黄金状态，并刷新成就与天梯
    if (d.season && d.season[state.mySide]){
      const s = d.season[state.mySide];
      seasonInfo = seasonInfo || {};
      seasonInfo.rating = s.rating; seasonInfo.shield = s.shield; seasonInfo.gold = s.gold;
      seasonGoldFlag = !!s.gold;
      refreshAchievements();
      if (ladderModalEl && ladderModalEl.style.display !== 'none') renderLadderMy();
    }
  });

  // —— 弹幕（房间内飘屏，区别于文字聊天）——
  Net.on('danmaku', (d) => { if (d && d.text) renderDanmaku(d.text, d.from); });

  // —— 好友约战通知（走全局私信通道，与房间消息独立）——
  Net.onIM('challenge', (d) => { onChallenge(d); });

  Net.on('error', msg => setNetInfo('⚠️ ' + msg, 'err'));
}

/* ===================== 观战 / 回放 / 战绩 =====================
 * 核心：整局对局可由"消息流"完整重建（move/verdict/hiddenmove/endturn），
 *       而这些消息都不含暗棋坐标 —— 所以观战与回放都看不到暗棋位置，保密不破。
 *       applyReplayMessage 同时被「实时观战」和「文件回放」复用。
 */
function applyReplayMessage(type, data){
  if (!state) return;
  switch(type){
    case 'move':
      if (data && data.from && data.to)
        state.pendingMove = { from:{r:data.from.r,c:data.from.c}, to:{r:data.to.r,c:data.to.c} };
      break;
    case 'verdict': {
      const pm = state.pendingMove; state.pendingMove = null;
      if (pm) executeNormalMove(pm.from, pm.to, { explode: !!(data && data.explode), at: (data && data.at) || null });
      break;
    }
    case 'hiddenmove':
      if (data) applyRemoteHiddenMove(data);
      break;
    case 'endturn':
      endTurn();
      break;
    case 'restart':
      newGame();
      state.isSpectator = true; state.mySide = null;
      state.hidden = { red:{r:-1,c:-1,alive:true}, black:{r:-1,c:-1,alive:true} };
      state.showGate = false; state.recorded = true;
      break;
    default: break;   // peer / spectator 等控制消息，回放时忽略
  }
}

function applyReplayMessages(msgs){
  _applyingHistory = true;   // 回放历史期间禁止记录悔棋快照，避免快照污染
  for (const m of (msgs || [])) applyReplayMessage(m.type, m.data);
  _applyingHistory = false;
}

// 重连 / 刷新后恢复棋局：拉取完整消息流重建棋盘，恢复自己暗棋坐标，并补发/补裁决最后一条未完成的着法。
// 用于「断线续局」与「匹配后刷新自动重连」。
async function recoverGame(){
  state.opponentOffline = false;
  try {
    const r = await fetch('/api/record?room=' + encodeURIComponent(Net.room)).then(x => x.json());
    if (r && r.ok && Array.isArray(r.msgs) && r.msgs.length){
      _spectateMode = true;
      newGame();                 // 初始化（会用 localStorage 缓存恢复自己的暗棋坐标）
      _spectateMode = false;
      applyReplayMessages(r.msgs);
      // 清除观战重建可能带来的污染
      state.isSpectator = false;
      state.recorded = false;
      state.gameMode = 'online';
      state.mySide = Net.side;
      // 最后一条若是未完成的 move（没有后续 verdict），则补发（我发的）或补裁决（对方发的）
      const last = r.msgs[r.msgs.length - 1];
      if (last && last.type === 'move' && last.data && last.data.from && last.data.to){
        if (last.from === state.mySide){
          // 我发的 move，对方可能没收到裁决 -> 重发
          netSend('move', { from: last.data.from, to: last.data.to });
          state.pending = true;
          state.pendingMove = { from: { r: last.data.from.r, c: last.data.from.c }, to: { r: last.data.to.r, c: last.data.to.c } };
        } else {
          // 对方的 move，我可能漏裁决 -> 补裁决并回传
          state.pendingMove = null;
          state.lastMoveResult = null;
          try { executeNormalMove(last.data.from, last.data.to); }
          finally {
            const res = state.lastMoveResult || { explode: false, at: null };
            netSend('verdict', { explode: !!res.explode, at: res.at || null });
          }
        }
      }
    }
  } catch(e){ /* 重建失败就当新局处理 */ }
  renderNetInfo();
  render();
}

// 进入观战：用服务器给的历史消息重建棋盘，之后持续接收新消息
function startSpectate(d){
  config.mode = 'online';
  modeSel.value = 'online';
  onlineOptsEl.style.display = 'block';
  _spectateMode = true;          // 观战期间不要记录暗棋轨迹
  newGame();
  _spectateMode = false;
  state.isSpectator = true;
  state.mySide = null;
  state.hidden = { red:{r:-1,c:-1,alive:true}, black:{r:-1,c:-1,alive:true} };
  state.showGate = false;
  state.recorded = true;        // 观战者不计战绩
  state.log = ['👁️ 观战模式：房间 ' + Net.room + '（暗棋位置对观战者隐藏）'];
  specCount = 0;
  applyReplayMessages(d.msgs || []);
  renderSpectatorInfo();
  render();
  showToast('👁️ 已进入观战', 'check');
}

function renderSpectatorInfo(){
  if (!netInfoEl) return;
  let txt = '👁️ 观战中 · 房间 <b>' + (Net.room || '') + '</b> · 轮到 <b>' + NAME[state.turn] + '</b>';
  if (specCount > 0) txt += ' · ' + specCount + ' 人观战';
  setNetInfo(txt, 'ok');
}

/* —— 战绩：本机 localStorage 记录胜负（不依赖服务器，防作弊且隐私） —— */
const REC_KEY = 'xq_record';
function loadRecord(){
  try { return JSON.parse(localStorage.getItem(REC_KEY)) || { wins:0, losses:0, games:0 }; }
  catch(e){ return { wins:0, losses:0, games:0 }; }
}
function saveRecord(r){ try { localStorage.setItem(REC_KEY, JSON.stringify(r)); } catch(e){} }
function recordResult(mySide, winner){
  if (!mySide) return;
  const r = loadRecord();
  r.games = (r.games || 0) + 1;
  if (winner === mySide) r.wins = (r.wins || 0) + 1; else r.losses = (r.losses || 0) + 1;
  saveRecord(r);
  renderRecord();
  // 成就统计：对局数 / 胜负 / 连胜 / 排位胜 / 胜 AI
  const s = loadStats();
  s.games = (s.games || 0) + 1;
  if (winner === mySide){ s.wins = (s.wins||0)+1; s.curStreak = (s.curStreak||0)+1; s.maxStreak = Math.max(s.maxStreak||0, s.curStreak); }
  else { s.losses = (s.losses||0)+1; s.curStreak = 0; }
  if (stateRanked && winner === mySide) s.rankedWins = (s.rankedWins||0)+1;
  if (state.gameMode === 'ai' && winner === opponent(state.aiSide)) s.aiWins = (s.aiWins||0)+1;
  saveStats(s);
  refreshAchievements();
}
function renderRecord(){
  if (!recordBoxEl) return;
  if (state && (state.gameMode === 'online' || state.isSpectator)){
    const r = loadRecord();
    recordBoxEl.style.display = 'block';
    recordBoxEl.innerHTML = '📊 我的战绩：<b>' + (r.wins||0) + ' 胜</b> / <b>' + (r.losses||0) + ' 负</b>（共 ' + (r.games||0) + ' 局）';
  } else {
    recordBoxEl.style.display = 'none';
  }
}

/* ===================== 邀请裂变 & 海报分享 =====================
 * 邀请：每人一个 6 位邀请码，链接形如 /?room=ABCD&inv=7K9MQX；
 *       好友首次打开会向服务器上报一次绑定，服务器只统计"谁邀请了几个人"。
 * 海报：用 Canvas 把战绩 / 邀请信息画成一张图，带二维码，便于发微信、朋友圈。
 */
let myInviteCode   = null;   // 本机专属邀请码（服务器分配，首次访问时生成）
let myInvitedCount = 0;      // 我已邀请成功的人数
let lastRatingDelta = 0;     // 最近一局段位增减（海报上显示 +16 / -16）

async function ensureInviteCode(){
  if (myInviteCode) return myInviteCode;
  try {
    const r = await fetch('/api/invite/code?clientId=' + encodeURIComponent(Net.clientId)).then(x => x.json());
    if (r && r.ok){ myInviteCode = r.code; myInvitedCount = r.count || 0; const s=loadStats(); s.invites=myInvitedCount; saveStats(s); refreshAchievements(); }
  } catch(e){ /* 拿不到就退化为无邀请码的普通链接 */ }
  return myInviteCode;
}

// 生成邀请链接：在房间里就带房间号（好友点开直接同房开战），否则只带邀请码
function buildInviteLink(room){
  const q = [];
  if (room) q.push('room=' + encodeURIComponent(room));
  if (myInviteCode) q.push('inv=' + encodeURIComponent(myInviteCode));
  return location.origin + '/' + (q.length ? '?' + q.join('&') : '');
}

// 好友通过 ?inv= 打开页面：上报一次绑定（同一浏览器只报一次，服务器也会去重）
async function bindInviteFromUrl(){
  let code = null;
  try { code = new URLSearchParams(location.search).get('inv'); } catch(e){}
  if (!code) return;
  const KEY = 'xq_inv_bound';
  try { if (localStorage.getItem(KEY)) return; } catch(e){}
  // 先写标记再发请求：网络慢时用户连点刷新也不会重复上报（服务器另有去重，这里是双保险）
  try { localStorage.setItem(KEY, code); } catch(e){}
  try {
    const r = await fetch('/api/invite/bind', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, clientId: Net.clientId })
    }).then(x => x.json());
    if (r && r.bound) showToast('🎁 你是好友邀请来的，祝旗开得胜！', 'kill');
  } catch(e){
    try { localStorage.removeItem(KEY); } catch(e2){}   // 请求真失败了就撤销标记，下次还能补报
  }
}

// 邀请人数对应的传播成就（纯展示，图个乐）
function inviteTitle(n){
  if (n >= 20) return '👑 棋坛盟主';
  if (n >= 10) return '💎 钻石推广官';
  if (n >= 5)  return '🥇 金牌推广官';
  if (n >= 3)  return '🥈 银牌推广官';
  if (n >= 1)  return '🥉 铜牌推广官';
  return '还没邀请过好友，快去拉一个';
}

async function renderInvitePanel(){
  if (!invitePanelEl) return;
  await ensureInviteCode();
  // 刷新最新邀请人数
  if (myInviteCode){
    try {
      const s = await fetch('/api/invite/stats?code=' + encodeURIComponent(myInviteCode)).then(x => x.json());
      if (s && s.ok) myInvitedCount = s.count || 0;
    } catch(e){}
  }
  const link = buildInviteLink(Net.joined && !state.isSpectator ? Net.room : '');
  if (inviteLinkEl) inviteLinkEl.value = link;
  if (inviteStatEl){
    inviteStatEl.innerHTML =
      '我的邀请码：<b>' + (myInviteCode || '—') + '</b>　已邀请 <b>' + myInvitedCount + '</b> 位好友<br>' +
      '<span class="ip-title-sm">' + inviteTitle(myInvitedCount) + '</span>';
  }
  // 内联二维码：好友可直接扫码进房（不用先复制链接）
  const qc = document.getElementById('inviteQrCanvas');
  if (qc && typeof QR !== 'undefined' && link){
    const ctx = qc.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 176, 176);
    QR.draw(ctx, link, 0, 0, 176, { quiet: 2, bg: '#ffffff', fg: '#161616' });
  }
}

/* —— 海报 —— */

// 信息面板（聊天/规则）标签页切换
function showInfoTab(tab){
  if (!chatPanelEl || !rulesPanelEl || !tabChatEl || !tabRulesEl) return;
  infoTab = tab;
  if (tab === 'chat'){
    tabChatEl.classList.add('active'); tabRulesEl.classList.remove('active');
    chatPanelEl.style.display = 'block';  rulesPanelEl.style.display = 'none';
  } else {
    tabRulesEl.classList.add('active'); tabChatEl.classList.remove('active');
    chatPanelEl.style.display = 'none';   rulesPanelEl.style.display = 'block';
  }
}

// 邀请链接 / 扫码进房：自动以玩家身份进房；房间满员（红黑都有人）则自动转观战
async function autoJoinFromUrl(){
  let room = null;
  try { room = new URLSearchParams(location.search).get('room'); } catch(e){}
  if (!room) return;
  room = room.trim();
  if (!room) return;
  // 确保联机面板就绪
  if (typeof modeSel !== 'undefined' && modeSel) modeSel.value = 'online';
  if (typeof onlineOptsEl !== 'undefined' && onlineOptsEl) onlineOptsEl.style.display = 'block';
  if (typeof aiOptsEl !== 'undefined' && aiOptsEl) aiOptsEl.style.display = 'none';
  if (typeof roomInput !== 'undefined' && roomInput) roomInput.value = room;
  config.mode = 'online';
  // 先问服务器该房间是否已满员（红黑双方都在）
  let full = false;
  try {
    const list = await fetch('/api/rooms').then(x => x.json());
    const r = list && list.rooms && list.rooms.find(x => x.room === room);
    if (r && r.red && r.black) full = true;
  } catch(e){}
  if (Net.joined) Net.leave();
  if (full){
    setNetInfo('该房间已有两位玩家，自动进入观战席 🔭', 'wait');
    Net.spectate(room);
    return;
  }
  setNetInfo('正在进入好友房间 ' + room + '…', 'wait');
  let res = null;
  try { res = await Net.join(room); } catch(e){}
  if (!res || !res.ok || !res.side){
    // 进房失败（满员或服务异常）→ 兜底转观战
    setNetInfo('无法以玩家身份进入，已转为观战 🔭', 'wait');
    try { Net.spectate(room); } catch(e){}
    return;
  }
  if (typeof chatPanelEl !== 'undefined') showInfoTab('chat');
  showInvite(room);
}

function posterCommon(){
  const hide = !!Settings.get('hideRatingPoster');
  return {
    rating: hide ? null : myRating,
    code: myInviteCode,
    invited: myInvitedCount,
    ts: Date.now()
  };
}

async function openResultPoster(){
  await ensureInviteCode();
  const rec = loadRecord();
  const cv = Poster.build(Object.assign(posterCommon(), {
    kind: 'result',
    win: !!(state.mySide && state.winner === state.mySide),
    sideName: state.mySide ? NAME[state.mySide] : '',
    room: (Net && Net.room) || '',
    steps: state.plies || 0,
    ratingDelta: Settings.get('hideRatingPoster') ? 0 : lastRatingDelta,
    wins: rec.wins || 0, losses: rec.losses || 0, games: rec.games || 0,
    link: buildInviteLink((Net && Net.room) || '')
  }));
  showPosterModal(cv, '保存后可发微信 / 朋友圈，好友扫码直接进你的房间复仇');
}

async function openInvitePoster(){
  await ensureInviteCode();
  const cv = Poster.build(Object.assign(posterCommon(), {
    kind: 'invite',
    link: buildInviteLink(Net.joined && !state.isSpectator ? Net.room : '')
  }));
  showPosterModal(cv, '把这张图发给好友，他扫码就能和你开战');
}

function showPosterModal(cv, tip){
  if (!cv){ showToast('当前浏览器不支持生成海报图片', 'check'); return; }
  if (!posterModalEl || !posterImgEl){ showToast('海报面板未就绪', 'check'); return; }
  posterImgEl.src = Poster.dataURL();
  const tipEl = posterModalEl.querySelector('.poster-tip');
  if (tipEl && tip) tipEl.textContent = tip;
  posterModalEl.style.display = 'flex';
  Sound.click();
}
function hidePosterModal(){ if (posterModalEl) posterModalEl.style.display = 'none'; }

/* ===================== 段位 / 聊天 / 悔棋 的 UI 与网络逻辑 ===================== */
// 对局结束上报胜方，服务器按 ELO 更新双方段位（服务器自身去重，双方都上报也只算一次）
function reportResult(winnerSide){
  if (!isOnline() || !Net.room || !state.mySide) return;
  fetch('/api/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: Net.room, winner: winnerSide })
  }).catch(() => {});
}

// 段位显示：进房时拉取、对局结束显示本局增减
function updateRatingUI(diff){
  if (!ratingLineEl) return;
  if (!isOnline() && !state.isSpectator){ ratingLineEl.style.display = 'none'; return; }
  ratingLineEl.style.display = 'block';
  if (typeof diff === 'number' && diff !== 0) lastRatingDelta = diff;   // 记下本局增减，海报要用
  let txt = `你的段位：<b>${myRating}</b>`;
  if (typeof diff === 'number' && diff !== 0){
    const up = diff > 0;
    txt += ` <span class="rating-delta ${up ? 'up' : 'down'}">（${up ? '▲ +' : '▼ '}${diff}）</span>`;
  }
  ratingLineEl.innerHTML = txt;
}

// —— 联机聊天 ——
function appendChat(who, text, mine){
  if (!chatMsgsEl) return;
  const div = document.createElement('div');
  div.className = 'chat-msg' + (mine ? ' mine' : '');
  div.innerHTML = `<span class="chat-who">${escapeHtml(who)}：</span><span class="chat-text">${escapeHtml(text)}</span>`;
  chatMsgsEl.appendChild(div);
  chatMsgsEl.scrollTop = chatMsgsEl.scrollHeight;
}
function sendChat(){
  if (!isOnline() && !state.isSpectator) return;
  const t = (chatInputEl.value || '').trim();
  if (!t) return;
  netSend('chat', { text: t });
  appendChat('我', t, true);
  chatInputEl.value = '';
  Sound.click();
}

// —— 悔棋：对手发来请求时弹出「同意/拒绝」面板 ——
function showUndoPrompt(side){
  if (!undoPromptEl) return;
  undoPromptEl.style.display = 'block';
  const txt = undoPromptEl.querySelector('.undo-text');
  if (txt) txt.innerHTML = `对手（${NAME[side]}）请求悔棋，是否同意退回上一步？`;
  const acc = undoPromptEl.querySelector('.undo-accept');
  const rej = undoPromptEl.querySelector('.undo-reject');
  if (acc) acc.onclick = () => {
    hideUndoPrompt();
    netSend('undoAccept', { side });
    if (performUndo(side)) showToast('🔄 已同意悔棋，已退回', 'check');
  };
  if (rej) rej.onclick = () => {
    hideUndoPrompt();
    netSend('undoReject', {});
    showToast('⛔ 已拒绝悔棋', 'check');
  };
}
function hideUndoPrompt(){ if (undoPromptEl) undoPromptEl.style.display = 'none'; }

/* —— 回放：对局结束后自动把整局消息流存到本机；也可导入他人分享的回放文件 —— */
const REPLAY_KEY = 'xq_replays';
function loadReplayList(){
  try { return JSON.parse(localStorage.getItem(REPLAY_KEY)) || []; } catch(e){ return []; }
}
function saveReplayList(list){ try { localStorage.setItem(REPLAY_KEY, JSON.stringify(list)); } catch(e){} }
async function saveReplayToLocal(){
  if (!Net.room) return;
  try {
    const r = await fetch('/api/record?room=' + encodeURIComponent(Net.room)).then(x => x.json());
    if (!r || !r.ok) return;
    // 把本机已知的暗棋坐标按 seq 对齐，附到每一条消息上（仅供本机回放显示，不泄露给对方）
    const msgs = (r.msgs || []).map(m => {
      let snap = null;
      if (liveHidden){
        for (let i = liveHidden.seqs.length - 1; i >= 0; i--){
          if (liveHidden.seqs[i] <= (m.seq || 0)){ snap = liveHidden.snaps[i]; break; }
        }
      }
      const cm = JSON.parse(JSON.stringify(m));
      if (snap) cm._hidden = snap;
      return cm;
    });
    const list = loadReplayList();
    list.unshift({ ts: Date.now(), room: Net.room, count: msgs.length, msgs });
    if (list.length > 20) list.length = 20;   // 最多保留最近 20 局
    saveReplayList(list);
  } catch(e){ /* 存档失败不影响对局 */ }
}

const Replay = {
  msgs: [], cursor: 0, playing: false, timer: null, label: '', _key: -1,
  showHidden: true,        // 回放时是否显示暗棋（仅本机已知坐标）
  load(msgs, label){
    this.stop();
    this.msgs = msgs || [];
    this.cursor = 0;
    this.label = label || '';
    config.mode = 'replay';
    modeSel.value = 'online';            // 回放不是 select 里的正式模式，仅用于显示
    newGame();
    state.isSpectator = true; state.mySide = null;
    state.hidden = { red:{r:-1,c:-1,alive:true}, black:{r:-1,c:-1,alive:true} };
    state.showGate = false; state.recorded = true; state.gameMode = 'replay';
    state.replayShowHidden = this.showHidden;
    if (this.msgs[0] && this.msgs[0]._hidden) state.hidden = JSON.parse(JSON.stringify(this.msgs[0]._hidden));
    state.log = ['📼 回放：' + this.label + '（勾选下方「显示暗棋」可看本机已知位置）'];
    this.updateSlider();
    render();
  },
  step(){
    if (this.cursor >= this.msgs.length) return false;
    const m = this.msgs[this.cursor];
    applyReplayMessage(m.type, m.data);
    if (m._hidden) state.hidden = JSON.parse(JSON.stringify(m._hidden));   // 回放时贴回暗棋坐标
    this.cursor++;
    this.updateSlider();
    render();
    return true;
  },
  seek(i){
    this.stop();
    i = Math.max(0, Math.min(i, this.msgs.length));
    config.mode = 'replay';
    newGame();
    state.isSpectator = true; state.mySide = null;
    state.hidden = { red:{r:-1,c:-1,alive:true}, black:{r:-1,c:-1,alive:true} };
    state.showGate = false; state.recorded = true; state.gameMode = 'replay';
    _applyingHistory = true;             // 拖进度条快速重建：不播声音/特效/快照，只重建局面
    while (this.cursor < i) this.step();
    _applyingHistory = false;
    this.updateSlider();
    render();
  },
  play(){
    if (this.playing) return;
    if (this.cursor >= this.msgs.length) this.seek(0);
    this.playing = true;
    if (replayPlayBtn) replayPlayBtn.textContent = '⏸ 暂停';
    const tick = () => {
      if (!this.playing) return;
      const ok = this.step();
      if (!ok){ this.stop(); return; }
      this.timer = setTimeout(tick, 700);
    };
    this.timer = setTimeout(tick, 300);
  },
  stop(){
    this.playing = false;
    if (this.timer){ clearTimeout(this.timer); this.timer = null; }
    if (replayPlayBtn) replayPlayBtn.textContent = '▶ 播放';
  },
  updateSlider(){
    if (!replaySliderEl) return;
    replaySliderEl.max = String(this.msgs.length);
    replaySliderEl.value = String(this.cursor);
    if (replayStepEl) replayStepEl.textContent = this.cursor + ' / ' + this.msgs.length;
  }
};

/* ===================== 特效 / 提示 ===================== */
// 记录最近一步的起止格（seq 自增用于动画只播一次）
function setLastMove(fr, fc, tr, tc){
  lastMove = { fr, fc, tr, tc, seq: ++lastMoveSeq };
}

/* —— 走子滑动补间（FLIP）：重绘后若棋子在上一帧的别处，就从旧位置平滑滑过来 —— */
const SLIDE_MS = 270;
function animateSlideIn(el, r, c, prevPos){
  if (!prevPos || !prevPos.size) return false;
  const cands = prevPos.get(el.dataset.pk);
  if (!cands || !cands.length) return false;
  let best = null, bestD = Infinity;
  for (const o of cands){
    const dd = Math.abs(o.r - r) + Math.abs(o.c - c);
    if (dd < bestD){ bestD = dd; best = o; }
  }
  if (!best || bestD === 0) return false;
  const dx = (best.c - c) * CELL, dy = (best.r - r) * CELL;
  el.style.transition = 'none';
  el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
  el.style.zIndex = '8';
  el.getBoundingClientRect();          // 强制回流，确保起始帧先生效
  el.style.transition = `transform ${SLIDE_MS}ms var(--ease-out)`;
  el.style.transform = 'translate(0, 0)';
  const elRef = el;
  setTimeout(() => {                   // 滑动结束清掉内联样式，交还 CSS 类控制
    elRef.style.transition = '';
    elRef.style.transform = '';
    elRef.style.zIndex = '';
  }, SLIDE_MS + 80);
  return true;
}

// 被吃棋子的残影：以棋子样式复制一份到特效层，缩小旋转淡出
function spawnGhost(r, c, owner, type){
  if (!fxEl || !Settings.get('fx') || _applyingHistory) return;
  const g = document.createElement('div');
  g.className = `piece ${owner} fx-ghost`;
  g.style.left = (MARGIN + c*CELL - PR) + 'px';
  g.style.top  = (MARGIN + r*CELL - PR) + 'px';
  g.textContent = CHARS[owner][type];
  fxEl.appendChild(g);
  setTimeout(() => { if (g.parentNode) g.parentNode.removeChild(g); }, 520);
}

// 撞暗棋自爆：进攻方棋子从起点飞向爆点，落地后起爆（回调里放爆炸与音效）
function spawnFlyGhost(from, to, owner, type, onArrive){
  if (!fxEl || !Settings.get('fx') || _applyingHistory){ if (onArrive) onArrive(); return; }
  const g = document.createElement('div');
  g.className = `piece ${owner} fx-fly`;
  g.style.left = (MARGIN + from.c*CELL - PR) + 'px';
  g.style.top  = (MARGIN + from.r*CELL - PR) + 'px';
  g.textContent = CHARS[owner][type];
  g.style.setProperty('--fx-dx', ((to.c - from.c) * CELL) + 'px');
  g.style.setProperty('--fx-dy', ((to.r - from.r) * CELL) + 'px');
  fxEl.appendChild(g);
  requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('arrive')));
  setTimeout(() => {
    if (g.parentNode) g.parentNode.removeChild(g);
    if (onArrive) onArrive();
  }, 180);
}

function showExplosion(r, c, label){
  if (!fxEl) return;
  if (!Settings.get('fx') || _applyingHistory){ showToast(`💥 ${label || '同归于尽'}！双方同归于尽`, 'boom'); return; }
  const x = MARGIN + c*CELL, y = MARGIN + r*CELL;
  const rm = (el, ms) => setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, ms);

  // 屏幕震动
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 540);

  // 全屏闪光
  const flash = document.createElement('div');
  flash.className = 'fx-flash';
  fxEl.appendChild(flash); rm(flash, 460);

  // 冲击波：一圈快而亮 + 一圈慢而宽
  for (const slow of [false, true]){
    const wave = document.createElement('div');
    wave.className = 'fx-wave' + (slow ? ' slow' : '');
    wave.style.left = (x - 4) + 'px';
    wave.style.top  = (y - 4) + 'px';
    fxEl.appendChild(wave); rm(wave, slow ? 1200 : 880);
  }

  // 爆心余烬光点
  const ember = document.createElement('div');
  ember.className = 'fx-ember';
  ember.style.left = (x - 13) + 'px';
  ember.style.top  = (y - 13) + 'px';
  fxEl.appendChild(ember); rm(ember, 660);

  // 碎片粒子：大小 / 旋转 / 起爆时序随机
  const N = 14;
  for (let i = 0; i < N; i++){
    const p = document.createElement('div');
    p.className = 'fx-particle';
    const ang = (Math.PI*2*i)/N + Math.random()*0.6;
    const dist = 34 + Math.random()*46;
    const size = 5 + Math.random()*7;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = (x - size/2) + 'px';
    p.style.top  = (y - size/2) + 'px';
    p.style.setProperty('--dx', (Math.cos(ang)*dist).toFixed(1) + 'px');
    p.style.setProperty('--dy', (Math.sin(ang)*dist).toFixed(1) + 'px');
    p.style.setProperty('--rot', (120 + Math.random()*240).toFixed(0) + 'deg');
    p.style.background = (i % 3 === 0) ? '#ffd24a' : (i % 3 === 1 ? '#ff5b5b' : '#ff9a3c');
    p.style.animationDelay = (Math.random()*70).toFixed(0) + 'ms';
    fxEl.appendChild(p); rm(p, 1000);
  }

  // 中心爆炸 + 文字
  const wrap = document.createElement('div');
  wrap.className = 'fx-explode';
  wrap.style.left = (x - 30) + 'px';
  wrap.style.top  = (y - 30) + 'px';
  wrap.innerHTML = `<div class="boom">💥</div><div class="fx-label">${label || '同归于尽'}</div>`;
  fxEl.appendChild(wrap); rm(wrap, 1600);

  showToast(`💥 ${label || '同归于尽'}！双方同归于尽`, 'boom');
}
function showCapture(r, c){
  if (!fxEl) return;
  if (!Settings.get('fx') || _applyingHistory) return;
  const x = MARGIN + c*CELL, y = MARGIN + r*CELL;

  // 刀光扫线
  const line = document.createElement('div');
  line.className = 'fx-slashline';
  line.style.left = (x - 43) + 'px';
  line.style.top  = (y - 2) + 'px';
  fxEl.appendChild(line);
  setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 520);

  // 红色爆闪环
  const burst = document.createElement('div');
  burst.className = 'fx-burst';
  burst.style.left = (x - 15) + 'px';
  burst.style.top  = (y - 15) + 'px';
  fxEl.appendChild(burst);
  setTimeout(() => { if (burst.parentNode) burst.parentNode.removeChild(burst); }, 620);

  // 匕首落款
  const wrap = document.createElement('div');
  wrap.className = 'fx-capture';
  wrap.style.left = (x - 30) + 'px';
  wrap.style.top  = (y - 30) + 'px';
  wrap.innerHTML = `<div class="slash">🗡️</div>`;
  fxEl.appendChild(wrap);
  setTimeout(() => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 900);
}
function showToast(text, type){
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.className = 'toast show ' + (type || '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.className = 'toast'; }, 1600);
}

// 碎块四散飞裂（金红/木色碎片，吃子、斩将、爆炸复用）
function spawnDebris(x, y, count, colors, dist){
  if (!fxEl) return;
  for (let i = 0; i < count; i++){
    const d = document.createElement('div');
    d.className = 'fx-debris';
    const ang = (Math.PI*2*i)/count + Math.random()*0.9;
    const len = (dist || 40) * (0.7 + Math.random()*0.7);
    d.style.left = (x - 5) + 'px';
    d.style.top  = (y - 5) + 'px';
    d.style.setProperty('--dx', (Math.cos(ang)*len).toFixed(1) + 'px');
    d.style.setProperty('--dy', (Math.sin(ang)*len).toFixed(1) + 'px');
    d.style.setProperty('--rot', ((Math.random()*2-1)*260).toFixed(0) + 'deg');
    d.style.background = colors[i % colors.length];
    fxEl.appendChild(d);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 780);
  }
}

// 斩将（吃将）特殊击杀特效：屏震 + 全屏白闪 + 旋转金光 + 红环 + 大红「将」字碎裂 + 金红碎块四散
function showKill(r, c){
  if (!fxEl) return;
  if (!Settings.get('fx')){ showToast('💥 斩将！', 'kill'); return; }
  const x = MARGIN + c*CELL, y = MARGIN + r*CELL;
  // 屏幕震动 + 全屏闪光（复用爆炸特效已有机制）
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 540);
  const flash = document.createElement('div');
  flash.className = 'fx-flash';
  fxEl.appendChild(flash);
  setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 280);
  // 斩将特效本体
  const wrap = document.createElement('div');
  wrap.className = 'fx-kill';
  wrap.style.left = (x - 38) + 'px';
  wrap.style.top  = (y - 38) + 'px';
  wrap.innerHTML = `<div class="kill-rays"></div><div class="kill-ring"></div>` +
                   `<div class="kill-label">将</div><div class="kill-tag">斩将！</div>`;
  fxEl.appendChild(wrap);
  setTimeout(() => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 1150);
  // 将/帅碎块四散（金红碎片，强调斩杀重量感）
  spawnDebris(x, y, 8, ['#ff3b3b', '#ffd24a'], 56);
}

// 胜利结算弹窗：全屏「某方胜利」四字 + 背景光芒四射，参考市面获胜动画。
// winner 为 'red'/'black'；吃将终结时由 render 延后 1000ms 调用（等斩将特效播完），其余结局 600ms。
function showVictory(winner){
  if (!victoryEl) return;
  victoryTextEl.textContent = NAME[winner] + '胜利';           // 红方胜利 / 黑方胜利（四字）
  victoryTextEl.className = 'vic-text ' + (winner === 'red' ? 'vic-red' : 'vic-black');
  const won = isOnline() ? (winner === state.mySide)
                        : (state.gameMode === 'ai' ? (winner === opponent(state.aiSide)) : true);
  victorySubEl.textContent = won ? '🎉 恭喜获胜！' : '惜败 · 再接再厉';
  if (gateEl) gateEl.style.display = 'none';                   // 避免与旧的「游戏结束」遮罩重叠（pvp 残留）
  victoryEl.style.display = 'flex';
  victoryEl.classList.remove('show'); void victoryEl.offsetWidth; victoryEl.classList.add('show');  // 重放入场动画
  if (won) spawnVictoryConfetti();                            // 自己获胜时下彩带雨
}
function hideVictory(){ if (victoryEl) victoryEl.style.display = 'none'; }
// 胜利彩带雨：彩色碎片从顶部旋转飘落（仅自己获胜时触发）
function spawnVictoryConfetti(){
  if (!victoryEl) return;
  const colors = ['#ffd24a', '#ff5b5b', '#5b8def', '#2ecc71', '#ff9a3c', '#e86bd6'];
  const n = 36;
  const frags = [];
  for (let i = 0; i < n; i++){
    const c = document.createElement('div');
    c.className = 'vic-confetti';
    c.style.left = (Math.random()*100) + '%';
    c.style.setProperty('--size', (6 + Math.random()*8).toFixed(1) + 'px');
    c.style.setProperty('--color', colors[i % colors.length]);
    c.style.setProperty('--delay', (Math.random()*0.6).toFixed(2) + 's');
    c.style.setProperty('--dur', (2.0 + Math.random()*1.2).toFixed(2) + 's');
    c.style.setProperty('--rot', ((Math.random()*2-1)*720).toFixed(0) + 'deg');
    victoryEl.appendChild(c);
    frags.push(c);
  }
  setTimeout(() => frags.forEach(c => { if (c.parentNode) c.parentNode.removeChild(c); }), 3600);
}

// 手机震动（Haptic 触觉反馈）：仅在真实对局里由翻棋/吃子触发；
// iOS 的 web-view 不支持 navigator.vibrate，特性检测后静默跳过，不影响其他平台。
function vibrate(pattern){
  try {
    if (!Settings.get('vibrate')) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch(e){}
}

/* ===================== 交互 ===================== */
function onHit(r, c){
  Sound.init();   // 首次点击棋盘即解锁音频（浏览器自动播放策略要求用户手势）
  if (state.isSpectator || state.gameMode === 'replay') return;  // 观战 / 回放：只读，禁止操作
  if (state.gameOver || state.showGate) return;
  if (handoffActive) return;                                            // 交接遮罩期间屏蔽操作，保护对方暗棋
  if (state.gameMode === 'ai' && state.turn === state.aiSide) return;  // AI 思考中，禁止玩家操作
  if (isOnline() && !onlineCanAct()) return;                            // 联机：没轮到你 / 正等对手裁决

  // 后置阶段：暗棋已就绪时，点高亮格直接走暗棋（自动结束回合）；否则只能点"结束回合"跳过
  if (state.phase === 'postMove'){
    if (state.hiddenReady[state.turn] && state.hidden[state.turn].alive){
      const lm = hiddenMoves(state.turn);
      if (lm.some(([tr,tc]) => tr === r && tc === c)){ executeHiddenMove({r,c}); return; }
    }
    return;   // 点别处忽略，等待走暗棋或点"结束回合"
  }

  // choose 阶段：普通棋子
  if (state.selected){
    const lm = legalMovesForPiece(state.selected.r, state.selected.c);
    if (lm.some(([tr,tc]) => tr === r && tc === c)){
      // 联机：本机不能自行判断有没有撞上对手暗棋，先发给对手裁决
      if (isOnline()) onlineSubmitMove(state.selected, {r,c});
      else executeNormalMove(state.selected, {r,c});
      return;
    }
    const p = state.board[r][c];
    if (p && p.owner === state.turn){ state.selected = {r,c}; render(); return; }
    state.selected = null; render(); return;
  } else {
    const p = state.board[r][c];
    if (p && p.owner === state.turn){ state.selected = {r,c}; render(); return; }
  }
}

/* ===================== 响应式布局（手机端） ===================== */
// 棋盘内部坐标固定（CELL/MARGIN 不变），仅通过 CSS transform scale 整体缩放以适配窄屏。
// 同时把 board 的布局盒宽高设为「逻辑尺寸 × k」，这样不会横向溢出，且点击命中区域随缩放自动正确。
function computeBoardScale(){
  const boardEl = document.getElementById('board');
  if (!boardEl) return;
  const fullW = MARGIN*2 + 8*CELL;   // 逻辑宽 532
  const fullH = MARGIN*2 + 9*CELL;   // 逻辑高 580
  const avail = Math.min(window.innerWidth - 16, 520);
  let k = 1;
  if (avail < fullW) k = avail / fullW;
  // #board 内部始终用逻辑像素绘制（render 负责其 width/height），
  // 这里只做整体缩放；transform 不影响布局盒子，所以同步把外层 wrapper 调成缩放后的真实尺寸，避免空白/错位。
  boardEl.style.transform = 'scale(' + k + ')';
  boardEl.style.transformOrigin = 'top left';
  boardEl.style.margin = '0';                 // 取消 .board 默认的 margin:0 auto，避免被居中后错位
  const wrap = boardEl.parentElement;
  if (wrap){
    wrap.style.display = 'block';             // 取消移动端 .board-wrap 的 flex 居中，确保缩放后左上角对齐
    wrap.style.width  = (fullW * k) + 'px';
    wrap.style.height = (fullH * k) + 'px';
  }
}

/* ===================== 渲染 ===================== */
/* 棋盘主题：质感化配色（渐变底 + 木纹/石纹 + 边框 + 暗角） */
const BOARD_THEMES = {
  classic: { bgTop:'#f2d8a4', bgBot:'#e0ba7c', grain:'rgba(122,80,26,.10)', frame:'#8a5a26',
             line:'#5b3a1a', text:'rgba(90,58,26,.9)', vig:'rgba(84,48,10,.22)' },
  dark:    { bgTop:'#2b313c', bgBot:'#1f242d', grain:'rgba(255,255,255,.035)', frame:'#0d0f14',
             line:'#6d7586', text:'rgba(160,170,190,.9)', vig:'rgba(0,0,0,.4)' },
  light:   { bgTop:'#faf5ea', bgBot:'#eee4cf', grain:'rgba(150,120,70,.09)', frame:'#c9b183',
             line:'#8a6b3a', text:'rgba(138,107,58,.9)', vig:'rgba(120,90,40,.14)' }
};
// 固定伪随机序列：木纹每次重绘完全一致，不闪变
const GRAIN_SEED = [3,7,13,19,23,31,41,47,53,61,67,73,83,89,97,103,109,121,131,139,149,157,167,173];
function buildBoardSVG(){
  const T = BOARD_THEMES[Settings.get('boardTheme')] || BOARD_THEMES.classic;
  const W = MARGIN*2 + 8*CELL, H = MARGIN*2 + 9*CELL;
  const x = c => MARGIN + c*CELL;
  const y = r => MARGIN + r*CELL;
  const line = (x1,y1,x2,y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${T.line}" stroke-width="1.4"/>`;
  const cross = (cx,cy) => { const d=5; return `<line x1="${cx-d}" y1="${cy}" x2="${cx+d}" y2="${cy}" stroke="${T.line}" stroke-width="1"/><line x1="${cx}" y1="${cy-d}" x2="${cx}" y2="${cy+d}" stroke="${T.line}" stroke-width="1"/>`; };

  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<defs>
    <linearGradient id="bgG" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${T.bgTop}"/><stop offset="1" stop-color="${T.bgBot}"/>
    </linearGradient>
    <radialGradient id="vigG" cx="0.5" cy="0.44" r="0.85">
      <stop offset="0.55" stop-color="${T.vig}" stop-opacity="0"/>
      <stop offset="1" stop-color="${T.vig}" stop-opacity="1"/>
    </radialGradient>
  </defs>`;
  // 底色渐变 + 细腻纹理（横纹按固定种子微波动，模拟木纹/纸纹）
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#bgG)"/>`;
  for (let i = 0; i < GRAIN_SEED.length; i++){
    const gy = 6 + (GRAIN_SEED[i] * 26.7) % (H - 12);
    const a1 = 3 + (i % 3) * 2, a2 = -2 - (i % 2) * 3;
    s += `<path d="M0 ${gy.toFixed(1)} q ${W*0.25} ${a1} ${W*0.5} 0 t ${W*0.5} ${a2}" fill="none" stroke="${T.grain}" stroke-width="${(i%3===0)?1.6:1}"/>`;
  }
  // 外框：厚边框 + 细内线，像棋盘的木质包边
  s += `<rect x="3" y="3" width="${W-6}" height="${H-6}" fill="none" stroke="${T.frame}" stroke-width="6" opacity=".9"/>`;
  s += `<rect x="10" y="10" width="${W-20}" height="${H-20}" fill="none" stroke="${T.frame}" stroke-width="1" opacity=".45"/>`;
  // 网格
  s += `<rect x="${MARGIN}" y="${MARGIN}" width="${8*CELL}" height="${9*CELL}" fill="none" stroke="${T.line}" stroke-width="2.2"/>`;
  for (let c = 0; c < COLS; c++) s += line(x(c), y(0), x(c), y(9));
  for (let r = 0; r <= 4; r++) s += line(x(0), y(r), x(8), y(r));
  for (let r = 5; r <= 9; r++) s += line(x(0), y(r), x(8), y(r));
  s += line(x(3), y(0), x(5), y(2)) + line(x(5), y(0), x(3), y(2));
  s += line(x(3), y(7), x(5), y(9)) + line(x(5), y(7), x(3), y(9));
  s += `<text x="${x(1.6)}" y="${y(4)+CELL*0.7}" font-size="23" fill="${T.text}" text-anchor="middle" font-family="serif" style="letter-spacing:10px">楚 河</text>`;
  s += `<text x="${x(6.4)}" y="${y(4)+CELL*0.7}" font-size="23" fill="${T.text}" text-anchor="middle" font-family="serif" style="letter-spacing:10px">漢 界</text>`;
  const marks = [[2,1],[2,7],[7,1],[7,7],[3,0],[3,2],[3,4],[3,6],[3,8],[6,0],[6,2],[6,4],[6,6],[6,8]];
  for (const [r,c] of marks) s += cross(x(c), y(r));
  // 暗角：边缘轻微压暗，视线聚焦中央
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#vigG)"/>`;
  s += `</svg>`;
  return s;
}

// 应用棋盘主题：切换 body 属性（影响 .board-wrap / .piece 的 CSS 覆盖）+ 重绘 SVG 棋盘
function applyBoardTheme(){
  if (document.body) document.body.setAttribute('data-board-theme', Settings.get('boardTheme'));
  const el = document.getElementById('svgLayer');
  if (el) el.innerHTML = buildBoardSVG();
}

function buildHits(){
  hitsEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      const d = document.createElement('div');
      d.className = 'hit';
      d.style.left = (MARGIN + c*CELL - CELL/2) + 'px';
      d.style.top  = (MARGIN + r*CELL - CELL/2) + 'px';
      d.style.width = CELL + 'px';
      d.style.height = CELL + 'px';
      d.addEventListener('click', () => onHit(r, c));
      hitsEl.appendChild(d);
    }
  }
}

function hiddenStatusText(owner){
  if (!state.hidden[owner].alive) return '已阵亡';
  if (state.hiddenReady[owner])   return '就绪';
  return '还需 ' + (2 - state.sinceHidden[owner]) + ' 步';
}

// 在棋盘上画一枚「暗」棋子（暗棋就绪时加发光样式）
function renderHiddenPiece(h, prevPos){
  const d = document.createElement('div');
  let cls = 'piece hidden-piece';
  if (state.phase === 'postMove') cls += ' hidden-ready';
  d.className = cls;
  d.style.left = (MARGIN + h.c*CELL - PR) + 'px';
  d.style.top  = (MARGIN + h.r*CELL - PR) + 'px';
  d.textContent = '暗';
  d.dataset.pk = 'hid:' + (h === state.hidden.red ? 'red' : 'black');
  d.dataset.r = h.r; d.dataset.c = h.c;
  piecesEl.appendChild(d);
  animateSlideIn(d, h.r, h.c, prevPos);   // 暗棋移动同样平滑滑动
  return d;
}

/* 渲染去重：同一状态一帧只绘一次。联机/回放路径常在走子后紧跟一次多余的 render()，
   若不去重，第二次会销毁刚起步的滑动动画（棋子看起来又变回瞬移）。 */
let lastRenderSig = null;
function renderSignature(){
  return JSON.stringify([
    state.board, state.turn, state.phase, state.selected, state.hidden, state.hiddenReady,
    state.sinceHidden, state.gameOver, state.winner, state.showGate, state.pending,
    state.gameMode, state.isSpectator, state.mySide, state.opponentOffline, state.replayShowHidden,
    lastMove && lastMove.seq, Settings.get('boardTheme'), Settings.get('showHighlights'),
    Net.room, Net.joined, Net.peerOnline
  ]);
}
function render(){
  const sig = renderSignature();
  if (sig === lastRenderSig) return;   // 与上一帧完全一致：跳过，保住进行中的动画
  lastRenderSig = sig;

  if (state.gameOver){
    // 对局结束时：玩家自动计入战绩 + 存档回放（观战/回放本身不触发）
    if (!state._soundPlayed && !state.isSpectator && state.gameMode !== 'replay'){
      const won = isOnline() ? (state.winner === state.mySide)
                            : (state.gameMode === 'ai' ? (state.winner === opponent(state.aiSide)) : true);
      if (won) Sound.win(); else Sound.lose();
      state._soundPlayed = true;
    }
    if ((state.gameMode === 'online' || state.isSpectator) && state.mySide && !state.recorded){
      state.recorded = true;
      recordResult(state.mySide, state.winner);
    }
    if (state.gameMode === 'online' && state.mySide && !state.reported){
      state.reported = true;
      reportResult(state.winner);          // 上报胜方，服务器按 ELO 更新双方段位（服务器去重）
    }
    if (state.gameMode === 'online' && state.mySide && !state.savedReplay){
      state.savedReplay = true;
      saveReplayToLocal();                 // 异步存档，失败也无妨
    }
    // 对局已结束：清掉"上次房间"，刷新后不再自动续这局已结束的对局
    if (state.gameMode === 'online' && state.mySide){
      try { localStorage.removeItem('xq_last_room_' + Net.clientId); } catch(e){}
    }
  }

  if (state.gameOver){
    const mine = isOnline() ? (state.winner === state.mySide ? '（你赢了 🎉）' : '（你输了）') : '';
    statusEl.innerHTML = `🏁 游戏结束：<b>${NAME[state.winner]}</b> 获胜！${mine}`;
  } else if (state.isSpectator){
    statusEl.innerHTML = `👁️ 观战中 · 房间 <b>${Net.room}</b> · 轮到 <b>${NAME[state.turn]}</b>`;
  } else if (isOnline()){
    if (typeof Net === 'undefined' || !Net.joined){
      statusEl.innerHTML = `请在右上方<b>输入房间号</b>并点「进入房间」`;
    } else if (!Net.peerOnline){
      if (state.opponentOffline)
        statusEl.innerHTML = `🔌 <b>对手已掉线</b>，正在等待重连…（最多 70 秒，超时判你胜）`;
      else
        statusEl.innerHTML = `⏳ <b>等待对手进入房间…</b>（房间号 ${Net.room}）`;
    } else if (state.opponentOffline){
      statusEl.innerHTML = `⏳ 对手正在重连…`;
    } else if (state.pending){
      statusEl.innerHTML = `⏳ 着法已发出，<b>等待对手确认…</b>`;
    } else if (state.turn !== state.mySide){
      statusEl.innerHTML = `⏳ 等待对手（<b>${NAME[state.turn]}</b>）行动…`;
    } else if (state.phase === 'postMove'){
      statusEl.innerHTML = `你的暗棋<b>已就绪</b> — 点棋盘高亮格走暗棋，或点右侧「结束回合」`;
    } else {
      statusEl.innerHTML = `轮到你了（<b>${NAME[state.mySide]}</b>）：请走 1 步普通棋子`;
    }
  } else if (state.gameMode === 'ai' && state.turn === state.aiSide){
    statusEl.innerHTML = `🤖 <b>AI 思考中…</b>（轮到 AI）`;
  } else if (state.phase === 'postMove'){
    const who = state.gameMode === 'ai' ? '你的暗棋' : `${NAME[state.turn]} 暗棋`;
    statusEl.innerHTML = `${who}<b>已就绪</b>（可选）— 点棋盘高亮格走暗棋，或点右侧「结束回合」跳过`;
  } else if (state.gameMode === 'ai'){
    statusEl.innerHTML = `你的回合（<b>${NAME[viewerSide()]}</b>）：请走 1 步普通棋子`;
  } else {
    statusEl.innerHTML = `当前回合：<b>${NAME[state.turn]}</b>（请走 1 步普通棋子）`;
  }

  if (state.isSpectator){
    redTokensEl.textContent   = state.hidden.red.alive   ? '（隐藏）' : '已阵亡';
    blackTokensEl.textContent = state.hidden.black.alive ? '（隐藏）' : '已阵亡';
  } else if (state.gameMode === 'replay' && state.replayShowHidden){
    redTokensEl.textContent   = hiddenStatusText('red');
    blackTokensEl.textContent = hiddenStatusText('black');
  } else if (isOnline()){
    const opp = opponent(state.mySide);
    const oppTxt = state.hidden[opp].alive ? '对手（隐藏）' : '已阵亡';
    redTokensEl.textContent   = (state.mySide === 'red')   ? hiddenStatusText('red')   : oppTxt;
    blackTokensEl.textContent = (state.mySide === 'black') ? hiddenStatusText('black') : oppTxt;
  } else if (state.gameMode === 'ai'){
    redTokensEl.textContent   = (state.aiSide === 'red')   ? '对手（隐藏）' : hiddenStatusText('red');
    blackTokensEl.textContent = (state.aiSide === 'black') ? '对手（隐藏）' : hiddenStatusText('black');
  } else {
    redTokensEl.textContent   = hiddenStatusText('red');
    blackTokensEl.textContent = hiddenStatusText('black');
  }

  const aiThinking = state.gameMode === 'ai' && state.turn === state.aiSide;
  const canEnd = !state.gameOver && !state.showGate && !aiThinking
                 && state.phase === 'postMove' && onlineCanAct()
                 && !state.isSpectator && state.gameMode !== 'replay';
  endBtn.disabled = !canEnd;
  endBtn.classList.toggle('ready', canEnd);   // 可结束时发光，提示玩家（跳过暗棋才需要点）

  // 观战 / 回放 时禁用"重新开始"按钮，避免误重启玩家对局
  newGameBtn.disabled = state.isSpectator || state.gameMode === 'replay';
  if (replayBarEl) replayBarEl.style.display = (state.gameMode === 'replay') ? 'flex' : 'none';
  renderRecord();

  // 悔棋 / 认输 / 聊天 / 段位 的可见性与可用性
  const playing = !state.isSpectator && state.gameMode !== 'replay';
  const onlineLike = isOnline() || state.isSpectator;
  if (undoBtnEl){
    undoBtnEl.style.display = playing ? '' : 'none';
    const undoSide = isOnline() ? state.mySide : (state.gameMode === 'ai' ? opponent(state.aiSide) : opponent(state.turn));
    const canUndo = playing && !state.gameOver && !state.showGate
                    && (isOnline() ? (!state.pending && Net.peerOnline && undoTargetIndex(state.mySide) >= 0)
                                   : undoTargetIndex(undoSide) >= 0);
    undoBtnEl.disabled = !canUndo;
  }
  if (resignBtnEl){
    resignBtnEl.style.display = playing ? '' : 'none';
    resignBtnEl.disabled = !playing || state.gameOver || state.showGate;
  }
  // 信息面板：联机/观战时聊天标签可用并默认显示；非联机自动切到规则标签
  if (chatPanelEl && rulesPanelEl && tabChatEl && tabRulesEl){
    if (!onlineLike){
      if (infoTab === 'chat') showInfoTab('rules');
      tabChatEl.disabled = true; tabChatEl.style.opacity = '0.5';
    } else {
      tabChatEl.disabled = false; tabChatEl.style.opacity = '1';
    }
  }
  if (ratingLineEl) ratingLineEl.style.display = onlineLike ? 'block' : 'none';
  // 战绩海报：联机时随时可生成；单机 / 人机则对局结束后才有意义
  if (posterBtnEl){
    const canPoster = state.gameMode === 'online' || state.gameOver;
    posterBtnEl.style.display = (canPoster && state.gameMode !== 'replay') ? '' : 'none';
    posterBtnEl.textContent = state.gameOver ? '🖼 晒战绩' : '🖼 战绩海报';
  }
  // AI 复盘按钮：对局结束后出现（需有走子记录），观战 / 回放不显示
  if (reviewBtnEl){
    const canReview = state.gameOver && isRealGame() && state.moveLog.length > 0;
    reviewBtnEl.style.display = canReview ? '' : 'none';
  }

  // —— FLIP 快照：重绘前记录每个棋子当前所在格，重绘后用 transform 过渡补间位移 ——
  const prevPos = new Map();
  if (!_applyingHistory){
    for (const el of Array.from(piecesEl.children)){
      if (!el.dataset.pk) continue;
      if (!prevPos.has(el.dataset.pk)) prevPos.set(el.dataset.pk, []);
      prevPos.get(el.dataset.pk).push({ r: +el.dataset.r, c: +el.dataset.c });
    }
  }
  piecesEl.innerHTML = '';
  hlEl.innerHTML = '';

  // 最后一步落点标记：from 空圈 + to 光圈（同一帧重复重绘不重放动画）
  if (lastMove){
    const fresh = lastMove.seq !== lastMarkShownSeq;
    lastMarkShownSeq = lastMove.seq;
    const mk = (cls, r, c) => {
      const m = document.createElement('div');
      m.className = 'last-mark ' + cls + (fresh ? '' : ' still');
      const half = (cls === 'from') ? 9 : 27;
      m.style.left = (MARGIN + c*CELL - half) + 'px';
      m.style.top  = (MARGIN + r*CELL - half) + 'px';
      hlEl.appendChild(m);
    };
    if (lastMove.fr >= 0) mk('from', lastMove.fr, lastMove.fc);
    mk('to', lastMove.tr, lastMove.tc);
  }

  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      const p = state.board[r][c];
      if (!p) continue;
      const overlap = hiddenAt(r, c) === viewerSide();
      const d = document.createElement('div');
      d.className = `piece ${p.owner}` + (overlap ? ' has-hidden' : '')
                    + (state.selected && state.selected.r === r && state.selected.c === c ? ' sel' : '');
      d.style.left = (MARGIN + c*CELL - PR) + 'px';
      d.style.top  = (MARGIN + r*CELL - PR) + 'px';
      d.textContent = CHARS[p.owner][p.type];
      d.dataset.pk = p.owner + ':' + p.type;
      d.dataset.r = r; d.dataset.c = c;
      piecesEl.appendChild(d);
      const slid = animateSlideIn(d, r, c, prevPos);
      if (lastMove && lastMove.tr === r && lastMove.tc === c && lastMove.seq !== landedShownSeq){
        // 刚落子的棋子弹性一跳；滑动未完成时等滑动结束再跳
        landedShownSeq = lastMove.seq;
        if (slid) setTimeout(() => d.classList.add('landed'), SLIDE_MS);
        else d.classList.add('landed');
      }
    }
  }
  // 将军：若轮到的一方主帅正被将军，在将/帅上叠加闪烁红环
  const kg = findGeneral(state.turn);
  if (kg && !state.gameOver && isInCheck(state.board, state.turn)){
    const ring = document.createElement('div');
    ring.className = 'check-ring';
    ring.style.left = (MARGIN + kg.c*CELL - PR - 4) + 'px';
    ring.style.top  = (MARGIN + kg.r*CELL - PR - 4) + 'px';
    hlEl.appendChild(ring);
  }
  if (state.gameMode === 'replay' && state.replayShowHidden){
    // 回放：显示本机已知坐标的暗棋（联机时只有自己的；本地双人/AI 两边都在本机则都显示）
    for (const o of ['red','black']){
      const hh = state.hidden[o];
      if (hh && hh.alive && hh.r >= 0 && hh.c >= 0 && !state.board[hh.r][hh.c]) renderHiddenPiece(hh, prevPos);
    }
  } else {
    const vs = viewerSide();
    const h = vs ? state.hidden[vs] : null;
    if (h && h.alive && h.r >= 0 && h.c >= 0 && !state.board[h.r][h.c]) renderHiddenPiece(h, prevPos);
  }

  if (state.selected){
    const lm = legalMovesForPiece(state.selected.r, state.selected.c);
    let di = 0;
    for (const [tr,tc] of lm){
      if (!Settings.get('showHighlights')) break;   // 关闭「高亮可走位置」时跳过落点指示（选中环仍保留）
      const cap = state.board[tr][tc];
      const dot = document.createElement('div');
      dot.className = 'dot' + (cap ? ' capture' : '');
      if (cap){ dot.style.left = (MARGIN + tc*CELL - 22) + 'px'; dot.style.top = (MARGIN + tr*CELL - 22) + 'px'; }
      else    { dot.style.left = (MARGIN + tc*CELL - 7)  + 'px'; dot.style.top = (MARGIN + tr*CELL - 7)  + 'px'; }
      dot.style.animationDelay = Math.min(di * 14, 140) + 'ms';   // 依次浮现，更有节奏感
      di++;
      hlEl.appendChild(dot);
    }
    const ring = document.createElement('div');
    ring.className = 'sel-ring';
    ring.style.left = (MARGIN + state.selected.c*CELL - 27) + 'px';
    ring.style.top  = (MARGIN + state.selected.r*CELL - 27) + 'px';
    hlEl.appendChild(ring);
  }
  // 暗棋可走点：只在"观看者本人"的回合高亮，绝不显示对手/AI 的暗棋去向
  if (state.phase === 'postMove' && state.turn === viewerSide()
      && state.hiddenReady[state.turn] && state.hidden[state.turn].alive){
    const lm = hiddenMoves(state.turn);
    let di = 0;
    for (const [tr,tc] of lm){
      if (!Settings.get('showHighlights')) break;
      const cap = state.board[tr][tc];
      const dot = document.createElement('div');
      dot.className = 'dot' + (cap ? ' capture' : '');
      if (cap){ dot.style.left = (MARGIN + tc*CELL - 22) + 'px'; dot.style.top = (MARGIN + tr*CELL - 22) + 'px'; }
      else    { dot.style.left = (MARGIN + tc*CELL - 7)  + 'px'; dot.style.top = (MARGIN + tr*CELL - 7)  + 'px'; }
      dot.style.animationDelay = Math.min(di * 14, 140) + 'ms';
      di++;
      hlEl.appendChild(dot);
    }
  }

  logEl.innerHTML = state.log.slice(-40).map(m => `<div>${m}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;

  if (state.showGate){
    gateEl.style.display = 'flex';
    gateTextEl.textContent = state.gameOver ? '游戏结束' : `轮到 ${NAME[state.turn]} 行动`;
    gateEl.querySelector('.gate-hint').textContent =
      state.gameOver ? '' : '请将设备交给对应玩家，准备好后点击继续（避免看到对方暗棋）';
  } else {
    gateEl.style.display = 'none';
  }

  // 胜负结算：游戏结束时弹出「某方胜利」全屏光芒动画（吃将终结则等斩将特效播完再弹）。
  // _victoryShown 避免 render 去重前/多次触发重复弹出；开始新对局时（newGame）会复位。
  if (state.gameOver && !state._victoryShown){
    state._victoryShown = true;
    const vDelay = state.decidedByGeneral ? 1000 : 600;
    setTimeout(() => showVictory(state.winner), vDelay);
  }
}

/* ===================== 初始化 ===================== */
/* =========================================================================
 * 段位天梯 / 赛季 / 综合成就 / 好友约战 / 新手教程 / AI 复盘 / 弹幕
 * 全部为「元数据 / 本机交互」，不涉及任何棋局规则或暗棋坐标，保密设计不破。
 * 其中天梯排行榜、赛季积分、好友关系、约战通知走服务器（server.js 新增接口）。
 * ========================================================================= */
const SEASON_SHIELD_CLIENT = 3;

function isRealGame(){
  return state && state.gameMode !== 'replay' && !state.isSpectator && !_spectateMode && !_applyingHistory;
}

/* ---------- 段位称号 ---------- */
const TIERS = [
  { name:'青铜', min:0,    color:'#8a5a2b' },
  { name:'白银', min:1100, color:'#9aa7b0' },
  { name:'黄金', min:1500, color:'#e6b422' },
  { name:'铂金', min:1700, color:'#3fb6c9' },
  { name:'钻石', min:1900, color:'#5ad1e6' },
  { name:'大师', min:2100, color:'#b96bff' },
  { name:'宗师', min:2300, color:'#ff7a59' },
  { name:'棋王', min:2500, color:'#ffd34d' }
];
function tierIndex(rating){ let i=0; for (let k=0;k<TIERS.length;k++) if (rating>=TIERS[k].min) i=k; return i; }
function tierOf(rating){ return TIERS[tierIndex(rating)]; }
function tierProgress(rating){ const i=tierIndex(rating), cur=TIERS[i], next=TIERS[i+1]; if(!next) return 100; return Math.max(0, Math.min(100, Math.round(((rating-cur.min)/(next.min-cur.min))*100))); }

let seasonInfo = null;          // 当前赛季信息（/api/season 返回）
function mySeasonRating(){ return seasonInfo && typeof seasonInfo.rating === 'number' ? seasonInfo.rating : myRating; }

function openLadder(){
  if (ladderModalEl) ladderModalEl.style.display = 'flex';
  loadSeasonInfo();
  loadLeaderboard();
}
async function loadSeasonInfo(){
  try {
    const r = await fetch('/api/season?clientId=' + encodeURIComponent(Net.clientId)).then(x => x.json());
    if (r && r.ok){ seasonInfo = r.player || { rating: myRating, shield: SEASON_SHIELD_CLIENT, gold:false }; }
    else seasonInfo = { rating: myRating, shield: SEASON_SHIELD_CLIENT, gold:false };
  } catch(e){ seasonInfo = { rating: myRating, shield: SEASON_SHIELD_CLIENT, gold:false }; }
  renderLadderMy();
}
function renderLadderMy(){
  if (!ladderMyEl) return;
  const rating = mySeasonRating();
  const ti = tierOf(rating);
  const i = tierIndex(rating), next = TIERS[i+1];
  const prog = tierProgress(rating);
  ladderMyEl.innerHTML =
    `当前段位：<b style="color:${ti.color}">${ti.name}</b>　·　赛季分 <b>${rating}</b>` +
    (seasonInfo && seasonInfo.gold ? '　🥈黄金' : '') +
    `　🛡️护盾 <b>${seasonInfo ? seasonInfo.shield : SEASON_SHIELD_CLIENT}</b>/${SEASON_SHIELD_CLIENT}`;
  if (ladderBarEl){ ladderBarEl.style.width = prog + '%'; ladderBarEl.style.background = ti.color; }
  if (ladderNextEl) ladderNextEl.textContent = next ? (`距 ${next.name} 还需 ${next.min - rating} 分`) : '已封顶 · 棋王';
  if (ladderSeasonEl) ladderSeasonEl.textContent = seasonInfo && seasonInfo.season ? '' : '';
}
async function loadLeaderboard(){
  if (!leaderboardEl) return;
  leaderboardEl.innerHTML = '加载中…';
  try {
    const r = await fetch('/api/leaderboard').then(x => x.json());
    if (!r || !r.ok){ leaderboardEl.innerHTML = '排行榜加载失败'; return; }
    if (r.season) { if (ladderSeasonEl) ladderSeasonEl.textContent = '（' + r.season + '）'; }
    if (!r.list || !r.list.length){ leaderboardEl.innerHTML = '<div class="lb-empty">本赛季还没有排行榜数据，快去打排位赛吧！</div>'; return; }
    let html = '';
    r.list.forEach((p, idx) => {
      const ti = tierOf(p.rating);
      const me = (p.cid === Net.clientId) ? ' lb-me' : '';
      html += `<div class="lb-row${me}"><span class="lb-rank">${idx+1}</span>` +
              `<span class="lb-name">玩家${escapeHtml(String(p.cid).slice(-4))}</span>` +
              `<span class="lb-tier" style="color:${ti.color}">${ti.name}</span>` +
              `<span class="lb-rating">${p.rating}</span>` +
              `<span class="lb-wl">${p.wins}胜${p.losses}负</span></div>`;
    });
    leaderboardEl.innerHTML = html;
  } catch(e){ leaderboardEl.innerHTML = '排行榜加载失败'; }
}

/* ---------- 综合成就 ---------- */
const STATS_KEY = 'xq_stats', ACH_KEY = 'xq_ach';
function loadStats(){ try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch(e){ return {}; } }
function saveStats(s){ try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch(e){} }
function loadAch(){ try { return JSON.parse(localStorage.getItem(ACH_KEY)) || {}; } catch(e){ return {}; } }
function saveAch(a){ try { localStorage.setItem(ACH_KEY, JSON.stringify(a)); } catch(e){} }

const ACHIEVEMENTS = [
  { id:'first_win',  name:'旗开得胜', icon:'🥇', desc:'赢得第一局',          check:s=> s.wins>=1 },
  { id:'streak3',   name:'三连胜',   icon:'🔥', desc:'连续赢 3 局',          check:s=> s.maxStreak>=3 },
  { id:'streak5',   name:'五连胜',   icon:'⚡', desc:'连续赢 5 局',          check:s=> s.maxStreak>=5 },
  { id:'streak10',  name:'十连胜',   icon:'👑', desc:'连续赢 10 局',         check:s=> s.maxStreak>=10 },
  { id:'games10',   name:'小试牛刀', icon:'🎯', desc:'累计 10 局',           check:s=> s.games>=10 },
  { id:'games50',   name:'棋逢对手', icon:'♟️', desc:'累计 50 局',           check:s=> s.games>=50 },
  { id:'games100',  name:'百战不殆', icon:'🏯', desc:'累计 100 局',          check:s=> s.games>=100 },
  { id:'ranked_win',name:'初登天梯', icon:'🏆', desc:'排位赛获胜 1 次',      check:s=> s.rankedWins>=1 },
  { id:'rank_gold', name:'黄金棋手', icon:'🥈', desc:'赛季分达 1500（黄金）', check:s=> s.seasonGold },
  { id:'invite1',   name:'广结棋缘', icon:'🤝', desc:'邀请 1 位好友',        check:s=> s.invites>=1 },
  { id:'invite5',   name:'呼朋唤友', icon:'📣', desc:'邀请 5 位好友',        check:s=> s.invites>=5 },
  { id:'spectate1', name:'旁观者清', icon:'👁️', desc:'观战 1 局',           check:s=> s.spectates>=1 },
  { id:'undo1',     name:'悔不当初', icon:'↩️', desc:'发起悔棋 1 次',        check:s=> s.undos>=1 },
  { id:'win_ai',    name:'人机过关', icon:'🤖', desc:'战胜 AI',             check:s=> s.aiWins>=1 }
];
let seasonGoldFlag = false;
function buildStats(){
  const s = loadStats();
  s.wins = s.wins||0; s.losses = s.losses||0; s.games = s.games||0;
  s.maxStreak = s.maxStreak||0; s.curStreak = s.curStreak||0;
  s.rankedWins = s.rankedWins||0; s.aiWins = s.aiWins||0;
  s.spectates = s.spectates||0; s.undos = s.undos||0;
  s.invites = myInvitedCount||0;
  s.seasonGold = seasonGoldFlag;
  return s;
}
function refreshAchievements(){
  const s = buildStats();
  const got = loadAch();
  let newly = 0;
  for (const a of ACHIEVEMENTS){
    if (!got[a.id] && a.check(s)){ got[a.id] = Date.now(); newly++; }
  }
  if (newly){ saveAch(got); showToast('🏅 解锁了 ' + newly + ' 个新成就！去「成就」看看', 'kill'); if (achGridEl && achModalEl && achModalEl.style.display !== 'none') renderAch(); }
}
function renderAch(){
  if (!achGridEl) return;
  const got = loadAch();
  const s = buildStats();
  let html = '';
  for (const a of ACHIEVEMENTS){
    const unlocked = !!got[a.id];
    html += `<div class="ach-cell${unlocked?' on':''}">` +
              `<div class="ach-ico">${a.icon}</div>` +
              `<div class="ach-name">${a.name}</div>` +
              `<div class="ach-desc">${a.desc}</div>` +
              `<div class="ach-state">${unlocked ? '✅ 已解锁' : '🔒 未解锁'}</div>` +
            `</div>`;
  }
  achGridEl.innerHTML = html;
}
function openAch(){ if (achModalEl) achModalEl.style.display = 'flex'; renderAch(); }

/* ---------- 好友 + 约战 ---------- */
function openFriends(){ if (friendsModalEl) friendsModalEl.style.display = 'flex'; loadFriends(); }
async function loadFriends(){
  if (!friendListEl) return;
  friendListEl.innerHTML = '加载中…';
  try {
    const r = await fetch('/api/friend/list?cid=' + encodeURIComponent(Net.clientId)).then(x => x.json());
    const list = (r && r.ok && r.list) ? r.list : [];
    if (!list.length){ friendListEl.innerHTML = '<div class="lb-empty">还没有好友，输入对方邀请码添加吧。</div>'; return; }
    let html = '';
    for (const f of list){
      html += `<div class="friend-row">` +
        `<span class="fr-name">${escapeHtml(f.name || '好友')}</span>` +
        `<span class="fr-code">${escapeHtml(f.code)}</span>` +
        `<span class="fr-online ${f.online?'on':''}">${f.online?'🟢在线':'⚪离线'}</span>` +
        `<button class="btn sm fr-challenge" data-code="${escapeHtml(f.code)}" ${f.online?'':'disabled'}>约战</button>` +
        `<button class="btn sm danger fr-remove" data-code="${escapeHtml(f.code)}">删除</button>` +
      `</div>`;
    }
    friendListEl.innerHTML = html;
    friendListEl.querySelectorAll('.fr-challenge').forEach(b => b.addEventListener('click', () => challengeFriend(b.getAttribute('data-code'))));
    friendListEl.querySelectorAll('.fr-remove').forEach(b => b.addEventListener('click', () => removeFriend(b.getAttribute('data-code'))));
  } catch(e){ friendListEl.innerHTML = '好友列表加载失败'; }
}
async function addFriend(){
  if (!friendCodeEl) return;
  const code = (friendCodeEl.value || '').trim().toUpperCase();
  const name = (friendNameEl.value || '').trim();
  if (!code){ showToast('请输入好友邀请码', 'check'); return; }
  try {
    const r = await fetch('/api/friend/add', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ cid: Net.clientId, code, name }) }).then(x => x.json());
    if (r && r.ok){ showToast('✅ 好友已添加', 'check'); if (friendCodeEl) friendCodeEl.value=''; if (friendNameEl) friendNameEl.value=''; loadFriends(); }
    else if (r && r.reason === 'self') showToast('不能添加自己', 'check');
    else if (r && r.dup) showToast('已是好友', 'check');
    else showToast('邀请码无效', 'check');
  } catch(e){ showToast('添加失败', 'check'); }
}
async function removeFriend(code){
  try {
    await fetch('/api/friend/remove', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ cid: Net.clientId, code }) }).then(x => x.json());
    loadFriends();
  } catch(e){}
}
async function challengeFriend(code){
  if (!code) return;
  if (!Net.joined || Net.role === 'spectator'){
    const room = Math.random().toString(36).slice(2,6).toUpperCase();
    roomInput.value = room;
    if (joinBtn) joinBtn.click();
    await new Promise(r => setTimeout(r, 400));
  }
  const room = Net.room;
  if (!room){ showToast('请先进入一个房间再约战', 'check'); return; }
  try {
    await fetch('/api/im/send', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ from: Net.clientId, to: code, type:'challenge', data:{ room, fromName:'棋友' } }) });
    showToast('已向好友发送约战，等他接受…', 'check');
  } catch(e){ showToast('约战发送失败', 'check'); }
}
let pendingChallengeRoom = null;
function onChallenge(d){
  if (!d || !d.room) return;
  pendingChallengeRoom = d.room;
  showToast('📨 ' + (d.fromName || '好友') + ' 邀你约战！房间 ' + d.room + '（点击加入）', 'kill', 9000);
  if (toastEl) toastEl.onclick = () => {
    if (pendingChallengeRoom){ roomInput.value = pendingChallengeRoom; if (joinBtn) joinBtn.click(); pendingChallengeRoom = null; toastEl.onclick = null; }
  };
}

/* ---------- 新手教程 ---------- */
const TUTORIAL_STEPS = [
  '👋 欢迎来到「暗棋象棋」！它在传统象棋里藏一枚只有你自己能看见的「暗棋」，是对手的盲点。点「下一步」快速上手。',
  '♟️ 棋盘就是标准象棋盘。每回合你先走 1 步普通棋子（车马炮兵将士象），走完轮到对方。',
  '🌑 暗棋：每走 2 步普通棋子，你的暗棋就「就绪」一次。就绪后棋盘会高亮它的可走格，点高亮格即可走暗棋（也可点右侧「结束回合」跳过）。',
  '💥 暗棋很猛：可主动吃掉敌子并存活，或挡在路径上让对方棋子撞上、同归于尽。它不占单独回合，是翻盘利器。',
  '🏁 目标：吃掉对方「将/帅」即获胜。被将军不强制应将，可等暗棋就绪后去吃掉将军的子解围。',
  '🌐 想联机？主菜单「开始游戏」选匹配/排位，或「开房间」把链接发好友。暗棋位置只存在你电脑，对方看不到。',
  '🎉 搞定！随时在主菜单点「新手教程」重看。祝旗开得胜！'
];
let tutorialIdx = 0;
function startTutorial(){
  if (tutorialModalEl) tutorialModalEl.style.display = 'flex';
  tutorialIdx = 0;
  showTutorialStep();
}
function showTutorialStep(){
  if (!tutorialTextEl) return;
  tutorialTextEl.textContent = TUTORIAL_STEPS[tutorialIdx];
  if (tutorialNextEl) tutorialNextEl.textContent = (tutorialIdx >= TUTORIAL_STEPS.length-1) ? '完成' : '下一步';
  if (tutorialDotsEl){
    let h = '';
    for (let i=0;i<TUTORIAL_STEPS.length;i++) h += `<span class="td-dot${i===tutorialIdx?' on':''}"></span>`;
    tutorialDotsEl.innerHTML = h;
  }
}
function endTutorial(){ try { localStorage.setItem('xq_tutorial_done', '1'); } catch(e){} if (tutorialModalEl) tutorialModalEl.style.display = 'none'; }

/* ---------- AI 复盘分析（启发式：基于子力得失） ---------- */
function analyzeGame(log){
  if (!log || !log.length) return { score: 100, moves: [] };
  const board = initialBoard();   // 从标准开局重建（暗棋身份未知，按"不可见"处理，不影响子力统计）
  const out = [];
  let score = 100;
  const mat = (b, side) => { let s=0; for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++){ const p=b[r][c]; if (p && p.owner===side && p.type!=='hidden') s += (PIECE_VALUE[p.type]||0); } return s; };
  for (let i=0;i<log.length;i++){
    const m = log[i];
    if (!m) continue;
    const opp = opponent(m.side);
    if (m.byHidden){
      const h = board[m.fr] && board[m.fr][m.fc];
      board[m.tr][m.tc] = h || { owner:m.side, type:'hidden' };
      board[m.fr][m.fc] = null;
    } else {
      const p = board[m.fr][m.fc];
      board[m.tr][m.tc] = p; board[m.fr][m.fc] = null;
    }
    const next = log[i+1];
    let label = '中性', cls = '';
    const blunder = !!(next && next.side === opp && !next.byHidden && next.tr === m.tr && next.tc === m.tc && next.captured);
    const goodCap = !!(m.captured && (PIECE_VALUE[m.captured]||0) >= 40);
    if (blunder){ label = '失误'; cls = 'bad'; score -= Math.min(18, (PIECE_VALUE[next.captured]||10)); }
    else if (goodCap){ label = '好棋'; cls = 'good'; score += 4; }
    out.push({ n:i+1, side:m.side, label, cls, from:m.fr+','+m.fc, to:m.tr+','+m.tc, captured:m.captured||null });
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, moves: out };
}
function openReview(){
  if (reviewModalEl) reviewModalEl.style.display = 'flex';
  const log = (state && state.moveLog) ? state.moveLog : [];
  if (!log.length){ if (reviewScoreEl) reviewScoreEl.innerHTML = '本局还没有可复盘的记录'; if (reviewListEl) reviewListEl.innerHTML = ''; return; }
  const res = analyzeGame(log);
  if (reviewScoreEl){
    const grade = res.score>=85?'S':res.score>=70?'A':res.score>=55?'B':res.score>=40?'C':'D';
    reviewScoreEl.innerHTML = `本局综合评分：<b class="rv-${grade}">${res.score} 分（${grade}）</b><span class="rv-note">· 基于子力得失的启发式复盘</span>`;
  }
  if (reviewListEl){
    let html = '';
    for (const mv of res.moves){
      const cap = mv.captured ? (' 吃' + (mv.captured==='hidden'?'暗棋':'子')) : '';
      html += `<div class="rv-row ${mv.cls}"><span class="rv-n">${mv.n}</span>` +
              `<span class="rv-side">${NAME[mv.side]}</span>` +
              `<span class="rv-move">${mv.from} → ${mv.to}${cap}</span>` +
              `<span class="rv-label ${mv.cls}">${mv.label}</span></div>`;
    }
    reviewListEl.innerHTML = html;
  }
}

/* ---------- 弹幕 ---------- */
function sendDanmaku(text){
  text = (text || '').trim();
  if (!text) return;
  if (!isOnline() && !state.isSpectator) { showToast('进入联机对战或观战才能发弹幕', 'check'); return; }
  netSend('danmaku', { text: text.slice(0,30), from: Net.side });
  renderDanmaku(text, Net.side);   // 自己这边也飘一下
}
function renderDanmaku(text, from){
  if (!danmakuLayerEl) return;
  const d = document.createElement('div');
  d.className = 'danmaku-item' + (from === 'black' ? ' black' : '');
  d.textContent = text;
  const top = 8 + Math.floor(Math.random() * 70);
  d.style.top = top + '%';
  d.style.animationDuration = (6 + Math.random() * 3) + 's';
  danmakuLayerEl.appendChild(d);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 9500);
}

/* ---------- 统一初始化新功能 UI ---------- */
function setupFeatures(){
  ladderModalEl   = document.getElementById('ladderModal');
  ladderMyEl      = document.getElementById('ladderMy');
  ladderBarEl     = document.getElementById('ladderBar');
  ladderNextEl    = document.getElementById('ladderNext');
  ladderSeasonEl  = document.getElementById('ladderSeason');
  leaderboardEl   = document.getElementById('leaderboard');
  achModalEl      = document.getElementById('achModal');
  achGridEl       = document.getElementById('achGrid');
  friendsModalEl  = document.getElementById('friendsModal');
  friendCodeEl    = document.getElementById('friendCode');
  friendNameEl    = document.getElementById('friendName');
  friendAddBtnEl  = document.getElementById('friendAddBtn');
  friendListEl    = document.getElementById('friendList');
  tutorialModalEl = document.getElementById('tutorialModal');
  tutorialTextEl  = document.getElementById('tutorialText');
  tutorialSkipEl  = document.getElementById('tutorialSkip');
  tutorialNextEl  = document.getElementById('tutorialNext');
  tutorialDotsEl  = document.getElementById('tutorialDots');
  reviewModalEl   = document.getElementById('reviewModal');
  reviewScoreEl   = document.getElementById('reviewScore');
  reviewListEl    = document.getElementById('reviewList');
  danmakuLayerEl  = document.getElementById('danmakuLayer');
  danmakuInputEl  = document.getElementById('danmakuInput');
  danmakuSendEl   = document.getElementById('danmakuSend');

  // 胜利结算弹窗元素
  victoryEl           = document.getElementById('victory');
  victoryTextEl       = document.getElementById('victoryText');
  victorySubEl        = document.getElementById('victorySub');
  victoryRestartBtn   = document.getElementById('victoryRestartBtn');
  victoryCloseBtn     = document.getElementById('victoryCloseBtn');
  if (victoryRestartBtn) victoryRestartBtn.addEventListener('click', () => {
    if (state.isSpectator || state.gameMode === 'replay') return;
    const wasOnline = isOnline() && !state.isSpectator;
    hideVictory();
    newGame();
    if (wasOnline) netSend('restart', {});   // 联机时通知对手一起重开，保证两边棋盘一致
    render();
  });
  if (victoryCloseBtn) victoryCloseBtn.addEventListener('click', hideVictory);

  // 通用关闭按钮
  document.querySelectorAll('[data-close]').forEach(b => {
    b.addEventListener('click', () => { const m = document.getElementById(b.getAttribute('data-close')); if (m) m.style.display = 'none'; });
  });
  // 点遮罩空白处关闭弹窗
  [ladderModalEl, achModalEl, friendsModalEl, reviewModalEl].forEach(m => {
    if (m) m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });

  // 音频解锁：QQ/微信 web-view 中 AudioContext 需用户手势才能出声，首次触摸/点击时 resume 一次
  const unlockAudio = () => { try { Sound.init(); if (typeof Music !== 'undefined') Music.ensure(); } catch(e){} };
  ['pointerdown', 'touchstart', 'click'].forEach(ev =>
    document.addEventListener(ev, unlockAudio, { once: false, passive: true }));

  if (friendAddBtnEl) friendAddBtnEl.addEventListener('click', addFriend);
  if (tutorialSkipEl) tutorialSkipEl.addEventListener('click', endTutorial);
  if (tutorialNextEl) tutorialNextEl.addEventListener('click', () => {
    if (tutorialIdx >= TUTORIAL_STEPS.length-1){ endTutorial(); }
    else { tutorialIdx++; showTutorialStep(); }
  });
  if (danmakuSendEl) danmakuSendEl.addEventListener('click', () => { if (danmakuInputEl){ sendDanmaku(danmakuInputEl.value); danmakuInputEl.value=''; } });
  if (danmakuInputEl) danmakuInputEl.addEventListener('keydown', e => { if (e.key === 'Enter'){ sendDanmaku(danmakuInputEl.value); danmakuInputEl.value=''; } });
  document.querySelectorAll('.dm-emoji').forEach(b => b.addEventListener('click', () => sendDanmaku(b.getAttribute('data-dm'))));

  // 复盘按钮：动态挂到操作栏（对局结束后出现）
  const ar = document.querySelector('.action-row');
  if (ar && !document.getElementById('reviewBtn')){
    reviewBtnEl = document.createElement('button');
    reviewBtnEl.id = 'reviewBtn'; reviewBtnEl.className = 'btn sm'; reviewBtnEl.textContent = '🤖 复盘';
    reviewBtnEl.style.display = 'none';
    reviewBtnEl.addEventListener('click', openReview);
    ar.appendChild(reviewBtnEl);
  }
}

function init(){
  const boardEl = document.getElementById('board');
  boardEl.style.width  = (MARGIN*2 + 8*CELL) + 'px';
  boardEl.style.height = (MARGIN*2 + 9*CELL) + 'px';
  boardEl.innerHTML =
    `<div class="layer" id="svgLayer"></div>` +
    `<div class="layer" id="highlights"></div>` +
    `<div class="layer" id="pieces"></div>` +
    `<div class="layer" id="fxLayer"></div>` +
    `<div class="layer" id="hits"></div>` +
    `<button id="endBtn" class="end-turn-board" disabled>结束回合</button>`;
  document.getElementById('svgLayer').innerHTML = buildBoardSVG();

  piecesEl       = document.getElementById('pieces');
  hitsEl         = document.getElementById('hits');
  hlEl           = document.getElementById('highlights');
  fxEl           = document.getElementById('fxLayer');
  statusEl       = document.getElementById('status');
  logEl          = document.getElementById('log');
  endBtn         = document.getElementById('endBtn');
  newGameBtn     = document.getElementById('newGameBtn');
  redTokensEl    = document.getElementById('redTokens');
  blackTokensEl  = document.getElementById('blackTokens');
  gateEl         = document.getElementById('gate');
  gateTextEl     = document.getElementById('gateText');
  gateBtn        = document.getElementById('gateBtn');
  handoffEl      = document.getElementById('handoff');
  handoffTextEl  = document.getElementById('handoffText');
  if (handoffEl) handoffEl.addEventListener('click', (e) => { e.stopPropagation(); hideHandoff(); });   // 点一下立即开始，不必等自动消失
  toastEl        = document.getElementById('toast');
  modeSel        = document.getElementById('modeSel');
  aiSideSel      = document.getElementById('aiSideSel');
  diffSel        = document.getElementById('diffSel');
  applyBtn       = document.getElementById('applyBtn');
  aiOptsEl       = document.getElementById('aiOpts');
  onlineOptsEl   = document.getElementById('onlineOpts');
  roomInput      = document.getElementById('roomInput');
  joinBtn        = document.getElementById('joinBtn');
  netInfoEl      = document.getElementById('netInfo');
  inviteBoxEl    = document.getElementById('inviteBox');
  matchBtn       = document.getElementById('matchBtn');
  createBtn      = document.getElementById('createBtn');
  matchStatusEl  = document.getElementById('matchStatus');
  cancelMatchBtn = document.getElementById('cancelMatchBtn');
  spectateBtn      = document.getElementById('spectateBtn');
  recordBoxEl      = document.getElementById('recordBox');
  replayBtn        = document.getElementById('replayBtn');
  replayPanelEl    = document.getElementById('replayPanel');
  replayListEl     = document.getElementById('replayList');
  replayPlayBtn    = document.getElementById('replayPlayBtn');
  replayImportBtn  = document.getElementById('replayImportBtn');
  replayFileEl     = document.getElementById('replayFile');
  replayBarEl      = document.getElementById('replayBar');
  replayRestartBtn = document.getElementById('replayRestartBtn');
  replayStepBtn    = document.getElementById('replayStepBtn');
  replaySliderEl   = document.getElementById('replaySlider');
  replayStepEl     = document.getElementById('replayStepEl');
  replayShowHiddenEl = document.getElementById('replayShowHidden');
  chatPanelEl      = document.getElementById('chatPanel');
  rulesPanelEl     = document.getElementById('rulesPanel');
  infoPanelEl      = document.getElementById('infoPanel');
  tabChatEl        = document.getElementById('tabChat');
  tabRulesEl       = document.getElementById('tabRules');
  infoCollapseEl   = document.getElementById('infoCollapse');
  chatMsgsEl       = document.getElementById('chatMsgs');
  chatInputEl      = document.getElementById('chatInput');
  chatSendEl       = document.getElementById('chatSend');
  // 信息面板：聊天/规则 标签切换 + 收起
  if (tabChatEl)  tabChatEl.addEventListener('click', () => showInfoTab('chat'));
  if (tabRulesEl) tabRulesEl.addEventListener('click', () => showInfoTab('rules'));
  if (infoCollapseEl) infoCollapseEl.addEventListener('click', () => {
    if (!infoPanelEl) return;
    infoCollapsed = !infoCollapsed;
    infoPanelEl.classList.toggle('collapsed', infoCollapsed);
  });
  showInfoTab('chat');   // 默认显示联机聊天
  ratingLineEl     = document.getElementById('ratingLine');
  soundBtnEl       = document.getElementById('soundBtn');
  undoBtnEl        = document.getElementById('undoBtn');
  resignBtnEl      = document.getElementById('resignBtn');
  undoPromptEl     = document.getElementById('undoPrompt');
  inviteBtnEl      = document.getElementById('inviteBtn');
  invitePanelEl    = document.getElementById('invitePanel');
  inviteLinkEl     = document.getElementById('inviteLink');
  inviteStatEl     = document.getElementById('inviteStat');
  inviteCopyBtn    = document.getElementById('inviteCopyBtn');
  invitePosterBtn  = document.getElementById('invitePosterBtn');
  posterBtnEl      = document.getElementById('posterBtn');
  posterModalEl    = document.getElementById('posterModal');
  posterImgEl      = document.getElementById('posterImg');
  menuEl           = document.getElementById('menu');
  menuMainEl       = document.getElementById('menuMain');
  menuStartEl      = document.getElementById('menuStart');
  menuStartBtnEl   = document.getElementById('menuStartBtn');
  menuBackBtnEl    = document.getElementById('menuBackBtn');
  menuHomeBtnEl    = document.getElementById('menuHomeBtn');

  setupMenu();
  setupSettings();
  setupNetHandlers();
  setupFeatures();   // 段位天梯 / 成就 / 好友 / 新手引导 / 复盘 / 弹幕 等新增模块的元素绑定
  Net.startIM();     // 启动全局私信长轮询（好友约战通知即使不在房间也能收到）

  function applySettings(){
    config.mode = modeSel.value;
    config.aiSide = aiSideSel.value;
    config.difficulty = diffSel.value;
    newGame();
    state.showGate = (config.mode === 'pvp');   // 只有同屏双人才需要交接遮罩
    render();
    if (state.gameMode === 'ai' && !state.gameOver && state.turn === state.aiSide) scheduleAI();
  }
  modeSel.addEventListener('change', () => {
    if (Net.joined && modeSel.value !== 'online') Net.leave();   // 离开观战时停止长轮询
    aiOptsEl.style.display     = modeSel.value === 'ai'     ? 'block' : 'none';
    onlineOptsEl.style.display = modeSel.value === 'online' ? 'block' : 'none';
    applySettings();                            // 切换模式立即生效，避免忘记点"应用"
  });
  applyBtn.addEventListener('click', applySettings);

  async function doJoin(){
    if (Net.joined) Net.leave();               // 若正在观战，先退出再作为玩家进房
    const room = (roomInput.value || '').trim();
    if (!room){ setNetInfo('请先填写房间号（双方必须一致）', 'err'); return; }
    setNetInfo('正在连接服务器…', 'wait');
    joinBtn.disabled = true;
    let r = null;
    try { r = await Net.join(room); } catch(e){ /* 下面统一处理 */ }
    joinBtn.disabled = false;
    if (!r || !r.ok){ setNetInfo('❌ ' + ((r && r.error) || '连接失败，请确认服务器已启动'), 'err'); return; }
    showInvite(room);
  }
  joinBtn.addEventListener('click', doJoin);
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

  // —— 随机匹配：系统自动找对手。ranked=true 为排位赛（影响段位），false 为休闲匹配（不计分）——
  function startMatch(ranked){
    if (!Settings.get('allowMatch')){
      showToast('已关闭「随机匹配」：去 设置 → 隐私 打开「允许被随机匹配」', 'check');
      return;
    }
    if (Net.joined) Net.leave();            // 若正在观战，先退出
    config.mode = 'online';
    modeSel.value = 'online';
    onlineOptsEl.style.display = 'block';
    stateRanked = !!ranked;
    if (matchStatusEl){
      matchStatusEl.style.display = 'block';
      matchStatusEl.className = 'net-info wait';
      matchStatusEl.innerHTML = (stateRanked ? '🏆 排位赛：' : '🎲 休闲匹配：') + '正在为你匹配对手…（可随时点「取消匹配」）';
    }
    if (cancelMatchBtn) cancelMatchBtn.style.display = 'block';
    if (matchBtn)       matchBtn.disabled = true;
    if (createBtn)      createBtn.disabled = true;
    Net.match(stateRanked);
  }

  // —— 创建房间：生成一个房间号，并直接给出可分享的邀请链接（休闲模式，不计段位）——
  function createRoom(){
    if (Net.joined) Net.leave();            // 若正在观战，先退出
    config.mode = 'online';
    modeSel.value = 'online';
    onlineOptsEl.style.display = 'block';
    stateRanked = false;
    const id = Math.random().toString(36).slice(2, 6).toUpperCase();   // 4 位房间号
    roomInput.value = id;
    setNetInfo('🚪 房间已创建（休闲模式，不计段位）。把邀请链接发给好友即可开战。', 'wait');
    doJoin();
  }

  // 修复：原来直接传 startMatch，click 事件对象会被当成 ranked 参数（truthy），
  // 导致「随机匹配」被算成排位赛、错算 ELO 段位分。
  if (matchBtn)       matchBtn.addEventListener('click', () => startMatch(false));
  if (createBtn)      createBtn.addEventListener('click', createRoom);
  if (cancelMatchBtn) cancelMatchBtn.addEventListener('click', () => { Net.cancelMatch(); });
  // 暴露给顶层 setupMenu 调用——修复主菜单「匹配/排位赛/开房间」点击无反应
  window.__startMatch = startMatch;
  window.__createRoom = createRoom;

  // —— 观战：输入房间号后点「观战」，以旁观者身份进房看棋 ——
  if (spectateBtn) spectateBtn.addEventListener('click', () => {
    const room = (roomInput.value || '').trim();
    if (!room){ setNetInfo('请先填写要观战的房间号', 'err'); return; }
    if (Net.joined) Net.leave();
    config.mode = 'online';
    modeSel.value = 'online';
    onlineOptsEl.style.display = 'block';
    setNetInfo('正在进入观战…', 'wait');
    Net.spectate(room);
    const s=loadStats(); s.spectates=(s.spectates||0)+1; saveStats(s); refreshAchievements();
  });

  // —— 回放面板：列出本机存档 + 导入文件 + 播放控制 ——
  if (replayBtn) replayBtn.addEventListener('click', () => {
    const show = replayPanelEl.style.display !== 'block';
    replayPanelEl.style.display = show ? 'block' : 'none';
    if (show) refreshReplayList();
  });
  function refreshReplayList(){
    const list = loadReplayList();
    replayListEl.innerHTML = '';
    if (!list.length){ replayListEl.innerHTML = '<option value="">（暂无存档回放，打完一局会自动保存）</option>'; return; }
    for (let i = 0; i < list.length; i++){
      const o = document.createElement('option');
      o.value = String(i);
      const d = new Date(list[i].ts);
      o.textContent = d.toLocaleString() + ' · ' + (list[i].room || '') + ' · ' + (list[i].count || 0) + ' 步';
      replayListEl.appendChild(o);
    }
  }
  if (replayPlayBtn) replayPlayBtn.addEventListener('click', () => {
    const list = loadReplayList();
    const idx = Number(replayListEl.value);
    if (!list[idx]) return;
    if (Replay._key !== idx){
      Replay.load(list[idx].msgs, (list[idx].room || '') + ' @ ' + new Date(list[idx].ts).toLocaleString());
      Replay._key = idx;
    }
    if (Replay.playing) Replay.stop(); else Replay.play();
  });
  if (replayImportBtn) replayImportBtn.addEventListener('click', () => replayFileEl.click());
  if (replayFileEl) replayFileEl.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        const msgs = Array.isArray(data) ? data : (data.msgs || []);
        Replay.load(msgs, '导入：' + f.name);
        Replay._key = -1;
      } catch(err){ showToast('回放文件解析失败', 'check'); }
    };
    rd.readAsText(f);
  });
  if (replayRestartBtn) replayRestartBtn.addEventListener('click', () => Replay.seek(0));
  if (replayStepBtn)    replayStepBtn.addEventListener('click', () => { Replay.stop(); Replay.step(); });
  if (replaySliderEl)   replaySliderEl.addEventListener('input', () => Replay.seek(Number(replaySliderEl.value)));
  if (replayShowHiddenEl) replayShowHiddenEl.addEventListener('change', () => {
    Replay.showHidden = replayShowHiddenEl.checked;
    if (state.gameMode === 'replay'){ state.replayShowHidden = Replay.showHidden; render(); }
  });

  // 通过邀请链接 ?room=xxx 打开时：预填房间号、切到联机面板
  // （真正进房放在 init 末尾统一处理，避免与自动续局重复进房）
  const qRoom = new URLSearchParams(location.search).get('room');
  if (qRoom && state.gameMode !== 'online'){
    modeSel.value = 'online';
    aiOptsEl.style.display = 'none';
    onlineOptsEl.style.display = 'block';
    roomInput.value = qRoom;
    config.mode = 'online';
    showToast('🔗 已通过邀请链接进入房间 ' + qRoom, 'check');
  }

  buildHits();
  computeBoardScale();
  window.addEventListener('resize', computeBoardScale);
  window.addEventListener('orientationchange', () => setTimeout(computeBoardScale, 120));  // 移动端旋转后重算棋盘缩放

  endBtn.addEventListener('click', () => {
    if (state.gameOver || state.showGate) return;
    if (state.phase !== 'postMove') return;
    if (isOnline()){
      if (!onlineCanAct()) return;
      netSend('endturn', {});
    }
    state.mode = 'normal';
    endTurn();
    render();
  });
  newGameBtn.addEventListener('click', () => {
    if (state.isSpectator || state.gameMode === 'replay') return;   // 观战/回放时禁用
    const wasOnline = isOnline() && !state.isSpectator;
    newGame();
    if (wasOnline) netSend('restart', {});   // 联机时通知对手一起重开，保证两边棋盘一致
    render();
  });

  // —— 悔棋 ——
  function onUndoClick(){
    Sound.init();
    if (state.gameOver || state.showGate || state.isSpectator || state.gameMode === 'replay') return;
    if (isOnline()){
      if (state.pending){ showToast('⏳ 还有着法在等待对手确认，稍后再悔棋', 'check'); return; }
      if (undoTargetIndex(state.mySide) < 0){ showToast('暂无可悔的棋步', 'check'); return; }
      netSend('undoRequest', { side: state.mySide });   // 联机需对手同意
      { const s=loadStats(); s.undos=(s.undos||0)+1; saveStats(s); refreshAchievements(); }
      showToast('🔄 已请求悔棋，等待对手同意…', 'check');
      undoBtnEl.disabled = true;
    } else {
      const side = state.gameMode === 'ai' ? opponent(state.aiSide) : opponent(state.turn);
      if (performUndo(side)) showToast('🔄 已退回上一步', 'check');
      else showToast('暂无可悔的棋步', 'check');
    }
  }
  // —— 认输 ——
  function onResignClick(){
    Sound.init();
    if (state.gameOver || state.showGate || state.isSpectator || state.gameMode === 'replay') return;
    if (!confirm('确定认输吗？本局将判你负。')) return;
    let loser, winner;
    if (isOnline()){ loser = state.mySide; winner = opponent(state.mySide); }
    else if (state.gameMode === 'ai'){ loser = opponent(state.aiSide); winner = state.aiSide; }
    else { loser = state.turn; winner = opponent(state.turn); }
    if (isOnline()) netSend('resign', { side: loser });   // 通知对手
    state.gameOver = true;
    state.winner = winner;
    log(`🏳️ ${NAME[loser]} 认输，${NAME[winner]} 获胜！`);
    showToast('🏳️ 你已认输', 'check');
    render();
  }
  if (undoBtnEl)   undoBtnEl.addEventListener('click', onUndoClick);
  if (resignBtnEl) resignBtnEl.addEventListener('click', onResignClick);

  // —— 邀请裂变：面板 / 复制链接 / 邀请海报 ——
  if (inviteBtnEl) inviteBtnEl.addEventListener('click', async () => {
    Sound.click();
    const show = invitePanelEl.style.display !== 'block';
    invitePanelEl.style.display = show ? 'block' : 'none';
    if (show) await renderInvitePanel();
  });
  if (inviteCopyBtn) inviteCopyBtn.addEventListener('click', async () => {
    const link = inviteLinkEl ? inviteLinkEl.value : '';
    if (!link) return;
    let done = false;
    try { await navigator.clipboard.writeText(link); done = true; }
    catch(e){
      // 旧浏览器 / 非 HTTPS 下 clipboard 不可用，退回选中文本让用户手动复制
      try { inviteLinkEl.select(); done = document.execCommand('copy'); } catch(e2){}
    }
    showToast(done ? '📋 邀请链接已复制，去发给好友吧' : '复制失败，请手动长按选择链接', 'check');
  });
  if (invitePosterBtn) invitePosterBtn.addEventListener('click', openInvitePoster);

  // —— 海报：战绩海报 + 弹窗里的保存 / 复制 / 分享 ——
  if (posterBtnEl) posterBtnEl.addEventListener('click', openResultPoster);
  if (posterModalEl){
    const saveB  = document.getElementById('posterSaveBtn');
    const copyB  = document.getElementById('posterCopyBtn');
    const shareB = document.getElementById('posterShareBtn');
    const closeB = document.getElementById('posterCloseBtn');
    if (saveB)  saveB.addEventListener('click', () => {
      const ok = Poster.download('暗棋象棋-' + new Date().toISOString().slice(0,10) + '.png');
      showToast(ok ? '💾 图片已保存到下载目录' : '保存失败，可长按图片另存', 'check');
    });
    if (copyB)  copyB.addEventListener('click', async () => {
      const ok = await Poster.copy();
      showToast(ok ? '📋 图片已复制，可直接粘贴到微信' : '此浏览器不支持复制图片，请改用「保存图片」', 'check');
    });
    if (shareB) shareB.addEventListener('click', async () => {
      const ok = await Poster.share('暗棋象棋 · 来一局');
      if (!ok) showToast('此设备不支持系统分享，请用「保存图片」后手动发送', 'check');
    });
    if (closeB) closeB.addEventListener('click', hidePosterModal);
    posterModalEl.addEventListener('click', e => { if (e.target === posterModalEl) hidePosterModal(); });
  }
  if (chatSendEl)  chatSendEl.addEventListener('click', sendChat);
  if (chatInputEl) chatInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  if (soundBtnEl){
    soundBtnEl.textContent = Settings.get('sfx') ? '🔊 音效' : '🔇 静音';
    soundBtnEl.addEventListener('click', () => Settings.toggleSfx());
  }
  document.addEventListener('click', () => Sound.init(), { once: true });   // 首次任意点击解锁音效
  document.addEventListener('click', () => { if (Settings.get('music')) Music.resumeIfNeeded(); }, { once: true });   // 首次手势后启动背景音乐
  document.addEventListener('keydown', () => { if (Settings.get('music')) Music.resumeIfNeeded(); }, { once: true });
  gateBtn.addEventListener('click', () => { state.showGate = false; render(); scheduleAI(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape'){
      state.selected = null; state.selectedHidden = null;
      if (state.mode === 'hidden') state.mode = 'normal';
      render();
    }
  });

  newGame();
  render();
  Settings.load();
  Settings.applyAll();          // 应用主题/音效/音乐等（会再 render 一次，确保棋盘主题色生效）
  bindInviteFromUrl();          // 若是好友邀请链接（?inv=）进来的，上报一次绑定
  if (qRoom) autoJoinFromUrl();  // 邀请链接进来的，自动进房（满员自动转观战）
  else {
    // 自动续上次的联机对局：刷新/关闭页面后回来，若房间仍在则恢复（支持"匹配后刷新重连"）
    let lastRoom = null;
    try { lastRoom = localStorage.getItem('xq_last_room_' + Net.clientId); } catch(e){}
    if (lastRoom){
      modeSel.value = 'online';
      onlineOptsEl.style.display = 'block';
      roomInput.value = lastRoom;
      config.mode = 'online';
      setNetInfo('正在恢复上次对局…', 'wait');
      Net.join(lastRoom);   // 服务器若房间仍在，会 rejoined=true 触发 recoverGame
    } else {
      showMenu();           // 没有正在进行的对局 → 首屏显示主菜单
      // 首次启动（从未看过新手引导）自动弹出教程
      try { if (!localStorage.getItem('xq_tutorial_done')) startTutorial(); } catch(e){}
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
