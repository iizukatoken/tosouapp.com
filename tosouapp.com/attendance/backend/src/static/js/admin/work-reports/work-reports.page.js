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
  if (!n) return '0:00';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function fmtTime(t) {
  if (!t) return '—';
  return String(t).slice(0, 5);
}

function durationMinutes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [sh, sm] = String(startTime).slice(0, 5).split(':').map(Number);
  const [eh, em] = String(endTime).slice(0, 5).split(':').map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null;
  return (eh * 60 + em) - (sh * 60 + sm);
}

// 作業報告の承認フローは廃止。画面上の状態は 提出済み / 未提出 / 差戻し の3つ。
// 未提出 = 出勤打刻時に自動作成された行のまま作業内容が空のもの（DB の status は見ない）。
const STATUS_META = {
  submitted: { label: '提出済み', cls: 'ok' },
  missing: { label: '未提出', cls: 'warn' },
  rejected: { label: '差戻し', cls: 'ng' }
};
const displayStatus = (r) => r.status === 'rejected' ? 'rejected' : (String(r.work || '').trim() ? 'submitted' : 'missing');

// 現場が未入力でも、出勤時に選んだ勤務形態（出社/在宅）が分かればそれを代わりに表示する。
// 「現場」に対応するworkType('satellite')は本人が現場名を書く前提なのでここでは補わない。
const WORK_TYPE_LABEL = {
  onsite: '出社',
  remote: '在宅'
};

export async function mount({ content } = {}) {
  const admin = await requireAdmin();
  const root = content || document.getElementById('attendanceHubContent') || document.getElementById('adminContent');
  if (!admin || !root) return () => {};

  let month = currentMonth();
  let dept = '';
  let userId = '';
  let status = '';
  let page = 1;
  const pageSize = 50;
  let departments = [];
  let employees = [];
  let lastData = null;

  async function loadFilterOptions() {
    departments = await listDepartments().catch(() => []);
    employees = await fetchJSONAuth('/api/admin/users?employmentStatus=active&role=employee&limit=5000')
      .then(r => Array.isArray(r) ? r : (r.rows || r.items || r.users || []))
      .catch(() => []);
    const deptSel = root.querySelector('#wrDeptFilter');
    if (deptSel) {
      deptSel.innerHTML = ['<option value="">全部署</option>']
        .concat(departments.map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`))
        .join('');
    }
    const empSel = root.querySelector('#wrUserFilter');
    if (empSel) {
      empSel.innerHTML = ['<option value="">全社員</option>']
        .concat(employees.map(u => `<option value="${u.id}">${escapeHtml(u.username || '')}${u.employee_code ? `（${escapeHtml(u.employee_code)}）` : ''}</option>`))
        .join('');
    }
  }

  function renderClosureBanner(closed) {
    const box = root.querySelector('#wrCloseBanner2');
    if (!box) return;
    // 月次締めの操作はこの画面では行わない。以前に締めた月だけ、入力できない理由が分かるよう1行で知らせる。
    if (closed) {
      box.style.display = '';
      box.innerHTML = `<span>🔒 ${escapeHtml(month)}分は締め済みです</span>`;
    } else {
      box.style.display = 'none';
      box.innerHTML = '';
    }
  }

  async function onCloseMonth() {
    if (!confirm(`${month}分を締めます。締め後は入力・修正ができなくなります。よろしいですか？`)) return;
    const btn = root.querySelector('#wrCloseMonthBtn2');
    if (btn) { btn.disabled = true; btn.textContent = '実行中...'; }
    try {
      await fetchJSONAuth('/api/admin/work-reports/close-month', { method: 'POST', body: JSON.stringify({ month }) });
      await loadList();
    } catch (err) {
      alert(String(err?.message || '失敗しました'));
      if (btn) { btn.disabled = false; btn.textContent = '月次締めを実行'; }
    }
  }

  function renderCards(summary) {
    const box = root.querySelector('#wrCards');
    if (!box) return;
    const cards = [
      { label: '提出済み', value: `${summary.submitted || 0}件` },
      { label: '報告時間の合計', value: hm(summary.totalMinutes) },
      { label: '未提出（作業内容が未入力）', value: `${summary.missing || 0}件`, danger: (summary.missing || 0) > 0, filter: 'missing' },
      { label: '差戻し', value: `${summary.rejected}件`, danger: summary.rejected > 0, filter: 'rejected' }
    ];
    box.innerHTML = cards.map(c => `<span ${c.filter ? `data-filter="${c.filter}" title="クリックで絞り込み" ` : ''}class="ui-stat${c.danger ? ' alert' : ''}${c.filter ? ' click' : ''}"><span>${escapeHtml(c.label)}</span><b>${escapeHtml(c.value)}</b></span>`).join('');
    // 未提出 / 差戻し のカードをクリックすると、その状態で一覧を絞り込む
    box.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => {
      status = el.dataset.filter;
      const sel = root.querySelector('#wrStatusFilter');
      if (sel) sel.value = status;
      page = 1;
      loadList();
    }));
  }

  function rowActionsHtml(r) {
    const buttons = [];
    // 承認ボタンは廃止。内容に問題がある提出済みの報告だけ 差戻し できる。
    if (displayStatus(r) === 'submitted') {
      buttons.push(`<button type="button" class="ui-btn sm danger wr-reject-btn" data-id="${r.id}">差戻し</button>`);
    }
    buttons.push(`<button type="button" class="ui-btn sm wr-edit-btn" data-id="${r.id}">編集</button>`);
    buttons.push(`<button type="button" class="ui-btn sm danger wr-delete-btn" data-id="${r.id}">削除</button>`);
    return `<span style="display:inline-flex;gap:4px;">${buttons.join('')}</span>`;
  }

  function renderTable(items) {
    const body = root.querySelector('#wrTableBody2');
    if (!body) return;
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="9" class="empty">該当する報告がありません</td></tr>';
      return;
    }
    body.innerHTML = items.map(r => {
      const meta = STATUS_META[displayStatus(r)];
      const minutes = durationMinutes(r.startTime, r.endTime);
      return `
        <tr>
          <td>${escapeHtml(String(r.date || '').slice(0, 10))}</td>
          <td><b>${escapeHtml(r.username || '')}</b>${r.employeeCode ? ` <span class="muted" style="font-size:11px;">${escapeHtml(r.employeeCode)}</span>` : ''}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.site || WORK_TYPE_LABEL[r.workType] || '—')}</td>
          <td class="wrap" style="max-width:280px;">${escapeHtml(r.work || '')}</td>
          <td class="num">${escapeHtml(fmtTime(r.startTime))}</td>
          <td class="num">${escapeHtml(fmtTime(r.endTime))}</td>
          <td class="num">${minutes != null ? hm(minutes) : '—'}</td>
          <td><span class="ui-pill ${meta.cls}">${meta.label}</span></td>
          <td>${rowActionsHtml(r)}</td>
        </tr>
      `;
    }).join('');

    body.querySelectorAll('.wr-approve-btn').forEach(btn => btn.addEventListener('click', () => onApprove(btn.dataset.id)));
    body.querySelectorAll('.wr-reject-btn').forEach(btn => btn.addEventListener('click', () => onReject(btn.dataset.id)));
    body.querySelectorAll('.wr-edit-btn').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
    body.querySelectorAll('.wr-delete-btn').forEach(btn => btn.addEventListener('click', () => onDelete(btn.dataset.id)));
  }

  function renderPager(data) {
    const pager = root.querySelector('#wrPager2');
    if (!pager) return;
    const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || pageSize)));
    const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    const to = Math.min(data.total, data.page * data.pageSize);
    pager.innerHTML = `
      <span>全 ${data.total} 件中 ${from}–${to} 件（${data.page} / ${pages} ページ）</span>
      <span style="display:flex;gap:4px;">
        <button type="button" class="ui-btn sm" id="wrPagerPrev" ${data.page <= 1 ? 'disabled' : ''}>前へ</button>
        <button type="button" class="ui-btn sm" id="wrPagerNext" ${data.page >= pages ? 'disabled' : ''}>次へ</button>
      </span>
    `;
    root.querySelector('#wrPagerPrev')?.addEventListener('click', () => { if (page > 1) { page -= 1; loadList(); } });
    root.querySelector('#wrPagerNext')?.addEventListener('click', () => { if (page < pages) { page += 1; loadList(); } });
  }

  async function loadList() {
    const body = root.querySelector('#wrTableBody2');
    if (body) body.innerHTML = '<tr><td colspan="9" class="empty">読み込み中...</td></tr>';
    try {
      const qs = new URLSearchParams({ month, page: String(page), pageSize: String(pageSize) });
      if (dept) qs.set('dept', dept);
      if (userId) qs.set('userId', userId);
      if (status) qs.set('status', status);
      const data = await fetchJSONAuth(`/api/admin/work-reports/list?${qs.toString()}`);
      lastData = data;
      renderClosureBanner(!!data.closed);
      renderCards(data.summary || { count: 0, totalMinutes: 0, pending: 0, rejected: 0, submitted: 0, missing: 0 });
      renderTable(data.items || []);
      renderPager(data);
    } catch (err) {
      if (body) body.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:#ef4444;">エラー: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function onApprove(id) {
    try {
      await fetchJSONAuth(`/api/admin/work-reports/${id}/approve`, { method: 'POST' });
      await loadList();
    } catch (err) {
      alert(String(err?.message || '失敗しました'));
    }
  }

  async function onReject(id) {
    const reason = prompt('差戻し理由を入力してください（任意）:', '');
    if (reason === null) return;
    try {
      await fetchJSONAuth(`/api/admin/work-reports/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
      await loadList();
    } catch (err) {
      alert(String(err?.message || '失敗しました'));
    }
  }

  async function onDelete(id) {
    if (!confirm('この報告を削除します。よろしいですか？')) return;
    try {
      await fetchJSONAuth(`/api/admin/work-reports/${id}`, { method: 'DELETE' });
      await loadList();
    } catch (err) {
      alert(String(err?.message || '失敗しました'));
    }
  }

  function closeFormModal() {
    const modal = root.querySelector('#wrFormModal');
    if (modal) modal.style.display = 'none';
  }

  function openFormModal({ editing, record } = {}) {
    const modal = root.querySelector('#wrFormModal');
    if (!modal) return;
    const title = modal.querySelector('#wrFormTitle');
    if (title) title.textContent = editing ? '作業報告を編集' : '作業報告を追加';
    const empField = modal.querySelector('#wrFormUserField');
    if (empField) empField.style.display = editing ? 'none' : '';
    modal.querySelector('#wrFormId').value = record?.id || '';
    modal.querySelector('#wrFormUser').innerHTML = employees.map(u =>
      `<option value="${u.id}" ${record && Number(record.userId) === Number(u.id) ? 'selected' : ''}>${escapeHtml(u.username || '')}${u.employee_code ? `（${escapeHtml(u.employee_code)}）` : ''}</option>`
    ).join('');
    modal.querySelector('#wrFormDate').value = record?.date ? String(record.date).slice(0, 10) : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    modal.querySelector('#wrFormStart').value = record?.startTime ? String(record.startTime).slice(0, 5) : '';
    modal.querySelector('#wrFormEnd').value = record?.endTime ? String(record.endTime).slice(0, 5) : '';
    modal.querySelector('#wrFormSite').value = record?.site || '';
    modal.querySelector('#wrFormWork').value = record?.work || '';
    modal.style.display = 'flex';
  }

  async function openEditModal(id) {
    const record = (lastData?.items || []).find(r => String(r.id) === String(id));
    if (!record) return;
    openFormModal({ editing: true, record });
  }

  async function onFormSubmit(ev) {
    ev.preventDefault();
    const modal = root.querySelector('#wrFormModal');
    const id = modal.querySelector('#wrFormId').value;
    const payload = {
      date: modal.querySelector('#wrFormDate').value,
      startTime: modal.querySelector('#wrFormStart').value || null,
      endTime: modal.querySelector('#wrFormEnd').value || null,
      site: modal.querySelector('#wrFormSite').value.trim(),
      work: modal.querySelector('#wrFormWork').value.trim()
    };
    if (!payload.work) { alert('作業内容を入力してください'); return; }
    try {
      if (id) {
        await fetchJSONAuth(`/api/admin/work-reports/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        payload.userId = parseInt(modal.querySelector('#wrFormUser').value, 10);
        if (!payload.userId) { alert('社員を選択してください'); return; }
        await fetchJSONAuth('/api/admin/work-reports', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeFormModal();
      await loadList();
    } catch (err) {
      alert(String(err?.message || '失敗しました'));
    }
  }

  // 画面の見た目は共通UI（/static/css/admin-ui.css の .ui-c）にそろえる
  root.innerHTML = `
    <div class="ui-c">
      <div class="ui-ph">
        <h2>作業報告</h2>
        <span class="ui-sp"></span>
        <input type="month" id="wrMonthFilter" class="ui-inp" value="${month}" title="対象月" aria-label="対象月">
        <select id="wrDeptFilter" class="ui-inp" style="min-width:110px;" title="部署" aria-label="部署"><option value="">全部署</option></select>
        <select id="wrUserFilter" class="ui-inp" style="min-width:120px;" title="社員" aria-label="社員"><option value="">全社員</option></select>
        <select id="wrStatusFilter" class="ui-inp" title="ステータス" aria-label="ステータス">
          <option value="">全ステータス</option>
          <option value="submitted">提出済み</option>
          <option value="missing">未提出</option>
          <option value="rejected">差戻し</option>
        </select>
        <button type="button" class="ui-btn primary" id="wrGoBtn">表示</button>
        <span style="width:1px;height:18px;background:#c3cdda;margin:0 4px;"></span>
        <button type="button" class="ui-btn dashed" id="wrBackfillBtn" title="月次勤怠入力にある過去の現場・作業内容を作業報告として取り込みます">過去データを取込</button>
        <button type="button" class="ui-btn" id="wrAddBtn">＋追加</button>
        <button type="button" class="ui-btn" id="wrCsvBtn">CSV出力</button>
        <button type="button" class="ui-btn primary" id="wrXlsxBtn">Excel出力</button>
      </div>
      <div id="wrCloseBanner2" class="ui-note" style="display:none;"></div>

      <div id="wrCards" class="ui-stats" style="margin-bottom:10px;"></div>

      <div class="ui-panel">
        <div class="ui-ptitle">作業報告一覧</div>
        <div class="ui-tablewrap">
          <table class="ui-table" style="min-width:1000px;">
            <thead>
              <tr>
                <th>日付</th><th>社員</th><th>現場・案件</th><th>作業内容</th>
                <th class="num">開始</th><th class="num">終了</th><th class="num">時間</th><th>ステータス</th><th>操作</th>
              </tr>
            </thead>
            <tbody id="wrTableBody2"></tbody>
          </table>
        </div>
        <div id="wrPager2" class="ui-pager"></div>
      </div>
    </div>

    <div id="wrFormModal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.55);align-items:center;justify-content:center;">
      <form id="wrForm" style="width:min(480px,92vw);background:#fff;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,0.25);overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
          <div id="wrFormTitle" style="font-size:15px;font-weight:700;color:#0f172a;">作業報告を追加</div>
          <button type="button" id="wrFormClose" style="width:28px;height:28px;border:none;background:transparent;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>
        </div>
        <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
          <input type="hidden" id="wrFormId">
          <div id="wrFormUserField" style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:12px;color:#475569;font-weight:600;">社員</label>
            <select id="wrFormUser" style="height:34px;border:1px solid #cbd5e1;border-radius:4px;padding:0 8px;"></select>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <label style="font-size:12px;color:#475569;font-weight:600;">日付</label>
            <input type="date" id="wrFormDate" required style="height:34px;border:1px solid #cbd5e1;border-radius:4px;padding:0 8px;">
          </div>
          <div style="display:flex;gap:10px;">
            <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
              <label style="font-size:12px;color:#475569;font-weight:600;">開始</label>
              <input type="time" id="wrFormStart" style="height:34px;border:1px solid #cbd5e1;border-radius:4px;padding:0 8px;width:100%;">
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
              <label style="font-size:12px;color:#475569;font-weight:600;">終了</label>
              <input type="time" id="wrFormEnd" style="height:34px;border:1px solid #cbd5e1;border-radius:4px;padding:0 8px;width:100%;">
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <label style="font-size:12px;color:#475569;font-weight:600;">現場・案件</label>
            <input type="text" id="wrFormSite" style="height:34px;border:1px solid #cbd5e1;border-radius:4px;padding:0 8px;">
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <label style="font-size:12px;color:#475569;font-weight:600;">作業内容</label>
            <textarea id="wrFormWork" rows="3" required style="border:1px solid #cbd5e1;border-radius:4px;padding:8px;resize:vertical;font-family:inherit;"></textarea>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <button type="button" id="wrFormCancel" style="height:34px;padding:0 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">キャンセル</button>
          <button type="submit" style="height:34px;padding:0 16px;border:none;border-radius:6px;background:#0b2c66;color:#fff;font-weight:600;cursor:pointer;">保存</button>
        </div>
      </form>
    </div>
  `;

  await loadFilterOptions();

  root.querySelector('#wrGoBtn')?.addEventListener('click', () => {
    month = root.querySelector('#wrMonthFilter').value || month;
    dept = root.querySelector('#wrDeptFilter').value || '';
    userId = root.querySelector('#wrUserFilter').value || '';
    status = root.querySelector('#wrStatusFilter').value || '';
    page = 1;
    loadList();
  });

  root.querySelector('#wrBackfillBtn')?.addEventListener('click', async () => {
    if (!confirm('月次勤怠入力にある過去の現場・作業内容を、作業報告として取り込みます（既に作業報告があるものはスキップされ、何度実行しても重複しません）。実行しますか？')) return;
    const btn = root.querySelector('#wrBackfillBtn');
    if (btn) { btn.disabled = true; btn.textContent = '取込中...'; }
    try {
      const result = await fetchJSONAuth('/api/admin/work-reports/backfill-from-daily', { method: 'POST' });
      alert(`取込完了\n作成: ${result.created}件\nスキップ（既存）: ${result.skippedExisting}件\nスキップ（内容なし）: ${result.skippedEmpty}件`);
      await loadList();
    } catch (err) {
      alert(String(err?.message || '取込に失敗しました'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '過去データを取込'; }
    }
  });

  root.querySelector('#wrAddBtn')?.addEventListener('click', () => openFormModal({ editing: false }));
  root.querySelector('#wrFormClose')?.addEventListener('click', closeFormModal);
  root.querySelector('#wrFormCancel')?.addEventListener('click', closeFormModal);
  root.querySelector('#wrFormModal')?.addEventListener('click', (ev) => { if (ev.target.id === 'wrFormModal') closeFormModal(); });
  root.querySelector('#wrForm')?.addEventListener('submit', onFormSubmit);

  root.querySelector('#wrCsvBtn')?.addEventListener('click', async () => {
    try {
      const qs = new URLSearchParams({ month });
      if (dept) qs.set('dept', dept);
      if (status) qs.set('status', status);
      await downloadWithAuth(`/api/admin/work-reports/export.csv?${qs.toString()}`, `work_reports_${month}.csv`);
    } catch (err) {
      alert(String(err?.message || 'CSV出力に失敗しました'));
    }
  });

  root.querySelector('#wrXlsxBtn')?.addEventListener('click', async () => {
    try {
      const qs = new URLSearchParams({ month });
      if (dept) qs.set('dept', dept);
      if (status) qs.set('status', status);
      await downloadWithAuth(`/api/admin/work-reports/export-report.xlsx?${qs.toString()}`, `work_reports_${month}.xlsx`);
    } catch (err) {
      alert(String(err?.message || 'Excel出力に失敗しました'));
    }
  });

  await loadList();

  return () => {};
}
