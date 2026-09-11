'use strict';
/*
 * 联机客户端网络层
 * 用长轮询（long polling）跟服务器通信：发一个请求挂在那儿，
 * 一有对手的消息服务器立刻返回，没有就 25 秒后返回空、再发下一个。
 * 回合制象棋用这个足够，比 WebSocket 更不容易被防火墙/代理拦。
 */

const Net = {
  room: null,
  side: null,          // 本机执哪一方：'red' 先手 / 'black' 后手
  since: 0,            // 已收到的消息序号
  joined: false,
  peerOnline: false,   // 对手是否已进房
  polling: false,
  handlers: {},
  _cancel: false,

  // 每台电脑一个固定身份，刷新页面时能拿回原来的红/黑方
  clientId: (function(){
    let id = null;
    try { id = localStorage.getItem('xq_client_id'); } catch(e){}
    if (!id){
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('xq_client_id', id); } catch(e){}
    }
    return id;
  })(),

  on(type, fn){ this.handlers[type] = fn; },
  emit(type, data){
    const f = this.handlers[type];
    if (f) { try { f(data); } catch(e){ console.error('[net] handler error', type, e); } }
  },

  // —— 全局私信（好友约战等）：与房间消息相互独立，不进房间也能收到 ——
  imSince: 0,
  imPolling: false,
  imHandlers: {},
  onIM(type, fn){ this.imHandlers[type] = fn; },
  emitIM(type, data){
    const f = this.imHandlers[type];
    if (f) { try { f(data); } catch(e){ console.error('[net.im] handler error', type, e); } }
  },
  startIM(){
    if (this.imPolling) return;
    this.imPolling = true;
    this._imLoop();
  },
  async _imLoop(){
    while (this.imPolling){
      try {
        const url = '/api/im/pull?cid=' + encodeURIComponent(this.clientId) + '&since=' + this.imSince;
        const r = await fetch(url).then(x => x.json());
        if (r && r.ok){
          if (typeof r.seq === 'number') this.imSince = Math.max(this.imSince, r.seq);
          for (const m of (r.msgs || [])) this.emitIM(m.type, m.data);
        }
      } catch(e){
        await new Promise(res => setTimeout(res, 1500));   // 网络抖动后稍等重试
      }
    }
  },

  get ready(){ return this.joined && this.peerOnline; },

  // 共用的"已拿到房间 + 身份"入口：进房成功 / 匹配成功都会走到这
  _connected(side, seq, both){
    this.side       = side;
    this.since      = seq || 0;
    this.joined     = true;
    this.peerOnline = !!both;
    this._cancel    = false;
    this.emit('joined', { side, seq: this.since, both: !!both });
    if (both) this.emit('peerJoined', { rejoined: true });
    if (!this.polling){ this.polling = true; this._loop(); }
  },

  async join(room){
    this.room = room;
    const r = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room, clientId: this.clientId })
    }).then(x => x.json());

    if (!r.ok){ this.emit('error', r.error || '加入房间失败'); return r; }

    this._connected(r.side, r.seq, r.both);
    return r;
  },

  // 随机匹配：进队列，系统自动分配在线对手；匹配到后自动进房开战
  async match(ranked){
    this._cancel = false;
    this.room = null; this.side = null; this.joined = false; this.peerOnline = false;
    this.emit('matchWaiting', {});
    while (!this._cancel){
      try {
        const r = await fetch('/api/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: this.clientId, cancel: false, ranked: !!ranked })
        }).then(x => x.json());
        if (!r || !r.ok){ this.emit('error', (r && r.error) || '匹配服务异常'); return; }
        if (r.cancelled || this._cancel) break;
        if (r.matched){ this._connected(r.side, r.seq || 0, true); return r; }
        // r.waiting -> 循环再来一次，重新排进队列
      } catch(e){
        if (this._cancel) break;
        await new Promise(res => setTimeout(res, 1500));  // 网络抖动后稍等重试
      }
    }
    if (this._cancel) this.emit('matchCancelled', {});
  },

  // 取消随机匹配（点"取消匹配"时调用）
  cancelMatch(){
    this._cancel = true;
    fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, cancel: true })
    }).catch(() => {});
  },

  // 观战：以旁观者身份进房，拿到完整棋局历史，之后持续接收所有消息
  async spectate(room){
    this.room = room;
    this.role = 'spectator';
    this.side = 'spectator';
    this.joined = true;
    this.peerOnline = true;     // 观战者不需要"对手是否在线"的门禁
    const r = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room, clientId: this.clientId, role: 'spectator' })
    }).then(x => x.json()).catch(() => ({ ok:false, error:'连接失败' }));

    if (!r || !r.ok){ this.emit('error', (r && r.error) || '观战失败'); return r; }

    this.since = r.seq || 0;
    this.emit('joined', { role:'spectator', side:'spectator', seq: this.since, msgs: r.msgs || [] });
    if (!this.polling){ this.polling = true; this._loop(); }
    return r;
  },

  // 彻底退出当前房间/观战，停止长轮询（切换模式时调用）
  leave(){
    this.joined = false;
    this.polling = false;
    this.peerOnline = false;
    this.room = null;
    this.side = null;
    this.role = null;
    this.since = 0;
  },

  async send(type, data){
    if (!this.joined) return;
    try {
      await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: this.room, side: this.side, type, data: data || null })
      });
    } catch(e){
      this.emit('error', '发送失败，网络可能断开');
    }
  },

  async _loop(){
    while (this.joined){
      try {
        const url = '/api/poll?room=' + encodeURIComponent(this.room) +
                    '&side=' + this.side + '&since=' + this.since +
                    '&cid=' + encodeURIComponent(this.clientId);
        const r = await fetch(url).then(x => x.json());
        if (r && r.ok){
          if (typeof r.seq === 'number') this.since = Math.max(this.since, r.seq);
          for (const m of (r.msgs || [])){
            if (m.type === 'peer'){
              const both = !!(m.data && m.data.red && m.data.black);
              const was = this.peerOnline;
              this.peerOnline = both;
              this.emit('peerStatus', m.data);              // 始终广播当前双方在线状态
              if (both && !was) this.emit('peerJoined', m.data);
              if (!both && was) this.emit('peerLeft', m.data);
              continue;
            }
            this.emit(m.type, m.data);
          }
        }
      } catch(e){
        this.emit('error', '与服务器失去联系，正在重连…');
        await new Promise(res => setTimeout(res, 1500));
      }
    }
    this.polling = false;
  }
};
