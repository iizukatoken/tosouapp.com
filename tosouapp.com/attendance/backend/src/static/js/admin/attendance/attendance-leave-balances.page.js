import { fetchJSONAuth } from '../../api/http.api.js';
import { downloadWithAuth } from '../../shared/api/client.js';
import { listDepartments } from '../../api/departments.api.js';
import { requireAdmin } from '../_shared/require-admin.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function mount({ content } = {}) {
  const admin = await requireAdmin();
  const root = content || document.getElementById('attendanceHubContent') || document.getElementById('adminContent');
  if (!admin || !root) return () => {};

  let dept = '';
  let userId = '';
  let departments = [];
  let employees = [];

  async function loadFilterOptions() {
    departments = await listDepartments().catch(() => []);
    employees = await fetchJSONAuth('/api/admin/users?employmentStatus=active&role=employee&limit=5000')
      .then(r => Array.isArray(r) ? r : (r.rows || r.items || r.users || []))
      .catch(() => []);
    const deptSel = root.querySelector('#lbDeptFilter');
    if (deptSel) {
      deptSel.innerHTML = ['<option value="">全部署</option>']
        .concat(departments.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`))
        .join('');
    }
    const empSel = root.querySelector('#lbUserFilter');
    if (empSel) {
      empSel.innerHTML = ['<option value="">全社員</option>']
        .concat(employees.map(u => `<option value="${u.id}">${escapeHtml(u.username || '')}${u.employee_code ? `（${escapeHtml(u.employee_code)}）` : ''}</option>`))
        .join('');
    }
  }

  function renderCards(items) {
    const box = root.querySelector('#lbCards');
    if (!box) return;
    const totalRemaining = items.reduce((s, r) => s + Number(r.remaining || 0), 0);
    const needsAction = items.filter(r => !r.obligationMet).length;
    const cards = [
      { label: '対象社員', value: `${items.length}名` },
      { label: '残日数合計', value: `${totalRemaining}日` },
      { label: '年5日義務未達成', value: `${needsAction}名`, danger: needsAction > 0 }
    ];
    box.innerHTML = cards.map(c => `<span class="ui-stat${c.danger ? ' alert' : ''}"><span>${escapeHtml(c.label)}</span><b>${escapeHtml(c.value)}</b></span>`).join('');
  }

  function renderTable(items) {
    const body = root.querySelector('#lbTableBody');
    if (!body) return;
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">対象データがありません</td></tr>';
      return;
    }
    body.innerHTML = items.map(r => `
      <tr>
        <td><b>${escapeHtml(r.username || '')}</b>${r.employeeCode ? ` <span class="muted" style="font-size:11px;">${escapeHtml(r.employeeCode)}</span>` : ''}</td>
        <td>${escapeHtml(r.departmentName || '—')}</td>
        <td class="num">${r.granted}</td>
        <td class="num">${r.carriedOver}</td>
        <td class="num">${r.usedDays}</td>
        <td class="num"><b>${r.remaining}</b></td>
        <td><span class="ui-pill ${r.obligationMet ? 'ok' : 'ng'}">${r.obligationMet ? '達成' : '要取得'}</span></td>
      </tr>
    `).join('');
  }

  async function loadList() {
    const body = root.querySelector('#lbTableBody');
    if (body) body.innerHTML = '<tr><td colspan="7" class="empty">読み込み中...</td></tr>';
    try {
      const qs = new URLSearchParams();
      if (dept) qs.set('dept', dept);
      if (userId) qs.set('userId', userId);
      const data = await fetchJSONAuth(`/api/leave/admin-balances?${qs.toString()}`);
      const items = data.items || [];
      renderCards(items);
      renderTable(items);
    } catch (err) {
      if (body) body.innerHTML = `<tr><td colspan="7" class="empty" style="color:#b91c1c;">エラー: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // 画面の見た目は 勤怠記録 と同じ共通UI（/static/css/admin-ui.css の .ui-c）
  root.innerHTML = `
    <div class="ui-c">
      <div class="ui-ph">
        <h2>有給管理</h2>
        <span class="ui-sp"></span>
        <select id="lbDeptFilter" class="ui-inp" style="min-width:120px;" title="部署" aria-label="部署"><option value="">全部署</option></select>
        <select id="lbUserFilter" class="ui-inp" style="min-width:130px;" title="社員" aria-label="社員"><option value="">全社員</option></select>
        <button type="button" class="ui-btn primary" id="lbGoBtn">表示</button>
        <span style="width:1px;height:18px;background:#c3cdda;margin:0 4px;"></span>
        <button type="button" class="ui-btn primary" id="lbXlsxBtn">Excel出力</button>
      </div>

      <div id="lbCards" class="ui-stats" style="margin-bottom:10px;"></div>

      <div class="ui-panel">
        <div class="ui-ptitle">有給残日数一覧</div>
        <div class="ui-tablewrap">
          <table class="ui-table" style="min-width:800px;">
            <thead>
              <tr><th>社員</th><th>部署</th><th class="num">付与</th><th class="num">繰越</th><th class="num">取得</th><th class="num">残</th><th>年5日義務</th></tr>
            </thead>
            <tbody id="lbTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  await loadFilterOptions();

  root.querySelector('#lbGoBtn')?.addEventListener('click', () => {
    dept = root.querySelector('#lbDeptFilter').value || '';
    userId = root.querySelector('#lbUserFilter').value || '';
    loadList();
  });

  root.querySelector('#lbXlsxBtn')?.addEventListener('click', async () => {
    try {
      const qs = new URLSearchParams();
      if (dept) qs.set('dept', dept);
      if (userId) qs.set('userId', userId);
      await downloadWithAuth(`/api/leave/admin-balances/export.xlsx?${qs.toString()}`, `leave_balances.xlsx`);
    } catch (err) {
      alert(String(err?.message || 'Excel出力に失敗しました'));
    }
  });

  await loadList();

  return () => {};
}
