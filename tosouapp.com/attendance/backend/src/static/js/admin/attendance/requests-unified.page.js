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

// 業務システム風（クラシック）: Meiryo 12.5px・罫線ありの表・フォルダ型タブ・小さめのボタン。
// 管理画面共通CSS（表見出しの青背景・中央寄せ等）に負けないよう !important。
const CSS = `
  #reqUnified.req-unified { font-family: Meiryo, 'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif !important; color: #222; background: #fff; padding: 12px 16px 0; box-sizing: border-box; font-size: 12.5px; line-height: 1.5; }
  #reqUnified.req-unified * { font-family: inherit !important; }
  #reqUnified.req-unified .ru-title { font-size: 15px !important; font-weight: 700 !important; margin: 0 0 10px !important; padding: 2px 0 2px 8px; border-left: 4px solid #0b2c66; color: #1a2b44; line-height: 1.3; }

  /* フォルダ型タブ */
  #reqUnified.req-unified .ru-tabs { display: flex; gap: 2px; align-items: flex-end; border-bottom: 1px solid #aeb8c4; padding-left: 2px; }
  #reqUnified.req-unified .ru-tab {
    height: 28px !important; padding: 0 14px !important; margin: 0 0 -1px !important;
    border: 1px solid #aeb8c4 !important; border-bottom: none !important; border-radius: 3px 3px 0 0 !important;
    background: #eef1f4 !important; color: #3a4553 !important; font-size: 12.5px !important; font-weight: 400 !important;
    cursor: pointer; box-shadow: none !important; line-height: 26px !important; white-space: nowrap; }
  #reqUnified.req-unified .ru-tab:hover { background: #e3e8ee !important; }
  #reqUnified.req-unified .ru-tab.active, #reqUnified.req-unified .ru-tab.active:hover {
    background: #fff !important; color: #0b2c66 !important; font-weight: 700 !important;
    border-top: 2px solid #0b2c66 !important; height: 30px !important; border-bottom: 1px solid #fff !important; }
  #reqUnified.req-unified .ru-tabcount { margin-left: 3px; color: #6b7684; }
  #reqUnified.req-unified .ru-tab.hot .ru-tabcount { color: #c0392b; font-weight: 700; }

  #reqUnified.req-unified .ru-panel { padding: 10px 0 16px; }
  #reqUnified.req-unified .ru-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  #reqUnified.req-unified .ru-monthnav { display: inline-flex; align-items: center; gap: 6px; }
  #reqUnified.req-unified .ru-month { font-size: 13.5px; font-weight: 700; min-width: 84px; text-align: center; color: #1a2b44; }
  #reqUnified.req-unified .ru-count { color: #5b6573; margin-left: 4px; }
  #reqUnified.req-unified .ru-msg { color: #b42318; }
  #reqUnified.req-unified .ru-msg:not(:empty) { margin-bottom: 6px; }

  /* ボタン・セレクト */
  #reqUnified.req-unified .ru-btn, #reqUnified.req-unified .ru-select {
    display: inline-flex !important; align-items: center; justify-content: center; box-sizing: border-box;
    height: 26px !important; padding: 0 10px !important; margin: 0 !important;
    border: 1px solid #aeb8c4 !important; border-radius: 3px !important; background: #fff !important; color: #222 !important;
    font-size: 12px !important; font-weight: 400 !important; line-height: 1 !important;
    cursor: pointer; text-decoration: none !important; white-space: nowrap; box-shadow: none !important; }
  #reqUnified.req-unified .ru-btn:hover { background: #f1f4f7 !important; border-color: #8c97a5 !important; }
  #reqUnified.req-unified .ru-btn.sm { height: 24px !important; padding: 0 9px !important; }
  #reqUnified.req-unified .ru-btn.ok { background: #0b2c66 !important; border-color: #0b2c66 !important; color: #fff !important; }
  #reqUnified.req-unified .ru-btn.ok:hover { background: #082251 !important; }
  #reqUnified.req-unified .ru-btn.ng { color: #b42318 !important; border-color: #d9a6a0 !important; }
  #reqUnified.req-unified .ru-btn.ng:hover { background: #fdf3f2 !important; }
  #reqUnified.req-unified .ru-btn:disabled { opacity: .45; cursor: default; }
  #reqUnified.req-unified .ru-select { padding: 0 6px !important; appearance: auto; min-width: 110px; }

  /* 罫線ありの表 */
  #reqUnified.req-unified .ru-tablewrap { overflow-x: auto; }
  #reqUnified.req-unified .ru-table { width: 100% !important; min-width: 880px !important; border-collapse: collapse !important; table-layout: auto !important; display: table !important; margin: 0 !important; border: 1px solid #b9c3ce !important; font-size: 12.5px !important; background: #fff; }
  #reqUnified.req-unified .ru-table th {
    position: static !important;
    background: #edf0f4 !important; background-image: linear-gradient(#f6f8fa, #e8ecf1) !important;
    color: #2b3644 !important; font-size: 12px !important; font-weight: 700 !important; text-align: left !important;
    padding: 5px 8px !important; border: 1px solid #b9c3ce !important; white-space: nowrap; height: auto !important; }
  #reqUnified.req-unified .ru-table td { padding: 5px 8px !important; border: 1px solid #d3dae2 !important; vertical-align: middle !important; color: #222 !important; font-size: 12.5px !important; text-align: left !important; background: #fff; }
  #reqUnified.req-unified .ru-table tbody tr:nth-child(even) td { background: #f9fafb; }
  #reqUnified.req-unified .ru-table tbody tr:hover td { background: #eef4fb; }
  #reqUnified.req-unified .ru-table tr.is-warn td { background: #fdf1f0 !important; }
  #reqUnified.req-unified .ru-table .nowrap { white-space: nowrap !important; word-break: normal !important; }
  #reqUnified.req-unified .ru-table .c-content { min-width: 170px; }
  #reqUnified.req-unified .ru-table .c-reason { min-width: 150px; }
  #reqUnified.req-unified .ru-sub { color: #6b7684; font-size: 11.5px; }
  #reqUnified.req-unified .ru-muted { color: #4a5563 !important; }
  #reqUnified.req-unified .ru-warn { color: #b42318; font-size: 11.5px; margin-top: 2px; }
  #reqUnified.req-unified .ru-note { color: #6b7684; font-size: 11.5px; }
  #reqUnified.req-unified .ru-empty { padding: 16px 8px !important; color: #6b7684 !important; text-align: center !important; }
  #reqUnified.req-unified .ru-ops { display: flex; gap: 4px; flex-wrap: nowrap; align-items: center; }

  /* 状態（角型の枠付きラベル） */
  #reqUnified.req-unified .ru-pill { display: inline-block; padding: 0 6px; border: 1px solid; border-radius: 2px; font-size: 11.5px; line-height: 18px; white-space: nowrap; }
  #reqUnified.req-unified .ru-pill.pending { color: #a15c07; border-color: #e7c08a; background: #fff8ec; }
  #reqUnified.req-unified .ru-pill.approved { color: #1e6b34; border-color: #a9d3b5; background: #f1faf3; }
  #reqUnified.req-unified .ru-pill.rejected { color: #a3231a; border-color: #e3aaa4; background: #fdf2f1; }
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
  root.id = 'reqUnified'; // 管理画面の #adminContent table{...} 系の規則より強くするため
  root.innerHTML = `
    <h2 class="ru-title">申請一覧</h2>
    <div class="ru-tabs" role="tablist"></div>
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
            <th>種別</th><th>申請者</th><th>対象日</th>
            <th>内容</th><th>理由・備考</th><th>状態</th>
            <th>処理者</th><th>操作</th>
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
        <td class="nowrap">${esc(r.applicantName)}${sub ? `<div class="ru-sub">${sub}</div>` : ''}</td>
        <td class="nowrap">${esc(r.targetDate)}</td>
        <td class="c-content">${esc(r.content)}${warn}</td>
        <td class="c-reason ru-muted">${esc(r.reason)}</td>
        <td class="nowrap"><span class="ru-pill ${st}">${esc(STATUS_LABEL[st])}</span></td>
        <td class="nowrap">${esc(r.processedByName || '')}</td>
        <td class="nowrap"><div class="ru-ops">${ops.join('')}</div></td>
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
