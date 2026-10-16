/* 公共工具 */
(function (global) {
  'use strict';

  async function api(path, options) {
    const opt = Object.assign({}, options || {});
    opt.headers = Object.assign({ 'Content-Type': 'application/json' }, opt.headers || {});
    const token = localStorage.getItem('quiz_admin_token');
    if (token) opt.headers['x-admin-token'] = token;
    if (opt.body && typeof opt.body !== 'string') opt.body = JSON.stringify(opt.body);
    let res;
    try {
      res = await fetch(path, opt);
    } catch (e) {
      throw new Error('无法连接服务器，请确认服务已启动');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || !data || data.ok === false) {
      const msg = (data && data.error) || ('请求失败 (' + res.status + ')');
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type, ms) {
    let host = document.querySelector('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, ms || 2200);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';
    const m = Math.floor(s / 60);
    return m + ' 分 ' + (s % 60) + ' 秒';
  }

  /** 从 /p/CODE 或 ?p=CODE 取出试卷码 */
  function paperCode() {
    const m = location.pathname.match(/\/p\/([A-Za-z0-9]+)/);
    if (m) return m[1].toUpperCase();
    const q = new URLSearchParams(location.search).get('p') || new URLSearchParams(location.search).get('code');
    return q ? q.toUpperCase() : '';
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      const needInput = !!opts.requireText;
      mask.innerHTML =
        '<div class="modal">' +
        '<h3>' + esc(opts.title || '确认') + '</h3>' +
        '<div class="muted">' + (opts.html || esc(opts.message || '')) + '</div>' +
        (needInput ? '<div class="mt16"><input type="text" id="dlgInput" placeholder="' + esc(opts.requireText) + '" autocomplete="off"></div>' : '') +
        '<div class="modal-actions">' +
        '<button class="btn ghost" data-act="cancel">取消</button>' +
        '<button class="btn ' + (opts.danger ? 'danger' : '') + '" data-act="ok">' + esc(opts.okText || '确定') + '</button>' +
        '</div></div>';
      document.body.appendChild(mask);
      const input = mask.querySelector('#dlgInput');
      if (input) setTimeout(function () { input.focus(); }, 30);
      function close(v) { mask.remove(); resolve(v); }
      mask.addEventListener('click', function (e) {
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'cancel' || e.target === mask) return close(needInput ? null : false);
        if (act === 'ok') return close(needInput ? input.value : true);
      });
      mask.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close(needInput ? null : false);
        if (e.key === 'Enter' && e.target === input) close(input.value);
      });
    });
  }

  function promptDialog(opts) {
    return new Promise(function (resolve) {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="modal">' +
        '<h3>' + esc(opts.title || '输入') + '</h3>' +
        (opts.message ? '<div class="muted mb12">' + esc(opts.message) + '</div>' : '') +
        '<input type="text" id="pdlgInput" placeholder="' + esc(opts.placeholder || '') + '" autocomplete="off">' +
        '<div class="modal-actions">' +
        '<button class="btn ghost" data-act="cancel">取消</button>' +
        '<button class="btn" data-act="ok">' + esc(opts.okText || '确定') + '</button>' +
        '</div></div>';
      document.body.appendChild(mask);
      const input = mask.querySelector('#pdlgInput');
      if (opts.value) input.value = opts.value;
      setTimeout(function () { input.focus(); input.select(); }, 40);
      function close(v) { mask.remove(); resolve(v); }
      mask.addEventListener('click', function (e) {
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'cancel' || e.target === mask) return close(null);
        if (act === 'ok') return close(input.value.trim());
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') close(input.value.trim());
        if (e.key === 'Escape') close(null);
      });
    });
  }

  function param(name) {
    return new URLSearchParams(location.search).get(name) || '';
  }

  global.QZ = {
    api: api, esc: esc, toast: toast, fmtDate: fmtDate, fmtDuration: fmtDuration,
    confirmDialog: confirmDialog, promptDialog: promptDialog, param: param,
    paperCode: paperCode, copyText: copyText
  };
})(window);
