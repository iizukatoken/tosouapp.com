import { logout } from '../api/auth.api.js';
import { fetchJSONAuth } from '../api/http.api.js';
import '/static/js/pages/employee-notify.sticky.js';

const $ = (sel) => document.querySelector(sel);

const prefillUserName = () => {
  try {
    const el = $('#userName');
    if (!el) return;
    const raw = sessionStorage.getItem('user') || localStorage.getItem('user') || '';
    const u = raw ? JSON.parse(raw) : null;
    const name = (u && (u.username || u.email)) ? String(u.username || u.email) : '';
    if (name) el.textContent = name;
  } catch (e) { /* silently ignored */ }
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const showErr = (msg) => {
  const el = $('#error');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'block';
  el.textContent = msg;
};

// Toast thành công/lỗi hiển thị ở trên đầu màn hình, tự ẩn sau vài giây
let adjToastTimer = null;
const showToast = (msg, type = 'success') => {
  try {
    let el = document.getElementById('adjToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'adjToast';
      el.className = 'adj-toast';
      document.body.appendChild(el);
    }
    const icon = type === 'error'
      ? '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z"></path></svg>'
      : '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>';
    el.className = 'adj-toast' + (type === 'error' ? ' error' : '');
    el.innerHTML = icon + '<span>' + String(msg == null ? '' : msg) + '</span>';
    // Kích hoạt hiệu ứng trượt xuống
    void el.offsetWidth;
    el.classList.add('show');
    try { clearTimeout(adjToastTimer); } catch (e) { /* silently ignored */ }
    adjToastTimer = setTimeout(() => { el.classList.remove('show'); }, 3200);
  } catch (e) { /* silently ignored */ }
};

let spinnerCount = 0;
let spinnerTimer = null;
const showSpinner = () => {
  try {
    const el = document.querySelector('#pageSpinner');
    spinnerCount++;
    if (!el) return;
    if (spinnerCount === 1) {
      try { clearTimeout(spinnerTimer); } catch (e) { /* silently ignored */ }
      spinnerTimer = setTimeout(() => {
        try {
          if (spinnerCount > 0) {
            el.removeAttribute('hidden');
            el.style.display = 'grid';
          }
        } catch (e) { /* silently ignored */ }
      }, 180);
    }
  } catch (e) { /* silently ignored */ }
};
const hideSpinner = () => {
  try {
    const el = document.querySelector('#pageSpinner');
    spinnerCount = Math.max(0, spinnerCount - 1);
    if (spinnerCount !== 0) return;
    try { clearTimeout(spinnerTimer); } catch (e) { /* silently ignored */ }
    spinnerTimer = null;
    if (el) { el.setAttribute('hidden', ''); el.style.display = 'none'; }
  } catch (e) { /* silently ignored */ }
};

const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const todayISO = () => new Date().toLocaleDateString('sv-SE');

const addDaysISO = (d, n) => {
  const [y, m, dd] = String(d).split('-').map(x => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (dd || 1) + n));
  return dt.toISOString().slice(0, 10);
};
// 再申請フォーム用: 出勤・退勤が対象日(退勤は翌日まで可)で、退勤が出勤より後かを確認
const validateAdjustPair = (inDT, outDT, baseDate) => {
  const inD = String(inDT || '').slice(0, 10);
  const outD = String(outDT || '').slice(0, 10);
  if (baseDate && inD && inD !== baseDate) return `出勤の日付は対象日（${baseDate.replace(/-/g, '/')}）にしてください`;
  if (baseDate && outD && outD !== baseDate && outD !== addDaysISO(baseDate, 1)) return `退勤の日付は対象日（${baseDate.replace(/-/g, '/')}）または翌日にしてください`;
  if (inDT && outDT && String(outDT) <= String(inDT)) return '退勤時刻は出勤時刻より後にしてください';
  return '';
};

const toMySQLDateTime = (dtLocal) => {
  const s = String(dtLocal || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s.replace('T', ' ') + ':00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return s.replace('T', ' ');
  return null;
};

let openAdjustChatId = null;
const adjustChatCache = Object.create(null);
const adjustChatLoading = Object.create(null);
const adjustChatErrors = Object.create(null);

const fmtAdjustChatDate = (val) => {
  if (!val) return '';
  return String(val).slice(0, 16).replace('T', ' ');
};

const loadAdjustMessages = async (id) => {
  adjustChatLoading[id] = true;
  delete adjustChatErrors[id];
  try {
    const rows = await fetchJSONAuth(`/api/adjust/${encodeURIComponent(id)}/messages`);
    adjustChatCache[id] = Array.isArray(rows) ? rows : [];
  } catch (e) {
    adjustChatErrors[id] = e?.message || 'unknown';
    adjustChatCache[id] = [];
    throw e;
  } finally {
    delete adjustChatLoading[id];
  }
};

const sendAdjustMessage = async (id, message) => {
  await fetchJSONAuth(`/api/adjust/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message })
  });
  await loadAdjustMessages(id);
};

const openAdjustChatModal = (id) => {
  const r = requestsCache.find((it) => String(it.id) === String(id));
  if (!r) return;

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.48);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

  const renderBody = () => {
    const loading = !!adjustChatLoading[id];
    const messages = Array.isArray(adjustChatCache[id]) ? adjustChatCache[id] : [];
    const error = String(adjustChatErrors[id] || '').trim();
    const intro = r.admin_note
      ? `<div style="margin-bottom:8px;padding:8px 10px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12px;"><strong>差戻し理由:</strong> ${esc(r.admin_note)}</div>`
      : '';
    const errorHtml = error
      ? `<div style="margin-bottom:8px;padding:8px 10px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:12px;">やり取りの読み込みに失敗しました: ${esc(error)}</div>`
      : '';
    const listHtml = loading
      ? '<div style="font-size:12px;color:#64748b;">読み込み中...</div>'
      : (messages.length
          ? messages.map((msg) => {
              const isMine = String(msg.sender_user_id) === String(r.userId);
              const align = isMine ? 'flex-end' : 'flex-start';
              const bg = isMine ? '#dbeafe' : '#f8fafc';
              return `
                <div style="display:flex;justify-content:${align};margin-bottom:8px;">
                  <div style="max-width:85%;background:${bg};border:1px solid #dbeafe;border-radius:12px;padding:8px 10px;">
                    <div style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">${esc(msg.sender_name || (isMine ? '自分' : '管理者'))}</div>
                    <div style="font-size:12px;color:#0f172a;white-space:pre-wrap;word-break:break-word;">${esc(msg.message || '')}</div>
                    <div style="font-size:10px;color:#64748b;margin-top:4px;">${esc(fmtAdjustChatDate(msg.created_at))}</div>
                  </div>
                </div>
              `;
            }).join('')
          : '<div style="font-size:12px;color:#64748b;">まだやり取りはありません。</div>');

    return `
      <div style="width:100%;max-width:560px;background:#fff;border-radius:12px;box-shadow:0 20px 45px rgba(15,23,42,0.25);overflow:hidden;display:flex;flex-direction:column;max-height:85vh;">
        <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;color:#0f172a;font-size:15px;">やり取り</div>
          <button type="button" id="btnAdjustChatClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:0;line-height:1;">&times;</button>
        </div>
        <div style="padding:16px 20px;overflow-y:auto;flex:1;background:#f8fafc;">
          ${intro}
          ${errorHtml}
          ${listHtml}
        </div>
        <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#fff;display:flex;gap:8px;align-items:flex-end;">
          <textarea id="adjustChatInputText" placeholder="メッセージを入力..." style="flex:1;min-height:72px;resize:vertical;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;box-sizing:border-box;font:inherit;"></textarea>
          <button id="btnAdjustChatSend" type="button" style="height:36px;padding:0 14px;border-radius:8px;border:1px solid #005eb8;background:#005eb8;color:#fff;cursor:pointer;font-weight:600;">送信</button>
        </div>
      </div>
    `;
  };

  const updateModalBody = () => {
    modal.innerHTML = renderBody();
    bindEvents();
    const chatContainer = modal.children[0].children[1];
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
  };

  const close = () => {
    try { document.body.removeChild(modal); } catch (e) { /* silently ignored */ }
    openAdjustChatId = null;
  };

  const bindEvents = () => {
    modal.querySelector('#btnAdjustChatClose')?.addEventListener('click', close);
    modal.querySelector('#btnAdjustChatSend')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const input = modal.querySelector('#adjustChatInputText');
      const text = String(input?.value || '').trim();
      if (!text) {
        input?.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = '送信中...';
      try {
        await sendAdjustMessage(id, text);
        updateModalBody();
      } catch (err) {
        adjustChatErrors[id] = err?.message || 'unknown';
        updateModalBody();
      }
    });
  };

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.body.appendChild(modal);
  updateModalBody();

  if (!adjustChatCache[id]) {
    loadAdjustMessages(id).then(updateModalBody).catch(updateModalBody);
  }
};

const wireUserMenu = () => {
  const btn = document.querySelector('.user-btn');
  const dd = $('#userDropdown');
  if (!btn || !dd) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const open = !dd.hasAttribute('hidden');
    if (open) dd.setAttribute('hidden', '');
    else dd.removeAttribute('hidden');
    try { btn.setAttribute('aria-expanded', open ? 'false' : 'true'); } catch (e) { /* silently ignored */ }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.user-menu')) return;
    try { dd.setAttribute('hidden', ''); } catch (e) { /* silently ignored */ }
    try { btn.setAttribute('aria-expanded', 'false'); } catch (e) { /* silently ignored */ }
  });
  const logoutBtn = $('#btnLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await logout(); } catch (e) { /* silently ignored */ }
      try { sessionStorage.removeItem('accessToken'); sessionStorage.removeItem('refreshToken'); sessionStorage.removeItem('user'); } catch (e) { /* silently ignored */ }
      try { localStorage.removeItem('refreshToken'); localStorage.removeItem('user'); } catch (e) { /* silently ignored */ }
      window.location.replace('/ui/login');
    });
  }
};

const wireDrawer = () => {
  const btn = $('#mobileMenuBtn');
  const drawer = $('#mobileDrawer');
  const backdrop = $('#drawerBackdrop');
  const closeBtn = $('#mobileClose');
  if (!btn || !drawer || !backdrop) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  const close = () => {
    try { drawer.setAttribute('hidden', ''); backdrop.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); } catch (e) { /* silently ignored */ }
    try { document.body.classList.remove('drawer-open'); } catch (e) { /* silently ignored */ }
  };
  const open = () => {
    try { drawer.removeAttribute('hidden'); backdrop.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); } catch (e) { /* silently ignored */ }
    try { document.body.classList.add('drawer-open'); } catch (e) { /* silently ignored */ }
  };
  btn.addEventListener('click', (e) => { e.preventDefault(); if (drawer.hasAttribute('hidden')) open(); else close(); });
  closeBtn?.addEventListener('click', (e) => { e.preventDefault(); close(); });
  backdrop.addEventListener('click', (e) => { e.preventDefault(); close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  try { drawer.querySelectorAll('.drawer-item, a').forEach(el => el.addEventListener('click', close)); } catch (e) { /* silently ignored */ }
};

const pickLatestSegment = (segments) => {
  const arr = Array.isArray(segments) ? segments : [];
  if (!arr.length) return null;
  let best = arr[0];
  for (const s of arr) {
    const a = String(s?.checkIn || '');
    const b = String(best?.checkIn || '');
    if (a && a > b) best = s;
  }
  return best;
};

const renderForm = async () => {
  const host = $('#adjustFormHost');
  if (!host) return;
  host.innerHTML = `
    <style>
      .sap-compact-card { background: #fff; border: 1px solid #cbd5e1; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border-radius: 4px; padding: 12px 16px; max-width: 500px; margin: 0 0 16px 0; }
      .sap-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; }
      .sap-title { font-size: 14px; font-weight: 700; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 6px; }
      .sap-toolbar { display: flex; gap: 6px; }
      .sap-icon-btn { background: transparent; border: none; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; transition: opacity 0.2s; width: 22px; height: 22px; }
      .sap-icon-btn:hover { opacity: 0.7; }
      .sap-icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      .sap-grid { display: grid; grid-template-columns: 85px 1fr; gap: 8px 12px; align-items: center; }
      .sap-label { font-size: 12px; font-weight: 600; color: #334155; text-align: left; }
      .sap-input { padding: 4px 8px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 2px; width: 100%; box-sizing: border-box; outline: none; transition: border-color 0.2s; display: block; height: 28px; }
      .sap-input.full { max-width: 100%; }
      .sap-textarea { padding: 6px 8px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 2px; width: 100%; box-sizing: border-box; outline: none; resize: vertical; min-height: 50px; font-family: inherit; transition: border-color 0.2s; display: block; }
      .sap-textarea:focus { border-color: #005eb8; box-shadow: 0 0 0 1px rgba(0,94,184,0.1); }
      .sap-input:focus { border-color: #005eb8; box-shadow: 0 0 0 1px rgba(0,94,184,0.1); }
      .sap-current { background: #f8fafc; border: 1px solid #e2e8f0; padding: 4px 8px; font-size: 12px; color: #334155; border-radius: 2px; line-height: 1.4; width: 100%; box-sizing: border-box; display: block; min-height: 28px; display: flex; flex-direction: column; justify-content: center; }
      
      .action-required-card { background: #fff7ed; border-left: 4px solid #ea580c; border-radius: 6px; padding: 16px; max-width: 600px; margin: 0 0 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .action-required-title { font-size: 14px; font-weight: 700; color: #9a3412; margin: 0 0 12px 0; display: flex; align-items: center; gap: 6px; }
      .action-required-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
      .action-required-item { background: #fff; border: 1px solid #fed7aa; padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; }
      .action-required-header { display: flex; justify-content: space-between; align-items: center; }
      .action-required-date { font-weight: 700; color: #1e293b; font-size: 13px; }
      .action-required-reason { font-size: 12px; color: #9a3412; display: block; line-height: 1.4; }
      .action-required-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; border-top: 1px dashed #fed7aa; padding-top: 10px; }
      .action-required-btn { background: #fff; border: 1px solid #cbd5e1; color: #334155; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s; }
      .action-required-btn:hover { background: #f1f5f9; border-color: #94a3b8; }
      .action-required-btn.primary { background: #ea580c; border-color: #ea580c; color: #fff; }
      .action-required-btn.primary:hover { background: #c2410c; border-color: #c2410c; }
      
      .sap-tabs-container {
        border-bottom: 1px solid #cbd5e1;
        margin-bottom: 16px;
        margin-top: 10px;
        display: flex !important;
        gap: 24px;
        overflow-x: auto;
        width: 100%;
        position: relative;
        z-index: 10;
        background: #ffffff;
        min-height: 48px;
        align-items: center;
        visibility: visible !important;
        opacity: 1 !important;
      }
      .sap-tabs-wrapper {
        display: flex !important;
        gap: 24px;
        width: 100%;
        visibility: visible !important;
        opacity: 1 !important;
      }
      .sap-tab {
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 600;
        color: #475569;
        cursor: pointer;
        border-bottom: 3px solid transparent;
        transition: all 0.2s;
        display: flex !important;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
        visibility: visible !important;
        opacity: 1 !important;
      }
      .sap-tab:hover { color: #0f172a; }
      .sap-tab.active {
        color: #0b2c66;
        border-bottom-color: #0b2c66;
      }
      .sap-tab svg { width: 18px; height: 18px; color: currentColor; }
      .tab-badge {
        background: #ea580c;
        color: #fff;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 999px;
        line-height: 1;
      }

      /* Mobile optimizations for the Adjust form */
      @media (max-width: 768px) {
        .sap-tabs-container {
          margin-top: 4px; /* Fix overlapping with topbar */
          margin-bottom: 12px;
          gap: 8px;
          padding: 0;
          border-bottom: none;
        }
        .sap-tabs-wrapper {
          gap: 12px !important;
          padding-bottom: 4px;
        }
        .sap-tab {
          padding: 8px 4px;
          font-size: 13px;
        }
        .sap-compact-card {
          max-width: 100%;
          width: 100%;
          margin: 0 auto 16px auto;
          box-sizing: border-box;
          padding: 12px;
        }
        .sap-grid {
          grid-template-columns: 1fr;
          gap: 4px 0;
        }
        .sap-label {
          margin-top: 8px;
        }
        #adjDate, #adjIn, #adjOut {
          width: 100% !important;
          max-width: 100% !important;
          box-sizing: border-box;
        }
      }
      /* Desktop optimizations */
      @media (min-width: 769px) {
        .sap-tabs-container {
          margin-top: 10px !important;
          margin-bottom: 20px;
          border-bottom: 1px solid #cbd5e1;
          background: transparent;
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        .sap-tabs-wrapper {
          display: flex !important;
          gap: 24px;
          visibility: visible !important;
          opacity: 1 !important;
        }
        .sap-tab {
          padding: 12px 16px;
          font-size: 14px;
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
      }

      /* ===== Form 修正申請: phẳng, góc vuông, tông navy đồng bộ với header ===== */
      .adj-card {
        margin: 0 0 22px 0;
        max-width: 560px;
      }
      /* Khung sửa đơn trong tab 履歴 vẫn cần viền để tách khỏi danh sách */
      .inline-edit-row.adj-card { background: #fff; border: 1px solid #cbd5e1; padding: 14px; }
      .adj-card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        font-weight: 800;
        color: #0b2c66;
        margin: 0 0 10px 0;
      }
      .adj-card-title svg { width: 18px; height: 18px; color: #0b2c66; }
      .adj-target-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        background: #fff;
        border: 1px solid #cbd5e1;
        padding: 12px 14px;
      }
      .adj-target-row:focus-within { border-color: #0b2c66; }
      .adj-target-date { font-size: 17px; font-weight: 800; color: #1f2937; }
      .adj-date-native {
        border: none; background: transparent; font-size: 17px; font-weight: 800;
        color: #1f2937; outline: none; width: 100%; cursor: pointer;
      }
      .adj-edit-icon {
        flex: 0 0 auto; background: transparent; border: none; cursor: pointer;
        color: #0b2c66; padding: 4px; display: inline-flex; align-items: center;
      }
      .adj-times {
        display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-bottom: 18px;
      }
      .adj-time-block { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .adj-time-label {
        display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: #0b2c66;
      }
      .adj-time-label svg { width: 16px; height: 16px; }
      .adj-time-hint { font-size: 11px; color: #64748b; font-weight: 600; }
      .adj-time-input {
        width: 100%; max-width: 100%; box-sizing: border-box; font-size: 16px; font-weight: 700;
        letter-spacing: 0; text-align: left; color: #1f2937;
        border: 1px solid #cbd5e1; border-radius: 0; padding: 13px 40px 13px 10px;
        outline: none; min-height: 52px; min-width: 0; cursor: pointer;
        /* Icon đồng hồ bên phải để nhân viên nhận ra ô này bấm vào được */
        background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' stroke='%230b2c66' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'/%3E%3C/svg%3E") no-repeat right 12px center / 20px 20px;
      }
      .adj-time-input::placeholder { color: #64748b; font-weight: 600; font-size: 14px; }
      .adj-time-input::-webkit-calendar-picker-indicator { margin-left: 0; }
      .adj-time-input:focus { border-color: #0b2c66; box-shadow: 0 0 0 2px rgba(11,44,102,.15); }
      /* flatpickr が altInput 用に元の input を type="hidden" に変えるはずだが、
         端末によって反映タイミングがずれて一瞬(または稀に継続的に)二重表示に
         見えることがあるための保険。flatpickr が付与する .flatpickr-input クラスを
         目印に、hidden 化された元の input を確実に非表示にする。 */
      input.flatpickr-input[type="hidden"] { display: none !important; }
      .adj-reason-label {
        display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700;
        color: #0b2c66; margin-bottom: 6px;
      }
      .adj-reason-label svg { width: 16px; height: 16px; }
      .adj-reason-input {
        width: 100%; box-sizing: border-box; font-size: 15px; color: #1f2937;
        border: 1px solid #cbd5e1; border-radius: 0; padding: 12px; background: #fff;
        outline: none; resize: vertical; min-height: 96px; font-family: inherit; line-height: 1.5;
      }
      .adj-reason-input:focus { border-color: #0b2c66; box-shadow: 0 0 0 2px rgba(11,44,102,.15); }
      .adj-status-msg { font-size: 12px; font-weight: 700; color: #059669; margin-top: 8px; min-height: 16px; }
      /* Toast thông báo ở trên đầu màn hình khi thao tác thành công */
      .adj-toast {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%) translateY(-140%);
        z-index: 12000; display: flex; align-items: center; gap: 10px;
        max-width: calc(100vw - 24px);
        padding: 12px 18px; border-radius: 12px;
        background: #16a34a; color: #fff; font-size: 15px; font-weight: 800;
        box-shadow: 0 10px 30px rgba(0,0,0,0.18);
        opacity: 0; transition: transform .28s ease, opacity .28s ease; pointer-events: none;
      }
      .adj-toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
      .adj-toast.error { background: #dc2626; }
      .adj-toast svg { width: 20px; height: 20px; flex: 0 0 auto; }

      /* Trạng thái rỗng của danh sách 申請履歴 (gọn, tông xám nhạt) */
      .adj-empty {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 8px; padding: 32px 16px; color: #94a3b8;
      }
      .adj-empty svg { width: 40px; height: 40px; color: #cbd5e1; }
      .adj-empty span { font-size: 14px; font-weight: 700; }

      /* Thanh nút dính đáy màn hình */
      .adj-action-bar {
        position: sticky; bottom: 0; left: 0; right: 0; z-index: 60;
        display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px;
        background: rgba(255,255,255,0.96);
        border-top: 1px solid #e2e8f0;
        box-shadow: 0 -4px 14px rgba(0,0,0,0.06);
        max-width: 560px;
        margin: 0 auto;
      }
      .adj-btn {
        flex: 1 1 0; min-height: 52px; border-radius: 0; font-size: 16px; font-weight: 800;
        cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        border: 1px solid transparent; transition: filter .15s ease, background .15s ease;
      }
      .adj-btn svg { width: 18px; height: 18px; }
      .adj-btn-primary { background: #0b2c66; color: #fff; flex: 0 0 160px; }
      .adj-btn-danger { background: #e5e7eb; color: #6b7280; }
      .adj-btn-danger:not(:disabled):hover { background: #d1d5db; color: #b91c1c; }
      .adj-btn-primary:hover { filter: brightness(1.2); }
      .adj-btn-primary:active { filter: brightness(0.94); }
      .adj-btn:disabled { opacity: .6; cursor: not-allowed; }

      @media (max-width: 768px) {
        .adj-card { margin-bottom: 18px; }
        .adj-times { gap: 10px; }
        .adj-time-input { font-size: 15px; padding: 13px 40px 13px 8px; }
        .adj-action-bar { max-width: 100%; }
      }
      /* Màn hình hẹp: xếp 出勤/退勤 thành 1 cột để ô giờ không bị tràn */
      @media (max-width: 480px) {
        .adj-times { grid-template-columns: 1fr; gap: 12px; }
        .adj-time-input { font-size: 16px; padding: 13px 40px 13px 10px; }
      }

      /* Nút trở về (bên trái thanh nút dưới cùng) */
      .adj-back-btn {
        flex: 0 0 auto; width: 52px; min-height: 52px;
        border: none; background: transparent; cursor: pointer;
        color: #0b2c66; display: inline-flex; align-items: center; justify-content: center;
      }
      .adj-back-btn:hover { background: #eef2f8; }
      .adj-back-btn svg { width: 28px; height: 28px; }
    </style>

    <div class="sap-tabs-container" style="display: flex !important; align-items: center; justify-content: flex-start; position: relative; z-index: 50; margin-top: 0 !important; visibility: visible !important; opacity: 1 !important; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; gap: 8px;">
        <div class="sap-tabs-wrapper" style="display: flex !important; gap: 24px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; width: 100%; opacity: 1 !important; visibility: visible !important;">
          <div class="sap-tab active" id="tabNew" style="display: flex !important; opacity: 1 !important; visibility: visible !important;">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
          <span>編集</span>
        </div>
        <div class="sap-tab" id="tabRejected" style="display: flex !important; opacity: 1 !important; visibility: visible !important;">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          <span>差戻し</span>
          <span id="rejectBadge" class="tab-badge" style="display:none;">0</span>
        </div>
        <div class="sap-tab" id="tabHistory" style="display: flex !important; opacity: 1 !important; visibility: visible !important;">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <span>履歴</span>
        </div>
      </div>
    </div>
    <div id="actionRequiredHost" style="display: none;"></div>

    <div id="newAdjustFormCard" style="display: block;">

      <div id="adjRejectReasonContainer" style="display:none; margin: 0 0 12px; padding: 12px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; color: #9a3412;">
        <div style="font-weight: bold; font-size: 13px; margin-bottom: 4px;">差戻し理由:</div>
        <div id="adjRejectReasonText" style="font-size: 13px; white-space: pre-wrap; word-break: break-word;"></div>
      </div>

      <!-- Thẻ: Ngày cần chỉnh -->
      <div class="adj-card">
        <div class="adj-card-title">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
          修正対象日
        </div>
        <div class="adj-target-row">
          <input id="adjDate" class="adj-date-native" type="date" value="${todayISO()}">
          <span class="adj-edit-icon" aria-hidden="true">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
          </span>
        </div>
        <!-- 1日に複数の行があるとき: 修正する行を選ぶ -->
        <div id="adjSegWrap" style="display:none;margin-top:10px;">
          <div style="font-size:12px;font-weight:700;color:#0b2c66;margin:0 0 4px;">修正する行</div>
          <select id="adjSeg" style="width:100%;height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:14px;background:#fff;color:#0f172a;"></select>
        </div>
        <!-- D: ngày đã có đơn đang chờ duyệt -->
        <div id="adjDupWarn" class="adj-dup-warn" style="display:none;"></div>
        <!-- A: các ngày thiếu 出勤/退勤 (tháng này + tháng trước chưa 承認) — chạm để chọn -->
        <div id="adjMissWrap" class="adj-miss-wrap" style="display:none;">
          <div class="adj-miss-title">打刻漏れの日（タップで選択）</div>
          <div id="adjMissChips" class="adj-miss-chips"></div>
        </div>
      </div>

      <!-- Thẻ: Cài đặt chỉnh sửa -->
      <div class="adj-card">
        <div class="adj-card-title">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
          修正設定
        </div>

        <div id="adjTypeWrap" style="display:none;gap:16px;margin:0 0 12px;font-size:14px;color:#0f172a;">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="adjType" value="modify" checked> 時刻を直す</label>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="radio" name="adjType" value="delete"> この行を削除</label>
        </div>
        <div class="adj-times">
          <div class="adj-time-block">
            <span class="adj-time-label in">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14"></path></svg>
              出勤時刻
            </span>
            <span id="adjInHint" class="adj-time-hint">現在の打刻 →</span>
            <input id="adjIn" class="adj-time-input" type="time" placeholder="タップして出勤時刻を選択">
          </div>
          <div class="adj-time-block">
            <span class="adj-time-label out">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 8l4 4m0 0l-4 4m4-4H3"></path></svg>
              退勤時刻
            </span>
            <span id="adjOutHint" class="adj-time-hint">現在の打刻 →</span>
            <input id="adjOut" class="adj-time-input" type="time" placeholder="タップして退勤時刻を選択">
            <label class="adj-nextday"><input type="checkbox" id="adjOutNext"> 翌日（日をまたいで退勤した場合）</label>
          </div>
        </div>

        <div class="adj-reason-label">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
          修正理由（必須）
        </div>
        <textarea id="adjReason" class="adj-reason-input" placeholder="修正理由を入力してください（例：電車遅延、残業、休憩時間調整など）"></textarea>

        <div id="adjCurrent" style="display:none;">—</div>
        <div id="adjStatus" class="adj-status-msg"></div>
      </div>

      <!-- Thanh nút dính đáy -->
      <div class="adj-action-bar">
        <button id="adjBack" class="adj-back-btn" type="button" aria-label="戻る" title="ホームへ戻る">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M15 19l-7-7 7-7"></path></svg>
        </button>
        <button id="adjSubmit" class="adj-btn adj-btn-primary" title="申請">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          申請
        </button>
      </div>
    </div>
  `;

  const els = {
    date: $('#adjDate'),
    current: $('#adjCurrent'),
    in: $('#adjIn'),
    out: $('#adjOut'),
    outNext: $('#adjOutNext'),
    reason: $('#adjReason'),
    submit: $('#adjSubmit'),
    status: $('#adjStatus')
  };

  // 端末(PC/スマホ/iPhone/Android)ごとにバラバラなネイティブ日付・時刻ピッカーの代わりに、
  // flatpickr で見た目を統一する。既存コードは els.date/in/out.value を直接読み書きしている
  // ため、dateFormat はネイティブ input と同じ形式(date: Y-m-d、datetime-local: Y-m-d\TH:i)
  // に合わせ、altInput でユーザー向けの見やすい表示だけを別に用意する。
  // (flatpickr が読み込まれていない環境ではネイティブ input のまま動作する)
  function setDateTimeValue(el, val) {
    if (!el) return;
    el.value = val || '';
    try {
      if (el._flatpickr) {
        if (val) el._flatpickr.setDate(val, false);
        else el._flatpickr.clear();
      }
    } catch (e) { /* silently ignored */ }
  }
  try {
    if (window.flatpickr) {
      if (window.flatpickr.l10ns && window.flatpickr.l10ns.ja) {
        window.flatpickr.localize(window.flatpickr.l10ns.ja);
      }
      if (els.date) {
        flatpickr(els.date, {
          dateFormat: 'Y-m-d',
          altInput: true,
          altInputClass: 'adj-date-native',
          altFormat: 'Y年n月j日(D)',
          allowInput: false,
          disableMobile: true
        });
      }
      // 出勤/退勤 は時刻のみ選択 (日付は 修正対象日 から自動) — 別の日を選んでしまう誤りを防ぐ
      const timeOpts = {
        enableTime: true,
        noCalendar: true,
        dateFormat: 'H:i',
        altInput: true,
        altInputClass: 'adj-time-input',
        altFormat: 'H:i',
        time_24hr: true,
        allowInput: false,
        disableMobile: true
      };
      if (els.in) flatpickr(els.in, timeOpts);
      if (els.out) flatpickr(els.out, timeOpts);
    }
  } catch (e) { /* flatpickr 未読み込み時はネイティブ input のまま */ }

  const setCurrent = (seg) => {
    // Hiển thị trạng thái chấm công hiện tại ngay dưới nhãn 出勤/退勤時刻
    const inHint = $('#adjInHint');
    const outHint = $('#adjOutHint');
    const cin = seg ? String(seg.checkIn || '').slice(11, 16) : '';
    const cout = seg ? String(seg.checkOut || '').slice(11, 16) : '';
    if (inHint) inHint.textContent = cin ? `現在: ${cin}` : 'まだ出勤の打刻がありません';
    if (outHint) outHint.textContent = cout ? `現在: ${cout}` : 'まだ退勤の打刻がありません（未退勤）';
    // Giữ phần tử ẩn cũ để không phá vỡ tham chiếu khác (nếu có)
    const el = els.current;
    if (el) {
      if (!seg) { el.textContent = '打刻記録なし'; }
      else { el.innerHTML = `出勤: ${cin || '—'}<br>退勤: ${cout || '—'}`; }
    }
  };

  let attendanceId = null;
  let urlParams = new URLSearchParams(window.location.search);
  let initialAttendanceId = urlParams.get('attendanceId');

  // ── A/D: 打刻漏れの日 (当月 + 前月[未承認]) と 申請中の日 ─────────────────────
  const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
  const fmtMdDow = (d) => {
    const [y, m, dd] = String(d).split('-').map(n => parseInt(n, 10));
    const dow = DOW_JA[new Date(y, (m || 1) - 1, dd || 1).getDay()];
    return `${m}/${dd}(${dow})`;
  };
  const fmtYmdDow = (d) => {
    const [y, m, dd] = String(d).split('-').map(n => parseInt(n, 10));
    const dow = DOW_JA[new Date(y, (m || 1) - 1, dd || 1).getDay()];
    return `${y}年${m}月${dd}日(${dow})`;
  };
  let missingDays = [];          // [{ date, missIn, missOut }] — chưa 申請 (không pending)
  let pendingDates = new Set();  // ngày đã có đơn 承認待ち

  const requestTargetDate = (r) => String(r?.requestedCheckIn || r?.requestedCheckOut || r?.originalCheckIn || '').slice(0, 10);
  const refreshPendingDates = async () => {
    try {
      const rows = await fetchJSONAuth('/api/adjust/my');
      pendingDates = new Set((Array.isArray(rows) ? rows : [])
        .filter(r => String(r?.status || 'pending') === 'pending')
        .map(requestTargetDate)
        .filter(isISODate));
    } catch (e) { pendingDates = new Set(); }
  };
  const refreshMissingDays = async () => {
    const t = todayISO();
    const y = parseInt(t.slice(0, 4), 10);
    const m = parseInt(t.slice(5, 7), 10);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const get = (yy, mm) => fetchJSONAuth(`/api/attendance/month/missing/me?year=${yy}&month=${mm}`).catch(() => null);
    try {
      const [cur, prev] = await Promise.all([get(y, m), get(py, pm)]);
      const list = [
        ...((prev && prev.monthStatus !== 'approved' && Array.isArray(prev.missing)) ? prev.missing : []),
        ...(Array.isArray(cur?.missing) ? cur.missing : [])
      ];
      missingDays = list
        .filter(it => isISODate(it?.date) && String(it?.adjust?.status || '') !== 'pending' && !pendingDates.has(it.date))
        .sort((a, b) => (a.date < b.date ? -1 : 1)); // cũ nhất trước — cần xử lý trước
    } catch (e) { missingDays = []; }
  };
  const missLabel = (it) => (it.missIn && it.missOut) ? '出勤・退勤なし' : (it.missOut ? '退勤なし' : (it.missIn ? '出勤なし' : '打刻漏れ'));
  const renderMissChips = () => {
    const wrap = $('#adjMissWrap');
    const host = $('#adjMissChips');
    if (!wrap || !host) return;
    if (!missingDays.length) { wrap.style.display = 'none'; host.innerHTML = ''; return; }
    const cur = els.date?.value;
    host.innerHTML = missingDays.map(it => `
      <button type="button" class="adj-miss-chip${it.date === cur ? ' is-active' : ''}" data-date="${it.date}">
        <span class="adj-miss-chip-date">${fmtMdDow(it.date)}</span>
        <span class="adj-miss-chip-kind">${missLabel(it)}</span>
      </button>`).join('');
    wrap.style.display = '';
    host.querySelectorAll('.adj-miss-chip').forEach(btn => btn.addEventListener('click', () => {
      setDateTimeValue(els.date, btn.dataset.date);
      if (els.reason && !String(els.reason.value || '').trim()) els.reason.value = '打刻し忘れ';
      loadDay();
    }));
  };
  const renderDupWarn = () => {
    const el = $('#adjDupWarn');
    if (!el) return;
    const d = els.date?.value;
    if (isISODate(d) && pendingDates.has(d)) {
      el.textContent = `${fmtYmdDow(d)} は調整申請中（承認待ち）です。内容を変える場合は「履歴」から編集してください。`;
      el.style.display = '';
    } else {
      el.style.display = 'none';
      el.textContent = '';
    }
  };

  // 修正する行（1日に複数あるとき）と 申請の種類
  let daySegments = [];
  const segLabel = (sg, i) => `${i + 1}行目  ${String(sg?.checkIn || '').slice(11, 16) || '—'}〜${String(sg?.checkOut || '').slice(11, 16) || '—'}`;
  const adjType = () => String(document.querySelector('input[name="adjType"]:checked')?.value || 'modify');
  const applyTypeUi = () => {
    const del = adjType() === 'delete';
    const times = document.querySelector('.adj-times');
    if (times) times.style.display = del ? 'none' : '';
  };
  const selectSegment = (sg) => {
    attendanceId = sg?.id || null;
    setCurrent(sg || null);
    try { setDateTimeValue(els.in, sg?.checkIn ? String(sg.checkIn).slice(11, 16) : ''); } catch (e) { /* silently ignored */ }
    try { setDateTimeValue(els.out, sg?.checkOut ? String(sg.checkOut).slice(11, 16) : ''); } catch (e) { /* silently ignored */ }
    if (els.outNext) els.outNext.checked = !!sg?.checkOut && String(sg.checkOut).slice(0, 10) > String(els.date?.value || '');
    // 「この行を削除」は既存の行を選んでいるときだけ
    const typeWrap = $('#adjTypeWrap');
    if (typeWrap) typeWrap.style.display = attendanceId ? 'flex' : 'none';
    if (!attendanceId) { const m = document.querySelector('input[name="adjType"][value="modify"]'); if (m) m.checked = true; }
    applyTypeUi();
  };
  document.querySelectorAll('input[name="adjType"]').forEach((r) => r.addEventListener('change', applyTypeUi));
  $('#adjSeg')?.addEventListener('change', (e) => {
    const v = String(e.target.value || '');
    selectSegment(v === 'new' ? null : daySegments.find((sg) => String(sg.id) === v));
  });

  const loadDay = async () => {
    showErr('');
    const d = els.date?.value;
    if (!isISODate(d)) return;
    renderMissChips();
    renderDupWarn();
    showSpinner();
    try {
      const r = await fetchJSONAuth(`/api/attendance/date/${encodeURIComponent(d)}`);
      let seg = null;
      if (initialAttendanceId) {
        seg = (r?.segments || []).find(s => String(s.id) === String(initialAttendanceId));
        initialAttendanceId = null; // Only use it once
      }
      daySegments = (Array.isArray(r?.segments) ? r.segments : []).filter((sg) => sg && (sg.checkIn || sg.checkOut))
        .sort((a, b) => String(a.checkIn || a.checkOut || '').localeCompare(String(b.checkIn || b.checkOut || '')));
      // 既定: URL で指定された行 → 退勤のない行 → 1行目
      if (!seg) seg = daySegments.find((sg) => sg.checkIn && !sg.checkOut) || daySegments[0] || pickLatestSegment(r?.segments);
      // 2行以上あるときは「修正する行」を選べるようにする（打刻のない時間を足す申請は「新しい行」）
      const segWrap = $('#adjSegWrap');
      const segSel = $('#adjSeg');
      if (segWrap && segSel) {
        if (daySegments.length >= 2) {
          segSel.innerHTML = daySegments.map((sg, i) => `<option value="${sg.id}">${segLabel(sg, i)}</option>`).join('')
            + '<option value="new">新しい行（打刻のない時間を追加）</option>';
          segSel.value = seg?.id ? String(seg.id) : 'new';
          segWrap.style.display = '';
        } else {
          segSel.innerHTML = '';
          segWrap.style.display = 'none';
        }
      }
      selectSegment(seg);
    } catch (e) {
      attendanceId = null;
      setCurrent(null);
      showErr(e?.message || '読み込みに失敗しました');
    } finally {
      hideSpinner();
    }
  };

  // Xử lý sự kiện chuyển Tab
  const switchTab = (tabId) => {
    // Cập nhật UI Tab
    document.querySelectorAll('.sap-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById(tabId);
    if (activeTab) activeTab.classList.add('active');

    // Ẩn tất cả nội dung
    const formCard = document.getElementById('newAdjustFormCard');
    const actionCard = document.getElementById('actionRequiredCard');
    const actionHost = document.getElementById('actionRequiredHost');
    const historyBlock = document.getElementById('sapHistoryBlock');
    
    if (formCard) formCard.style.display = 'none';
    if (actionCard) actionCard.style.display = 'none';
    if (actionHost) actionHost.style.display = 'none';
    if (historyBlock) historyBlock.style.display = 'none';

    // Hiển thị nội dung tương ứng
    if (tabId === 'tabNew' && formCard) {
      formCard.style.display = 'block';
    } else if (tabId === 'tabRejected') {
      if (actionHost) actionHost.style.display = 'block';
      if (actionCard) actionCard.style.display = 'block';
    } else if (tabId === 'tabHistory') {
      if (historyBlock) historyBlock.style.display = 'block';
    }
    
  };

  $('#tabNew')?.addEventListener('click', () => switchTab('tabNew'));
  $('#tabRejected')?.addEventListener('click', () => switchTab('tabRejected'));
  $('#tabHistory')?.addEventListener('click', () => switchTab('tabHistory'));

  // Nút trở về màn hình home (bên trái thanh nút dưới cùng)
  $('#adjBack')?.addEventListener('click', () => { window.location.href = '/ui/portal'; });

  // Xóa các event listener cũ của 3 nút Quick Actions do đã chuyển sang dùng Tab
  // Xử lý sự kiện click cho các nút động (close, overlay) bằng Event Delegation
  document.addEventListener('click', (e) => {
    // Không cần xử lý đóng drawer nữa
  });

  const pDate = urlParams.get('date');
  const pType = urlParams.get('type');

  if (pType === 'time_adjust' && pDate && isISODate(pDate) && els.date) {
    setDateTimeValue(els.date, pDate);
    if (els.reason) els.reason.value = '打刻し忘れ';
  }

  els.date?.addEventListener('change', loadDay);

  await refreshPendingDates();
  await refreshMissingDays();
  await loadDay();

  const handleApply = async () => {
    if (!els.submit || els.submit.disabled) return;

    // C: 修正対象日 + 時刻 から日時を組み立てて検証し、日付・時刻を明記して確認する
    showErr('');
    const isEdit = !!els.submit.dataset.editId;
    const d = els.date?.value;
    if (!isISODate(d)) { showErr('修正対象日を選択してください'); return; }
    if (d > todayISO()) { showErr('未来の日付は申請できません'); return; }
    if (adjType() === 'delete') {
      if (!attendanceId) { showErr('削除する行を選んでください'); return; }
      const reasonDel = String(els.reason?.value || '').trim();
      if (!reasonDel) { showErr('理由を入力してください'); return; }
      const sgDel = daySegments.find((sg) => String(sg.id) === String(attendanceId));
      const lbl = sgDel ? `${String(sgDel.checkIn || '').slice(11, 16) || '—'}〜${String(sgDel.checkOut || '').slice(11, 16) || '—'}` : '';
      if (!confirm(`${fmtYmdDow(d)} の行（${lbl}）の削除を申請しますか？\n承認されると、この行は削除されます。`)) return;
      els.submit.disabled = true;
      showSpinner();
      try {
        await fetchJSONAuth('/api/adjust', { method: 'POST', body: JSON.stringify({ attendanceId, requestType: 'delete', reason: reasonDel }) });
        if (els.status) els.status.textContent = '申請しました';
        showToast('行の削除を申請しました');
        if (els.reason) els.reason.value = '';
        await refreshPendingDates();
        renderDupWarn();
        await renderList();
      } catch (e) {
        showErr(e?.message || '申請に失敗しました');
      } finally {
        hideSpinner();
        els.submit.disabled = false;
      }
      return;
    }
    const inHm = String(els.in?.value || '').trim();
    const outHm = String(els.out?.value || '').trim();
    const outDate = els.outNext?.checked ? addDaysISO(d, 1) : d;
    const inDT = /^\d{2}:\d{2}$/.test(inHm) ? `${d}T${inHm}` : '';
    const outDT = /^\d{2}:\d{2}$/.test(outHm) ? `${outDate}T${outHm}` : '';
    if (!inDT && !outDT) { showErr('出勤時刻または退勤時刻を入力してください'); return; }
    if (inDT && outDT && outDT <= inDT) {
      showErr('退勤時刻は出勤時刻より後にしてください（日をまたぐ場合は「翌日」にチェック）');
      return;
    }
    if (!String(els.reason?.value || '').trim()) { showErr('理由を入力してください'); return; }
    const dupNote = (!isEdit && pendingDates.has(d)) ? '\n\n※この日は既に調整申請中（承認待ち）です。もう1件申請されます。' : '';
    const confirmMsg = `${fmtYmdDow(d)} の打刻を\n`
      + `　出勤：${inHm || '（変更なし）'}\n`
      + `　退勤：${outHm ? `${els.outNext?.checked ? '翌日 ' : ''}${outHm}` : '（変更なし）'}\n`
      + `で${isEdit ? '更新' : '申請'}しますか？${dupNote}`;
    if (!confirm(confirmMsg)) return;

    els.submit.disabled = true;

    // Thêm vòng quay xoay tròn trong lúc đang gửi
      const originalIcon = els.submit.innerHTML;
      els.submit.innerHTML = `<svg class="spinner" viewBox="0 0 50 50" style="width:18px;height:18px;animation:spin 1s linear infinite;"><circle cx="25" cy="25" r="20" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-dasharray="80 200"></circle></svg><style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>`;

    if (els.status) els.status.textContent = (isEdit ? '更新中…' : '申請中…');
    const inV = toMySQLDateTime(inDT);
    const outV = toMySQLDateTime(outDT);
    const reason = String(els.reason?.value || '').trim();
    const editId = parseInt(String(els.submit?.dataset?.editId || 0), 10) || null;

    if (!attendanceId && !editId) {
      // Allow submission even without existing attendance record
      // (employee forgot to clock in/out entirely)
    }
    if (!inV && !outV) {
      if (els.status) els.status.textContent = '';
      els.submit.disabled = false;
      els.submit.innerHTML = originalIcon;
      showErr('修正(出勤)または修正(退勤)を入力してください');
      return;
    }
    if (!reason) {
      if (els.status) els.status.textContent = '';
      els.submit.disabled = false;
      els.submit.innerHTML = originalIcon;
      showErr('理由を入力してください');
      return;
    }
    showSpinner();
    try {
      if (editId) {
        await fetchJSONAuth(`/api/adjust/${editId}`, {
          method: 'PATCH',
          body: JSON.stringify({ requestedCheckIn: inV, requestedCheckOut: outV, reason })
        });
        if (els.status) els.status.textContent = '更新しました';
        showToast('申請を更新しました');
      } else {
        await fetchJSONAuth('/api/adjust', { method: 'POST', body: JSON.stringify({ attendanceId, requestedCheckIn: inV, requestedCheckOut: outV, reason }) });
        if (els.status) els.status.textContent = '申請しました';
        showToast('勤怠修正を申請しました');
      }
      try { delete els.submit.dataset.editId; } catch (e) { /* silently ignored */ }
      setDateTimeValue(els.in, '');
      setDateTimeValue(els.out, '');
      if (els.outNext) els.outNext.checked = false;
      if (els.reason) els.reason.value = '';
      // 申請済みの日を 打刻漏れ 一覧から外し、申請中 の警告を更新
      await refreshPendingDates();
      await refreshMissingDays();
      renderMissChips();
      renderDupWarn();
      await renderList();
    } catch (e) {
      if (els.status) els.status.textContent = '';
      showErr(e?.message || '申請に失敗しました');
    } finally {
      hideSpinner();
      try { 
        if (els.submit) {
          els.submit.disabled = false;
          els.submit.innerHTML = originalIcon;
        }
      } catch (e) { /* silently ignored */ }
    }
  };

  els.submit?.addEventListener('click', handleApply);
};

let currentPage = 1;
const itemsPerPage = 15;
// Tháng đang xem ở tab 履歴 (yyyy-MM). Giữ ở cấp module để nút ‹ › điều hướng bền qua các lần render.
let historyMonth = new Date().toISOString().slice(0, 7);

// Tiện ích cho card lịch sử
const jpWeekday = ['日', '月', '火', '水', '木', '金', '土'];
const fmtHistDate = (ds) => {
  // ds = 'YYYY-MM-DD' -> 'YYYY/MM/DD (曜)'
  const s = String(ds || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-').map(Number);
  const w = jpWeekday[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${s.replace(/-/g, '/')} (${w})`;
};
const fmtHistDateTime = (val) => {
  // 'YYYY-MM-DD HH:mm...' -> 'YYYY/M/D HH:mm'
  const s = String(val || '').replace('T', ' ');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2}:\d{2})?/);
  if (!m) return '—';
  const time = m[4] ? ` ${m[4]}` : '';
  return `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}${time}`;
};
const monthLabelJP = (ym) => {
  const [y, m] = String(ym || '').split('-').map(Number);
  return (y && m) ? `${y}年${m}月` : '';
};
const shiftMonth = (ym, delta) => {
  let [y, m] = String(ym || '').split('-').map(Number);
  m += delta;
  if (m < 1) { m = 12; y -= 1; }
  else if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
};

const renderList = async () => {
  const host = $('#adjustListHost');
  if (!host) return;
  host.innerHTML = '<div style="color:#475569;font-weight:650;">履歴を読み込み中…</div>';
  showSpinner();
  try {
    const [rowsRaw, profile] = await Promise.all([
      fetchJSONAuth('/api/adjust/my'),
      fetchJSONAuth('/api/auth/me').catch(() => null)
    ]);
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    window.requestsCache = rows;
    // Tháng đang xem lấy từ state module (điều hướng bằng nút ‹ ›)
    let selectedMonth = historyMonth;

    // Hiển thị danh sách các yêu cầu bị trả về ở ngay màn hình chính
    const actionHost = document.getElementById('actionRequiredHost');
    const rejectBadge = document.getElementById('rejectBadge');
    
    if (actionHost) {
      const rejectedRows = rows.filter(row => row.status === 'rejected');
      
      // Cập nhật số lượng trên Badge của Tile
      if (rejectBadge) {
        if (rejectedRows.length > 0) {
          rejectBadge.textContent = rejectedRows.length;
          rejectBadge.style.display = 'block';
        } else {
          rejectBadge.style.display = 'none';
        }
      }

      if (rejectedRows.length > 0) {
        actionHost.innerHTML = `
          <div class="action-required-card" style="display: none;" id="actionRequiredCard">
            <h4 class="action-required-title">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              差戻しされた申請があります（${rejectedRows.length}件）
            </h4>
            <ul class="action-required-list">
              ${rejectedRows.map(row => {
                const dateLabel = String(row.requestedCheckIn || row.created_at || '').slice(0, 10).replace(/-/g, '/');
                return `
                  <li class="action-required-item">
                    <div class="action-required-header">
                      <span class="action-required-date">対象日: ${dateLabel}</span>
                    </div>
                    <div class="action-required-reason">
                      <strong>差戻し理由:</strong> ${esc(row.admin_note || row.reason || '—')}
                    </div>
                    <div class="action-required-actions">
                      <button type="button" class="action-required-btn btn-chat-action" data-id="${row.id}">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z"></path></svg>
                        やり取り
                      </button>
                      <button type="button" class="action-required-btn primary btn-fix-action" data-id="${row.id}" data-in="${row.requestedCheckIn || ''}" data-out="${row.requestedCheckOut || ''}" data-reason="${esc(row.reason || '')}" data-adminnote="${esc(row.admin_note || '')}">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                        修正する
                      </button>
                    </div>
                  </li>
                `;
              }).join('')}
            </ul>
          </div>
        `;

        // Gắn sự kiện cho các nút trong Alert Box
        actionHost.querySelectorAll('.btn-chat-action').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const id = e.currentTarget.dataset.id;
            openAdjustChatId = id;
            openAdjustChatModal(id);
          });
        });

        actionHost.querySelectorAll('.btn-fix-action').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const dataset = e.currentTarget.dataset;
            const id = dataset.id;
            const cin = (dataset.in || '').slice(0, 16).replace(' ', 'T');
            const cout = (dataset.out || '').slice(0, 16).replace(' ', 'T');
            const reason = dataset.reason || '';
            const adminNote = dataset.adminnote || '';
            const targetDate = (dataset.in || dataset.out || '').slice(0, 10).replace(/-/g, '/');

            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.48);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

            modal.innerHTML = `
              <div style="width:100%;max-width:500px;background:#fff;border-radius:12px;box-shadow:0 20px 45px rgba(15,23,42,0.25);overflow:hidden;display:flex;flex-direction:column;">
                <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;background:#f8fafc;">
                  <div style="font-weight:700;color:#0f172a;font-size:15px;display:flex;align-items:center;gap:6px;">
                    <svg width="18" height="18" fill="none" stroke="#ea580c" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                    差戻し申請の再提出
                  </div>
                  <button type="button" class="btn-close-modal" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:0;line-height:1;">&times;</button>
                </div>
                <div style="padding:20px;overflow-y:auto;flex:1;">
                  <div style="margin-bottom:16px;font-size:13px;color:#334155;">
                    <strong>対象日:</strong> ${targetDate}
                  </div>
                  ${adminNote ? `<div style="margin-bottom:16px;padding:10px 12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:13px;"><strong>差戻し理由:</strong><br>${esc(adminNote)}</div>` : ''}
                  
                  <div style="margin-bottom:12px;">
                    <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">修正(出勤)</div>
                    <input type="datetime-local" id="fixIn" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;" value="${cin}">
                  </div>
                  <div style="margin-bottom:12px;">
                    <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">修正(退勤)</div>
                    <input type="datetime-local" id="fixOut" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;" value="${cout}">
                  </div>
                  <div style="margin-bottom:12px;">
                    <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">理由 <span style="color:#ef4444">*</span></div>
                    <input type="text" id="fixReason" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;" value="${esc(reason)}" placeholder="理由を入力してください">
                  </div>
                  <div id="fixError" style="color:#dc2626;font-size:13px;font-weight:600;margin-top:8px;display:none;"></div>
                </div>
                <div style="padding:12px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;gap:12px;justify-content:flex-end;">
                  <button type="button" class="btn-cancel-modal" style="padding:8px 16px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-weight:600;cursor:pointer;">キャンセル</button>
                  <button type="button" id="btnFixSubmit" style="padding:8px 16px;border-radius:6px;border:none;background:#005eb8;color:#fff;font-weight:600;cursor:pointer;">再提出する</button>
                </div>
              </div>
            `;

            const close = () => {
              try { document.body.removeChild(modal); } catch(e){}
            };

            modal.querySelector('.btn-close-modal').addEventListener('click', close);
            modal.querySelector('.btn-cancel-modal').addEventListener('click', close);
            modal.addEventListener('click', (e) => { if(e.target === modal) close(); });

            const btnSubmit = modal.querySelector('#btnFixSubmit');
            btnSubmit.addEventListener('click', async () => {
              const errEl = modal.querySelector('#fixError');
              errEl.style.display = 'none';

              const newIn = toMySQLDateTime(modal.querySelector('#fixIn').value);
              const newOut = toMySQLDateTime(modal.querySelector('#fixOut').value);
              const newReason = modal.querySelector('#fixReason').value.trim();

              if (!newReason) {
                errEl.textContent = '理由を入力してください';
                errEl.style.display = 'block';
                return;
              }
              const pairErr = validateAdjustPair(newIn, newOut, (dataset.in || dataset.out || '').slice(0, 10));
              if (pairErr) {
                errEl.textContent = pairErr;
                errEl.style.display = 'block';
                return;
              }

              btnSubmit.disabled = true;
              btnSubmit.textContent = '送信中...';

              try {
                await fetchJSONAuth('/api/adjust/' + id, {
                  method: 'PATCH',
                  body: JSON.stringify({ requestedCheckIn: newIn, requestedCheckOut: newOut, reason: newReason })
                });
                delete adjustChatCache[id];
                close();
                await renderList();
              } catch (err) {
                errEl.textContent = err?.message || '更新に失敗しました';
                errEl.style.display = 'block';
                btnSubmit.disabled = false;
                btnSubmit.textContent = '再提出する';
              }
            });

            document.body.appendChild(modal);
          });
        });
      } else {
        actionHost.innerHTML = '';
      }
    }

    // Lọc dữ liệu theo tháng được chọn (dùng 対象日 = requestedCheckIn)
    const filteredRows = rows.filter(r => {
      const target = r.requestedCheckIn ? String(r.requestedCheckIn).slice(0, 7) : (r.created_at ? String(r.created_at).slice(0, 7) : '');
      return target === selectedMonth;
    });

    const totalPages = Math.ceil(filteredRows.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const pagedRows = filteredRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const tr = pagedRows.map((r) => {
      const cin  = String(r.requestedCheckIn  || '').slice(0, 16).replace('T', ' ');
      const cout = String(r.requestedCheckOut || '').slice(0, 16).replace('T', ' ');
      // 変更後 (giờ được yêu cầu)
      const newInTime  = String(r.requestedCheckIn  || '').slice(11, 16) || '--:--';
      const newOutTime = String(r.requestedCheckOut || '').slice(11, 16) || '--:--';
      // 変更前 (giờ chấm công gốc, lấy từ JOIN attendance)
      const oldInTime  = String(r.originalCheckIn  || '').slice(11, 16) || '--:--';
      const oldOutTime = String(r.originalCheckOut || '').slice(11, 16) || '--:--';
      const targetDate = r.requestedCheckIn ? String(r.requestedCheckIn).slice(0, 10)
        : (r.originalCheckIn ? String(r.originalCheckIn).slice(0, 10) : (r.created_at ? String(r.created_at).slice(0, 10) : ''));
      const st = String(r.status || 'pending');
      let stLabel, stClass;
      if (st === 'approved') { stLabel = '承認済み'; stClass = 'approved'; }
      else if (st === 'rejected') { stLabel = '却下'; stClass = 'rejected'; }
      else { stLabel = '承認待ち'; stClass = 'pending'; }
      const created = fmtHistDateTime(r.created_at);

      const editBtn = (st === 'pending' || st === 'rejected')
        ? `<button class="btn-edit adj-hist-actbtn" data-id="${r.id}" data-in="${cin}" data-out="${cout}" data-reason="${esc(r.reason || '')}" data-adminnote="${esc(r.admin_note || '')}" title="${st === 'rejected' ? '再申請' : '編集'}"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>`
        : '';
      const deleteBtn = st === 'pending'
        ? `<button class="btn-delete adj-hist-actbtn danger" data-id="${r.id}" title="削除"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>`
        : '';
      const chatBtn = `<button class="btn-chat adj-hist-actbtn" data-id="${r.id}" title="やり取り"><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z"></path></svg></button>`;

      return `
        <div class="adj-hist-card" data-record-id="${r.id}">
          <div class="adj-hist-head">
            <span class="adj-hist-icon">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            </span>
            <div class="adj-hist-head-text">
              <div class="adj-hist-date">${fmtHistDate(targetDate)}</div>
              <div class="adj-hist-sub">修正日時: ${created}</div>
            </div>
            <span class="adj-hist-badge ${stClass}">${esc(stLabel)}</span>
          </div>

          <div class="adj-hist-diff">
            <div class="adj-hist-col">
              <div class="adj-hist-col-title">変更前</div>
              <div class="adj-hist-line">出勤時刻: ${oldInTime}</div>
              <div class="adj-hist-line">退勤時刻: ${oldOutTime}</div>
            </div>
            <div class="adj-hist-arrow">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 8l4 4m0 0l-4 4m4-4H3"></path></svg>
            </div>
            <div class="adj-hist-col after">
              <div class="adj-hist-col-title">変更後</div>
              ${String(r.request_type || "") === "delete" ? '<div class="adj-hist-line" style="color:#b91c1c;font-weight:700;">この行を削除</div>' : `<div class="adj-hist-line">出勤時刻: ${newInTime}</div>
              <div class="adj-hist-line">退勤時刻: ${newOutTime}</div>`}
            </div>
          </div>

          ${r.reason ? `
          <div class="adj-hist-reason">
            <div class="adj-hist-reason-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              修正理由
            </div>
            <div class="adj-hist-reason-text">${esc(r.reason)}</div>
          </div>` : ''}

          ${r.admin_note ? `<div class="adj-hist-adminnote"><strong>差戻し理由:</strong> ${esc(r.admin_note)}</div>` : ''}

          ${(editBtn || deleteBtn || chatBtn) ? `<div class="adj-hist-actions">${editBtn}${chatBtn}${deleteBtn}</div>` : ''}
        </div>
      `;
    }).join('');
    host.innerHTML = `
        <style>
          .adj-hist-nav {
            display: flex; align-items: center; justify-content: space-between;
            background: #fff; border: 1px solid #cbd5e1;
            padding: 10px 12px; margin: 0 0 14px 0; max-width: 560px;
          }
          .adj-hist-nav-btn {
            width: 40px; height: 40px; border-radius: 999px; border: none; cursor: pointer;
            background: transparent; color: #0b2c66; display: inline-flex; align-items: center; justify-content: center;
          }
          .adj-hist-nav-btn:hover { background: rgba(11,44,102,0.08); }
          .adj-hist-nav-btn svg { width: 22px; height: 22px; }
          .adj-hist-nav-label { font-size: 17px; font-weight: 800; color: #1f2937; }

          .adj-hist-list { display: flex; flex-direction: column; gap: 14px; max-width: 560px; }
          .adj-hist-card {
            background: #fff; border: 1px solid #cbd5e1;
            padding: 14px;
          }
          .adj-hist-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
          .adj-hist-icon {
            flex: 0 0 auto; width: 36px; height: 36px;
            background: #eef2f8; color: #0b2c66; display: inline-flex; align-items: center; justify-content: center;
          }
          .adj-hist-icon svg { width: 18px; height: 18px; }
          .adj-hist-head-text { flex: 1 1 auto; min-width: 0; }
          .adj-hist-date { font-size: 16px; font-weight: 800; color: #1f2937; }
          .adj-hist-sub { font-size: 12px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
          .adj-hist-badge {
            flex: 0 0 auto; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 999px; white-space: nowrap;
          }
          .adj-hist-badge.approved { background: #dcfce7; color: #166534; }
          .adj-hist-badge.rejected { background: #fee2e2; color: #991b1b; }
          .adj-hist-badge.pending { background: #fef3c7; color: #92400e; }

          .adj-hist-diff {
            display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px;
            background: #f8fafc; padding: 12px;
          }
          .adj-hist-col { min-width: 0; }
          .adj-hist-col-title { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px; }
          .adj-hist-col.after { text-align: right; }
          .adj-hist-col.after .adj-hist-col-title { color: #0b2c66; }
          .adj-hist-col.after .adj-hist-line { color: #0b2c66; font-weight: 700; }
          .adj-hist-line { font-size: 14px; color: #334155; line-height: 1.7; white-space: nowrap; }
          .adj-hist-arrow { color: #0b2c66; display: flex; align-items: center; justify-content: center; }
          .adj-hist-arrow svg { width: 20px; height: 20px; }

          .adj-hist-reason {
            margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 10px;
          }
          .adj-hist-reason-title {
            display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #0b2c66; margin-bottom: 6px;
          }
          .adj-hist-reason-title svg { width: 16px; height: 16px; }
          .adj-hist-reason-text { font-size: 14px; color: #1f2937; white-space: pre-wrap; word-break: break-word; }

          .adj-hist-adminnote {
            margin-top: 10px; padding: 8px 10px; border-radius: 8px;
            background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-size: 12px;
          }
          .adj-hist-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
          .adj-hist-actbtn {
            width: 38px; height: 38px; border: 1px solid #cbd5e1;
            background: #fff; color: #0b2c66; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          }
          .adj-hist-actbtn:hover { background: #eef2f8; }
          .adj-hist-actbtn.danger { color: #dc2626; border-color: #fecaca; }
          .adj-hist-actbtn.danger:hover { background: #fef2f2; }

          .adj-hist-pager { display: flex; justify-content: center; align-items: center; gap: 12px; padding: 16px 0; max-width: 560px; }
          .adj-hist-pager button {
            padding: 8px 16px; border: 1px solid #cbd5e1; background: #fff; color: #0b2c66;
            font-weight: 700; cursor: pointer;
          }
          .adj-hist-pager button:disabled { opacity: .5; cursor: not-allowed; }
          .adj-hist-pager .adj-hist-pager-info { font-size: 13px; color: #64748b; font-weight: 700; }

          @media (max-width: 480px) {
            .adj-hist-line { font-size: 13px; }
          }
        </style>

        <div id="sapHistoryBlock" class="sap-history-block" style="display: ${document.getElementById('tabHistory')?.classList?.contains('active') ? 'block' : 'none'};">
          <div class="adj-hist-nav">
            <button id="adjHistPrev" class="adj-hist-nav-btn" type="button" aria-label="前の月">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <span class="adj-hist-nav-label">${monthLabelJP(selectedMonth)}</span>
            <button id="adjHistNext" class="adj-hist-nav-btn" type="button" aria-label="次の月">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M9 5l7 7-7 7"></path></svg>
            </button>
          </div>

          ${pagedRows.length ? `<div class="adj-hist-list">${tr}</div>` : '<div class="adj-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"></path></svg><span>申請はありません</span></div>'}

          ${totalPages > 1 ? `
            <div class="adj-hist-pager">
              <button id="btnAdjustPagePrev" ${currentPage === 1 ? 'disabled' : ''}>前へ</button>
              <span class="adj-hist-pager-info">${currentPage} / ${totalPages} ページ</span>
              <button id="btnAdjustPageNext" ${currentPage === totalPages ? 'disabled' : ''}>次へ</button>
            </div>
          ` : ''}
        </div>
      `;

    // Điều hướng tháng bằng nút ‹ ›
    $('#adjHistPrev')?.addEventListener('click', () => { historyMonth = shiftMonth(historyMonth, -1); currentPage = 1; renderList(); });
    $('#adjHistNext')?.addEventListener('click', () => { historyMonth = shiftMonth(historyMonth, 1); currentPage = 1; renderList(); });
    // Phân trang
    $('#btnAdjustPagePrev')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderList(); } });
    $('#btnAdjustPageNext')?.addEventListener('click', () => { currentPage++; renderList(); });
    // Logic xử lý khi click vào nút chỉnh sửa trên hàng (inline edit)
    const handleInlineEdit = (e) => {
      const btn = e.target.closest('.btn-edit');
      if (!btn) return;
      const card = btn.closest('.adj-hist-card');
      if (!card) return;
      const recId = btn.getAttribute('data-id');
      if (!recId) return;

      // Đóng các form sửa inline khác đang mở
      document.querySelectorAll('.inline-edit-row').forEach(el => el.remove());
      document.querySelectorAll('.adj-hist-card[data-hidden="1"]').forEach(el => {
        el.style.display = '';
        delete el.dataset.hidden;
      });

      const cin = btn.getAttribute('data-in') || '';
      const cout = btn.getAttribute('data-out') || '';
      const reason = btn.getAttribute('data-reason') || '';
      const adminNote = btn.getAttribute('data-adminnote') || '';

      // Ẩn card hiện tại
      card.style.display = 'none';
      card.dataset.hidden = '1';

      // Tạo block chỉnh sửa ngay dưới card được click
      const editTr = document.createElement('div');
      editTr.className = 'inline-edit-row adj-card';
      editTr.innerHTML = `
        <div class="inline-edit-container" style="position:relative;">
          <button type="button" class="btn-close-inline-edit" style="position:absolute; top:0; right:0; background:none; border:none; font-size:18px; color:#94a3b8; cursor:pointer; padding:4px; line-height:1;" title="閉じる">&times;</button>
          <div style="font-weight: 800; color: #0b2c66; margin-bottom: 12px; font-size: 14px;">${String(btn.title || '') === '再申請' ? '差戻しされた申請を修正して再申請' : '申請の編集'}</div>
          ${adminNote ? `<div style="margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-size: 12px;"><strong>差戻し理由:</strong> ${esc(adminNote)}</div>` : ''}
          <div style="display:grid; gap:10px;">
            <div>
              <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:4px;">修正(出勤)</div>
              <input type="datetime-local" class="adj-time-input edit-in" value="${cin.replace(' ', 'T')}">
            </div>
            <div>
              <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:4px;">修正(退勤)</div>
              <input type="datetime-local" class="adj-time-input edit-out" value="${cout.replace(' ', 'T')}">
            </div>
            <div>
              <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:4px;">理由 <span style="color:#ef4444">*</span></div>
              <input type="text" class="adj-time-input edit-reason" value="${esc(reason)}" placeholder="理由を入力してください" style="font-size:14px; font-weight:500;">
            </div>
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:4px;">
              <button type="button" class="btn-cancel-inline-edit adj-btn adj-btn-danger" style="flex:0 0 auto; min-height:44px; padding:0 18px;">キャンセル</button>
              <button type="button" class="btn-save-inline-edit adj-btn adj-btn-primary" data-id="${recId}" style="flex:0 0 auto; min-height:44px; padding:0 22px;">保存</button>
            </div>
          </div>
          <div class="edit-error" style="color:#ef4444; font-size:12px; font-weight:600; margin-top:8px; display:none;"></div>
        </div>
      `;

      card.after(editTr);

      // Gắn sự kiện cho form
      const closeBtn = editTr.querySelector('.btn-close-inline-edit');
      const cancelBtn = editTr.querySelector('.btn-cancel-inline-edit');
      const saveBtn = editTr.querySelector('.btn-save-inline-edit');

      const closeForm = (ev) => {
        if(ev) ev.preventDefault();
        editTr.remove();
        card.style.display = '';
        delete card.dataset.hidden;
      };

      closeBtn.addEventListener('click', closeForm);
      cancelBtn.addEventListener('click', closeForm);

      saveBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const errEl = editTr.querySelector('.edit-error');
        errEl.style.display = 'none';

        const newIn = toMySQLDateTime(editTr.querySelector('.edit-in').value);
        const newOut = toMySQLDateTime(editTr.querySelector('.edit-out').value);
        const newReason = editTr.querySelector('.edit-reason').value.trim();

        if (!newReason) {
          errEl.textContent = '理由を入力してください';
          errEl.style.display = 'block';
          return;
        }
        const pairErr = validateAdjustPair(newIn, newOut, String(cin || cout || '').slice(0, 10));
        if (pairErr) {
          errEl.textContent = pairErr;
          errEl.style.display = 'block';
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
          await fetchJSONAuth(`/api/adjust/${recId}`, {
            method: 'PATCH',
            body: JSON.stringify({ requestedCheckIn: newIn, requestedCheckOut: newOut, reason: newReason })
          });
          delete adjustChatCache[recId];
          await renderList(); // Reload danh sách
        } catch (err) {
          errEl.textContent = err?.message || '保存に失敗しました';
          errEl.style.display = 'block';
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
        }
      });
    };

    // Xóa sự kiện lắng nghe trực tiếp trên `host` để tránh trùng lặp khi đã gắn vào từng nút
    // host.addEventListener('click', handleInlineEdit);

    const deleteHandler = async (e) => {
      const btn = e.target.closest('.btn-delete');
      if (!btn) return;
      const recId = btn.getAttribute('data-id');
      if (!recId) return;
      if (!confirm('この申請を削除しますか？')) return;
      btn.disabled = true;
      try {
        await fetchJSONAuth(`/api/adjust/${recId}`, { method: 'DELETE' });
        await renderList();
      } catch (err) {
        showErr(err?.message || '削除に失敗しました');
        btn.disabled = false;
      }
    };
    // host.addEventListener('click', deleteHandler);

    const chatHandler = async (e) => {
      const btn = e.target.closest('.btn-chat');
      if (!btn) return;
      const recId = btn.getAttribute('data-id');
      if (!recId) return;
      openAdjustChatId = recId;
      openAdjustChatModal(recId);
    };
    // host.addEventListener('click', chatHandler);
      
    // Event delegation trên #adjustListHost (phần tử cố định).
    // Chỉ gắn MỘT LẦN để tránh listener chồng lên nhau qua mỗi lần renderList().
    if (!host.dataset.wired) {
      host.dataset.wired = '1';
      host.addEventListener('click', (e) => {
        if (e.target.closest('.btn-edit')) {
          handleInlineEdit(e);
        } else if (e.target.closest('.btn-delete')) {
          deleteHandler(e);
        } else if (e.target.closest('.btn-chat')) {
          chatHandler(e);
        }
      });
    }

  } catch (e) {
    host.innerHTML = `<div style="color:#b00020;font-weight:650;">取得失敗: ${esc(e?.message || 'unknown')}</div>`;
  } finally {
    hideSpinner();
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  wireUserMenu();
  wireDrawer();
  prefillUserName();
  try {
    const profile = await fetchJSONAuth('/api/auth/me');
    const role = String(profile?.role || '').toLowerCase();
    // Admin không được tạo request, chỉ được xét duyệt
    if (!profile || !(role === 'employee' || role === 'manager')) {
      window.location.replace('/ui/login');
      return;
    }
    const name = profile.username || profile.email || 'ユーザー';
    const el = $('#userName');
    if (el) el.textContent = name;
  } catch (e) {
    window.location.replace('/ui/login');
    return;
  }
  await renderForm();
  await renderList();


});
