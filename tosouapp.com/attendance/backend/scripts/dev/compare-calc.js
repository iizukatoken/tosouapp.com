/**
 * [DEV / CHỈ ĐỌC] So sánh cách tính giờ giữa 3 nơi cho cùng một nhân viên/tháng:
 *   - 画面   : màn hình 月次勤怠 thật (mở bằng trình duyệt tự động, đọc ô trên bảng)
 *   - Excel  : file 入力用勤怠表 (GET /api/attendance/month/export.xlsx)
 *   - サーバー: GET /api/attendance/month (attendance.rules.js — nguồn cho 給与)
 * và liệt kê các ngày / chỉ số tổng tháng cho kết quả khác nhau.
 *
 * Chỉ dùng trên MÔI TRƯỜNG LOCAL: token đăng nhập được tạo bằng JWT secret trong .env local,
 * không ghi gì vào DB. Cần server đang chạy và Chrome/Edge (Playwright channel).
 *
 *   DISABLE_SCHEDULERS=true PORT=3999 node attendance/backend/src/server.js
 *   node attendance/backend/scripts/dev/compare-calc.js --base http://localhost:3999 [--user 2 --month 2026-03] [--out dir]
 */
'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const db = require('../../src/core/database/mysql');

const arg = (name, def = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://localhost:3999');
const ONLY_USER = arg('user');
const ONLY_MONTH = arg('month');
const OUT = arg('out', path.join(process.cwd(), 'compare-calc-out'));

if (/tosouapp\.com/.test(BASE) || process.env.NODE_ENV === 'production') {
  console.error('Chỉ chạy trên local.');
  process.exit(1);
}

// "8:00" → 480, "" / "—" → 0
const hm = (s) => {
  const m = String(s ?? '').trim().match(/^(-?\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) * (m[1].startsWith('-') ? -1 : 1) : 0;
};
const fmt = (min) => `${Math.floor(min / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
const lateEarlyLabel = (s) => {
  const t = String(s ?? '');
  const late = /遅刻/.test(t);
  const early = /早退/.test(t);
  return late && early ? '遅刻/早退' : late ? '遅刻' : early ? '早退' : '';
};
const kubunNorm = (s) => (/^【.*】$/.test(String(s ?? '').trim()) ? '' : String(s ?? '').trim());
const cellText = (c) => {
  let v = c?.value;
  if (v && typeof v === 'object') v = v.richText ? v.richText.map((t) => t.text).join('') : (v.result ?? v.text ?? '');
  return String(v ?? '').trim();
};

async function targets() {
  const where = ['a.checkIn IS NOT NULL'];
  const params = [];
  if (ONLY_USER) { where.push('a.userId = ?'); params.push(Number(ONLY_USER)); }
  if (ONLY_MONTH) { where.push("DATE_FORMAT(a.checkIn, '%Y-%m') = ?"); params.push(ONLY_MONTH); }
  const [rows] = await db.query(`
    SELECT a.userId, u.username, u.tenant_id, u.employment_type, DATE_FORMAT(a.checkIn, '%Y-%m') AS ym, COUNT(*) AS n
    FROM attendance a JOIN users u ON u.id = a.userId
    WHERE ${where.join(' AND ')} AND u.tenant_id IS NOT NULL
    GROUP BY a.userId, u.username, u.tenant_id, u.employment_type, ym ORDER BY ym DESC, a.userId`, params);
  return rows;
}

async function tokenFor(tenantId) {
  const [[admin]] = await db.query("SELECT id, email, username, token_version FROM users WHERE role = 'sysadmin' LIMIT 1");
  const token = jwt.sign({ id: admin.id, role: 'admin', v: admin.token_version || 1, tid: tenantId },
    process.env.JWT_SECRET_CURRENT || process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token, admin };
}

async function serverSide(h, q) {
  const r = await fetch(`${BASE}/api/attendance/month?${q}`, { headers: h });
  const j = await r.json();
  if (r.status !== 200) return { error: `サーバー HTTP ${r.status}: ${j.message || ''}`, days: {}, total: {} };
  const days = {};
  for (const d of j.days || []) {
    days[d.date] = { worked: Number(d.regularMinutes || 0) + Number(d.overtimeMinutes || 0), overtime: Number(d.overtimeMinutes || 0) };
  }
  const t = j.total || {};
  return {
    days,
    total: { worked: Number(t.regularMinutes || 0) + Number(t.overtimeMinutes || 0), overtime: Number(t.overtimeMinutes || 0), night: Number(t.nightMinutes || 0) },
  };
}

async function excelSide(h, q, year) {
  const r = await fetch(`${BASE}/api/attendance/month/export.xlsx?${q}`, { headers: h });
  if (r.status !== 200) return { error: `HTTP ${r.status}` };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const ws = wb.worksheets[0];
  const days = {};
  const total = {};
  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const c1 = cellText(row.getCell(1));
    const dm = c1.match(/^(\d{1,2})月(\d{1,2})日/);
    if (dm) {
      const date = `${year}-${String(dm[1]).padStart(2, '0')}-${String(dm[2]).padStart(2, '0')}`;
      days[date] = {
        kubun: kubunNorm(cellText(row.getCell(2))),
        in: cellText(row.getCell(8)), out: cellText(row.getCell(9)),
        worked: hm(cellText(row.getCell(12))), overtime: hm(cellText(row.getCell(13))),
        lateEarly: lateEarlyLabel(cellText(row.getCell(14))),
      };
    }
    if (c1 === '所定日数') {
      const labels = []; row.eachCell((c, k) => { labels[k] = cellText(c); });
      const vals = ws.getRow(i + 1);
      labels.forEach((l, k) => { if (l) total[l] = cellText(vals.getCell(k)); });
    }
  }
  return {
    days,
    total: { worked: hm(total['総労働時間']), overtime: hm(total['総残業時間']), night: hm(total['深夜時間']), legal: hm(total['法定外時間']), attendDays: total['出勤日数'], holidayWorkDays: total['休日出勤日数'] },
  };
}

async function payrollSide(userId, ym, tenantId) {
  try {
    const { computePayslipForUser } = require('../../src/modules/salary/salary.service');
    const p = await computePayslipForUser(userId, ym, null, tenantId);
    const k = p?.['勤怠'] || {};
    return { attendDays: k['出勤日数'], holidayWorkDays: k['休日出勤日数'] };
  } catch (e) {
    return { error: e.message };
  }
}

async function screenSide(browser, token, admin, userId, ym) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addCookies([{ name: 'session_token', value: token, domain: new URL(BASE).hostname, path: '/' }]);
  await ctx.addInitScript(([t, u]) => {
    try { sessionStorage.setItem('accessToken', t); sessionStorage.setItem('user', JSON.stringify(u)); } catch (e) { /* ignore */ }
  }, [token, { id: admin.id, role: 'admin', email: admin.email, username: admin.username }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/ui/attendance/monthly?userId=${userId}&month=${ym}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('#monthTable [data-row="1"][data-date]', { timeout: 30000 });
    await page.waitForTimeout(500);
    // Giá trị "tự điền" (giờ ca mặc định, 区分 mặc định của ngày chưa nhập) không phải dữ liệu đã lưu → coi như trống.
    const scrape = () => page.$$eval('#monthTable [data-row="1"][data-date]', (trs) => trs.map((tr) => {
      const val = (el) => (el && el.dataset.auto !== '1' ? el.value || '' : '');
      const txt = (el) => (el && !el.classList.contains('is-auto') ? el.textContent.trim() : '');
      return {
        date: tr.dataset.date,
        kubun: tr.dataset.kubunConfirmed === '1' ? (tr.querySelector('select[data-field="classification"]')?.value || '') : '',
        in: val(tr.querySelector('input[data-field="checkIn"]')),
        out: val(tr.querySelector('input[data-field="checkOut"]')),
        worked: txt(tr.querySelector('td[data-field="worked"]')),
        excess: txt(tr.querySelector('td[data-field="excess"]')),
        lateEarly: tr.querySelector('td[data-field="lateEarly"]')?.textContent.trim() || '',
      };
    }));
    const summary = async () => {
      const cells = await page.$$eval('#summarySection table th, #summarySection table td', (els) => els.map((e) => e.textContent.trim()));
      const half = cells.length / 2;
      const sum = {};
      for (let i = 0; i < half; i++) sum[cells[i]] = cells[i + half];
      return { worked: hm(sum['総労働時間']), overtime: hm(sum['総残業時間']), night: hm(sum['深夜時間']), legal: hm(sum['法定外時間']), attendDays: sum['出勤日数'], holidayWorkDays: sum['休日出勤日数'] };
    };
    const toDays = (rows) => {
      const days = {};
      for (const r of rows) days[r.date] = { kubun: r.kubun, in: r.in, out: r.out, worked: hm(r.worked), overtime: hm(r.excess), lateEarly: lateEarlyLabel(r.lateEarly) };
      return days;
    };
    const actual = { days: toDays(await scrape()), total: await summary() };
    // Chế độ 丸め (làm tròn 30 phút) — cùng cách tính với サーバー/給与
    let rounded = null;
    const btn = page.locator('button:has-text("丸め")').first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(800);
      rounded = { days: toDays(await scrape()), total: await summary() };
    }
    return { ...actual, rounded, errors };
  } catch (e) {
    return { error: e.message.split('\n')[0], errors };
  } finally {
    await ctx.close();
  }
}

function diffMonth(t, s, x, v, pay = {}) {
  const R = s.rounded || { days: {}, total: {} };
  const out = [];
  const dates = new Set([...Object.keys(s.days || {}), ...Object.keys(x.days || {})]);
  for (const date of [...dates].sort()) {
    const S = s.days?.[date] || {};
    const X = x.days?.[date] || {};
    const V = v.days?.[date] || { worked: 0, overtime: 0 };
    const SR = R.days?.[date] || {};
    const issues = [];
    if ((S.worked || 0) !== (X.worked || 0)) issues.push(`実働(実績) 画面=${fmt(S.worked || 0)} Excel=${fmt(X.worked || 0)}`);
    if ((S.overtime || 0) !== (X.overtime || 0)) issues.push(`残業(実績) 画面=${fmt(S.overtime || 0)} Excel=${fmt(X.overtime || 0)}`);
    if (s.rounded && (SR.worked || 0) !== V.worked) issues.push(`実働(丸め) 画面=${fmt(SR.worked || 0)} サーバー=${fmt(V.worked)}`);
    if (s.rounded && (SR.overtime || 0) !== V.overtime) issues.push(`残業(丸め) 画面=${fmt(SR.overtime || 0)} サーバー=${fmt(V.overtime)}`);
    if ((S.lateEarly || '') !== (X.lateEarly || '')) issues.push(`遅刻/早退 画面=${S.lateEarly || '—'} Excel=${X.lateEarly || '—'}`);
    if ((S.kubun || '') !== (X.kubun || '')) issues.push(`区分 画面=${S.kubun || '(未保存)'} Excel=${X.kubun || '(未保存)'}`);
    if ((S.in || '') !== (X.in || '') || (S.out || '') !== (X.out || '')) issues.push(`時刻 画面=${S.in || '-'}~${S.out || '-'} Excel=${X.in || '-'}~${X.out || '-'}`);
    if (issues.length) out.push({ userId: t.userId, username: t.username, ym: t.ym, date, issues });
  }
  const totals = [];
  const keys = [['worked', '総労働時間'], ['overtime', '総残業時間'], ['night', '深夜時間']];
  for (const [k, label] of keys) {
    const a = s.total?.[k] || 0; const b = x.total?.[k] || 0;
    if (a !== b) totals.push(`${label}(実績) 画面=${fmt(a)} Excel=${fmt(b)}`);
    if (s.rounded) {
      const r = R.total?.[k] || 0; const c = v.total?.[k] || 0;
      if (r !== c) totals.push(`${label}(丸め) 画面=${fmt(r)} サーバー=${fmt(c)}`);
    }
  }
  if ((s.total?.legal || 0) !== (x.total?.legal || 0)) totals.push(`法定外時間 画面=${fmt(s.total?.legal || 0)} Excel=${fmt(x.total?.legal || 0)}`);
  { const a = parseFloat(String(s.total?.attendDays ?? '').replace(/[^0-9.]/g, '') || '0'), b = parseFloat(String(x.total?.attendDays ?? '').replace(/[^0-9.]/g, '') || '0'), c = Number(pay.attendDays ?? NaN);
    if (a !== b || (Number.isFinite(c) && a !== c)) totals.push(`出勤日数 画面=${a} Excel=${b} 給与=${pay.error ? 'ERR ' + pay.error : pay.attendDays}`); }
  { const a = parseFloat(String(s.total?.holidayWorkDays ?? '').replace(/[^0-9.]/g, '') || '0'), b = parseFloat(String(x.total?.holidayWorkDays ?? '').replace(/[^0-9.]/g, '') || '0'), c = Number(pay.holidayWorkDays ?? NaN);
    if (a !== b || (Number.isFinite(c) && a !== c)) totals.push(`休日出勤日数 画面=${a} Excel=${b} 給与=${pay.holidayWorkDays}`); }
  return { days: out, totals };
}

(async () => {
  const { chromium } = require('playwright');
  let browser = null;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { browser = await chromium.launch(channel ? { channel, headless: true } : { headless: true }); break; } catch (e) { /* try next */ }
  }
  if (!browser) throw new Error('Không mở được Chrome/Edge');
  fs.mkdirSync(OUT, { recursive: true });

  const list = await targets();
  console.log(`Đối tượng: ${list.length} (nhân viên × tháng)`);
  const report = [];
  for (const t of list) {
    const [y, m] = t.ym.split('-');
    const q = `year=${y}&month=${Number(m)}&userId=${t.userId}`;
    const { token, admin } = await tokenFor(t.tenant_id);
    const h = { Authorization: `Bearer ${token}`, Cookie: `session_token=${token}` };
    const [v, x, s, pay] = await Promise.all([serverSide(h, q), excelSide(h, q, y), screenSide(browser, token, admin, t.userId, t.ym), payrollSide(t.userId, t.ym, t.tenant_id)]);
    if (s.error || x.error) {
      report.push({ ...t, error: s.error || x.error });
      console.log(`✗ user ${t.userId} ${t.ym}: ${s.error || x.error}`);
      continue;
    }
    if (v.error) console.log(`  ⚠ user ${t.userId} ${t.ym}: ${v.error}`);
    const d = diffMonth(t, s, x, v, pay);
    report.push({ ...t, serverError: v.error || null, dayDiffs: d.days, totalDiffs: d.totals, pageErrors: s.errors });
    console.log(`${d.days.length || d.totals.length ? '≠' : '='} user ${t.userId} (${t.employment_type}) ${t.ym}: ${d.days.length} ngày lệch, ${d.totals.length} chỉ số tổng lệch`);
  }
  await browser.close();

  const file = path.join(OUT, 'compare-calc.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 1));
  console.log(`\nĐã lưu: ${file}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
