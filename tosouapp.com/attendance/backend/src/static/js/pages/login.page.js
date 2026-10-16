import { login, me, refresh } from '../api/auth.api.js';

const $ = (sel) => document.querySelector(sel);

try {
  const p = String(window.location && window.location.pathname || '');
  if (p.includes('expenses-login')) {
    window.LOGIN_NEXT = '/ui/expenses';
  }
} catch (e) { /* silently ignored */ }

function hidePageSpinner() {
  try {
    const ps = document.querySelector('#pageSpinner');
    if (!ps) return;
    ps.setAttribute('hidden', '');
    ps.style.display = 'none';
  } catch (e) { /* silently ignored */ }
}

function showPageSpinner() {
  try {
    let ps = document.querySelector('#pageSpinner');
    if (!ps) {
      ps = document.createElement('div');
      ps.id = 'pageSpinner';
      ps.className = 'page-spinner';
      ps.innerHTML = '<div class="lds-spinner" aria-hidden="true"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div><div class="kintai-success-anim" aria-hidden="true"></div>';
      document.body.appendChild(ps);
    }
    ps.removeAttribute('hidden');
    ps.style.display = 'grid';
  } catch (e) { /* silently ignored */ }
}

function setError(msg) {
  const el = $('#error'); el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none';
}


// Người đăng nhập khác với chủ cache bảng tháng trên máy này → xoá cache của người trước.
// Cùng người đăng nhập lại → giữ cache để bảng tháng hiển thị ngay.
function clearMonthlyCacheIfOwnerChanged(email, username) {
  try {
    const owner = String(email || username || '').trim().toLowerCase();
    const prev = String(localStorage.getItem('monthlyCacheOwner') || '');
    if (!owner || prev !== owner) {
      localStorage.removeItem('monthly.lastParams');
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('monthly.cache.')) localStorage.removeItem(key);
      });
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('monthly.cache.')) sessionStorage.removeItem(key);
      });
    }
    if (owner) localStorage.setItem('monthlyCacheOwner', owner);
  } catch (e) { /* silently ignored */ }
}

function saveAuth({ accessToken, username, email, role, tenants, tenantId, tenantName }) {
  clearMonthlyCacheIfOwnerChanged(email, username);
  sessionStorage.setItem('accessToken', accessToken);
  // Backup to localStorage so select-company page survives Chrome password popup
  try { localStorage.setItem('accessToken', accessToken); } catch (e) { /* silently ignored */ }
  const userObj = { username, email, role };
  if (tenantId) { userObj.tenantId = tenantId; userObj.tenantName = tenantName; }
  sessionStorage.setItem('user', JSON.stringify(userObj));
  try {
    localStorage.setItem('user', JSON.stringify(userObj));
  } catch (e) { /* silently ignored */ }
  // Save tenant list for select-company page
  if (Array.isArray(tenants) && tenants.length > 0) {
    try { sessionStorage.setItem('sc_tenants', JSON.stringify(tenants)); } catch (e) { /* silently ignored */ }
    try { localStorage.setItem('sc_tenants', JSON.stringify(tenants)); } catch (e) { /* silently ignored */ }
  } else {
    try { sessionStorage.removeItem('sc_tenants'); } catch (e) { /* silently ignored */ }
    try { localStorage.removeItem('sc_tenants'); } catch (e) { /* silently ignored */ }
  }
}

async function tryRefresh() {
  try {
    const r = await refresh();
    sessionStorage.setItem('accessToken', r.accessToken);
    return r.accessToken;
  } catch (e) { return null; }
}

function getCookie(name) { return null; }

function roleRedirect(role, nextPath) {
  try { sessionStorage.setItem('navSpinner', '1'); } catch (e) { /* silently ignored */ }
  showPageSpinner();
  const suggested = String(nextPath || '').trim();
  const r = String(role || '').toLowerCase();

  let dest = (suggested && suggested.startsWith('/') && !suggested.startsWith('//'))
    ? suggested
    : ((r === 'admin' || r === 'manager' || r === 'sysadmin' || r === 'owner')
        ? `/admin/dashboard?boot=${Date.now()}`
        : '/ui/portal');

  try { window.location.href = dest; } catch (e) { /* silently ignored */ }
}

async function handleSubmit(e) {
  e.preventDefault();
  setError('');
  const statusEl = document.querySelector('#status');
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const form = $('#loginForm');
  if (form && !form.checkValidity()) {
    try { form.reportValidity(); } catch (e) { /* silently ignored */ }
    setError('メール/パスワードを正しく入力してください');
    hidePageSpinner();
    return;
  }
  if (!email || !password) {
    setError('メール/パスワードを入力してください');
    hidePageSpinner();
    return;
  }

  const btn = $('#loginBtn');
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  if (statusEl) { statusEl.textContent = 'ログイン中...'; }
  showPageSpinner();
  let navigated = false;
  try {
    const data = await login(email, password);
    saveAuth(data);
    // Hide entire page immediately to prevent logo flash during navigation
    try {
      document.body.style.opacity = '0';
      document.body.style.transition = 'none';
      const wrapper = document.querySelector('.wrapper');
      if (wrapper) wrapper.style.display = 'none';
      const hero = document.querySelector('.hero');
      if (hero) hero.style.display = 'none';
    } catch (e) { /* silently ignored */ }
    navigated = true;
    roleRedirect(data.role, data.nextPath);
  } catch (err) {
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('invalid') || msg.includes('not found') || msg.includes('unauthorized')) {
      setError('メールまたはパスワードが正しくありません');
    } else if (msg.includes('locked')) {
      setError('アカウントが一時的にロックされています。しばらくしてからお試しください');
    } else if (msg.includes('abort') || msg.includes('timeout')) {
      setError('サーバーが応答しません。しばらくしてからお試しください');
    } else if (msg.startsWith('http')) {
      setError('サーバーが応答しません ( ' + err.message + ' )');
    } else {
      setError('ログインに失敗しました: ' + (err.message || 'unknown'));
    }
  }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = 'ログイン'; btn.removeAttribute('aria-busy'); }
    if (statusEl) { statusEl.textContent = ''; }
    if (!navigated) hidePageSpinner();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try { sessionStorage.removeItem('navSpinner'); } catch (e) { /* silently ignored */ }
  hidePageSpinner();
  try {
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('user');
    // Also clear localStorage tokens on login page load
    localStorage.removeItem('accessToken');
    localStorage.removeItem('sc_tenants');
  } catch (e) { /* silently ignored */ }
  try {
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    // Cache bảng tháng KHÔNG xoá ở đây nữa: giữ lại để cùng người đăng nhập lại mở ra là thấy ngay.
    // Khi người KHÁC đăng nhập, saveAuth() xoá cache (và bảng tháng chỉ dùng cache đúng chủ).
  } catch (e) { /* silently ignored */ }
  try {
    const ref = document.referrer || '';
    void ref;
  } catch (e) { /* silently ignored */ }
  try {
    window.addEventListener('pageshow', () => {
      try {
        sessionStorage.removeItem('accessToken');
        sessionStorage.removeItem('refreshToken');
        sessionStorage.removeItem('user');
      } catch (e) { /* silently ignored */ }
      try {
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
      } catch (e) { /* silently ignored */ }
      try {
        sessionStorage.removeItem('navSpinner');
        hidePageSpinner();
        const ref = document.referrer || '';
        void ref;
      } catch (e) { /* silently ignored */ }
    });
  } catch (e) { /* silently ignored */ }
  const form = $('#loginForm');
  const emailInput = $('#email');
  const passwordInput = $('#password');
  const btn = $('#loginBtn');
  const updateBtnState = () => {
    const email = emailInput && emailInput.value != null ? String(emailInput.value).trim() : '';
    const pass = passwordInput && passwordInput.value != null ? String(passwordInput.value) : '';
    const ok = !!(email && pass);
    if (btn) { btn.disabled = !ok; btn.setAttribute('aria-disabled', (!ok).toString()); }
    try {
      const grp = document.querySelector('.input-group');
      if (grp) {
        const hasAny = !!(email || pass);
        if (hasAny) grp.classList.add('filled');
        else grp.classList.remove('filled');
      }
    } catch (e) { /* silently ignored */ }
  };
  form.addEventListener('submit', handleSubmit);
  updateBtnState();
  // ブラウザのパスワードマネージャ自動入力は 'input'/'change' を発火しないことがあり、
  // ログインボタンが disabled のまま残る。:-webkit-autofill の CSS アニメーションを
  // animationstart で検知して再評価する(CSS に onAutoFillStart がなければ何も起こらず安全)。
  [emailInput, passwordInput].forEach(el => {
    if (!el) return;
    el.addEventListener('input', updateBtnState);
    el.addEventListener('change', updateBtnState);
    el.addEventListener('animationstart', e => { if (e.animationName === 'onAutoFillStart') updateBtnState(); });
  });
  try {
    // パスワードマネージャ(ブラウザ内蔵/拡張機能問わず)の自動入力タイミングは一定しないため、
    // 数秒間は定期的に値を直接読み直してボタン状態を強制的に正す(イベント発火に依存しない)。
    let ticks = 0;
    const iv = setInterval(() => {
      updateBtnState();
      ticks += 1;
      if (ticks >= 15) clearInterval(iv);
    }, 200);
  } catch (e) { /* silently ignored */ }
  const toggle = $('#togglePassword');
  const EYE_ON = `<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF = `<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.73 5.08A10.47 10.47 0 0 1 12 5c7 0 11 7 11 7a19.54 19.54 0 0 1-4.21 4.62"/><path d="M6.11 6.11A19.45 19.45 0 0 0 1 12s4 7 11 7a10.65 10.65 0 0 0 3.89-.73"/><circle cx="12" cy="12" r="3"/></svg>`;
  toggle.innerHTML = EYE_OFF;
  toggle.addEventListener('click', () => {
    const input = $('#password');
    input.type = input.type === 'password' ? 'text' : 'password';
    toggle.innerHTML = input.type === 'password' ? EYE_OFF : EYE_ON;
    toggle.setAttribute('aria-label', input.type === 'password' ? '表示' : '非表示');
    input.focus();
  });
  const remember = $('#remember');
  if (remember) {
    remember.addEventListener('change', () => {
      localStorage.setItem('remember', remember.checked ? '1' : '0');
    });
  }

  // Extra-safe policy navigation: avoid accidental form submit or blocked anchor taps.
  const bindForceNav = (id, href) => {
    const el = document.getElementById(id);
    if (!el) return;
    const go = (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch (e) { /* silently ignored */ }
      try { window.location.assign(href); } catch (e) { window.location.href = href; }
    };
    el.addEventListener('click', go, true);
    el.addEventListener('pointerdown', go, true);
  };
  bindForceNav('termsLinkInline', '/terms');
  bindForceNav('privacyLinkInline', '/privacy');
  bindForceNav('termsLinkCircle', '/terms');
  bindForceNav('privacyLinkCircle', '/privacy');
});

/* ログインし直したら、×で消したヘルプのキャラクターをまた表示する（help-bot.js） */
try{localStorage.removeItem("igb-hidden")}catch{}
