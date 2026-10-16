/* 答题页（对应短链 /p/<CODE>） */
(function () {
  'use strict';
  const { api, esc, toast, confirmDialog, paperCode } = window.QZ;

  const CODE = paperCode();
  const state = {
    paper: null,
    accessCode: '',
    questions: [],
    answers: {},
    startedAt: Date.now(),
    submitting: false
  };

  const $ = (id) => document.getElementById(id);

  function splitValues(v) {
    return String(v || '').split(/[、,，;；\n\r\t]+/).map((s) => s.trim()).filter(Boolean);
  }
  function answeredCount() {
    let n = 0;
    for (const q of state.questions) {
      const a = state.answers[q.id];
      if (q.type === 'single') { if (a !== undefined && a !== null && a !== '') n++; }
      else if (String(a || '').trim()) n++;
    }
    return n;
  }
  function updateProgress() {
    $('progressTip').textContent = `已作答 ${answeredCount()} / ${state.questions.length} 题`;
  }

  function renderQuestion(q, i) {
    const el = document.createElement('div');
    el.className = 'q-item';
    el.dataset.qid = q.id;

    const head = document.createElement('div');
    head.className = 'q-title';
    head.innerHTML =
      `<span class="q-no">${i + 1}</span>` +
      `<span class="q-tag ${q.type === 'single' ? 'single' : 'short'}">${q.type === 'single' ? '单选题' : '简答题'}</span>` +
      `<span class="q-text">${esc(q.title)}</span>` +
      `<span class="q-pts">${q.points} 分</span>`;
    el.appendChild(head);

    if (q.type === 'single') {
      q.options.forEach((opt, oi) => {
        const label = document.createElement('label');
        label.className = 'opt';
        label.innerHTML =
          `<input type="radio" name="q_${q.id}" value="${oi}">` +
          `<span class="letter">${String.fromCharCode(65 + oi)}</span>` +
          `<span>${esc(opt)}</span>`;
        const input = label.querySelector('input');
        input.addEventListener('change', () => {
          state.answers[q.id] = oi;
          el.querySelectorAll('.opt').forEach((o) => o.classList.remove('checked'));
          label.classList.add('checked');
          updateProgress();
        });
        el.appendChild(label);
      });
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'short-input-wrap';
      wrap.innerHTML =
        `<input type="text" placeholder="请输入答案，多个值用 、 分隔" autocomplete="off">` +
        `<span class="tail" data-tail></span>`;
      const input = wrap.querySelector('input');
      const tail = wrap.querySelector('[data-tail]');
      input.addEventListener('input', () => {
        state.answers[q.id] = input.value;
        const n = splitValues(input.value).length;
        tail.textContent = n > 1 ? `${n} 个值` : '';
        updateProgress();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
      el.appendChild(wrap);
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = '提示：多个答案请用顿号（、）分开，例如：红色、绿色、蓝色';
      el.appendChild(hint);
    }
    return el;
  }

  function renderQuestions() {
    const box = $('questions');
    box.innerHTML = '';
    state.questions.forEach((q, i) => box.appendChild(renderQuestion(q, i)));
    $('submitBtn').disabled = !state.questions.length;
    updateProgress();
  }

  async function loadQuestions() {
    const r = await api(`/api/papers/${CODE}/questions`, {
      method: 'POST', body: { accessCode: state.accessCode }
    });
    state.questions = r.questions || [];
    state.startedAt = Date.now();
    renderQuestions();
  }

  async function submit() {
    if (state.submitting) return;
    const name = $('nameInput').value.trim();
    $('submitErr').textContent = '';
    if (!name) {
      $('submitErr').textContent = '请先填写姓名';
      $('nameInput').focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const unanswered = state.questions.filter((q) => {
      const a = state.answers[q.id];
      return q.type === 'single' ? (a === undefined || a === null || a === '') : !String(a || '').trim();
    });
    if (unanswered.length) {
      const ok = await confirmDialog({
        title: '还有题目未作答',
        html: `还有 <b>${unanswered.length}</b> 道题没有作答，未作答将计 0 分。<br>确定要现在提交吗？`,
        okText: '仍然提交'
      });
      if (!ok) return;
    }

    state.submitting = true;
    $('submitBtn').disabled = true;
    $('submitBtn').textContent = '提交中…';
    try {
      const r = await api(`/api/papers/${CODE}/submit`, {
        method: 'POST',
        body: {
          name, answers: state.answers, accessCode: state.accessCode,
          durationMs: Date.now() - state.startedAt
        }
      });
      localStorage.setItem('quiz_last_name', name);
      location.href = '/result.html?id=' + encodeURIComponent(r.id);
    } catch (e) {
      $('submitErr').textContent = e.message;
      state.submitting = false;
      $('submitBtn').disabled = false;
      $('submitBtn').textContent = '④ 提交答卷';
    }
  }

  function timer() {
    setInterval(() => {
      const s = Math.floor((Date.now() - state.startedAt) / 1000);
      const p = (n) => String(n).padStart(2, '0');
      $('timer').textContent = `用时 ${p(Math.floor(s / 60))}:${p(s % 60)}`;
    }, 1000);
  }

  function showError(msg) {
    $('gateWrap').style.display = 'none';
    $('mainWrap').style.display = 'none';
    $('errorWrap').style.display = 'block';
    $('errorMsg').textContent = msg;
  }

  async function unlockGate() {
    $('gateErr').textContent = '';
    const v = $('gateInput').value.trim();
    if (!v) { $('gateErr').textContent = '请输入口令'; return; }
    try {
      await api(`/api/papers/${CODE}/questions`, { method: 'POST', body: { accessCode: v } });
      state.accessCode = v;
      sessionStorage.setItem('quiz_gate_' + CODE, v);
      await enter();
    } catch (e) {
      $('gateErr').textContent = e.message;
    }
  }

  async function enter() {
    try {
      await loadQuestions();
      $('gateWrap').style.display = 'none';
      $('errorWrap').style.display = 'none';
      $('mainWrap').style.display = 'block';
      $('pageTitle').textContent = state.paper.title;
      $('pageSubtitle').textContent = state.paper.desc ||
        `共 ${state.paper.questionCount} 题，总分 ${state.paper.totalPoints} 分，及格线 ${state.paper.passPercent}%。`;
      document.title = state.paper.title;
      window.scrollTo(0, 0);
    } catch (e) {
      showError(e.message);
    }
  }

  async function boot() {
    if (!CODE) { showError('链接不完整，请使用出题人分享的完整链接'); return; }
    try {
      const d = await api('/api/papers/' + CODE);
      state.paper = d.paper;
      document.title = d.paper.title;
      document.getElementById('brandTitle').textContent = d.paper.title;

      if (d.paper.needAccessCode) {
        const cached = sessionStorage.getItem('quiz_gate_' + CODE);
        $('gateDesc').textContent = `「${d.paper.title}」需要口令才能进入，请向出题人索取。`;
        if (cached) {
          state.accessCode = cached;
          await enter();
          if ($('mainWrap').style.display === 'block') return;
          sessionStorage.removeItem('quiz_gate_' + CODE);
          state.accessCode = '';
        }
        $('gateWrap').style.display = 'block';
        setTimeout(() => $('gateInput').focus(), 60);
        return;
      }
      await enter();
    } catch (e) {
      showError(e.message);
    }
  }

  $('submitBtn').addEventListener('click', submit);
  $('gateBtn').addEventListener('click', unlockGate);
  $('gateInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockGate(); });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
  });

  const lastName = localStorage.getItem('quiz_last_name');
  if (lastName) $('nameInput').value = lastName;

  timer();
  boot();
})();
