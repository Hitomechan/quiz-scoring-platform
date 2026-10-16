/* 管理后台：多套试卷 */
(function () {
  'use strict';
  const { api, esc, toast, fmtDate, fmtDuration, confirmDialog, promptDialog, copyText } = window.QZ;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));

  const state = {
    papers: [],
    paper: null,
    questions: [],
    settings: {},
    submissions: [],
    stats: null,
    editor: { type: 'single', options: ['', ''], correctIndex: 0, editingId: null },
    filterType: 'all',
    keyword: '',
    scoreQueried: false,
    queryQid: '',
    qSort: 'manual',
    qStatSort: 'index',
    sort: {
      scores: { key: 'createdAt', dir: -1 },
      students: { key: 'bestPercent', dir: -1 },
      qstats: { key: 'index', dir: 1 }
    }
  };

  /* ================= 登录 ================= */
  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#mainView').classList.add('hidden');
    $('#shareBar').classList.add('hidden');
    $('#logoutBtn').classList.add('hidden');
    setTimeout(() => $('#pwd').focus(), 50);
  }
  function showMain() {
    $('#loginView').classList.add('hidden');
    $('#mainView').classList.remove('hidden');
    $('#logoutBtn').classList.remove('hidden');
  }

  async function login() {
    const pwd = $('#pwd').value;
    $('#loginErr').textContent = '';
    if (!pwd) { $('#loginErr').textContent = '请输入密码'; return; }
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { password: pwd } });
      localStorage.setItem('quiz_admin_token', r.token);
      showMain();
      await loadPapers();
      showPapers();
    } catch (e) { $('#loginErr').textContent = e.message; }
  }

  function logout() {
    localStorage.removeItem('quiz_admin_token');
    location.reload();
  }

  /* ================= 视图切换 ================= */
  function showPapers() {
    state.paper = null;
    $('#view-papers').classList.remove('hidden');
    $('#view-workspace').classList.add('hidden');
    $('#shareBar').classList.add('hidden');
    $('#brandTitle').textContent = '管理后台';
    renderPapers();
  }

  function setSubView(name) {
    ['editor', 'list', 'import', 'scores', 'stats', 'paper', 'global', 'share'].forEach((v) => {
      const el = document.getElementById('sub-' + v);
      if (el) el.classList.toggle('hidden', v !== name);
    });
    $$('#view-workspace .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'list') renderQuestionList();
    if (name === 'scores') openScores();
    if (name === 'stats') loadStats();
    if (name === 'paper') fillPaperSettings();
    if (name === 'global') fillGlobalSettings();
    if (name === 'share') renderShareView();
    if (name === 'editor') setTimeout(() => $('#qTitle').focus(), 40);
  }

  async function enterPaper(id, subView) {
    try {
      const d = await api('/api/admin/papers/' + id);
      state.paper = d.paper;
      state.questions = d.questions || [];
      state.settings = d.settings || {};
      state.stats = null;
      state.scoreQueried = false;
      state.queryQid = '';
      state.qSort = 'manual';
      state.qStatSort = 'index';
      $('#qSortSelect').value = 'manual';
      $('#qStatSort').value = 'index';
      resetScoreQuery();
      $('#view-papers').classList.add('hidden');
      $('#view-workspace').classList.remove('hidden');
      $('#shareBar').classList.remove('hidden');
      $('#brandTitle').textContent = '管理后台';
      renderShareBar();
      renderQuestionList();
      renderRecent();
      resetEditor(false);
      setSubView(subView || 'editor');
      // 后台静默拉一次统计，供「题库管理」显示正确率与按正确率排序
      loadStats(true);
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.status === 401) return logout();
      toast(e.message, 'err');
    }
  }

  async function loadPapers() {
    const r = await api('/api/admin/papers');
    state.papers = r.papers || [];
    state.settings = r.settings || {};
    if (state.settings.usingDefaultPassword) {
      $('#defaultPwdTip').innerHTML = '当前使用默认密码，登录后请到「系统设置」修改。';
    }
    renderPapers();
  }

  /* ================= 试卷列表 ================= */
  function renderPapers() {
    const host = $('#paperGrid');
    host.innerHTML = '';
    if (!state.papers.length) {
      host.innerHTML =
        '<div class="card"><div class="empty-state"><div class="big">📄</div>' +
        '<div>还没有任何试卷</div>' +
        '<div class="muted mt8">点右上角「＋ 新建一套试卷」开始出题。</div></div></div>';
      return;
    }
    state.papers.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'card paper-card-admin';
      card.innerHTML =
        '<div class="pc-head">' +
          '<div class="pc-title">' + esc(p.title) + '</div>' +
          '<span class="status-badge ' + (p.status === 'published' ? 'on' : 'off') + '">' +
            (p.status === 'published' ? '已发布' : '草稿') + '</span>' +
        '</div>' +
        (p.desc ? '<div class="muted pc-desc">' + esc(p.desc) + '</div>' : '') +
        '<div class="paper-meta">' +
          '<span><b>' + p.questionCount + '</b> 题</span>' +
          '<span>总分 <b>' + p.totalPoints + '</b></span>' +
          '<span>已交 <b>' + p.submissionCount + '</b> 份</span>' +
          (p.needAccessCode ? '<span style="color:var(--warn)">需口令</span>' : '') +
        '</div>' +
        '<button class="link-chip pc-link" title="点击复制链接">' +
          '<span class="link-ico">🔗</span><span>' + esc(p.url) + '</span>' +
        '</button>' +
        '<div class="pc-actions">' +
          '<button class="btn sm" data-act="enter">进入管理</button>' +
          '<button class="btn ghost sm" data-act="qr">▦ 二维码</button>' +
          '<button class="btn ghost sm" data-act="copy">复制链接</button>' +
          '<button class="btn ghost sm" data-act="rename">重命名</button>' +
          '<button class="btn ghost sm" data-act="duplicate">复制副本</button>' +
          '<button class="btn ghost sm" data-act="publish">' + (p.status === 'published' ? '转为草稿' : '发布') + '</button>' +
          '<button class="btn danger sm" data-act="delete">删除</button>' +
        '</div>';
      card.querySelector('[data-act="enter"]').addEventListener('click', () => enterPaper(p.id));
      card.querySelector('[data-act="qr"]').addEventListener('click', () => showQrModal(p.url, p.title));
      card.querySelector('.pc-link').addEventListener('click', () => doCopy(p.url));
      card.querySelector('[data-act="copy"]').addEventListener('click', () => doCopy(p.url));
      card.querySelector('[data-act="rename"]').addEventListener('click', () => renamePaper(p));
      card.querySelector('[data-act="duplicate"]').addEventListener('click', () => duplicatePaper(p));
      card.querySelector('[data-act="publish"]').addEventListener('click', () => togglePublish(p, null));
      card.querySelector('[data-act="delete"]').addEventListener('click', () => deletePaper(p));
      host.appendChild(card);
    });
  }

  async function newPaper() {
    const title = await promptDialog({
      title: '新建一套试卷',
      message: '给这套题起个名字，创建后会自动生成一条独立的答题链接和二维码。',
      placeholder: '例如：2026 春季语文测验',
      okText: '创建'
    });
    if (!title) return;
    try {
      const r = await api('/api/admin/papers', { method: 'POST', body: { title } });
      await loadPapers();
      toast('试卷已创建：' + r.paper.title, 'ok');
      enterPaper(r.paper.id);
    } catch (e) { toast(e.message, 'err'); }
  }

  async function renamePaper(p) {
    const title = await promptDialog({ title: '重命名试卷', value: p.title, okText: '保存' });
    if (title === null || !title) return;
    try {
      await api('/api/admin/papers/' + p.id, { method: 'PUT', body: { title } });
      if (state.paper && state.paper.id === p.id) {
        state.paper.title = title;
        renderShareBar();
        if ($('#pTitle')) $('#pTitle').value = title;
        if ($('#scorePaperName')) {
          $('#scorePaperName').textContent = '「' + title + '」：先选筛选条件，再点「查询」';
        }
        document.title = title + ' - 管理后台';
      }
      await loadPapers();
      if (state.paper) state.paper = state.papers.find((x) => x.id === state.paper.id) || state.paper;
      renderShareBar();
      toast('已重命名为「' + title + '」', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function duplicatePaper(p) {
    try {
      const r = await api('/api/admin/papers/' + p.id + '/duplicate', { method: 'POST' });
      await loadPapers();
      toast('已复制为：' + r.paper.title, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function togglePublish(p, btn) {
    const next = p.status !== 'published';
    if (next && p.questionCount === 0) { toast('这套试卷还没有题目，无法发布', 'warn'); return; }
    if (btn) { btn.disabled = true; }
    try {
      const r = await api('/api/admin/papers/' + p.id + '/publish', {
        method: 'POST', body: { published: next }
      });
      if (state.paper && state.paper.id === p.id) { state.paper = r.paper; renderShareBar(); }
      await loadPapers();
      if (state.paper) state.paper = state.papers.find((x) => x.id === state.paper.id) || state.paper;
      renderShareBar();
      toast(next ? '已发布，链接现在可以分享给别人了' : '已转为草稿，链接暂时不可访问', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { if (btn) btn.disabled = false; }
  }

  async function deletePaper(p) {
    const v = await confirmDialog({
      title: '删除试卷',
      html: '将删除试卷「<b>' + esc(p.title) + '</b>」及其 <b>' + p.submissionCount +
        '</b> 份成绩记录，<b>不可恢复</b>。<br><br>请输入 <b>DELETE</b> 确认：',
      requireText: 'DELETE', okText: '确认删除', danger: true
    });
    if (v === null) return;
    if (String(v).trim().toUpperCase() !== 'DELETE') { toast('输入不正确，已取消', 'warn'); return; }
    try {
      await api('/api/admin/papers/' + p.id, { method: 'DELETE' });
      if (state.paper && state.paper.id === p.id) state.paper = null;
      await loadPapers();
      if (state.paper === null && !$('#view-papers').classList.contains('hidden')) renderPapers();
      else showPapers();
      toast('试卷已删除', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ================= 分享 / 二维码 ================= */
  function renderShareBar() {
    const p = state.paper;
    if (!p) return;
    $('#sharePaperName').textContent = p.title;
    $('#shareLinkText').textContent = p.url;
    const st = $('#shareStatus');
    st.textContent = p.status === 'published' ? '已发布' : '草稿';
    st.className = 'status-badge ' + (p.status === 'published' ? 'on' : 'off');
    $('#publishBtn').textContent = p.status === 'published' ? '取消发布' : '发布';
    $('#shareQrBtn').disabled = p.status !== 'published';
    $('#shareQrBtn').title = p.status === 'published' ? '显示二维码' : '请先发布试卷';
  }

  function renderShareView() {
    const p = state.paper;
    if (!p) return;
    $('#shareUrlText').textContent = p.url;
    $('#openExamBtn').href = '/p/' + encodeURIComponent(p.code);
    $('#shareHint').innerHTML = p.status === 'published'
      ? (p.accessCode
          ? '这份试卷已设置答题口令：<b>' + esc(p.accessCode) + '</b>，请一并告知答题人。'
          : '把上面的链接或二维码发给答题的人，打开就能答题。')
      : '<span style="color:var(--warn)">这份试卷还是草稿，链接暂时打不开。请先点右上角「发布」。</span>';
    try {
      window.QRCode.toCanvas($('#shareCanvas'), p.url, { width: 232, margin: 3, ecLevel: 'M' });
    } catch (e) { toast('二维码生成失败：' + e.message, 'err'); }
  }

  function showQrModal(url, title) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal qr-modal">' +
      '<h3>▦ 扫码答题</h3>' +
      '<div class="muted mb12">' + esc(title || '') + '</div>' +
      '<div class="qr-canvas-wrap"><canvas id="modalQrCanvas"></canvas></div>' +
      '<div class="share-url">' + esc(url) + '</div>' +
      '<div class="modal-actions">' +
      '<button class="btn ghost" data-act="download">下载二维码</button>' +
      '<button class="btn ghost" data-act="copy">复制链接</button>' +
      '<button class="btn" data-act="close">关闭</button>' +
      '</div></div>';
    document.body.appendChild(mask);
    const canvas = mask.querySelector('#modalQrCanvas');
    try {
      window.QRCode.toCanvas(canvas, url, { width: 260, margin: 3, ecLevel: 'M' });
    } catch (e) { toast('二维码生成失败：' + e.message, 'err'); }
    mask.addEventListener('click', (e) => {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (e.target === mask || act === 'close') return mask.remove();
      if (act === 'copy') doCopy(url);
      if (act === 'download') {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = '答题二维码-' + (title || '试卷').replace(/[\\/:*?"<>|]/g, '_') + '.png';
        a.click();
      }
    });
  }

  function doCopy(text) {
    copyText(text).then(() => toast('链接已复制', 'ok', 1600))
      .catch(() => toast('复制失败，请手动选中复制', 'err'));
  }

  /* ================= 出题编辑器 ================= */
  /* 出题时实时显示本套试卷总分 */
  function updateEditorTotal() {
    const count = state.questions.length;
    const pts = state.questions.reduce((a, q) => a + (Number(q.points) > 0 ? Number(q.points) : 1), 0);
    const inputPts = Number($('#qPoints').value) > 0 ? Number($('#qPoints').value) : 1;
    const round = (x) => Math.round(x * 100) / 100;
    $('#tbCount').textContent = count;
    $('#tbPoints').textContent = round(pts);
    if (state.editor.editingId) {
      const q = state.questions.find((x) => x.id === state.editor.editingId);
      const old = q ? (Number(q.points) > 0 ? Number(q.points) : 1) : 0;
      const next = round(pts - old + inputPts);
      $('#tbPreview').textContent = next === pts
        ? '（正在编辑已有题目）'
        : '保存后 → ' + count + ' 题 / ' + next + ' 分';
    } else {
      $('#tbPreview').textContent = '加上本题 → ' + (count + 1) + ' 题 / ' + round(pts + inputPts) + ' 分';
    }
  }

  function setType(t) {
    state.editor.type = t;
    $('#typeSingle').classList.toggle('active', t === 'single');
    $('#typeShort').classList.toggle('active', t === 'short');
    $('#singleBox').classList.toggle('hidden', t !== 'single');
    $('#shortBox').classList.toggle('hidden', t !== 'short');
  }

  function renderOptions(focusIndex) {
    const host = $('#optionList');
    host.innerHTML = '';
    state.editor.options.forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'opt-editor-row' + (state.editor.correctIndex === i ? ' is-correct' : '');

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'correctOpt';
      radio.checked = state.editor.correctIndex === i;
      radio.title = '设为正确答案';
      radio.addEventListener('change', () => { state.editor.correctIndex = i; renderOptions(); });

      const chip = document.createElement('span');
      chip.className = 'letter-chip';
      chip.textContent = String.fromCharCode(65 + i);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'opt-text';
      input.placeholder = '选项 ' + String.fromCharCode(65 + i) + ' 内容';
      input.value = text;
      input.addEventListener('input', () => { state.editor.options[i] = input.value; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (i === state.editor.options.length - 1) {
            if (state.editor.options.length < 8) {
              state.editor.options.push('');
              renderOptions(state.editor.options.length - 1);
            }
          } else renderOptions(i + 1);
        }
        if (e.key === 'Backspace' && !input.value && state.editor.options.length > 2) {
          e.preventDefault(); removeOption(i);
        }
      });

      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.textContent = '×';
      del.title = '删除该选项';
      del.addEventListener('click', () => removeOption(i));

      row.append(radio, chip, input, del);
      host.appendChild(row);
    });
    if (focusIndex !== undefined) {
      const inputs = host.querySelectorAll('.opt-text');
      if (inputs[focusIndex]) inputs[focusIndex].focus();
    }
  }

  function removeOption(i) {
    if (state.editor.options.length <= 2) { toast('至少保留 2 个选项', 'warn'); return; }
    state.editor.options.splice(i, 1);
    if (state.editor.correctIndex >= state.editor.options.length) state.editor.correctIndex = 0;
    renderOptions();
  }

  function resetEditor(keepPoints) {
    state.editor.editingId = null;
    state.editor.options = ['', ''];
    state.editor.correctIndex = 0;
    $('#qTitle').value = '';
    $('#shortAnswer').value = '';
    $('#shortPreview').textContent = '';
    if (!keepPoints) $('#qPoints').value = '1';
    $('#editorTitle').textContent = '出一道新题';
    $('#saveNewBtn').classList.remove('hidden');
    setType(state.editor.type);
    renderOptions();
    $('#editorErr').textContent = '';
    updateEditorTotal();
  }

  function collectQuestion() {
    const title = $('#qTitle').value.trim();
    const points = Number($('#qPoints').value) || 1;
    if (!title) return { error: '题干不能为空' };
    if (state.editor.type === 'short') {
      const answers = $('#shortAnswer').value.split(/[、,，;；]+/).map((s) => s.trim()).filter(Boolean);
      if (!answers.length) return { error: '请填写简答题的正确答案' };
      return { q: { type: 'short', title, answers, points } };
    }
    const options = state.editor.options.map((o) => String(o).trim());
    const filled = options.filter(Boolean);
    if (filled.length < 2) return { error: '单选题至少需要 2 个选项' };
    for (let i = 0; i < options.length; i++) {
      if (!options[i]) return { error: '选项 ' + String.fromCharCode(65 + i) + ' 内容为空，请填写或删除它' };
    }
    const ci = state.editor.correctIndex;
    if (ci < 0 || ci >= options.length) return { error: '请点选一个正确答案' };
    return { q: { type: 'single', title, options, correctIndex: ci, points } };
  }

  async function saveQuestion(andContinue) {
    if (!state.paper) return;
    const r = collectQuestion();
    $('#editorErr').textContent = '';
    if (r.error) { $('#editorErr').textContent = r.error; return; }
    const base = '/api/admin/papers/' + state.paper.id + '/questions';
    try {
      if (state.editor.editingId) {
        await api(base + '/' + state.editor.editingId, { method: 'PUT', body: r.q });
        toast('已保存修改', 'ok');
        await reloadPaperQuestions();
        setSubView('list');
      } else {
        await api(base, { method: 'POST', body: r.q });
        toast('题目已添加（第 ' + (state.questions.length + 1) + ' 题）', 'ok');
        resetEditor(true);
        await reloadPaperQuestions();
        if (andContinue) setTimeout(() => $('#qTitle').focus(), 30);
      }
    } catch (e) { $('#editorErr').textContent = e.message; }
  }

  async function reloadPaperQuestions() {
    const d = await api('/api/admin/papers/' + state.paper.id);
    state.questions = d.questions || [];
    state.paper = d.paper;
    state.settings = d.settings || state.settings;
    renderQuestionList();
    renderRecent();
    renderShareBar();
    const idx = state.papers.findIndex((x) => x.id === state.paper.id);
    if (idx >= 0) state.papers[idx] = state.paper;
  }

  function editQuestion(id) {
    const q = state.questions.find((x) => x.id === id);
    if (!q) return;
    state.editor.editingId = id;
    $('#qTitle').value = q.title;
    $('#qPoints').value = q.points;
    if (q.type === 'single') {
      state.editor.options = q.options.slice();
      state.editor.correctIndex = q.correctIndex;
      setType('single');
      renderOptions();
    } else {
      state.editor.options = ['', ''];
      state.editor.correctIndex = 0;
      $('#shortAnswer').value = (q.answers || []).join('、');
      setType('short');
      updateShortPreview();
    }
    $('#editorTitle').textContent = '编辑题目（修改后点保存）';
    $('#saveNewBtn').classList.add('hidden');
    setSubView('editor');
    updateEditorTotal();
    $('#qTitle').focus();
  }

  function updateShortPreview() {
    const vals = $('#shortAnswer').value.split(/[、,，;；]+/).map((s) => s.trim()).filter(Boolean);
    $('#shortPreview').textContent = vals.length
      ? '将识别为 ' + vals.length + ' 个正确答案：' + vals.join(' / ') : '';
  }

  function renderRecent() {
    const recent = state.questions.slice(-5).reverse();
    const box = $('#recentBox');
    if (!recent.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    const host = $('#recentList');
    host.innerHTML = '';
    recent.forEach((q) => host.appendChild(questionRow(q, true)));
  }

  /* ================= 题库列表 ================= */
  function rateOf(qid) {
    if (!state.stats || !state.stats.questions) return null;
    const s = state.stats.questions.find((x) => x.qid === qid);
    return s || null;
  }

  function questionRow(q, compact) {
    const el = document.createElement('div');
    el.className = 'q-row';
    el.dataset.id = q.id;
    const idx = state.questions.indexOf(q) + 1;
    const st = rateOf(q.id);
    const answerText = q.type === 'single'
      ? String.fromCharCode(65 + q.correctIndex) + '. ' + (q.options[q.correctIndex] || '')
      : (q.answers || []).join('、');
    const rateHtml = st && st.scored
      ? ' · 正确率 <b style="color:' + (st.correctRate >= 80 ? 'var(--ok)' : st.correctRate >= 50 ? 'var(--warn)' : 'var(--bad)') +
        '">' + st.correctRate + '%</b>'
      : '';
    const manual = state.qSort === 'manual';
    el.innerHTML =
      '<div class="drag" title="拖动排序" ' + ((compact || !manual) ? 'style="visibility:hidden"' : '') + '>⠿</div>' +
      '<div class="body">' +
        '<div class="ttl"><b style="color:var(--text-light);margin-right:6px">' + idx + '.</b>' +
        '<span class="q-tag ' + (q.type === 'single' ? 'single' : 'short') + '">' + (q.type === 'single' ? '单选' : '简答') + '</span> ' +
        esc(q.title) + '</div>' +
        '<div class="meta">答案：' + esc(answerText || '（未设置）') + ' · ' + q.points + ' 分' + rateHtml + '</div>' +
      '</div>' +
      '<div class="ops">' +
        '<button class="btn ghost sm" data-act="edit">编辑</button>' +
        (manual || compact
          ? '<button class="btn ghost sm" data-act="up" title="上移">↑</button>' +
            '<button class="btn ghost sm" data-act="down" title="下移">↓</button>'
          : '') +
        '<button class="btn danger sm" data-act="del">删除</button>' +
      '</div>';
    el.querySelector('[data-act="edit"]').addEventListener('click', () => editQuestion(q.id));
    const up = el.querySelector('[data-act="up"]');
    const down = el.querySelector('[data-act="down"]');
    if (up) up.addEventListener('click', () => move(q.id, -1));
    if (down) down.addEventListener('click', () => move(q.id, 1));
    el.querySelector('[data-act="del"]').addEventListener('click', () => removeQuestion(q.id));
    if (!compact && manual) makeDraggable(el);
    return el;
  }

  function renderQuestionList() {
    const host = $('#questionList');
    if (!host) return;
    host.innerHTML = '';
    const kw = state.keyword.trim().toLowerCase();
    let list = state.questions.filter((q) => {
      if (state.filterType !== 'all' && q.type !== state.filterType) return false;
      if (kw && !(q.title.toLowerCase().includes(kw) ||
        (q.options || []).join(' ').toLowerCase().includes(kw) ||
        (q.answers || []).join(' ').toLowerCase().includes(kw))) return false;
      return true;
    });

    const ptsOf = (q) => (Number(q.points) > 0 ? Number(q.points) : 1);
    const rateOfQ = (q) => { const s = rateOf(q.id); return s && s.scored ? s.correctRate : -1; };
    const cmp = {
      manual: null,
      pointsDesc: (a, b) => ptsOf(b) - ptsOf(a),
      pointsAsc: (a, b) => ptsOf(a) - ptsOf(b),
      rateAsc: (a, b) => rateOfQ(a) - rateOfQ(b),
      rateDesc: (a, b) => rateOfQ(b) - rateOfQ(a),
      title: (a, b) => a.title.localeCompare(b.title, 'zh')
    }[state.qSort];
    if (cmp) list = list.slice().sort(cmp);

    const totalPts = list.reduce((a, q) => a + ptsOf(q), 0);
    const rated = list.map(rateOf).filter((s) => s && s.scored);
    const avgRate = rated.length
      ? Math.round(rated.reduce((a, s) => a + s.correctRate, 0) / rated.length * 10) / 10 : null;
    $('#listStat').textContent = '共 ' + list.length + ' 题 · 合计 ' + totalPts + ' 分' +
      (avgRate === null ? '' : ' · 平均正确率 ' + avgRate + '%');
    $('#navCount').textContent = state.questions.length ? '(' + state.questions.length + ')' : '';
    updateEditorTotal();

    if (!list.length) {
      host.innerHTML = '<div class="empty-state"><div class="big">📭</div><div>' +
        (state.questions.length ? '没有匹配的题目' : '这套试卷还是空的，去「出新题」添加第一道题吧') + '</div></div>';
      return;
    }
    list.forEach((q) => host.appendChild(questionRow(q, false)));
  }

  function move(id, delta) {
    const i = state.questions.findIndex((q) => q.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.questions.length) return;
    const t = state.questions[i];
    state.questions[i] = state.questions[j];
    state.questions[j] = t;
    renderQuestionList();
    saveOrder();
  }

  let orderTimer = null;
  function saveOrder() {
    clearTimeout(orderTimer);
    orderTimer = setTimeout(async () => {
      try {
        await api('/api/admin/papers/' + state.paper.id + '/questions/reorder', {
          method: 'POST', body: { ids: state.questions.map((q) => q.id) }
        });
        toast('顺序已保存', 'ok', 1200);
      } catch (e) { toast('顺序保存失败：' + e.message, 'err'); }
    }, 350);
  }

  function makeDraggable(el) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      $$('.q-row').forEach((r) => r.classList.remove('drop-target'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.q-row.dragging');
      if (dragging && dragging !== el) el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      const fromId = e.dataTransfer.getData('text/plain');
      const toId = el.dataset.id;
      if (!fromId || fromId === toId) return;
      const from = state.questions.findIndex((q) => q.id === fromId);
      const to = state.questions.findIndex((q) => q.id === toId);
      if (from < 0 || to < 0) return;
      const item = state.questions.splice(from, 1)[0];
      state.questions.splice(to, 0, item);
      renderQuestionList();
      saveOrder();
    });
  }

  async function removeQuestion(id) {
    const q = state.questions.find((x) => x.id === id);
    if (!q) return;
    const ok = await confirmDialog({
      title: '删除题目', html: '确定要删除这道题吗？<br><br><b>' + esc(q.title) + '</b>',
      okText: '删除', danger: true
    });
    if (!ok) return;
    try {
      await api('/api/admin/papers/' + state.paper.id + '/questions/' + id, { method: 'DELETE' });
      state.questions = state.questions.filter((x) => x.id !== id);
      toast('已删除', 'ok');
      renderQuestionList();
      renderRecent();
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ================= 批量导入 ================= */
  async function previewImport() {
    const text = $('#importText').value;
    $('#importErr').textContent = '';
    if (!text.trim()) { $('#importErr').textContent = '请先粘贴题目文本'; return []; }
    try {
      const r = await api('/api/admin/papers/' + state.paper.id + '/preview', {
        method: 'POST', body: { text }
      });
      const host = $('#previewList');
      host.innerHTML = '';
      $('#previewCard').classList.remove('hidden');
      if (!r.count) {
        host.innerHTML = '<div class="empty-state">没有解析出题目，请检查格式</div>';
        return [];
      }
      r.questions.forEach((q, i) => {
        const el = document.createElement('div');
        el.className = 'q-row';
        const ans = q.type === 'single' ? String.fromCharCode(65 + q.correctIndex) : (q.answers || []).join('、');
        const warn = q._unresolved ? ' <span style="color:var(--bad)">⚠ 未识别到答案</span>' : '';
        el.innerHTML = '<div class="body">' +
          '<div class="ttl"><b>' + (i + 1) + '.</b> <span class="q-tag ' + (q.type === 'single' ? 'single' : 'short') + '">' +
          (q.type === 'single' ? '单选' : '简答') + '</span> ' + esc(q.title) + '</div>' +
          (q.options && q.options.length ? '<div class="meta">选项：' + q.options.map((o, oi) =>
            String.fromCharCode(65 + oi) + '.' + esc(o)).join('　') + '</div>' : '') +
          '<div class="meta">答案：<b style="color:var(--ok)">' + esc(ans || '（空）') + '</b>' + warn + ' · ' + q.points + ' 分</div>' +
          '</div>';
        host.appendChild(el);
      });
      toast('解析成功：' + r.count + ' 题', 'ok');
      return r.questions;
    } catch (e) {
      $('#importErr').textContent = e.message;
      return [];
    }
  }

  async function doImport(replace) {
    const text = $('#importText').value;
    $('#importErr').textContent = '';
    if (!text.trim()) { $('#importErr').textContent = '请先粘贴题目文本'; return; }
    if (replace && state.questions.length) {
      const ok = await confirmDialog({
        title: '清空并替换本套试卷',
        html: '这会删除本套试卷现有的 <b>' + state.questions.length + '</b> 道题，然后导入新题目。',
        okText: '继续', danger: true
      });
      if (!ok) return;
    }
    try {
      const r = await api('/api/admin/papers/' + state.paper.id + '/import', {
        method: 'POST', body: { text, replace }
      });
      toast('导入成功：新增 ' + r.added + ' 题，本套共 ' + r.total + ' 题', 'ok', 3200);
      if (r.problems && r.problems.length) $('#importErr').textContent = '提示：' + r.problems.join('；');
      await reloadPaperQuestions();
      await previewImport();
    } catch (e) { $('#importErr').textContent = e.message; }
  }

  /* ================= 成绩 ================= */
  /* ================= 成绩（先筛选，再出结果） ================= */
  function fillQuestionOptions() {
    const sel = $('#fQuestion');
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部题目</option>';
    state.questions.forEach((q, i) => {
      const o = document.createElement('option');
      o.value = q.id;
      o.textContent = (i + 1) + '. ' + (q.title.length > 34 ? q.title.slice(0, 34) + '…' : q.title);
      sel.appendChild(o);
    });
    if (state.questions.some((q) => q.id === cur)) sel.value = cur;
    $('#fQStatus').disabled = !sel.value;
  }

  function openScores() {
    if (!state.paper) return;
    fillQuestionOptions();
    $('#scorePaperName').textContent = '「' + state.paper.title + '」：先选筛选条件，再点「查询」';
    $('#exportCsvBtn').href = '/api/admin/export?format=csv&paperId=' + encodeURIComponent(state.paper.id);
    if (state.scoreQueried) { renderScores(); return; }
    state.submissions = [];
    $('#scoreStats').classList.add('hidden');
    $('#scoreResultTitle').textContent = '查询结果';
    $('#scoreResultHint').textContent = '';
    $('#scoreList').innerHTML =
      '<div class="empty-state"><div class="big">🔍</div><div>请先设置上面的筛选条件，然后点「查询」</div>' +
      '<div class="muted mt8">什么都不选直接查询 = 查看本套全部记录</div></div>';
  }

  function scoreQueryParams() {
    const p = new URLSearchParams();
    p.set('paperId', state.paper.id);
    const name = $('#fName').value.trim();
    if (name) p.set('name', name);
    const qid = $('#fQuestion').value;
    if (qid) { p.set('qid', qid); p.set('qstatus', $('#fQStatus').value); }
    if ($('#fMin').value !== '') p.set('minPercent', $('#fMin').value);
    if ($('#fMax').value !== '') p.set('maxPercent', $('#fMax').value);
    if ($('#fPass').value) p.set('pass', $('#fPass').value);
    if ($('#fFrom').value) p.set('from', $('#fFrom').value);
    if ($('#fTo').value) p.set('to', $('#fTo').value);
    return p;
  }

  function describeQuery() {
    const parts = [];
    if ($('#fName').value.trim()) parts.push('姓名含「' + $('#fName').value.trim() + '」');
    const qid = $('#fQuestion').value;
    if (qid) {
      const idx = state.questions.findIndex((q) => q.id === qid) + 1;
      const map = { any: '不限', correct: '答对', partial: '部分正确', wrong: '答错', blank: '未作答' };
      parts.push('第 ' + idx + ' 题' + ($('#fQStatus').value === 'any' ? '' : '（' + map[$('#fQStatus').value] + '）'));
    }
    const mn = $('#fMin').value, mx = $('#fMax').value;
    if (mn !== '' || mx !== '') parts.push('得分率 ' + (mn === '' ? '0' : mn) + '~' + (mx === '' ? '100' : mx) + '%');
    if ($('#fPass').value === 'true') parts.push('仅及格');
    if ($('#fPass').value === 'false') parts.push('仅不及格');
    if ($('#fFrom').value) parts.push('从 ' + $('#fFrom').value);
    if ($('#fTo').value) parts.push('到 ' + $('#fTo').value);
    return parts.length ? parts.join('、') : '全部记录';
  }

  async function loadSubmissions() {
    if (!state.paper) return;
    try {
      const r = await api('/api/admin/submissions?' + scoreQueryParams().toString());
      state.submissions = r.submissions || [];
      state.scoreQueried = true;
      state.queryQid = $('#fQuestion').value;
      $('#scoreStats').classList.remove('hidden');
      renderScores();
    } catch (e) {
      if (e.status === 401) return logout();
      toast(e.message, 'err');
    }
  }

  function resetScoreQuery() {
    ['#fName', '#fMin', '#fMax', '#fFrom', '#fTo'].forEach((s) => { $(s).value = ''; });
    const sel = $('#fQuestion');
    if (sel) sel.value = '';
    if ($('#fQStatus')) { $('#fQStatus').value = 'any'; $('#fQStatus').disabled = true; }
    if ($('#fPass')) $('#fPass').value = '';
    state.scoreQueried = false;
    state.queryQid = '';
    state.submissions = [];
  }

  /* ================= 通用表格排序 ================= */
  function sortRows(rows, sort, getters) {
    const g = (getters && getters[sort.key]) || ((r) => r[sort.key]);
    return rows.slice().sort((a, b) => {
      const va = g(a), vb = g(b);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'zh') * sort.dir;
      }
      return ((va || 0) - (vb || 0)) * sort.dir;
    });
  }

  function makeTable(host, columns, rows, sort, onSort) {
    const table = document.createElement('table');
    table.className = 'data sortable';
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label + (sort.key === col.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
      if (col.sortable === false) th.classList.add('no-sort');
      else {
        th.classList.add('sortable-th');
        th.title = '点击排序';
        th.addEventListener('click', () => onSort(col.key));
      }
      if (col.numeric) th.classList.add('num');
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    const tb = document.createElement('tbody');
    rows.forEach((row) => {
      const tr2 = document.createElement('tr');
      columns.forEach((col) => {
        const td = document.createElement('td');
        if (col.render) {
          const v = col.render(row);
          if (v instanceof Node) td.appendChild(v); else td.innerHTML = v;
        } else td.textContent = row[col.key] == null ? '' : row[col.key];
        if (col.numeric) td.classList.add('num');
        if (col.nowrap) td.classList.add('nowrap');
        if (col.align) td.style.textAlign = col.align;
        tr2.appendChild(td);
      });
      tb.appendChild(tr2);
    });
    table.appendChild(tb);
    host.innerHTML = '';
    host.appendChild(table);
  }

  function toggleSort(which, key, defaultDir, rerender) {
    const s = state.sort[which];
    if (s.key === key) s.dir = -s.dir;
    else { s.key = key; s.dir = defaultDir === undefined ? 1 : defaultDir; }
    rerender();
  }

  /* ================= 成绩记录表格 ================= */
  function renderScores() {
    const all = state.submissions;
    const list = all;

    const avg = all.length ? Math.round(all.reduce((a, s) => a + s.percent, 0) / all.length * 10) / 10 : 0;
    const best = all.length ? Math.max.apply(null, all.map((s) => s.percent)) : 0;
    const worst = all.length ? Math.min.apply(null, all.map((s) => s.percent)) : 0;
    const passN = all.filter((s) => s.pass).length;
    const students = new Set(all.map((s) => s.name)).size;
    $('#scoreStats').innerHTML =
      '<div class="stat info"><div class="n">' + all.length + '</div><div class="l">命中记录</div></div>' +
      '<div class="stat info"><div class="n">' + students + '</div><div class="l">涉及人数</div></div>' +
      '<div class="stat"><div class="n">' + avg + '%</div><div class="l">平均得分率</div></div>' +
      '<div class="stat ok"><div class="n">' + passN + '</div><div class="l">及格份数</div></div>' +
      '<div class="stat warn"><div class="n">' + best + '%</div><div class="l">最高</div></div>' +
      '<div class="stat bad"><div class="n">' + worst + '%</div><div class="l">最低</div></div>';

    $('#scoreResultTitle').textContent = '查询结果（' + all.length + ' 条）';
    $('#scoreResultHint').innerHTML = '筛选条件：' + esc(describeQuery()) +
      ' · 点表头可排序';

    const host = $('#scoreList');
    if (!list.length) {
      host.innerHTML = '<div class="empty-state"><div class="big">📊</div><div>没有符合条件的记录</div>' +
        '<div class="muted mt8">换个筛选条件再试试</div></div>';
      return;
    }

    const sorted = sortRows(list, state.sort.scores, {
      score: (s) => s.percent,
      correct: (s) => s.correctCount,
      duration: (s) => s.durationMs || 0,
      qEarned: (s) => s.qEarned || 0
    });
    const ranks = {};
    state.submissions.slice().sort((a, b) => b.percent - a.percent)
      .forEach((s, i) => { ranks[s.id] = i + 1; });

    const cols = [
      { key: 'rank', label: '名次', numeric: true,
        render: (s) => {
          const r = ranks[s.id];
          return r <= 3 ? '<b style="color:var(--warn)">' + r + '</b>' : String(r);
        } },
      { key: 'name', label: '姓名', render: (s) => '<b>' + esc(s.name) + '</b>' },
      { key: 'createdAt', label: '提交时间', nowrap: true, render: (s) => fmtDate(s.createdAt) },
      { key: 'duration', label: '用时', nowrap: true, numeric: true, render: (s) => fmtDuration(s.durationMs) },
      { key: 'earned', label: '总分', numeric: true, render: (s) => s.earnedSum + ' / ' + s.fullSum },
      { key: 'score', label: '得分率', numeric: true, render: (s) => '<b>' + s.percent + '%</b>' }
    ];

    if (state.queryQid) {
      const labels = { correct: ['正确', 'correct'], partial: ['部分正确', 'partial'],
        wrong: ['错误', 'wrong'], blank: ['未作答', 'blank'] };
      const qFull = (list.find((s) => s.qFull) || {}).qFull;
      const qIdx = state.questions.findIndex((q) => q.id === state.queryQid) + 1;
      cols.push({
        key: 'qEarned', label: '第 ' + qIdx + ' 题结果', numeric: true,
        render: (s) => {
          const m = labels[s.qStatus];
          const badge = m ? '<span class="badge ' + m[1] + '">' + m[0] + '</span>' : '<span class="badge blank">—</span>';
          return '<span class="nowrap">' + s.qEarned + '/' + (qFull || s.qFull || 0) + ' ' + badge + '</span>';
        }
      });
    }

    cols.push(
      { key: 'correct', label: '对 / 部分 / 错', numeric: true,
        render: (s) => s.correctCount + ' / ' + (s.partialCount || 0) + ' / ' + s.wrongCount },
      { key: 'pass', label: '结果', render: (s) => '<span class="' + (s.pass ? 'tag-pass' : 'tag-fail') + '">' +
          (s.pass ? '及格' : '不及格') + '</span>' },
      { key: 'ops', label: '操作', sortable: false, align: 'right',
        render: (s) => {
          const box = document.createElement('span');
          box.style.whiteSpace = 'nowrap';
          const a = document.createElement('a');
          a.className = 'btn ghost sm';
          a.textContent = '查看答卷';
          a.href = '/result.html?id=' + encodeURIComponent(s.id);
          a.target = '_blank';
          const del = document.createElement('button');
          del.className = 'btn danger sm';
          del.textContent = '删除';
          del.style.marginLeft = '6px';
          del.addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: '删除记录', message: '删除 ' + s.name + ' 的这份答卷记录？', okText: '删除', danger: true
            });
            if (!ok) return;
            try {
              await api('/api/admin/submissions/' + s.id, { method: 'DELETE' });
              state.submissions = state.submissions.filter((x) => x.id !== s.id);
              state.stats = null;
              renderScores();
              toast('已删除', 'ok');
            } catch (e) { toast(e.message, 'err'); }
          });
          box.append(a, del);
          return box;
        } }
    );

    makeTable(host, cols, sorted, state.sort.scores,
      (k) => toggleSort('scores', k, (k === 'name' || k === 'createdAt') ? 1 : -1, renderScores));
  }

  /* ================= 数据统计 ================= */
  async function loadStats(silent) {
    if (!state.paper) return;
    try {
      const r = await api('/api/admin/papers/' + state.paper.id + '/stats');
      state.stats = r;
      renderQuestionList();          // 让题库管理里的正确率刷新
      if (!$('#sub-stats').classList.contains('hidden')) renderStats();
    } catch (e) {
      if (e.status === 401) return logout();
      if (!silent) toast(e.message, 'err');
    }
  }

  function renderStats() {
    const st = state.stats;
    const host = $('#statsOverview');
    if (!st) { host.innerHTML = ''; return; }
    const o = st.overview;
    $('#statsPaperName').textContent = '「' + state.paper.title + '」共 ' + o.questionCount +
      ' 题 / 满分 ' + o.totalPoints + ' 分';
    $('#exportStudentsBtn').href = '/api/admin/export?format=csv&type=students&paperId=' + encodeURIComponent(state.paper.id);
    $('#exportQuestionsBtn').href = '/api/admin/export?format=csv&type=questions&paperId=' + encodeURIComponent(state.paper.id);

    host.innerHTML =
      '<div class="stat info"><div class="n">' + o.submissions + '</div><div class="l">提交份数</div></div>' +
      '<div class="stat info"><div class="n">' + o.students + '</div><div class="l">参与人数</div></div>' +
      '<div class="stat"><div class="n">' + o.avgPercent + '%</div><div class="l">平均得分率</div></div>' +
      '<div class="stat"><div class="n">' + o.medianPercent + '%</div><div class="l">中位数</div></div>' +
      '<div class="stat warn"><div class="n">' + o.maxPercent + '%</div><div class="l">最高</div></div>' +
      '<div class="stat bad"><div class="n">' + o.minPercent + '%</div><div class="l">最低</div></div>' +
      '<div class="stat ok"><div class="n">' + o.passRate + '%</div><div class="l">及格率（' + o.passCount + '人）</div></div>' +
      '<div class="stat"><div class="n">' + (o.avgDurationMs ? fmtDuration(o.avgDurationMs) : '—') + '</div><div class="l">平均用时</div></div>';

    const maxCount = Math.max(1, ...st.distribution.map((d) => d.count));
    $('#statsDistHint').textContent = o.submissions ? '共 ' + o.submissions + ' 份' : '';
    $('#scoreDist').innerHTML = st.distribution.map((d) => {
      const w = Math.round(d.count / maxCount * 100);
      return '<div class="dist-row">' +
        '<span class="dist-label">' + d.label + '%</span>' +
        '<span class="dist-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="dist-count">' + d.count + ' 份</span>' +
        '</div>';
    }).join('');

    renderStudentTable();
    renderQuestionStats();
  }

  function renderStudentTable() {
    const st = state.stats;
    const host = $('#studentTable');
    if (!st) return;
    const kw = $('#studentSearch').value.trim().toLowerCase();
    const list = st.students.filter((s) => !kw || s.name.toLowerCase().includes(kw));
    if (!list.length) {
      host.innerHTML = '<div class="empty-state"><div class="big">👤</div><div>' +
        (st.students.length ? '没有匹配的人' : '还没有人提交') + '</div></div>';
      return;
    }
    const sorted = sortRows(list, state.sort.students, {
      attempts: (s) => s.attempts,
      bestPercent: (s) => s.bestPercent,
      lastPercent: (s) => s.lastPercent,
      avgPercent: (s) => s.avgPercent
    });
    makeTable(host, [
      { key: 'name', label: '姓名', render: (s) => '<b>' + esc(s.name) + '</b>' },
      { key: 'attempts', label: '提交次数', numeric: true },
      { key: 'bestPercent', label: '最高得分率', numeric: true, render: (s) => '<b>' + s.bestPercent + '%</b>' },
      { key: 'lastPercent', label: '最近得分率', numeric: true, render: (s) => s.lastPercent + '%' },
      { key: 'avgPercent', label: '平均得分率', numeric: true, render: (s) => s.avgPercent + '%' },
      { key: 'pass', label: '是否及格', render: (s) => '<span class="' + (s.pass ? 'tag-pass' : 'tag-fail') + '">' +
          (s.pass ? '及格' : '不及格') + '</span>' },
      { key: 'lastAt', label: '最近提交', nowrap: true, render: (s) => fmtDate(s.lastAt) },
      { key: 'ops', label: '操作', sortable: false, align: 'right', render: (s) => {
          const a = document.createElement('a');
          a.className = 'btn ghost sm';
          a.textContent = '看最近一次答卷';
          a.href = '/result.html?id=' + encodeURIComponent(s.lastId);
          a.target = '_blank';
          return a;
        } }
    ], sorted, state.sort.students, (k) => toggleSort('students', k, k === 'name' || k === 'lastAt' ? 1 : -1, renderStudentTable));
  }

  function renderQuestionStats() {
    const st = state.stats;
    const host = $('#questionStats');
    if (!st) { host.innerHTML = ''; return; }
    const mode = state.qStatSort;
    let list = st.questions.slice();
    const cmp = {
      index: (a, b) => a.index - b.index,
      correctRate: (a, b) => a.correctRate - b.correctRate,
      correctRateDesc: (a, b) => b.correctRate - a.correctRate,
      avgEarnedAsc: (a, b) => a.avgEarned - b.avgEarned,
      avgEarnedDesc: (a, b) => b.avgEarned - a.avgEarned
    }[mode] || ((a, b) => a.index - b.index);
    list.sort(cmp);

    if (!list.length) {
      host.innerHTML = '<div class="empty-state"><div class="big">📈</div><div>这套试卷还没有题目</div></div>';
      return;
    }

    const box = document.createElement('div');
    box.className = 'qstat-list';
    list.forEach((q) => {
      const rate = q.correctRate;
      const color = rate >= 80 ? 'var(--ok)' : (rate >= 50 ? 'var(--warn)' : 'var(--bad)');
      const el = document.createElement('div');
      el.className = 'qstat';
      let opts = '';
      if (q.type === 'single' && q.options.length) {
        opts = '<div class="qstat-opts">' + q.options.map((o) =>
          '<div class="qstat-opt' + (o.isCorrect ? ' is-answer' : '') + '">' +
            '<span class="letter-chip">' + o.letter + '</span>' +
            '<span class="qstat-opt-text">' + esc(o.text) + '</span>' +
            '<span class="qstat-opt-bar"><i style="width:' + o.percent + '%"></i></span>' +
            '<span class="qstat-opt-num">' + o.count + ' 人 · ' + o.percent + '%</span>' +
            (o.isCorrect ? '<span class="badge correct">正确答案</span>' : '') +
          '</div>').join('') + '</div>';
      } else if (q.topWrong && q.topWrong.length) {
        opts = '<div class="qstat-opts"><div class="hint" style="margin:0">常见错误答案：' +
          q.topWrong.map((w) => esc(w.value) + '（' + w.count + '次）').join('、') + '</div></div>';
      }
      el.innerHTML =
        '<div class="qstat-head">' +
          '<span class="q-no">' + q.index + '</span>' +
          '<span class="q-tag ' + (q.type === 'single' ? 'single' : 'short') + '">' +
            (q.type === 'single' ? '单选' : '简答') + '</span>' +
          '<span class="qstat-title">' + esc(q.title) + '</span>' +
          '<span class="q-pts">' + q.points + ' 分</span>' +
          '<span class="qstat-rate" style="color:' + color + '">正确率 ' + rate + '%</span>' +
        '</div>' +
        '<div class="qstat-nums">' +
          '<span>答对 <b style="color:var(--ok)">' + q.correct + '</b></span>' +
          '<span>部分对 <b style="color:var(--warn)">' + q.partial + '</b></span>' +
          '<span>答错 <b style="color:var(--bad)">' + q.wrong + '</b></span>' +
          '<span>未作答 <b>' + q.blank + '</b></span>' +
          '<span>平均得分 <b>' + q.avgEarned + '/' + q.points + '</b></span>' +
          (q.type === 'short' && q.correctAnswers.length
            ? '<span>标准答案 <b style="color:var(--ok)">' + esc(q.correctAnswers.join('、')) + '</b></span>' : '') +
        '</div>' + opts;
      box.appendChild(el);
    });
    host.innerHTML = '';
    host.appendChild(box);
  }

  /* ================= 试卷设置 ================= */
  function fillPaperSettings() {
    const p = state.paper;
    if (!p) return;
    $('#pTitle').value = p.title;
    $('#pDesc').value = p.desc || '';
    $('#pAccessCode').value = p.accessCode || '';
    const customPass = p.passPercent !== state.settings.passPercent;
    $('#pPassCustom').checked = customPass;
    $('#pPass').value = p.passPercent;
    $('#pPass').disabled = !customPass;
    const customPartial = p.partialCredit !== state.settings.partialCredit;
    $('#pPartialCustom').checked = customPartial;
    $('#pPartial').checked = !!p.partialCredit;
    $('#pPartial').disabled = !customPartial;
  }

  /* ================= 系统设置 ================= */
  function fillGlobalSettings() {
    const s = state.settings || {};
    $('#setTitle').value = s.title || '';
    $('#setSubtitle').value = s.subtitle || '';
    $('#setPass').value = s.passPercent === undefined ? 60 : s.passPercent;
    $('#setPartial').checked = s.partialCredit !== false;
  }

  /* ================= 下载 ================= */
  async function download(url, filename) {
    const token = localStorage.getItem('quiz_admin_token');
    const res = await fetch(url, { headers: { 'x-admin-token': token } });
    if (!res.ok) { toast('导出失败', 'err'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    $('#loginBtn').addEventListener('click', login);
    $('#pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('#logoutBtn').addEventListener('click', () => {
      api('/api/admin/logout', { method: 'POST' }).catch(() => {}).then(() => logout());
    });
    $('#newPaperBtn').addEventListener('click', newPaper);
    $('#backToListBtn').addEventListener('click', showPapers);
    $('#shareLinkBtn').addEventListener('click', () => { if (state.paper) doCopy(state.paper.url); });
    $('#shareQrBtn').addEventListener('click', () => {
      if (state.paper && state.paper.status === 'published') showQrModal(state.paper.url, state.paper.title);
    });
    $('#publishBtn').addEventListener('click', (e) => { if (state.paper) togglePublish(state.paper, e.target); });
    $('#sharePaperName').addEventListener('click', () => { if (state.paper) renamePaper(state.paper); });

    $$('#view-workspace .nav-item').forEach((b) => b.addEventListener('click', () => setSubView(b.dataset.view)));

    // 编辑器
    $('#typeSingle').addEventListener('click', () => setType('single'));
    $('#typeShort').addEventListener('click', () => setType('short'));
    $('#addOptionBtn').addEventListener('click', () => {
      if (state.editor.options.length >= 8) { toast('最多 8 个选项', 'warn'); return; }
      state.editor.options.push('');
      renderOptions(state.editor.options.length - 1);
    });
    $('#saveBtn').addEventListener('click', () => saveQuestion(false));
    $('#saveNewBtn').addEventListener('click', () => saveQuestion(true));
    $('#clearFormBtn').addEventListener('click', () => resetEditor(false));
    $('#qPoints').addEventListener('input', updateEditorTotal);
    $('#shortAnswer').addEventListener('input', updateShortPreview);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' &&
          state.paper && !$('#sub-editor').classList.contains('hidden')) {
        e.preventDefault();
        saveQuestion(false);
      }
    });

    // 题库
    $('#searchBox').addEventListener('input', (e) => { state.keyword = e.target.value; renderQuestionList(); });
    $$('#sub-list .chip').forEach((c) => c.addEventListener('click', () => {
      state.filterType = c.dataset.f;
      $$('#sub-list .chip').forEach((x) => x.classList.toggle('active', x === c));
      renderQuestionList();
    }));

    // 导入
    $('#parseBtn').addEventListener('click', previewImport);
    $('#importAppendBtn').addEventListener('click', () => doImport(false));
    $('#importReplaceBtn').addEventListener('click', () => doImport(true));
    $('#sampleBtn').addEventListener('click', () => {
      $('#importText').value =
        '1. 中国的首都是哪座城市？（2分）\n' +
        'A. 北京\nB. 上海\nC. 广州\nD. 深圳\n' +
        '答案：A\n\n' +
        '2. 请写出三种三原色\n' +
        '答案：红色、绿色、蓝色\n\n' +
        '3. 下列哪个不是编程语言？\n' +
        'A. Python\nB. Java\nC. HTML\nD. Go\n' +
        '答案：C\n';
      previewImport();
    });

    // 题库排序
    $('#qSortSelect').addEventListener('change', (e) => {
      state.qSort = e.target.value;
      renderQuestionList();
      if (state.qSort !== 'manual') toast('已按所选方式排序（不会改变答题顺序）', 'ok', 1800);
    });

    // 成绩：先筛选再查询
    $('#scoreQueryBtn').addEventListener('click', loadSubmissions);
    $('#scoreResetBtn').addEventListener('click', () => { resetScoreQuery(); openScores(); });
    $('#fQuestion').addEventListener('change', (e) => {
      $('#fQStatus').disabled = !e.target.value;
      if (!e.target.value) $('#fQStatus').value = 'any';
    });
    ['#fName', '#fMin', '#fMax', '#fPass', '#fFrom', '#fTo', '#fQStatus'].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSubmissions(); });
      if (el.tagName === 'SELECT') el.addEventListener('change', () => { if (state.scoreQueried) loadSubmissions(); });
    });

    // 数据统计
    $('#qStatSort').addEventListener('change', (e) => {
      state.qStatSort = e.target.value;
      renderQuestionStats();
    });
    $('#studentSearch').addEventListener('input', renderStudentTable);
    $('#exportStudentsBtn').addEventListener('click', (e) => {
      e.preventDefault();
      if (state.paper) download('/api/admin/export?format=csv&type=students&paperId=' +
        encodeURIComponent(state.paper.id), state.paper.title + '-人员成绩.csv');
    });
    $('#exportQuestionsBtn').addEventListener('click', (e) => {
      e.preventDefault();
      if (state.paper) download('/api/admin/export?format=csv&type=questions&paperId=' +
        encodeURIComponent(state.paper.id), state.paper.title + '-题目统计.csv');
    });
    $('#exportCsvBtn').addEventListener('click', (e) => {
      e.preventDefault();
      if (state.paper) download('/api/admin/export?format=csv&paperId=' + encodeURIComponent(state.paper.id),
        state.paper.title + '-成绩.csv');
    });
    $('#clearScoresBtn').addEventListener('click', async () => {
      const v = await confirmDialog({
        title: '清空本套成绩记录',
        html: '将删除本套试卷的 <b>' + state.submissions.length + '</b> 条提交记录，不可恢复。<br><br>请输入 <b>DELETE</b>：',
        requireText: 'DELETE', okText: '确认清空', danger: true
      });
      if (v === null) return;
      try {
        await api('/api/admin/submissions', { method: 'DELETE', body: { confirm: v, paperId: state.paper.id } });
        state.submissions = [];
        renderScores();
        toast('已清空', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });

    // 试卷设置
    $('#pPassCustom').addEventListener('change', (e) => { $('#pPass').disabled = !e.target.checked; });
    $('#pPartialCustom').addEventListener('change', (e) => { $('#pPartial').disabled = !e.target.checked; });
    $('#savePaperBtn').addEventListener('click', async () => {
      if (!state.paper) return;
      try {
        const body = {
          title: $('#pTitle').value,
          desc: $('#pDesc').value,
          accessCode: $('#pAccessCode').value,
          passPercent: $('#pPassCustom').checked ? Number($('#pPass').value) : null,
          partialCredit: $('#pPartialCustom').checked ? $('#pPartial').checked : null
        };
        const r = await api('/api/admin/papers/' + state.paper.id, { method: 'PUT', body });
        state.paper = r.paper;
        renderShareBar();
        await loadPapers();
        state.paper = state.papers.find((x) => x.id === r.paper.id) || r.paper;
        renderShareBar();
        fillPaperSettings();
        toast('试卷设置已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#exportPaperBtn').addEventListener('click', (e) => {
      e.preventDefault();
      if (state.paper) download('/api/admin/export?format=json&paperId=' + encodeURIComponent(state.paper.id),
        state.paper.title + '-题库.json');
    });
    $('#duplicatePaperBtn').addEventListener('click', async () => {
      if (!state.paper) return;
      await duplicatePaper(state.paper);
    });
    $('#deletePaperBtn').addEventListener('click', async () => {
      if (!state.paper) return;
      await deletePaper(state.paper);
    });

    // 系统设置
    $('#saveSettingsBtn').addEventListener('click', async () => {
      try {
        const r = await api('/api/admin/settings', {
          method: 'POST',
          body: {
            title: $('#setTitle').value,
            subtitle: $('#setSubtitle').value,
            passPercent: Number($('#setPass').value),
            partialCredit: $('#setPartial').checked
          }
        });
        state.settings = r.settings;
        toast('系统设置已保存', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#savePwdBtn').addEventListener('click', async () => {
      const pw = $('#setPwd').value;
      if (!pw) { toast('请输入新密码', 'warn'); return; }
      const v = await confirmDialog({
        title: '修改管理密码', html: '修改后所有登录会话会失效，需要重新登录。确定继续？', okText: '修改'
      });
      if (!v) return;
      try {
        await api('/api/admin/settings', { method: 'POST', body: { newPassword: pw } });
        toast('密码已修改，请重新登录', 'ok', 2000);
        setTimeout(() => { localStorage.removeItem('quiz_admin_token'); location.reload(); }, 900);
      } catch (e) { toast(e.message, 'err'); }
    });

    // 分享页
    $('#copyUrlBtn').addEventListener('click', () => { if (state.paper) doCopy(state.paper.url); });
    $('#downloadQrBtn').addEventListener('click', () => {
      const canvas = $('#shareCanvas');
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = '答题二维码-' + (state.paper ? state.paper.title.replace(/[\\/:*?"<>|]/g, '_') : '试卷') + '.png';
      a.click();
    });

    window.addEventListener('resize', () => {
      if (state.paper && !$('#sub-share').classList.contains('hidden')) renderShareView();
    });
  }

  /* ================= 启动 ================= */
  async function boot() {
    bind();
    setType('single');
    renderOptions();
    const token = localStorage.getItem('quiz_admin_token');
    if (!token) { showLogin(); return; }
    try {
      await api('/api/admin/check');
      showMain();
      await loadPapers();
      showPapers();
    } catch (e) {
      localStorage.removeItem('quiz_admin_token');
      showLogin();
    }
  }

  boot();
})();
