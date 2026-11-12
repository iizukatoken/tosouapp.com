'use strict';
/**
 * GET /api/attendance/shifts/export.pdf?month=YYYY-MM
 * シフト承認の月次PDFエクスポート (Playwright HTML→PDF, matrix layout)
 */
const db = require('../../core/database/mysql');

const escH = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const statusLabel = s => {
  switch (s) {
    case 'PENDING':     return '<span style="color:#ea580c;">未承認</span>';
    case 'APPROVED':    return '<span style="color:#16a34a;">承認済</span>';
    case 'REJECTED':    return '<span style="color:#dc2626;">差戻し</span>';
    case 'UNSUBMITTED': return '<span style="color:#94a3b8;">未提出</span>';
    default: return escH(s || '');
  }
};

const cellHtml = (schedule, date, isFullTime) => {
  const c = schedule[date];
  if (!c) return isFullTime ? '<span style="color:#94a3b8;">-</span>' : '<span style="color:#dc2626;font-size:8pt;">休</span>';
  switch (c.status) {
    case 'WORKING':   return '<span style="color:#1e40af;font-weight:700;">出</span>';
    case 'CA_NGAY':   return '<span style="color:#1e40af;font-weight:700;">日</span>';
    case 'CA_CHIEU':  return '<span style="color:#1e40af;font-weight:700;">午</span>';
    case 'CA_DEM':    return '<span style="color:#1e40af;font-weight:700;">夜</span>';
    case '09:00-14:00': return '<span style="color:#1e40af;font-size:6pt;font-weight:700;">09-14</span>';
    case 'LEAVE': {
      const lbl = { paid: '有休', unpaid: '欠', special: '特休' }[c.leaveType] || '休';
      const col = c.leaveType === 'paid' ? '#92400e' : c.leaveType === 'special' ? '#6b21a8' : '#dc2626';
      return `<span style="color:${col};font-weight:700;">${lbl}</span>`;
    }
    case 'OFF': return '<span style="color:#dc2626;">休</span>';
    default:    return '<span style="color:#94a3b8;">-</span>';
  }
};

async function exportShiftsPdf(req, res) {
  try {
    const qMonth = String(req.query.month || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
    const _tid = req.tenantId ? parseInt(String(req.tenantId), 10) : null;
    const [yr, mo] = qMonth.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
    const dowJa = ['日', '月', '火', '水', '木', '金', '土'];

    // ── データ取得 ──────────────────────────────────────────────────
    const tenantClause = _tid ? ' AND u.tenant_id = ?' : '';
    const tenantP = _tid ? [_tid] : [];
    const [users] = await db.query(`
      SELECT u.id, u.username, u.employee_code, u.employment_type, d.name AS departmentName
      FROM users u
      LEFT JOIN departments d ON d.id = u.departmentId
      WHERE u.employment_status = 'active'${tenantClause}
        AND u.role NOT IN ('admin','manager','sysadmin','super_admin','owner')
      ORDER BY COALESCE(u.employee_code,'') ASC, u.id ASC
    `, tenantP);

    const [shiftRows] = await db.query(`
      SELECT ss.userId, ss.date, ss.status, ss.leaveType, ss.reason
      FROM shift_requests ss
      WHERE ss.date >= ? AND ss.date <= ?
      ${_tid ? ' AND ss.userId IN (SELECT id FROM users WHERE tenant_id = ?)' : ''}
    `, [`${qMonth}-01`, `${qMonth}-${String(daysInMonth).padStart(2,'0')}`, ..._tid ? [_tid] : []]);

    const [approvalRows] = await db.query(`
      SELECT sm.userId, sm.status AS submissionStatus
      FROM shift_month_status sm
      WHERE sm.month = ?
      ${_tid ? ' AND sm.userId IN (SELECT id FROM users WHERE tenant_id = ?)' : ''}
    `, [qMonth, ..._tid ? [_tid] : []]);

    const scheduleByUser = new Map();
    shiftRows.forEach(r => {
      const uid = Number(r.userId);
      if (!scheduleByUser.has(uid)) scheduleByUser.set(uid, {});
      scheduleByUser.get(uid)[String(r.date).slice(0, 10)] = { status: r.status, leaveType: r.leaveType, reason: r.reason };
    });
    const approvalByUser = new Map(approvalRows.map(r => [Number(r.userId), r.submissionStatus]));

    // ── 出勤日数計算 ──────────────────────────────────────────────
    users.forEach(u => {
      const sch = scheduleByUser.get(Number(u.id)) || {};
      let cnt = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${String(yr).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const c = sch[ds];
        if (c && ['WORKING','CA_NGAY','CA_CHIEU','CA_DEM','09:00-14:00'].includes(c.status)) cnt++;
      }
      u._workCount = cnt;
    });

    const nowStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    // ── ページ分割: 最大15人/ページ、少ない場合は列幅を自動拡張 ──
    // A4 landscape at 96dpi = 1122px。padding 8mm×2 ≈ 61px → usable = 1061px
    // 日付(44) + 曜日(28) = 72px固定 → 残り989px を人数で割る
    const COLS_PER_PAGE = 15;
    const USABLE_W = 1061; // px
    const FIXED_W = 72;    // 日付+曜日

    const chunks = [];
    for (let i = 0; i < users.length; i += COLS_PER_PAGE) chunks.push(users.slice(i, i + COLS_PER_PAGE));
    if (!chunks.length) chunks.push([]);

    const buildSection = (chunk, ci) => {
      const colW = chunk.length > 0 ? Math.floor((USABLE_W - FIXED_W) / chunk.length) : 80;
      const isLast = ci === chunks.length - 1;

      const empHeaders = chunk.map(u => {
        const isFull = u.employment_type === 'full_time';
        const badge = isFull
          ? '<span style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;padding:1px 3px;border-radius:2px;font-size:6pt;">正</span>'
          : '<span style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;padding:1px 3px;border-radius:2px;font-size:6pt;">パート</span>';
        const approval = statusLabel(approvalByUser.get(Number(u.id)) || 'UNSUBMITTED');
        return `<th style="width:${colW}px;padding:3px 2px;vertical-align:top;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;overflow:hidden;">
          <div style="font-weight:700;font-size:8pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escH(u.username)}</div>
          <div style="font-size:6.5pt;color:#64748b;">${escH(u.employee_code || '')}</div>
          <div style="margin-top:2px;">${badge}</div>
          <div style="font-size:6.5pt;margin-top:2px;">計: <strong>${u._workCount}</strong>日</div>
          <div style="font-size:6.5pt;margin-top:1px;">${approval}</div>
        </th>`;
      }).join('');

      let dayRows = '';
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${String(yr).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(Date.UTC(yr, mo - 1, d)).getUTCDay();
        const dowLbl = dowJa[dow];
        const isSat = dow === 6, isSun = dow === 0;
        const dateColor = isSun ? 'color:#dc2626;' : isSat ? 'color:#2563eb;' : 'color:#475569;';
        const rowBg = isSun ? 'background:#fff5f5;' : isSat ? 'background:#eff6ff;' : (d % 2 === 0 ? 'background:#f8fafc;' : 'background:#fff;');
        const cells = chunk.map(u => {
          const sch = scheduleByUser.get(Number(u.id)) || {};
          const isFull = u.employment_type === 'full_time';
          return `<td style="width:${colW}px;text-align:center;vertical-align:middle;padding:2px;border:1px solid #e2e8f0;height:20px;">${cellHtml(sch, ds, isFull)}</td>`;
        }).join('');
        dayRows += `<tr style="${rowBg}">
          <td style="width:44px;font-size:7.5pt;${dateColor}font-weight:600;text-align:center;padding:2px 4px;border:1px solid #e2e8f0;white-space:nowrap;">${mo}/${d}</td>
          <td style="width:28px;font-size:7.5pt;${dateColor}font-weight:600;text-align:center;padding:2px 4px;border:1px solid #e2e8f0;">${dowLbl}</td>
          ${cells}
        </tr>`;
      }

      const pageLabel = chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : '';
      return `<div ${ci === 0 ? 'id="_sec0"' : ''} style="padding:8mm 8mm 6mm 8mm;${isLast ? '' : 'page-break-after:always;'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:5px;padding-bottom:4px;border-bottom:2px solid #1e4d8c;">
          <div style="font-size:12pt;font-weight:700;">シフト表 ${escH(qMonth)}${pageLabel}</div>
          <div style="font-size:7.5pt;color:#64748b;">${chunk.length}名　出力日時: ${escH(nowStr)}</div>
        </div>
        <table style="width:${USABLE_W}px;border-collapse:collapse;font-size:7.5pt;table-layout:fixed;">
          <thead>
            <tr>
              <th style="width:44px;background:#1e4d8c;color:#fff;font-weight:600;font-size:7pt;padding:5px 3px;text-align:center;border:1px solid #2563ab;">日付</th>
              <th style="width:28px;background:#1e4d8c;color:#fff;font-weight:600;font-size:7pt;padding:5px 3px;text-align:center;border:1px solid #2563ab;">曜</th>
              ${empHeaders}
            </tr>
          </thead>
          <tbody>${dayRows}</tbody>
        </table>
      </div>`;
    };

    const sections = chunks.map(buildSection).join('');

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  @font-face{font-family:'JP';src:local('Meiryo'),local('Yu Gothic'),url('file:///C:/Windows/Fonts/NotoSansJP-VF.ttf') format('truetype');}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'JP','Meiryo','Yu Gothic','MS Gothic',sans-serif;font-size:8pt;color:#1e293b;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @page{size:A4 landscape;margin:0;}
  @media print{thead{display:table-header-group;}tbody tr{page-break-inside:avoid;}}
</style>
</head>
<body>
${sections}
</body>
</html>`;

    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    // Viewport width = A4 landscape (1122px) so layout matches print width exactly
    await page.setViewportSize({ width: 1122, height: 5000 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(300);
    // Measure first section height (includes its own padding) to calculate scale
    // A4 landscape at 96dpi = 794px tall
    const secH = await page.evaluate(() => {
      const el = document.getElementById('_sec0');
      return el ? el.getBoundingClientRect().height : document.documentElement.scrollHeight;
    });
    const A4H = 794;
    const scale = Math.min(1, A4H / secH);
    const pdfBuf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      scale,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    await browser.close();

    const fname = encodeURIComponent(`シフト表_${qMonth}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${fname}`);
    res.send(pdfBuf);
  } catch (err) {
    console.error('[shifts export.pdf] error:', err);
    if (!res.headersSent) res.status(500).json({ message: err.message || 'export failed' });
  }
}

module.exports = { exportShiftsPdf };
