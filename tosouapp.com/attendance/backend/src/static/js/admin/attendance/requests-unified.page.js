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
  #reqUnified.req-unified { font-family: 'Meiryo UI', 'Yu Gothic UI', Meiryo, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif !important; color: #1f2937; background: #fff; padding: 12px 16px 0; box-sizing: border-box; font-size: 12.5px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  #reqUnified.req-unified * { font-family: inherit !important; }
  /* 共通UI（案C）と同じ: タイトルの下に紺の線 */
  #reqUnified.req-unified .ru-title { font-size: 16px !important; font-weight: 700 !important; margin: 0 0 8px !important; padding: 0 0 6px; border-bottom: 2px solid #0b2c66; color: #0b2c66; line-height: 1.3; }

  /* フォルダ型タブ */
  #reqUnified.req-unified .ru-tabs { display: flex; gap: 2px; align-items: flex-end; border-bottom: 1px solid #c3cdda; padding: 4px 6px 0; background: #f3f6fa; }
  #reqUnified.req-unified .ru-tab {
    height: 24px !important; padding: 0 12px !important; margin: 0 0 -1px !important;
    border: 1px solid #c3cdda !important; border-bottom: none !important; border-radius: 0 !important;
    background: #e6edf7 !important; color: #0b2c66 !important; font-size: 12.5px !important; font-weight: 600 !important;
    cursor: pointer; box-shadow: none !important; line-height: 24px !important; white-space: nowrap; }
  #reqUnified.req-unified .ru-tab:hover { background: #d3dff0 !important; }
  #reqUnified.req-unified .ru-tab.active, #reqUnified.req-unified .ru-tab.active:hover {
    background: #0b2c66 !important; color: #fff !important; font-weight: 700 !important; border-color: #0b2c66 !important;
    height: 25px !important; border-bottom: 1px solid #0b2c66 !important; }
  #reqUnified.req-unified .ru-tabcount { margin-left: 3px; color: #7a8699; font-weight: 400; }
  #reqUnified.req-unified .ru-tab.active .ru-tabcount { color: #c9d6ea; }
  #reqUnified.req-unified .ru-tab:not(.hot) .ru-tabcount::before { content: "("; }
  #reqUnified.req-unified .ru-tab:not(.hot) .ru-tabcount::after { content: ")"; }
  #reqUnified.req-unified .ru-tab.hot .ru-tabcount { display: inline-block; min-width: 16px; height: 16px; padding: 0 4px; margin-left: 4px;
    border-radius: 999px !important; background: #dc2626 !important; color: #fff !important; font-size: 10.5px; font-weight: 700; line-height: 16px; text-align: center; vertical-align: 1px; box-sizing: border-box; }

  #reqUnified.req-unified .ru-panel { padding: 10px 0 16px; }
  #reqUnified.req-unified .ru-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; padding: 6px 8px; background: #f1f4f8; border: 1px solid #c3cdda; }
  #reqUnified.req-unified .ru-monthnav { display: inline-flex; align-items: center; gap: 6px; }
  #reqUnified.req-unified .ru-month { font-size: 12.5px; font-weight: 700; min-width: 78px; text-align: center; color: #1f2d3d; }
  #reqUnified.req-unified .ru-count { color: #777; margin-left: 4px; }
  #reqUnified.req-unified .ru-msg { color: #b42318; }
  #reqUnified.req-unified .ru-msg:not(:empty) { margin-bottom: 6px; }

  /* ボタン・セレクト */
  #reqUnified.req-unified .ru-btn, #reqUnified.req-unified .ru-select {
    display: inline-flex !important; align-items: center; justify-content: center; box-sizing: border-box;
    height: 24px !important; padding: 0 10px !important; margin: 0 !important;
    border: 1px solid #c3cdda !important; border-radius: 2px !important; background: #fff !important; color: #1f2937 !important;
    font-size: 12px !important; font-weight: 600 !important; line-height: 1 !important;
    cursor: pointer; text-decoration: none !important; white-space: nowrap; box-shadow: none !important; }
  #reqUnified.req-unified .ru-seg { display: inline-flex; border: 1px solid #c3cdda; border-radius: 2px; overflow: hidden; }
  #reqUnified.req-unified .ru-seg button { height: 24px; padding: 0 10px; border: 0; border-radius: 0; background: #fff; color: #334155; font: 600 12px 'Meiryo UI', 'Yu Gothic UI', Meiryo, sans-serif; cursor: pointer; white-space: nowrap; }
  #reqUnified.req-unified .ru-seg button + button { border-left: 1px solid #c3cdda; }
  #reqUnified.req-unified .ru-seg button:hover { background: #f1f5f9; }
  #reqUnified.req-unified .ru-seg button.on { background: #0b2c66; color: #fff; }
  #reqUnified.req-unified .ru-btn:hover { background: #f6f8fb !important; border-color: #8a97aa !important; }
  #reqUnified.req-unified .ru-btn.sm { height: 20px !important; padding: 0 7px !important; font-size: 11.5px !important; }
  #reqUnified.req-unified .ru-btn.ok { background: #0b2c66 !important; border-color: #08214d !important; color: #fff !important; }
  #reqUnified.req-unified .ru-btn.ok:hover { background: #082251 !important; }
  #reqUnified.req-unified .ru-btn.ng { background: #fff !important; color: #a11 !important; border-color: #d79a9a !important; }
  #reqUnified.req-unified .ru-btn.ng:hover { background: #fdf3f2 !important; }
  #reqUnified.req-unified .ru-btn:disabled { opacity: .45; cursor: default; }
  #reqUnified.req-unified .ru-select { padding: 0 6px !important; appearance: auto; min-width: 110px; background: #fff !important; border-radius: 0 !important; font-weight: 400 !important; }

  /* 罫線ありの表 */
  #reqUnified.req-unified .ru-tablewrap { overflow-x: auto; }
  #reqUnified.req-unified .ru-table { width: 100% !important; min-width: 880px !important; border-collapse: collapse !important; table-layout: auto !important; display: table !important; margin: 0 !important; border: 1px solid #c3cdda !important; font-size: 12.5px !important; background: #fff; }
  #reqUnified.req-unified .ru-table th {
    position: static !important;
    background: #eef2f7 !important; background-image: none !important;
    color: #0f172a !important; font-size: 12px !important; font-weight: 700 !important; text-align: left !important;
    padding: 4px 8px !important; border: 1px solid #c3cdda !important; white-space: nowrap; height: auto !important; }
  #reqUnified.req-unified .ru-table td { padding: 3px 8px !important; border: 1px solid #d3dae4 !important; vertical-align: middle !important; color: #1f2937 !important; font-size: 12.5px !important; text-align: left !important; background: #fff; }
  #reqUnified.req-unified .ru-table tbody tr:nth-child(even) td { background: #f7f9fc; }
  #reqUnified.req-unified .ru-table tbody tr:hover td { background: #fff8db; }
  #reqUnified.req-unified .ru-table tr.is-warn td { background: #fdf1f0 !important; }
  #reqUnified.req-unified .ru-table .nowrap { white-space: nowrap !important; word-break: normal !important; }
  #reqUnified.req-unified .ru-table .c-content { min-width: 170px; }
  #reqUnified.req-unified .ru-table .c-reason { min-width: 150px; }
  #reqUnified.req-unified .ru-table td .ru-sub { color: #8a94a3 !important; font-size: 10px !important; line-height: 1.2 !important; margin-top: 1px; }
  #reqUnified.req-unified .ru-muted { color: #666 !important; }
  #reqUnified.req-unified .ru-warn { color: #b42318; font-size: 11px; margin-top: 2px; }
  #reqUnified.req-unified .ru-note { color: #888; font-size: 11px; }
  #reqUnified.req-unified .ru-empty { padding: 16px 8px !important; color: #6b7684 !important; text-align: center !important; }
  #reqUnified.req-unified .ru-ops { display: flex; gap: 4px; flex-wrap: nowrap; align-items: center; }

  /* 状態（角型の枠付きラベル） */
  /* 状態ラベル: 共通の色（待ち=黄・済=緑・差戻し=赤） */
  #reqUnified.req-unified .ru-pill { display: inline-block; min-width: 56px; text-align: center; padding: 0 8px; border: 1px solid; border-radius: 0; font-size: 11.5px; font-weight: 700; line-height: 18px; white-space: nowrap; }
  #reqUnified.req-unified .ru-pill.pending { color: #8a5300; border-color: #e5bf5c; background: #fff4d6; }
  #reqUnified.req-unified .ru-pill.approved { color: #146c2e; border-color: #8cc79c; background: #e6f4ea; }
  #reqUnified.req-unified .ru-pill.rejected { color: #9b1c1c; border-color: #e09a9a; background: #fde8e8; }
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

  const state = { tab: readTab(), month: ym(new Date()), status: '', items: [], summary: {}, busy: false, adjustChanged: false };
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

  function renderTabs() {
    const pend = state.summary?.pendingByCategory || {};
    const total = Object.values(pend).reduce((a, b) => a + b, 0);
    $('.ru-tabs').innerHTML = TABS.map(t => {
      const n = t.key === 'all' ? total : (pend[t.key] || 0);
      const active = t.key === state.tab;
      // 調整申請 タブは従来画面なので件数は出さない（月の絞り込みが別のため）
      const count = t.key === 'adjust' ? '' : `<span class="ru-tabcount">${n}</span>`;
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
        <td class="nowrap">${r.processedByName ? esc(r.processedByName) : (r.status !== 'pending' ? '<span style="color:#94a3b8;font-size:11px;" title="この機能を入れる前に処理されたため、処理者の記録がありません">記録なし</span>' : '')}</td>
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
