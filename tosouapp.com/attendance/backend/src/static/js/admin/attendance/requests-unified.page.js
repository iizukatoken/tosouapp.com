// 申請一覧（統合）: 調整申請一覧 の上にタブを出し、社員の申請をすべて 1か所で承認/却下できるようにする。
// 「調整申請」タブは従来の画面（やり取り・Excel出力など）をそのまま表示する。
// 承認/却下は API (/api/admin/requests/list) が返す actions の元APIをそのまま呼ぶ。
import { fetchJSONAuth } from '../../api/http.api.js';

const TABS = [
  { key: 'all', label: 'すべて' },
  { key: 'adjust', label: '調整申請' },
  { key: 'leave', label: '有給・休暇' },
  { key: 'shift', label: 'シフト' },
  { key: 'profile', label: 'プロフィール' },
  { key: 'other', label: 'その他' }
];
const STATUS_LABEL = { pending: '承認待ち', approved: '承認済み', rejected: '却下' };

// シフト承認 画面と同じトーン（紺 #0b2c66・角丸4px・高さ32px）。管理画面共通CSSに負けないよう !important。
const CSS = `
  .req-unified { font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, sans-serif; color: #1e293b; background: #fff; padding: 14px 20px 0; box-sizing: border-box; font-size: 13px; }
  .req-unified .ru-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .req-unified .ru-title { font-size: 18px; font-weight: 800; margin: 0; color: #1e293b; }
  .req-unified .ru-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .req-unified .ru-btn, .req-unified .ru-tab, .req-unified .ru-select {
    display: inline-flex !important; align-items: center; justify-content: center; gap: 4px; box-sizing: border-box;
    height: 32px !important; padding: 0 14px !important; margin: 0 !important; border: 1px solid #c7ced8 !important; border-radius: 4px !important;
    background: #fff !important; color: #1e293b !important; font-size: 13px !important; font-weight: 600 !important; line-height: 1 !important;
    cursor: pointer; text-decoration: none !important; white-space: nowrap; box-shadow: none !important; }
  .req-unified .ru-btn:hover, .req-unified .ru-tab:hover { background: #f3f5f8 !important; border-color: #9aa4b2 !important; }
  .req-unified .ru-btn.sm { height: 28px !important; padding: 0 10px !important; font-size: 12.5px !important; }
  .req-unified .ru-btn.ok { background: #0b2c66 !important; border-color: #0b2c66 !important; color: #fff !important; }
  .req-unified .ru-btn.ok:hover { background: #0a2455 !important; }
  .req-unified .ru-btn.ng { border-color: #f0b4b4 !important; color: #c02626 !important; }
  .req-unified .ru-btn.ng:hover { background: #fef2f2 !important; border-color: #e58f8f !important; }
  .req-unified .ru-btn:disabled { opacity: .45; cursor: default; }
  .req-unified .ru-tab.active, .req-unified .ru-tab.active:hover { background: #e0f2fe !important; border-color: #7dd3fc !important; color: #075985 !important; }
  .req-unified .ru-tabcount { font-weight: 600; margin-left: 2px; }
  .req-unified .ru-tab.hot:not(.active) .ru-tabcount { color: #c2410c; font-weight: 800; }
  .req-unified .ru-select { padding: 0 28px 0 10px !important; font-weight: 400 !important; appearance: auto; }
  .req-unified .ru-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .req-unified .ru-monthnav { display: inline-flex; align-items: center; gap: 8px; }
  .req-unified .ru-month { font-size: 15px; font-weight: 800; min-width: 92px; text-align: center; }
  .req-unified .ru-count { color: #64748b; }
  .req-unified .ru-msg { color: #b91c1c; }
  .req-unified .ru-msg:not(:empty) { margin-bottom: 8px; }
  .req-unified .ru-tablewrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
  .req-unified .ru-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  .req-unified .ru-table th { background: #f8fafc; color: #475569; font-size: 12.5px; font-weight: 700; text-align: left; padding: 9px 10px; border-bottom: 1px solid #e2e8f0; }
  .req-unified .ru-table td { padding: 9px 10px; border-bottom: 1px solid #eef2f6; vertical-align: middle; word-break: break-word; }
  .req-unified .ru-table tbody tr:last-child td { border-bottom: none; }
  .req-unified .ru-table tbody tr:hover td { background: #f8fafc; }
  .req-unified .ru-table tr.is-warn td { background: #fef2f2; }
  .req-unified .nowrap { white-space: nowrap; }
  .req-unified .ru-sub { color: #64748b; font-size: 12px; margin-top: 2px; }
  .req-unified .ru-muted { color: #475569; }
  .req-unified .ru-warn { color: #b91c1c; font-size: 12px; margin-top: 3px; }
  .req-unified .ru-note { color: #64748b; font-size: 12px; }
  .req-unified .ru-empty { padding: 20px 10px !important; color: #64748b; text-align: center; }
  .req-unified .ru-ops { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .req-unified .ru-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .req-unified .ru-pill.pending { color: #c2410c; background: #ffedd5; }
  .req-unified .ru-pill.approved { color: #15803d; background: #dcfce7; }
  .req-unified .ru-pill.rejected { color: #b91c1c; background: #fee2e2; }
`;
function ensureStyles() {
  if (document.getElementById('ru-css')) return;
  const st = document.createElement('style');
  st.id = 'ru-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
const TAB_KEY = 'adm.requests.tab';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonth = (m, delta) => {
  const [y, mo] = m.split('-').map(Number);
  return ym(new Date(y, mo - 1 + delta, 1));
};
const readTab = () => { try { return sessionStorage.getItem(TAB_KEY) || 'all'; } catch { return 'all'; } };
const saveTab = (k) => { try { sessionStorage.setItem(TAB_KEY, k); } catch { /* ignore */ } };

export async function mount({ content }) {
  const legacy = content; // 従来の調整申請画面（中身は自分で innerHTML を書き換えるので、外側に置く）
  const parent = legacy?.parentElement;
  if (!parent) return null;

  const state = { tab: readTab(), month: ym(new Date()), status: 'pending', items: [], summary: {}, busy: false, adjustChanged: false };
  // ?tab=leave など（旧「休暇申請承認」URL からの転送）
  try {
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab && TABS.some(t => t.key === urlTab)) { state.tab = urlTab; saveTab(urlTab); }
  } catch { /* ignore */ }
  if (!TABS.some(t => t.key === state.tab)) state.tab = 'all';

  ensureStyles();
  const root = document.createElement('div');
  root.className = 'req-unified';
  root.innerHTML = `
    <div class="ru-head">
      <h2 class="ru-title">申請一覧</h2>
      <div class="ru-tabs" role="tablist"></div>
    </div>
    <div class="ru-panel">
      <div class="ru-toolbar">
        <div class="ru-monthnav">
          <button type="button" class="ru-btn ru-prev" aria-label="前月">‹ 前月</button>
          <span class="ru-month"></span>
          <button type="button" class="ru-btn ru-next" aria-label="翌月">翌月 ›</button>
        </div>
        <select class="ru-select ru-status" aria-label="状態">
          <option value="pending">承認待ち</option>
          <option value="approved">承認済み</option>
          <option value="rejected">却下</option>
          <option value="">すべての状態</option>
        </select>
        <span class="ru-count"></span>
      </div>
      <div class="ru-msg"></div>
      <div class="ru-tablewrap">
        <table class="ru-table">
          <thead><tr>
            <th style="width:96px;">種別</th><th style="width:150px;">申請者</th><th style="width:100px;">対象日</th>
            <th>内容</th><th>理由・備考</th><th style="width:84px;">状態</th>
            <th style="width:90px;">処理者</th><th style="width:210px;">操作</th>
          </tr></thead>
          <tbody class="ru-body"></tbody>
        </table>
      </div>
    </div>`;
  parent.insertBefore(root, legacy);

  const $ = (sel) => root.querySelector(sel);
  const panel = $('.ru-panel');
  $('.ru-status').value = state.status;

  function renderTabs() {
    const pend = state.summary?.pendingByCategory || {};
    const total = Object.values(pend).reduce((a, b) => a + b, 0);
    $('.ru-tabs').innerHTML = TABS.map(t => {
      const n = t.key === 'all' ? total : (pend[t.key] || 0);
      const active = t.key === state.tab;
      // 調整申請 タブは従来画面なので件数は出さない（月の絞り込みが別のため）
      const count = t.key === 'adjust' ? '' : `<span class="ru-tabcount">(${n})</span>`;
      return `<button type="button" role="tab" data-tab="${t.key}" aria-selected="${active}"
        class="ru-tab${active ? ' active' : ''}${n ? ' hot' : ''}">${esc(t.label)}${count}</button>`;
    }).join('');
  }

  function applyTabVisibility() {
    const showLegacy = state.tab === 'adjust';
    legacy.style.display = showLegacy ? '' : 'none';
    panel.style.display = showLegacy ? 'none' : '';
  }

  function renderRows() {
    const rows = state.tab === 'all' ? state.items : state.items.filter(r => r.category === state.tab);
    $('.ru-month').textContent = state.month.replace('-', '年') + '月';
    $('.ru-count').textContent = `${rows.length}件`;
    if (!rows.length) {
      $('.ru-body').innerHTML = '<tr><td colspan="8" class="ru-empty">該当する申請はありません。</td></tr>';
      return;
    }
    $('.ru-body').innerHTML = rows.map((r) => {
      const idx = state.items.indexOf(r);
      const ops = [];
      // シフトは日ごとの出勤・休みを月カレンダーで確認してから承認する
      if (r.category === 'shift') {
        const href = `/admin/attendance/shifts-approvals?month=${encodeURIComponent(r.targetDate)}&view=${encodeURIComponent(r.userId)}`;
        ops.push(`<a href="${href}" class="ru-btn sm">内容を見る</a>`);
      }
      if (r.status === 'pending' && r.actions) {
        ops.push(`<button type="button" class="ru-btn sm ok" data-act="approve" data-i="${idx}">承認</button>`);
        ops.push(`<button type="button" class="ru-btn sm ng" data-act="reject" data-i="${idx}">却下</button>`);
      } else if (!r.actions && r.source === 'shift') {
        ops.push('<span class="ru-note">シフト承認で決定</span>');
      }
      const warn = r.warning ? `<div class="ru-warn">⚠ ${esc(r.warning)}</div>` : '';
      const sub = [r.employeeCode, r.departmentName].filter(Boolean).map(esc).join(' / ');
      const st = STATUS_LABEL[r.status] ? r.status : 'pending';
      return `<tr class="${r.warning ? 'is-warn' : ''}">
        <td class="nowrap">${esc(r.typeLabel)}</td>
        <td>${esc(r.applicantName)}${sub ? `<div class="ru-sub">${sub}</div>` : ''}</td>
        <td class="nowrap">${esc(r.targetDate)}</td>
        <td>${esc(r.content)}${warn}</td>
        <td class="ru-muted">${esc(r.reason)}</td>
        <td><span class="ru-pill ${st}">${esc(STATUS_LABEL[st])}</span></td>
        <td class="nowrap">${esc(r.processedByName || '')}</td>
        <td><div class="ru-ops">${ops.join('')}</div></td>
      </tr>`;
    }).join('');
  }

  async function load() {
    $('.ru-msg').textContent = '';
    $('.ru-body').innerHTML = '<tr><td colspan="8" class="ru-empty">読み込み中…</td></tr>';
    try {
      const qs = new URLSearchParams({ month: state.month, pageSize: '200' });
      if (state.status) qs.set('status', state.status);
      const res = await fetchJSONAuth(`/api/admin/requests/list?${qs}`);
      state.items = Array.isArray(res?.items) ? res.items : [];
      state.summary = res?.summary || {};
    } catch (e) {
      state.items = [];
      $('.ru-msg').textContent = `取得失敗: ${e?.message || 'error'}`;
    }
    renderTabs();
    renderRows();
  }

  async function decide(item, kind) {
    const action = item.actions?.[kind];
    if (!action || state.busy) return;
    const body = { ...action.body };
    if (kind === 'approve') {
      if (!confirm(`${item.applicantName} さんの「${item.typeLabel}」を承認しますか？`)) return;
    } else {
      const note = prompt(action.noteRequired ? '却下理由を入力してください（必須）' : '却下理由（任意）', '');
      if (note === null) return;
      if (action.noteRequired && !note.trim()) { alert('却下理由を入力してください。'); return; }
      if (action.noteField) body[action.noteField] = note.trim();
    }
    state.busy = true;
    try {
      await fetchJSONAuth(action.url, { method: action.method, body: JSON.stringify(body) });
      if (item.category === 'adjust') state.adjustChanged = true;
    } catch (e) {
      alert(`処理に失敗しました: ${e?.message || 'error'}`);
    } finally {
      state.busy = false;
    }
    await load();
  }

  const onClick = (ev) => {
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab;
      saveTab(state.tab);
      // 統合一覧で打刻修正を処理した後は、従来画面を最新にするため再読み込み
      if (state.tab === 'adjust' && state.adjustChanged) { location.reload(); return; }
      renderTabs();
      applyTabVisibility();
      renderRows();
      return;
    }
    const actBtn = ev.target.closest('[data-act]');
    if (actBtn) {
      const item = state.items[Number(actBtn.dataset.i)];
      if (item) decide(item, actBtn.dataset.act);
      return;
    }
    if (ev.target.closest('.ru-prev')) { state.month = shiftMonth(state.month, -1); load(); }
    else if (ev.target.closest('.ru-next')) { state.month = shiftMonth(state.month, 1); load(); }
  };
  const onChange = (ev) => {
    if (ev.target.closest('.ru-status')) { state.status = ev.target.value; load(); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  renderTabs();
  applyTabVisibility();
  await load();

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.remove();
    legacy.style.display = '';
  };
}
