// 页面逻辑：只负责把 H5 游戏网址传给 web-view
Page({
  data: {
    // ⚠️ 改成你备案好的真实地址，必须是 https，且域名已加进 QQ 小程序「业务域名」白名单
    url: 'https://YOUR-DOMAIN.com/index.html'
  },
  onLoad() {
    // 如需带参数（如从分享卡片进入指定房间），可在这里解析并拼到 url 上
  }
});
