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
const STATUS_COLOR = { pending: '#b45309', approved: '#15803d', rejected: '#b91c1c' };
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
  if (!TABS.some(t => t.key === state.tab)) state.tab = 'all';

  const root = document.createElement('div');
  root.className = 'req-unified';
  root.style.cssText = 'background:#fff;padding:12px 16px 0;';
  root.innerHTML = `
    <div class="ru-tabs" role="tablist" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0;"></div>
    <div class="ru-panel" style="padding:12px 0;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
        <button type="button" class="ru-prev" style="padding:4px 10px;">前月</button>
        <strong class="ru-month" style="min-width:80px;text-align:center;"></strong>
        <button type="button" class="ru-next" style="padding:4px 10px;">翌月</button>
        <select class="ru-status" style="padding:4px 8px;margin-left:8px;">
          <option value="pending">承認待ち</option>
          <option value="approved">承認済み</option>
          <option value="rejected">却下</option>
          <option value="">すべての状態</option>
        </select>
        <span class="ru-count" style="color:#475569;font-size:13px;"></span>
      </div>
      <div class="ru-msg" style="color:#b91c1c;margin-bottom:8px;"></div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:860px;">
          <thead><tr style="background:#f1f5f9;text-align:left;">
            <th style="padding:6px;">種別</th><th style="padding:6px;">申請者</th><th style="padding:6px;">対象日</th>
            <th style="padding:6px;">内容</th><th style="padding:6px;">理由・備考</th><th style="padding:6px;">状態</th>
            <th style="padding:6px;">処理者</th><th style="padding:6px;">操作</th>
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
      return `<button type="button" role="tab" data-tab="${t.key}" aria-selected="${active}"
        style="padding:8px 14px;border:none;border-bottom:3px solid ${active ? '#0b5ed7' : 'transparent'};background:none;cursor:pointer;font-weight:${active ? 700 : 400};">
        ${esc(t.label)}${n ? ` <span style="background:#dc2626;color:#fff;border-radius:9px;padding:0 6px;font-size:11px;">${n}</span>` : ''}
      </button>`;
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
      $('.ru-body').innerHTML = '<tr><td colspan="8" style="padding:16px;color:#64748b;">該当する申請はありません。</td></tr>';
      return;
    }
    $('.ru-body').innerHTML = rows.map((r, i) => {
      const idx = state.items.indexOf(r);
      let ops = '';
      if (r.status === 'pending' && r.actions) {
        ops = `<button type="button" data-act="approve" data-i="${idx}" style="padding:3px 10px;margin-right:4px;background:#16a34a;color:#fff;border:none;border-radius:4px;">承認</button>`
          + `<button type="button" data-act="reject" data-i="${idx}" style="padding:3px 10px;background:#dc2626;color:#fff;border:none;border-radius:4px;">却下</button>`;
      } else if (!r.actions && r.source === 'shift') {
        ops = '<span style="color:#64748b;">シフト承認で決定</span>';
      }
      const warn = r.warning ? `<div style="color:#b91c1c;font-size:12px;margin-top:2px;">⚠ ${esc(r.warning)}</div>` : '';
      const who = `${esc(r.applicantName)}${r.employeeCode ? `<div style="color:#64748b;font-size:11px;">${esc(r.employeeCode)}${r.departmentName ? ' / ' + esc(r.departmentName) : ''}</div>` : ''}`;
      return `<tr style="border-bottom:1px solid #e2e8f0;${r.warning ? 'background:#fef2f2;' : (i % 2 ? 'background:#fafafa;' : '')}">
        <td style="padding:6px;white-space:nowrap;">${esc(r.typeLabel)}</td>
        <td style="padding:6px;">${who}</td>
        <td style="padding:6px;white-space:nowrap;">${esc(r.targetDate)}</td>
        <td style="padding:6px;">${esc(r.content)}${warn}</td>
        <td style="padding:6px;">${esc(r.reason)}</td>
        <td style="padding:6px;white-space:nowrap;color:${STATUS_COLOR[r.status] || '#334155'};font-weight:600;">${esc(STATUS_LABEL[r.status] || r.status)}</td>
        <td style="padding:6px;white-space:nowrap;">${esc(r.processedByName || '')}</td>
        <td style="padding:6px;white-space:nowrap;">${ops}</td>
      </tr>`;
    }).join('');
  }

  async function load() {
    $('.ru-msg').textContent = '';
    $('.ru-body').innerHTML = '<tr><td colspan="8" style="padding:16px;color:#64748b;">読み込み中…</td></tr>';
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
