/* 首页：已发布试卷列表 */
(function () {
  'use strict';
  const { api, esc, fmtDate } = window.QZ;

  async function load() {
    const host = document.getElementById('paperList');
    try {
      const cfg = await api('/api/config');
      document.title = cfg.title;
      document.getElementById('brandTitle').textContent = cfg.title;
      document.getElementById('pageTitle').textContent = '选择一份试卷开始答题';

      const d = await api('/api/papers');
      document.getElementById('pageSubtitle').textContent = d.papers.length
        ? `当前有 ${d.papers.length} 份试卷可以作答，点击进入即可。`
        : '暂时还没有已发布的试卷。';

      if (!d.papers.length) {
        host.innerHTML =
          '<div class="card"><div class="empty-state"><div class="big">📭</div>' +
          '<div>还没有已发布的试卷</div>' +
          '<div class="muted mt8">请到 <a href="/admin">管理后台</a> 新建一套试卷并发布后，把链接分享给别人。</div>' +
          '</div></div>';
        return;
      }

      host.innerHTML = '';
      d.papers.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'card paper-card';
        card.innerHTML =
          '<div class="paper-card-main">' +
            '<div class="paper-card-title">' + esc(p.title) +
              (p.needAccessCode ? '<span class="q-tag" style="background:#fef3c7;color:#92400e;margin-left:8px">需要口令</span>' : '') +
            '</div>' +
            (p.desc ? '<div class="muted mt8">' + esc(p.desc) + '</div>' : '') +
            '<div class="paper-meta">' +
              '<span>共 <b>' + p.questionCount + '</b> 题</span>' +
              '<span>总分 <b>' + p.totalPoints + '</b> 分</span>' +
              (p.publishedAt ? '<span>发布 <b>' + fmtDate(p.publishedAt) + '</b></span>' : '') +
            '</div>' +
          '</div>' +
          '<a class="btn" href="/p/' + encodeURIComponent(p.code) + '">进入答题 →</a>';
        host.appendChild(card);
      });
    } catch (e) {
      host.innerHTML = '<div class="card"><div class="empty-state">加载失败：' + esc(e.message) + '</div></div>';
    }
  }

  load();
})();
