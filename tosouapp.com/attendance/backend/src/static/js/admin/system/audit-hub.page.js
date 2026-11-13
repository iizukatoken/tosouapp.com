/**
 * 監査ログ: 「勤怠の修正」（打刻編集・調整申請の承認）と「ログイン・システム操作」（従来の監査ログ）をタブで切り替え。
 */
import { api, downloadWithAuth } from '../../shared/api/client.js';
import { listUsers } from '../../api/users.api.js';
import { escapeHtml as esc } from '../_shared/dom.js';

const KINDS = [
  ['', 'すべての操作'], ['void', '打刻の取消'], ['edit', '打刻の修正'], ['add', '打刻の追加'], ['restore', '取消の復元'], ['adjust', '調整申請の承認']
];
const roleJa = (r) => ({ admin: '管理者', manager: 'マネージャー' }[String(r || '').toLowerCase()] || '');
const jst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const CSS = `
.ah-tabs{display:flex;gap:0;border-bottom:2px solid #0b2c66;margin:0 0 12px}
.ah-tab{height:32px;padding:0 16px;border:1px solid #c3cdda;border-bottom:0;background:#f1f5f9;color:#334155;font-size:13px;font-weight:700;cursor:pointer;margin-right:4px;font-family:inherit}
.ah-tab.on{background:#0b2c66;border-color:#0b2c66;color:#fff}
.pa-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:10px}
.pa-filters label{display:flex;flex-direction:column;gap:2px;font-size:11px;font-weight:700;color:#475569}
.pa-f{height:30px;border:1px solid #c3cdda;font-size:12.5px;padding:0 6px;font-family:inherit;background:#fff}
.pa-btn{height:30px;padding:0 14px;border:1px solid #0b2c66;background:#0b2c66;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit}
.pa-btn.sub{background:#f0fdf4;border-color:#86efac;color:#166534}
.pa-t{width:100%;border-collapse:collapse;font-size:12.5px}
.pa-t th{background:#0b2c66 !important;color:#fff !important;border:1px solid #0b2c66;padding:6px 8px;text-align:left;font-weight:700;white-space:nowrap;position:sticky;top:0}
.pa-t td{border:1px solid #d5dde8;padding:5px 8px;vertical-align:top}
.pa-t tr:nth-child(even) td{background:#f8fafc}
.pa-t td.pa-del{color:#b91c1c !important;font-weight:700}
.pa-sub{font-size:11px;color:#64748b}
.pa-count{font-size:12px;color:#475569;margin:0 0 6px}
`;

async function mountPunchAudit(host) {
  const today = jst();
  const first = today.slice(0, 8) + '01';
  host.innerHTML = `
    <div class="pa-filters">
      <label>対象日（から）<input type="date" class="pa-f" id="paFrom" value="${first}"></label>
      <label>対象日（まで）<input type="date" class="pa-f" id="paTo" value="${today}"></label>
      <label>対象社員<select class="pa-f" id="paUser"><option value="">全社員</option></select></label>
      <label>操作者<select class="pa-f" id="paActor"><option value="">全ての操作者</option></select></label>
      <label>操作<select class="pa-f" id="paKind">${KINDS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      <button type="button" class="pa-btn" id="paSearch">表示</button>
      <button type="button" class="pa-btn sub" id="paXlsx">Excel 出力</button>
    </div>
    <div class="pa-count" id="paCount"></div>
    <div style="overflow:auto;max-height:calc(100vh - 260px);"><table class="pa-t"><thead><tr>
      <th>日時</th><th>操作者</th><th>対象社員</th><th>対象日</th><th>操作</th><th>変更内容（前 → 後）</th><th>理由</th>
    </tr></thead><tbody id="paBody"><tr><td colspan="7" style="color:#64748b;">読み込み中…</td></tr></tbody></table></div>`;
  try {
    const users = await listUsers();
    const opts = (users || []).map(u => `<option value="${esc(u.id)}">${esc(u.username || '')}${u.employee_code || u.employeeCode ? `（${esc(u.employee_code || u.employeeCode)}）` : ''}</option>`).join('');
    host.querySelector('#paUser').insertAdjacentHTML('beforeend', opts);
    const actors = (users || []).filter(u => ['admin', 'manager'].includes(String(u.role || '').toLowerCase()));
    host.querySelector('#paActor').insertAdjacentHTML('beforeend', actors.map(u => `<option value="${esc(u.id)}">${esc(u.username || '')}（${roleJa(u.role)}）</option>`).join(''));
  } catch (e) { /* 絞り込みなしで使える */ }
  const qs = () => {
    const p = new URLSearchParams();
    p.set('from', host.querySelector('#paFrom').value || first);
    p.set('to', host.querySelector('#paTo').value || today);
    for (const [k, id] of [['userId', '#paUser'], ['actorId', '#paActor'], ['kind', '#paKind']]) { const v = host.querySelector(id).value; if (v) p.set(k, v); }
    return p.toString();
  };
  const body = host.querySelector('#paBody');
  const load = async () => {
    body.innerHTML = '<tr><td colspan="7" style="color:#64748b;">読み込み中…</td></tr>';
    try {
      const r = await api.get(`/api/attendance/admin/punch-audit?${qs()}`);
      const items = r.items || [];
      host.querySelector('#paCount').textContent = `${items.length} 件`;
      body.innerHTML = items.length ? items.map(x => `<tr>
        <td style="white-space:nowrap;">${esc(x.at)}</td>
        <td style="white-space:nowrap;">${esc(x.actorName)}${roleJa(x.actorRole) ? `<div class="pa-sub">${roleJa(x.actorRole)}</div>` : ''}</td>
        <td style="white-space:nowrap;">${esc(x.targetName)}${x.targetCode ? `<div class="pa-sub">${esc(x.targetCode)}</div>` : ''}</td>
        <td style="white-space:nowrap;">${esc(x.workDate)}</td>
        <td style="white-space:nowrap;" class="${/取消|削除/.test(x.label) ? 'pa-del' : ''}">${esc(x.label)}${x.restored ? '<div class="pa-sub">元に戻し済み</div>' : ''}</td>
        <td>${esc(x.change)}</td>
        <td>${esc(x.reason)}</td></tr>`).join('')
        : '<tr><td colspan="7" style="color:#64748b;">この条件の記録はありません</td></tr>';
    } catch (e) {
      body.innerHTML = `<tr><td colspan="7" style="color:#991b1b;">${esc(String(e?.message || '読み込めませんでした'))}</td></tr>`;
    }
  };
  host.querySelector('#paSearch').addEventListener('click', load);
  host.querySelector('#paXlsx').addEventListener('click', async () => {
    try { await downloadWithAuth(`/api/attendance/admin/punch-audit/export.xlsx?${qs()}`, `監査ログ_勤怠の修正.xlsx`); } catch (e) { alert(String(e?.message || e)); }
  });
  await load();
}

async function mount(ctx = {}) {
  const content = ctx.content || document.querySelector('#adminContent');
  if (!content) return;
  if (!document.getElementById('ah-css')) {
    const st = document.createElement('style');
    st.id = 'ah-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let role = '';
  try { role = String(JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || '{}').role || '').toLowerCase(); } catch (e) { /* ignore */ }
  content.innerHTML = `
    <div style="padding:16px;">
      <h2 style="margin:0 0 10px;font-size:18px;font-weight:700;color:#0b2c66;">監査ログ</h2>
      <div class="ah-tabs">
        <button type="button" class="ah-tab on" data-tab="punch">勤怠の修正</button>
        ${role === 'admin' ? '<button type="button" class="ah-tab" data-tab="system">ログイン・システム操作</button>' : ''}
      </div>
      <div id="ahBody"></div>
    </div>`;
  const bodyHost = content.querySelector('#ahBody');
  const show = async (tab) => {
    content.querySelectorAll('.ah-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'system') {
      const m = await import('./audit-logs.page.js');
      await m.mount({ content: bodyHost });
      const h2 = bodyHost.querySelector('h2'); if (h2) h2.remove();
    } else {
      await mountPunchAudit(bodyHost);
    }
  };
  content.querySelector('.ah-tabs').addEventListener('click', (e) => { const b = e.target.closest('.ah-tab'); if (b) show(b.dataset.tab); });
  await show('punch');
}

export { mount };
