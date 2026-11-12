import { fetchJSONAuth } from '../../api/http.api.js';
import { downloadWithAuth } from '../../shared/api/client.js';
import { listDepartments } from '../../api/departments.api.js';
import { requireAdmin } from '../_shared/require-admin.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function currentMonth() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function hm(minutes) {
  const n = Math.round(Number(minutes) || 0);
  const h = Math.floor(Math.abs(n) / 60);
  const m = Math.abs(n) % 60;
  return `${n < 0 ? '-' : ''}${h}:${String(m).padStart(2, '0')}`;
}

// 判定ラベル: 共通の状態色（正常=緑・注意=黄・超過=赤）
const JUDGEMENT_META = {
  normal: { label: '正常', cls: 'ok' },
  caution: { label: '注意', cls: 'warn' },
  exceeded: { label: '超過', cls: 'ng' }
};

function progressBar(value, limit) {
  const ratio = limit > 0 ? value / limit : 0;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const color = ratio >= 1 ? '#dc2626' : ratio >= 0.8 ? '#f59e0b' : '#16a34a';
  return `
    <div style="display:flex;align-items:center;gap:6px;min-width:130px;">
      <div style="flex:1;height:5px;background:#e2e8f0;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};"></div>
      </div>
      <span class="num" style="font-size:12px;white-space:nowrap;">${escapeHtml(hm(value))}</span>
    </div>
  `;
}

export async function mount({ content } = {}) {
  const admin = await requireAdmin();
  const root = content || document.getElementById('attendanceHubContent') || document.getElementById('adminContent');
  if (!admin || !root) return () => {};

  let month = currentMonth();
  let dept = '';
  let userId = '';
  let departments = [];
  let employees = [];
  let lastConfig = null;

  async function loadFilterOptions() {
    departments = await listDepartments().catch(() => []);
    employees = await fetchJSONAuth('/api/admin/users?employmentStatus=active&role=employee&limit=5000')
      .then(r => Array.isArray(r) ? r : (r.rows || r.items || r.users || []))
      .catch(() => []);
    const deptSel = root.querySelector('#lsDeptFilter');
    if (deptSel) {
      deptSel.innerHTML = ['<option value="">全部署</option>']
        .concat(departments.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`))
        .join('');
    }
    const empSel = root.querySelector('#lsUserFilter');
    if (empSel) {
      empSel.innerHTML = ['<option value="">全社員</option>']
        .concat(employees.map(u => `<option value="${u.id}">${escapeHtml(u.username || '')}${u.employee_code ? `（${escapeHtml(u.employee_code)}）` : ''}</option>`))
        .join('');
    }
  }

  async function loadClosureBanner() {
    const box = root.querySelector('#lsCloseBanner');
    if (!box) return;
    // 月次締めの操作はこの画面では行わない。締め済み（全員承認済み）の時だけ1行で知らせる
    box.style.display = 'none';
    box.innerHTML = '';
    try {
      const summary = await fetchJSONAuth(`/api/attendance/month/closure-summary?month=${encodeURIComponent(month)}`);
      if (summary.closed) {
        box.style.display = '';
        box.innerHTML = `<span>🔒 ${escapeHtml(month)}分は締め済みです</span>`;
      } else {
        box.style.display = 'none';
        box.innerHTML = '';
      }
    } catch (err) {
      // 締め状況はお知らせだけなので、取れなくても画面は使える（表示しない）
      box.style.display = 'none';
    }
  }

  async function onCloseMonth() {
    if (!confirm(`${month}分を全社員まとめて承認します。入力が未完了の人はスキップされます。よろしいですか？`)) return;
    try {
      await fetchJSONAuth('/api/attendance/month/approve-ready', { method: 'POST', body: JSON.stringify({ month }) });
      await loadClosureBanner();
      await loadList();
    } catch (err) {
      alert(String(err?.message || '失敗しました'));
    }
  }

  function renderCards(summary) {
    const box = root.querySelector('#lsCards');
    if (!box) return;
    const cards = [
      { label: '対象社員', value: `${summary.employeeCount}名` },
      { label: '実働時間', value: hm(summary.totalWorkedMinutes) },
      { label: '法定外残業', value: hm(summary.totalOvertimeMinutes) },
      { label: 'アラート', value: `${summary.alertCount}名`, danger: summary.alertCount > 0 }
    ];
    box.innerHTML = cards.map(c => `<span class="ui-stat${c.danger ? ' alert' : ''}"><span>${escapeHtml(c.label)}</span><b>${escapeHtml(c.value)}</b></span>`).join('');
  }

  function renderTable(items, config) {
    const body = root.querySelector('#lsTableBody');
    if (!body) return;
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="11" class="empty">対象データがありません</td></tr>';
      return;
    }
    body.innerHTML = items.map(r => {
      const meta = JUDGEMENT_META[r.judgement] || JUDGEMENT_META.normal;
      const diffColor = r.diffMinutes === 0 ? '#334155' : r.diffMinutes > 0 ? '#c2410c' : '#0369a1';
      const diffLabel = r.diffMinutes > 0 ? `+${hm(r.diffMinutes)}` : hm(r.diffMinutes);
      return `
        <tr>
          <td><b>${escapeHtml(r.username || '')}</b>${r.employeeCode ? ` <span class="muted" style="font-size:11px;">${escapeHtml(r.employeeCode)}</span>` : ''}</td>
          <td>${escapeHtml(r.departmentName || '—')}</td>
          <td class="num">${r.attendDays}</td>
          <td class="num">${escapeHtml(hm(r.workedMinutes))}</td>
          <td>${progressBar(r.overtimeMinutes, config.monthlyOtLimitMinutes)}</td>
          <td class="num">${escapeHtml(hm(r.nightMinutes))}</td>
          <td class="num">${escapeHtml(hm(r.holidayWorkMinutes))}</td>
          <td>${progressBar(r.annualOvertimeMinutes, config.annualOtLimitMinutes)}</td>
          <td><span class="ui-pill ${meta.cls}">${meta.label}</span></td>
          <td class="num">${escapeHtml(hm(r.reportedMinutes))}</td>
          <td class="num" style="color:${diffColor};font-weight:700;">${escapeHtml(diffLabel)}</td>
        </tr>
      `;
    }).join('');
  }

  function renderFootnote(config) {
    const box = root.querySelector('#lsFootnote');
    if (!box) return;
    const monthlyH = Math.round(config.monthlyOtLimitMinutes / 60);
    const annualH = Math.round(config.annualOtLimitMinutes / 60);
    const singleH = Math.round(config.singleMonthLimitMinutes / 60);
    const pct = Math.round(config.cautionThresholdRatio * 100);
    box.textContent = `判定の基準: 時間外労働は月${monthlyH}時間・年${annualH}時間まで（36協定の原則）。月の時間外+休日労働は${singleH}時間未満。月の時間外が${pct}%到達で「注意」を表示します。`;
  }

  async function loadList() {
    const body = root.querySelector('#lsTableBody');
    if (body) body.innerHTML = '<tr><td colspan="11" class="empty">読み込み中...</td></tr>';
    try {
      const [year, m] = month.split('-').map(n => parseInt(n, 10));
      const qs = new URLSearchParams({ year: String(year), month: String(m) });
      if (dept) qs.set('dept', dept);
      if (userId) qs.set('userId', userId);
      const data = await fetchJSONAuth(`/api/attendance/summary/admin-list?${qs.toString()}`);
      lastConfig = data.config;
      renderCards(data.summary || { employeeCount: 0, totalWorkedMinutes: 0, totalOvertimeMinutes: 0, alertCount: 0 });
      renderTable(data.items || [], data.config);
      renderFootnote(data.config);
    } catch (err) {
      if (body) body.innerHTML = `<tr><td colspan="11" class="empty" style="color:#b91c1c;">エラー: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // 画面の見た目は 勤怠記録 と同じ共通UI（/static/css/admin-ui.css の .ui-c）
  root.innerHTML = `
    <div class="ui-c" style="max-width:1400px;">
      <div class="ui-ph">
        <h2>法定集計（36協定）</h2>
        <span class="ui-sp"></span>
        <input type="month" id="lsMonthFilter" class="ui-inp" value="${month}" title="対象月" aria-label="対象月">
        <select id="lsDeptFilter" class="ui-inp" style="min-width:120px;" title="部署" aria-label="部署"><option value="">全部署</option></select>
        <select id="lsUserFilter" class="ui-inp" style="min-width:130px;" title="社員" aria-label="社員"><option value="">全社員</option></select>
        <button type="button" class="ui-btn primary" id="lsGoBtn">表示</button>
        <span style="width:1px;height:18px;background:#c3cdda;margin:0 4px;"></span>
        <button type="button" class="ui-btn" id="lsCsvBtn">CSV出力</button>
        <button type="button" class="ui-btn primary" id="lsXlsxBtn">Excel出力</button>
      </div>
      <div id="lsCloseBanner" class="ui-note" style="display:none;"></div>

      <div id="lsCards" class="ui-stats" style="margin-bottom:10px;"></div>

      <div class="ui-panel">
        <div class="ui-ptitle">社員別一覧</div>
        <div class="ui-tablewrap">
          <table class="ui-table" style="min-width:1200px;">
            <thead>
              <tr>
                <th>社員</th><th>部署</th><th class="num">出勤日数</th><th class="num">実働</th><th>法定外残業</th>
                <th class="num">深夜</th><th class="num">休日</th><th>年間時間外</th><th>判定</th><th class="num">報告時間</th><th class="num">実働との差</th>
              </tr>
            </thead>
            <tbody id="lsTableBody"></tbody>
          </table>
        </div>
        <div id="lsFootnote" class="ui-pager" style="justify-content:flex-start;font-size:11px;"></div>
      </div>
    </div>
  `;

  await loadFilterOptions();

  root.querySelector('#lsGoBtn')?.addEventListener('click', () => {
    month = root.querySelector('#lsMonthFilter').value || month;
    dept = root.querySelector('#lsDeptFilter').value || '';
    userId = root.querySelector('#lsUserFilter').value || '';
    loadClosureBanner();
    loadList();
  });

  root.querySelector('#lsCsvBtn')?.addEventListener('click', async () => {
    try {
      const [year, m] = month.split('-').map(n => parseInt(n, 10));
      const qs = new URLSearchParams({ year: String(year), month: String(m) });
      if (dept) qs.set('dept', dept);
      await downloadWithAuth(`/api/attendance/summary/export.csv?${qs.toString()}`, `legal_summary_${month}.csv`);
    } catch (err) {
      alert(String(err?.message || 'CSV出力に失敗しました'));
    }
  });

  root.querySelector('#lsXlsxBtn')?.addEventListener('click', async () => {
    try {
      const [year, m] = month.split('-').map(n => parseInt(n, 10));
      const qs = new URLSearchParams({ year: String(year), month: String(m) });
      if (dept) qs.set('dept', dept);
      if (userId) qs.set('userId', userId);
      await downloadWithAuth(`/api/attendance/summary/export.xlsx?${qs.toString()}`, `legal_summary_${month}.xlsx`);
    } catch (err) {
      alert(String(err?.message || 'Excel出力に失敗しました'));
    }
  });

  await loadClosureBanner();
  await loadList();

  return () => {};
}
