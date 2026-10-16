/* 成绩页 */
(function () {
  'use strict';
  const { api, esc, fmtDate, fmtDuration, param } = window.QZ;

  const STATUS_TEXT = { correct: '正确', partial: '部分正确', wrong: '错误', blank: '未作答' };

  let RESULT = null;
  let filter = 'all';

  function ringColor(percent) {
    if (percent >= 85) return ['#16a34a', '#dcfce7'];
    if (percent >= 60) return ['#3b5bdb', '#e0e7ff'];
    if (percent >= 40) return ['#d97706', '#fef3c7'];
    return ['#dc2626', '#fee2e2'];
  }

  function renderHero(r, settings) {
    const [c1, c2] = ringColor(r.percent);
    const pct = Math.max(0, Math.min(100, r.percent));
    return `
    <div class="card score-hero">
      <div class="score-ring" style="background:
        conic-gradient(${c1} ${pct * 3.6}deg, #e8edf5 ${pct * 3.6}deg)">
        <div style="width:136px;height:136px;border-radius:50%;background:#fff;display:grid;place-items:center;align-content:center;">
          <div class="val" style="color:${c1}">${r.percent}<span class="unit">%</span></div>
          <div class="sub">${r.earnedSum} / ${r.fullSum} 分</div>
        </div>
      </div>
      <div class="pill ${r.pass ? 'pass' : 'fail'}">${r.pass ? '🎉 恭喜，成绩合格' : '💪 很遗憾，未达及格线'}</div>
      ${r.paperTitle ? `<div class="score-paper">📄 ${esc(r.paperTitle)}</div>` : ''}
      <div class="score-name">${esc(r.name)}</div>
      <div class="score-line">
        交卷时间 ${fmtDate(r.createdAt)} · 用时 ${fmtDuration(r.durationMs)} · 及格线 ${settings.passPercent}%
      </div>
      <div class="stat-grid">
        <div class="stat ok"><div class="n">${r.correctCount}</div><div class="l">完全正确</div></div>
        <div class="stat warn"><div class="n">${r.partialCount || 0}</div><div class="l">部分正确</div></div>
        <div class="stat bad"><div class="n">${r.wrongCount}</div><div class="l">错误 / 未答</div></div>
        <div class="stat info"><div class="n">${r.totalCount}</div><div class="l">题目总数</div></div>
      </div>
    </div>`;
  }

  function optionState(d, oi) {
    const isCorrect = d.type === 'single' && oi === d.correctIndex;
    const isChosen = d.type === 'single' && String(d.userAnswer) === String(oi);
    if (isCorrect && isChosen) return { cls: 'state-correct', badge: '<span class="badge correct">你的选择 ✔ 正确</span>' };
    if (isCorrect && !isChosen) return { cls: 'state-missed', badge: '<span class="badge partial">正确答案</span>' };
    if (isChosen) return { cls: 'state-wrong', badge: '<span class="badge wrong">你的选择 ✘</span>' };
    return { cls: '', badge: '' };
  }

  function renderQuestion(d, i) {
    const cls = d.status === 'correct' ? 'is-correct' : (d.status === 'partial' ? 'is-partial' : 'is-wrong');
    const badge = `<span class="badge ${d.status}">${STATUS_TEXT[d.status] || d.status}</span>`;
    const el = document.createElement('div');
    el.className = 'q-item ' + cls;
    el.dataset.status = d.status === 'correct' ? 'correct' : (d.status === 'partial' ? 'partial' : 'wrong');

    let html = `<div class="q-title">
        <span class="q-no">${i + 1}</span>
        <span class="q-tag ${d.type === 'single' ? 'single' : 'short'}">${d.type === 'single' ? '单选题' : '简答题'}</span>
        <span class="q-text">${esc(d.title)}</span>
        <span class="q-pts">得 ${d.earned} / ${d.full} 分</span>
        ${badge}
      </div>`;

    if (d.type === 'single') {
      (d.options || []).forEach((opt, oi) => {
        const st = optionState(d, oi);
        html += `<div class="opt ${st.cls}">
            <span class="letter">${String.fromCharCode(65 + oi)}</span>
            <span style="flex:1">${esc(opt)}</span>${st.badge}
          </div>`;
      });
    } else {
      const userVals = String(d.userDisplay || '').split('、').map((s) => s.trim()).filter(Boolean);
      const correct = (d.correctAnswers || []).map((s) => String(s).trim()).filter(Boolean);
      const keyOf = (s) => s.replace(/\s+/g, '').toLowerCase();
      const correctSet = new Set(correct.map(keyOf));
      html += '<div class="ans-box">';
      html += `<div class="line"><span class="k">你的答案</span><span class="v ${d.status === 'correct' ? 'ok' : (d.status === 'blank' ? '' : 'bad')}">${
        userVals.length
          ? userVals.map((v) => correctSet.has(keyOf(v))
              ? `<span style="color:var(--ok)">${esc(v)} ✔</span>`
              : `<span style="color:var(--bad)">${esc(v)} ✘</span>`).join('、')
          : '<span class="empty-val">（未作答）</span>'
      }</span></div>`;
      html += `<div class="line"><span class="k">正确答案</span><span class="v ok">${
        correct.length ? correct.map(esc).join('、') : '<span class="empty-val">（未设置）</span>'
      }</span></div>`;
      if (d.status === 'partial') {
        html += `<div class="line"><span class="k">说明</span><span class="v">答对 ${d.matched} / ${d.expectedCount} 个要点，按比例给分</span></div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;
    return el;
  }

  function render() {
    const r = RESULT.result;
    const settings = RESULT.settings || { passPercent: 60 };
    const host = document.getElementById('content');
    const wrongCount = r.wrongCount + (r.partialCount || 0);
    host.innerHTML = renderHero(r, settings) + `
      <div class="card">
        <div class="filter-bar">
          <button class="chip ${filter === 'all' ? 'active' : ''}" data-f="all">全部题目 (${r.totalCount})</button>
          <button class="chip ${filter === 'wrong' ? 'active' : ''}" data-f="wrong">只看错题 (${wrongCount})</button>
          <button class="chip ${filter === 'correct' ? 'active' : ''}" data-f="correct">只看正确 (${r.correctCount})</button>
          <div class="spacer" style="flex:1"></div>
          <span class="muted">错题已用红色高亮</span>
        </div>
        <div id="qlist"></div>
      </div>
      <div class="center mt16 no-print">
        <a class="btn" href="${r.paperCode ? '/p/' + encodeURIComponent(r.paperCode) : '/'}">再答一次</a>
        <a class="btn ghost" href="/">其他试卷</a>
        <a class="btn ghost" href="/admin">管理后台</a>
      </div>`;

    const list = document.getElementById('qlist');
    let shown = 0;
    r.details.forEach((d, i) => {
      const bucket = d.status === 'correct' ? 'correct' : 'wrong';
      if (filter !== 'all' && filter !== bucket) return;
      list.appendChild(renderQuestion(d, i));
      shown++;
    });
    if (!shown) {
      list.innerHTML = '<div class="empty-state"><div class="big">✨</div><div>' +
        (filter === 'wrong' ? '全部答对，没有错题！' : '没有符合条件的题目') + '</div></div>';
    }

    host.querySelectorAll('.chip').forEach((c) => {
      c.addEventListener('click', () => { filter = c.dataset.f; render(); });
    });
  }

  async function load() {
    const id = param('id');
    if (!id) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('errorCard').style.display = 'block';
      document.getElementById('errorMsg').textContent = '缺少答卷编号';
      return;
    }
    try {
      const data = await api('/api/result/' + encodeURIComponent(id));
      RESULT = data;
      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';
      const title = (data.settings && data.settings.title) || '在线答题';
      document.title = '成绩 - ' + (data.result.paperTitle || title);
      document.getElementById('brandTitle').textContent = title;
      const retry = document.getElementById('retryBtn');
      if (retry && data.result.paperCode) retry.href = '/p/' + encodeURIComponent(data.result.paperCode);
      render();
      window.scrollTo(0, 0);
    } catch (e) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('errorCard').style.display = 'block';
      document.getElementById('errorMsg').textContent = e.message;
    }
  }

  load();
})();
