/**
 * 月次勤怠入力「予定」タブ（勤務予定表）。表示のみ。
 * - 正社員: 会社カレンダー＋割り当てたシフトが予定（シフト申請がなくても予定がある）
 * - アルバイト: 提出したシフトが予定。未提出なら案内（本人: シフトを提出／管理者: 催促する）
 * - 実績と違う日は薄いオレンジ＋「実績との差」
 */
(function () {
  const root = globalThis.AttendanceMonthly || {};
  const core = root.Core || globalThis.MonthlyMonthlyCore || {};
  const state = root.State || globalThis.MonthlyMonthlyState || {};
  const { fetchJSONAuth } = core;

  const W = '日月火水木金土';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toMin = (hm) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const hm = (v) => { const s = String(v || ''); return s.length >= 16 ? s.slice(11, 16) : (/^\d{1,2}:\d{2}/.test(s) ? s.slice(0, 5) : ''); };
  const fmt = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  const LEAVE_KUBUN = new Set(['有給休暇', '無給休暇', '欠勤', '代替休日', '半休', '半休(有給)', '特別休暇']);
  const LEAVE_TYPE = { paid: '有給休暇', paid_half: '半休(有給)', half: '半休', unpaid: '欠勤', substitute: '代替休日', special: '無給休暇' };
  const PLACE = { onsite: '出社', remote: '在宅', satellite: '現場' };
  const todayStr = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const CSS = `
#planView{padding:0 0 8px}
#planView .pv-ban{border:1px solid #f59e0b;background:#fffbeb;color:#92400e;padding:6px 10px;font-size:12.5px;margin:0 0 8px;display:flex;align-items:center;gap:10px}
#planView .pv-ban.red{border-color:#fca5a5;background:#fef2f2;color:#991b1b}
#planView .pv-ban b{color:#b45309}#planView .pv-ban.red b{color:#b91c1c}
#planView .pv-ban .pv-bt{margin-left:auto;height:24px;line-height:22px;padding:0 12px;background:#0b2c66;border:1px solid #0b2c66;color:#fff;font-weight:700;font-size:12px;cursor:pointer;text-decoration:none;font-family:inherit;white-space:nowrap}
#planView .pv-ban .pv-bt:disabled{opacity:.5;cursor:default}
#planView .pv-sum{display:flex;flex-wrap:wrap;margin:0 0 8px;font-size:12px}
#planView .pv-sum div{border:1px solid #9aa8ba;border-right:0;padding:3px 10px;background:#fff}#planView .pv-sum div:last-child{border-right:1px solid #9aa8ba}
#planView .pv-sum b{margin-left:6px;color:#0b2c66}
#planView table{border-collapse:collapse;width:100%;font-size:12px;background:#fff}
#planView th{background:#0b2c66 !important;color:#fff !important;border:1px solid #0b2c66 !important;padding:4px 6px !important;font-weight:700;white-space:nowrap;text-align:center}
#planView td{border:1px solid #c3cdda !important;padding:3px 6px !important;text-align:center;white-space:nowrap;height:auto !important}
#planView td.l{text-align:left}
#planView tr.off td{background:#f8fafc;color:#94a3b8}
#planView tr.diff td{background:#fff7ed}
#planView tr.today td{box-shadow:inset 0 1px 0 #0b2c66,inset 0 -1px 0 #0b2c66}
#planView .sun{color:#dc2626}#planView .sat{color:#2563eb}
#planView .k{display:inline-block;padding:0 6px;font-size:11px;font-weight:700;border:1px solid}
#planView .k.work{color:#0b2c66;border-color:#9cb6e0;background:#eef4ff}#planView .k.off{color:#64748b;border-color:#cbd5e1;background:#fff}
#planView .k.leave{color:#0f766e;border-color:#5eead4;background:#f0fdfa}#planView .k.none{color:#b45309;border-color:#fcd34d;background:#fffbeb}
#planView .st{font-size:11px;font-weight:700}#planView .st.ok{color:#166534}#planView .st.wait{color:#b45309}#planView .st.ng{color:#b91c1c}#planView .st.na{color:#94a3b8;font-weight:400}
#planView .dif{font-size:11px;color:#c2410c;font-weight:700}
#planView .pv-note{font-size:11px;color:#64748b;margin-top:6px}
`;

  function ensureCss() {
    if (document.getElementById('pv-css')) return;
    const st = document.createElement('style');
    st.id = 'pv-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function me() {
    try { return JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || '{}') || {}; } catch (e) { return {}; }
  }

  /** 1日分の予定と実績の差 */
  function dayPlan(d, ctx) {
    const ds = String(d?.date || '').slice(0, 10);
    const sr = d?.shiftRequest || null;
    const shift = d?.shift || null;
    const plan = d?.plan || null;
    const daily = d?.daily || null;
    const isOffDay = Number(d?.is_off || 0) === 1;
    const kubun = String(daily?.kubun || '').trim();
    const srStatus = String(sr?.status || '');
    const leaveFromReq = srStatus === 'LEAVE' ? (LEAVE_TYPE[String(sr?.leaveType || '')] || '') : '';

    let kind = 'work'; let label = '出勤';
    if (LEAVE_KUBUN.has(kubun) && !/^半休/.test(kubun)) { kind = 'leave'; label = kubun; }
    else if (leaveFromReq && !/^半休/.test(leaveFromReq)) { kind = 'leave'; label = leaveFromReq; }
    else if (ctx.isPart) {
      if (srStatus === 'WORKING') { kind = 'work'; label = '出勤'; }
      else if (ctx.unsubmitted) { kind = 'none'; label = '予定なし'; }
      else { kind = 'off'; label = '休み'; }
    } else if (srStatus === 'WORKING') { kind = 'work'; label = '出勤'; }
    else if (srStatus === 'OFF' || (srStatus === 'LEAVE' && !leaveFromReq) || isOffDay) { kind = 'off'; label = '休日'; }
    const half = /^半休/.test(kubun) ? kubun : (/^半休/.test(leaveFromReq) ? leaveFromReq : '');

    const p = { ds, kind, label, half, shiftName: '—', time: '—', brk: '—', std: '—', stdMin: 0, place: '—', memo: '', status: '', diff: '' };
    if (kind === 'work') {
      const s = shift?.start_time ? String(shift.start_time).slice(0, 5) : '';
      const e = shift?.end_time ? String(shift.end_time).slice(0, 5) : '';
      const br = Number(shift?.break_minutes ?? 60);
      p.shiftName = shift?.name || (s ? '—' : '（シフト未設定）');
      if (s && e) {
        p.time = `${s}〜${e}`;
        let span = toMin(e) - toMin(s); if (span <= 0) span += 1440;
        p.stdMin = Number(shift?.standard_minutes) || Math.max(0, span - br);
        if (half) p.stdMin = Math.round(p.stdMin / 2);
        p.brk = fmt(br);
        p.std = fmt(p.stdMin);
        p.start = toMin(s); p.end = toMin(e);
      }
      p.place = PLACE[String(plan?.workType || plan?.work_type || '')] || (plan ? '—' : '出社');
      if (half) p.label = `出勤（${half}）`;
    } else if (kind === 'leave') {
      const sm = Number(shift?.standard_minutes) || 0;
      p.std = sm ? `(${fmt(sm)})` : '—';
    }
    p.memo = [sr?.detail, plan?.memo, plan?.location].filter(Boolean).map(String).join('・');

    // 申請の状態
    const ls = (ctx.leaveStatus || {})[ds];
    if (kind === 'leave' && ls?.status) p.status = ls.status === 'approved' ? 'ok:承認済み' : ls.status === 'rejected' ? 'ng:差戻し' : 'wait:申請中';
    else if (sr) p.status = ctx.monthStatus === 'APPROVED' ? 'ok:承認済み' : ctx.monthStatus === 'REJECTED' ? 'ng:差戻し' : 'wait:申請中';
    else if (ctx.isPart && ctx.unsubmitted) p.status = 'na:未提出';
    else if (!ctx.isPart && kind === 'work') p.status = 'na:（シフト申請なし）';

    // 実績との差（今日まで）
    const segs = Array.isArray(d?.segments) ? d.segments.filter(x => x && (x.checkIn || x.checkOut)) : [];
    if (ds <= ctx.today && segs.length) {
      const first = segs[0];
      const ins = hm(first.checkIn); const outs = hm(first.checkOut);
      const extra = segs.slice(1).filter(x => x.checkIn && x.checkOut);
      const extraMin = extra.reduce((a, x) => { let m = toMin(hm(x.checkOut)) - toMin(hm(x.checkIn)); if (m < 0) m += 1440; return a + m; }, 0);
      const out = [];
      if (kind !== 'work') {
        out.push(`予定外勤務（${ins || '—'}〜${outs || '—'}）`);
      } else if (p.start != null) {
        const a = toMin(ins); const b = toMin(outs);
        if (a != null && a > p.start) out.push(`遅刻 ${a - p.start}分（${ins}）`);
        if (!outs && ds < ctx.today) out.push('退勤未打刻');
        if (b != null && b < p.end && b > (a ?? 0)) out.push(`早退 ${p.end - b}分`);
        let ot = (b != null && b > p.end) ? b - p.end : 0;
        ot += extraMin;
        if (ot >= 1) out.push(`残業 +${fmt(ot)}${extra.length ? `（${extra.map(x => `${hm(x.checkIn)}〜${hm(x.checkOut)}`).join('・')} 追加勤務）` : ''}`);
      }
      p.diff = out.join('・');
    } else if (kind === 'work' && ds < ctx.today && !segs.length && p.start != null) {
      p.diff = '打刻なし';
    }
    return p;
  }

  function render() {
    const detail = state.currentMonthDetail || null;
    const host = document.getElementById('monthTable');
    if (!host) return;
    ensureCss();
    let box = document.getElementById('planView');
    if (!box) {
      box = document.createElement('div');
      box.id = 'planView';
      host.parentNode.insertBefore(box, host);
    }
    box.style.display = '';
    host.style.display = 'none';
    if (!detail || !Array.isArray(detail.days)) { box.innerHTML = '<div class="pv-note">社員を選ぶと予定が表示されます。</div>'; return; }

    const user = detail.user || {};
    const self = me();
    const role = String(self.role || '').toLowerCase();
    const viewingOther = user.id != null && String(user.id) !== String(self.id || '');
    const isManagerView = (role === 'admin' || role === 'manager') && viewingOther;
    const isPart = String(user.employment_type || '').toLowerCase() === 'part_time' || String(user.shift_id || '').includes('baito');
    const monthStatus = String(detail.shiftMonthStatus || '');
    const hasReq = detail.days.some(x => x && x.shiftRequest);
    const ym = `${detail.year}-${String(detail.month).padStart(2, '0')}`;
    const ctx = { isPart, monthStatus, unsubmitted: !monthStatus && !hasReq, leaveStatus: detail.leaveStatusByDate || {}, today: todayStr() };

    const rows = detail.days.map(d => dayPlan(d, ctx));
    const workRows = rows.filter(r => r.kind === 'work');
    const stdTotal = workRows.reduce((a, r) => a + r.stdMin, 0);
    const sum = isPart
      ? `<div>出勤予定<b>${workRows.length}日</b></div><div>予定時間<b>${fmt(stdTotal)}</b></div><div>シフト<b style="color:${monthStatus === 'APPROVED' ? '#166534' : '#b45309'};">${ctx.unsubmitted ? '未提出' : monthStatus === 'APPROVED' ? '承認済み' : monthStatus === 'REJECTED' ? '差戻し' : '申請中'}</b></div>`
      : `<div>所定日数<b>${workRows.length}日</b></div><div>所定時間<b>${fmt(stdTotal)}</b></div><div>休日予定<b>${rows.filter(r => r.kind === 'off').length}日</b></div><div>休暇予定<b>${rows.filter(r => r.kind === 'leave').length}日</b></div>`;

    let banner = '';
    const m = Number(detail.month);
    if (isPart && ctx.unsubmitted) {
      const btn = isManagerView
        ? `<button type="button" class="pv-bt" data-pv="remind">催促する</button>`
        : (!viewingOther ? `<a class="pv-bt" href="/ui/shifts?month=${encodeURIComponent(ym)}">シフトを提出</a>` : '');
      banner = `<div class="pv-ban">⚠ <span><b>${m}月のシフトが未提出です</b>。予定がないため、勤務予定と実績の比較ができません。</span>${btn}</div>`;
    } else if (monthStatus === 'REJECTED') {
      banner = `<div class="pv-ban red">⚠ <span><b>${m}月のシフトは差し戻されました</b>。内容を直して、もう一度提出してください。</span>${!viewingOther ? `<a class="pv-bt" href="/ui/shifts?month=${encodeURIComponent(ym)}">シフトを確認</a>` : ''}</div>`;
    }

    const body = rows.map((r) => {
      const w = new Date(`${r.ds}T00:00:00Z`).getUTCDay();
      const dc = w === 0 ? 'sun' : w === 6 ? 'sat' : '';
      const [stc, stt] = r.status ? r.status.split(':') : ['', ''];
      const cls = [r.kind === 'off' && !r.diff ? 'off' : '', r.diff ? 'diff' : '', r.ds === ctx.today ? 'today' : ''].filter(Boolean).join(' ');
      return `<tr class="${cls}"><td><span class="${dc}">${Number(r.ds.slice(5, 7))}/${r.ds.slice(8, 10)}(${W[w]})</span></td>
        <td><span class="k ${r.kind}">${esc(r.label)}</span></td><td>${esc(r.shiftName)}</td><td>${esc(r.time)}</td><td>${esc(r.brk)}</td><td>${esc(r.std)}</td>
        <td>${esc(r.place)}</td><td class="l">${esc(r.memo)}</td><td>${stt ? `<span class="st ${stc}">${esc(stt)}</span>` : ''}</td>
        <td class="l">${r.diff ? `<span class="dif">${esc(r.diff)}</span>` : ''}</td></tr>`;
    }).join('');

    box.innerHTML = `${banner}<div class="pv-sum">${sum}</div>
      <table><thead><tr><th>日付</th><th>勤務区分（予定）</th><th>シフト</th><th>予定時刻</th><th>休憩</th><th>所定時間</th><th>勤務場所</th><th>予定メモ</th><th>申請の状態</th><th>実績との差</th></tr></thead><tbody>${body}</tbody></table>
      <div class="pv-note">※ 予定は表示のみです（変更は シフト申請・休暇申請 から）。実績との差は打刻どおりの分で表示しています。</div>`;

    const rb = box.querySelector('[data-pv="remind"]');
    if (rb) {
      rb.addEventListener('click', async () => {
        rb.disabled = true;
        try {
          await fetchJSONAuth('/api/attendance/admin/shift-remind', { method: 'POST', body: JSON.stringify({ userId: user.id, month: ym }) });
          rb.textContent = '催促しました';
        } catch (e) {
          rb.disabled = false;
          alert(String(e?.message || '送れませんでした'));
        }
      });
    }
  }

  function hide() {
    const box = document.getElementById('planView');
    if (box) box.style.display = 'none';
    const host = document.getElementById('monthTable');
    if (host) host.style.display = '';
  }

  const isActive = () => document.body.classList.contains('view-plan');
  const mod = { render, hide, isActive, _dayPlan: dayPlan };
  root.PlanView = mod;
  globalThis.AttendanceMonthly = root;
  globalThis.MonthlyPlanView = mod;
})();
