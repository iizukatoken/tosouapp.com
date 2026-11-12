import { fetchJSONAuth } from '../../api/http.api.js';
import { downloadWithAuth } from '../../shared/api/client.js';
import { listDepartments } from '../../api/departments.api.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function hm(min) {
  const n = Math.round(Number(min) || 0);
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const KUBUN_LABEL = {
  '通常': '通常', '休日': '休日', '法定休日': '休日', '休日出勤': '休日出勤',
  '法定休日出勤': '休日出勤', '代替出勤': '休日出勤', '有給休暇': '有給',
  '半休': '半休', '半休(有給)': '半休', '欠勤': '欠勤', '振替出勤': '振替出勤'
};

export async function mount({ content } = {}) {
  const root = content || document.querySelector('#adminContent');
  if (!root) return () => {};

  let month = currentMonth();
  let departmentId = '';
  let departments = [];
  let page = 1;
  // 実績 = 打刻どおり (丸め前) / 丸め = 出勤30分切り上げ・退勤30分切り捨て後 (給与計算に使う値)
  let viewMode = 'round';
  try { if (localStorage.getItem('ledgerViewMode') === 'actual') viewMode = 'actual'; } catch (e) { /* ignore */ }
  let lastData = null;
  const pageSize = 100; // 200人規模で1ヶ月分だと最大6000行程度になるため、一覧はページングする

  async function loadClosureBanner() {
    const box = root.querySelector('#ledgerClosureBanner');
    if (!box) return;
    box.innerHTML = '読み込み中...';
    try {
      const summary = await fetchJSONAuth(`/api/attendance/month/closure-summary?month=${encodeURIComponent(month)}`);
      // 月次締めの操作はこの画面では行わない（承認は 月次勤怠入力 で社員ごとに行う）。
      // 全員承認済みの時だけ1行で知らせ、それ以外はバナーを出さない。
      if (summary.closed) {
        box.style.display = '';
        box.style.background = '#eef2f8';
        box.style.borderColor = '#0b2c66';
        box.innerHTML = `<b style="color:#0b2c66;">締め済み</b> — ${escapeHtml(month)}分は全員（${summary.total}名）承認済みです`;
      } else {
        box.style.display = 'none';
        box.innerHTML = '';
      }
    } catch (err) {
      box.style.background = '#fef2f2';
      box.style.borderColor = '#dc2626';
      box.textContent = `締め状況の取得に失敗しました: ${err.message}`;
    }
  }

  async function onCloseMonth() {
    if (!confirm(`${month}分を全社員まとめて承認します。入力が未完了の人はスキップされます。よろしいですか？`)) return;
    const resultBox = root.querySelector('#ledgerCloseResult');
    try {
      const result = await fetchJSONAuth('/api/attendance/month/approve-ready', {
        method: 'POST',
        body: JSON.stringify({ month })
      });
      const skippedList = (result.results || []).filter(r => !r.ok);
      if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = `
          <div style="position:relative;border:1px solid #cbd5e1;border-radius:8px;padding:12px 16px;margin-bottom:16px;background:#fff;">
            <button type="button" id="ledgerCloseResultBtn" title="閉じる" style="position:absolute;top:8px;right:8px;width:24px;height:24px;border:none;background:transparent;color:#94a3b8;font-size:16px;line-height:1;cursor:pointer;">×</button>
            <div style="font-weight:700;margin-bottom:6px;padding-right:24px;">${escapeHtml(month)}分 月次締め結果 — 承認 ${result.approved}名 / スキップ ${result.skipped}名</div>
            ${skippedList.length ? `
              <div style="font-size:12px;color:#b45309;margin-bottom:6px;">入力未完了でスキップされた人（対応が必要です）:</div>
              <ul style="margin:0;padding-left:18px;font-size:13px;">
                ${skippedList.map(s => {
                  const label = (s.username || s.employeeCode)
                    ? `${escapeHtml(s.username || '')}${s.employeeCode ? `（${escapeHtml(s.employeeCode)}）` : ''}`
                    : `ID:${escapeHtml(s.userId)}`;
                  return `<li>${label} — ${(s.missing || []).length}日分不足</li>`;
                }).join('')}
              </ul>
            ` : '<div style="font-size:13px;color:#166534;">全員分、正常に締められました。</div>'}
          </div>
        `;
        root.querySelector('#ledgerCloseResultBtn')?.addEventListener('click', () => {
          resultBox.style.display = 'none';
          resultBox.innerHTML = '';
        });
      }
      await loadClosureBanner();
      await loadLedger();
    } catch (err) {
      if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.innerHTML = `
          <div style="position:relative;border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#991b1b;">
            <button type="button" id="ledgerCloseResultBtn" title="閉じる" style="position:absolute;top:8px;right:8px;width:24px;height:24px;border:none;background:transparent;color:#991b1b;font-size:16px;line-height:1;cursor:pointer;">×</button>
            <span style="padding-right:24px;display:inline-block;">月次締めに失敗しました: ${escapeHtml(err.message)}</span>
          </div>
        `;
        root.querySelector('#ledgerCloseResultBtn')?.addEventListener('click', () => {
          resultBox.style.display = 'none';
          resultBox.innerHTML = '';
        });
      }
    }
  }

  async function loadLedger() {
    const body = root.querySelector('#ledgerTableBody');
    if (body) body.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:24px;color:#94a3b8;">読み込み中...</td></tr>';
    try {
      const qs = new URLSearchParams({ month, page: String(page), pageSize: String(pageSize) });
      if (departmentId) qs.set('departmentId', departmentId);
      const data = await fetchJSONAuth(`/api/attendance/ledger/month?${qs.toString()}`);
      lastData = data;
      renderLedger(data);
    } catch (err) {
      if (body) body.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:24px;color:#ef4444;">エラー: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // 実績/丸め 切替はサーバーに取り直さず、手元のデータで描き直す
  function renderLedger(data) {
    const body = root.querySelector('#ledgerTableBody');
    const cards = root.querySelector('#ledgerCards');
    const pager = root.querySelector('#ledgerPager');
    const isActual = viewMode === 'actual';
    const workedOf = r => isActual ? (r.actualWorkedMinutes || 0) : (r.regularMinutes || 0) + (r.overtimeMinutes || 0);
    const overtimeOf = r => isActual ? (r.actualOvertimeMinutes || 0) : (r.overtimeMinutes || 0);
    const inOf = r => isActual ? r.checkIn : (r.roundedIn || r.checkIn);
    const outOf = r => isActual ? r.checkOut : (r.roundedOut || r.checkOut);
    root.querySelectorAll('[data-ledger-mode]').forEach(b => {
      const on = b.getAttribute('data-ledger-mode') === viewMode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    {
      const chipsBox = root.querySelector('#ledgerTodayChips');
      if (chipsBox && data.todayStatus) {
        const ts = data.todayStatus;
        // 今日の状況: 状態ラベルと同じ色（作業中=青・済=緑・休み=灰）
        const chip = (label, count, cls) => `<span class="ui-pill ${cls}">${escapeHtml(label)} ${Number(ts[count] || 0)}</span>`;
        chipsBox.innerHTML =
          '<span style="font-size:11px;color:#475569;">今日</span>' +
          chip('出勤中', 'working', 'info') +
          chip('退勤済', 'checkedOut', 'ok') +
          chip('休日・休暇', 'offOrLeave', 'off');
      }
      const countEl = root.querySelector('#ledgerCount');
      if (countEl) countEl.textContent = `（${Number(data.total || 0)}行）`;
      if (cards) {
        cards.innerHTML = [
          { label: '出勤日数', value: `${data.totals.attendDays}日` },
          // 実働 = 所定内 + 残業 (Excel出力と同じ)。regularMinutes は所定内だけ
          { label: '実働時間', value: hm(isActual ? data.totals.actualWorkedMinutes : (data.totals.regularMinutes || 0) + (data.totals.overtimeMinutes || 0)) },
          { label: '法定外残業', value: hm(isActual ? data.totals.actualOvertimeMinutes : data.totals.overtimeMinutes) },
          { label: '深夜', value: hm(data.totals.nightMinutes) },
          { label: '休日労働', value: hm(isActual ? data.totals.actualHolidayWorkMinutes : data.totals.holidayWorkMinutes) }
        ].map(c => `<span class="ui-stat"><span>${escapeHtml(c.label)}</span><b>${escapeHtml(c.value)}</b></span>`).join('');
      }
      if (body) {
        const rows = data.rows || [];
        // 休日出勤の行は薄い黄色（縞模様より優先）
        const td = (r, cls, inner) => `<td class="${cls}"${r.isHolidayWork ? ' style="background:#fffbeb;"' : ''}>${inner}</td>`;
        body.innerHTML = rows.length ? rows.map(r => `
          <tr${r.isExtra ? ' class="is-extra" title="追加勤務（その日に追加した勤務の行。全部 残業）"' : ''}>
            ${td(r, '', r.isExtra ? '<span style="color:#94a3b8;">↳</span>' : escapeHtml(r.date.slice(5)))}
            ${td(r, '', r.isExtra ? '' : escapeHtml(r.employeeCode || r.userId))}
            ${td(r, '', r.isExtra ? '' : escapeHtml(r.username || ''))}
            ${td(r, '', r.isExtra ? `<span class="ui-tag" style="background:#f1f5f9;color:#475569;border-color:#cbd5e1;">追加勤務${r.extraReason ? '・' + escapeHtml(r.extraReason) : ''}</span>` : `<span class="ui-tag">${escapeHtml(KUBUN_LABEL[r.kubun] || r.kubun)}</span>`)}
            ${td(r, 'num', escapeHtml(inOf(r) || '—'))}
            ${td(r, 'num', escapeHtml(outOf(r) || '—'))}
            ${td(r, 'num', r.breakMinutes != null ? `${r.breakMinutes}分` : '—')}
            ${td(r, 'num', workedOf(r) ? hm(workedOf(r)) : '—')}
            ${td(r, 'num', overtimeOf(r) ? `<span style="color:#b45309;font-weight:700;">${hm(overtimeOf(r))}</span>` : '—')}
            ${td(r, 'num', r.nightMinutes ? hm(r.nightMinutes) : '—')}
            ${td(r, 'num', r.isHolidayWork ? hm(workedOf(r)) : '—')}
            <td class="wrap muted" style="max-width:260px;font-size:12px;${r.isHolidayWork ? 'background:#fffbeb;' : ''}">${escapeHtml(r.memo || '')}</td>
          </tr>
        `).join('') : '<tr><td colspan="12" class="empty">該当データがありません</td></tr>';
      }
      if (pager) {
        const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
        const to = Math.min(data.total, data.page * data.pageSize);
        pager.innerHTML = `
          <span>全 ${data.total} 行中 ${from}–${to} 行（${data.page} / ${data.pages} ページ）</span>
          <span style="display:flex;gap:4px;">
            <button type="button" class="ui-btn sm" id="ledgerPrev" ${data.page <= 1 ? 'disabled' : ''}>前へ</button>
            <button type="button" class="ui-btn sm" id="ledgerNext" ${data.page >= data.pages ? 'disabled' : ''}>次へ</button>
          </span>
        `;
        root.querySelector('#ledgerPrev')?.addEventListener('click', () => { if (page > 1) { page -= 1; loadLedger(); } });
        root.querySelector('#ledgerNext')?.addEventListener('click', () => { if (page < data.pages) { page += 1; loadLedger(); } });
      }
    }
  }

  departments = await listDepartments().catch(() => []);

  // 画面の見た目は共通UI（/static/css/admin-ui.css の .ui-c）にそろえる
  root.innerHTML = `
    <div class="ui-c">
      <div class="ui-ph">
        <h2>勤怠記録</h2>
        <div id="ledgerTodayChips" class="ui-stats" title="今日の状況" style="margin:0 0 0 12px;"></div>
        <span class="ui-sp"></span>
        <input type="month" id="ledgerMonth" class="ui-inp" value="${month}" title="対象月" aria-label="対象月">
        <select id="ledgerDept" class="ui-inp" title="部署" aria-label="部署">
          <option value="">全部署</option>
          ${departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
        </select>
        <button type="button" class="ui-btn primary" id="ledgerGoBtn">表示</button>
        <span style="width:1px;height:18px;background:#c3cdda;margin:0 4px;"></span>
        <span class="ui-seg" role="group" aria-label="表示切替" title="実績: 打刻どおりの時間 / 丸め: 出勤30分切り上げ・退勤30分切り捨て後の時間">
          <button type="button" class="ui-btn" data-ledger-mode="actual">実績</button>
          <button type="button" class="ui-btn" data-ledger-mode="round">丸め</button>
        </span>
        <button type="button" class="ui-btn primary" id="ledgerXlsxBtn">Excel出力</button>
      </div>

      <div id="ledgerClosureBanner" class="ui-note" style="display:none;"></div>
      <div id="ledgerCloseResult" style="display:none;"></div>

      <div id="ledgerCards" class="ui-stats" style="margin-bottom:10px;"></div>

      <div class="ui-panel">
        <div class="ui-ptitle">勤怠一覧 <span class="ui-sub" id="ledgerCount"></span></div>
        <div class="ui-tablewrap">
          <table class="ui-table" style="min-width:1100px;">
            <thead>
              <tr>
                <th>日付</th><th>社員番号</th><th>氏名</th><th>区分</th>
                <th class="num">出勤</th><th class="num">退勤</th><th class="num">休憩</th><th class="num">実働</th>
                <th class="num">法定外残業</th><th class="num">深夜</th><th class="num">休日</th><th>備考</th>
              </tr>
            </thead>
            <tbody id="ledgerTableBody"></tbody>
          </table>
        </div>
        <div id="ledgerPager" class="ui-pager"></div>
      </div>
    </div>
  `;

  root.querySelector('#ledgerGoBtn')?.addEventListener('click', async () => {
    month = root.querySelector('#ledgerMonth').value || month;
    departmentId = root.querySelector('#ledgerDept').value || '';
    page = 1;
    await loadClosureBanner();
    await loadLedger();
  });

  root.querySelectorAll('[data-ledger-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.getAttribute('data-ledger-mode') === 'actual' ? 'actual' : 'round';
      try { localStorage.setItem('ledgerViewMode', viewMode); } catch (e) { /* ignore */ }
      if (lastData) renderLedger(lastData);
    });
  });

  root.querySelector('#ledgerXlsxBtn')?.addEventListener('click', async () => {
    try {
      const qs = new URLSearchParams({ month, mode: viewMode });
      if (departmentId) qs.set('departmentId', departmentId);
      await downloadWithAuth(`/api/attendance/ledger/export.xlsx?${qs.toString()}`, `attendance_ledger_${month}_${viewMode === 'actual' ? '実績' : '丸め'}.xlsx`);
    } catch (err) {
      alert(String(err?.message || 'Excel出力に失敗しました'));
    }
  });

  await loadClosureBanner();
  await loadLedger();

  return () => {};
}
