// Cron Job: mỗi sáng thứ Hai kiểm tra dữ liệu trùng (chỉ đọc) và gửi email cảnh báo
// khi có — để biết lỗi trùng dòng trước khi người dùng phát hiện.
// Không có dòng trùng thì không gửi email (chỉ ghi log).
const cron = require('node-cron');
const mailService = require('../core/notifications/email.service');
const { findDuplicates, hasDuplicates } = require('../services/duplicateCheck.service');

const ALERT_EMAIL = 'iizuka_token@tosouapp.com';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function table(headers, rows) {
  const th = headers.map(([, label]) => `<th style="border:1px solid #cbd5e1;padding:4px 8px;background:#f1f5f9;">${esc(label)}</th>`).join('');
  const trs = rows.map((r) => `<tr>${headers.map(([key]) => `<td style="border:1px solid #cbd5e1;padding:4px 8px;">${esc(r[key])}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;font-size:13px;"><tr>${th}</tr>${trs}</table>`;
}

function buildEmailHtml(result) {
  const parts = ['<p>週次の重複データチェックで、重複の疑いがあるデータが見つかりました（データは変更していません）。</p>'];
  if (result.attendanceOverlappingPairs > 0) {
    parts.push(`<h3>勤怠: 同じ日に時間が重なる打刻 ${result.attendanceOverlappingPairs} 組</h3>`);
    parts.push(table([
      ['tenant_id', '会社ID'], ['username', '氏名'], ['date', '日付'],
      ['id_a', 'ID A'], ['in_a', '出勤 A'], ['out_a', '退勤 A'],
      ['id_b', 'ID B'], ['in_b', '出勤 B'], ['out_b', '退勤 B'],
    ], result.attendanceOverlapSamples));
  }
  if (result.workReportIdenticalGroups > 0) {
    parts.push(`<h3>日報: 内容が完全に同じ日報 ${result.workReportIdenticalGroups} 件（余分 ${result.workReportExtraRows} 行）</h3>`);
    parts.push(table([
      ['tenant_id', '会社ID'], ['username', '氏名'], ['date', '日付'], ['site', '現場'], ['cnt', '件数'], ['ids', 'ID'],
    ], result.workReportIdenticalSamples));
  }
  parts.push('<p style="color:#64748b;font-size:12px;">確認方法: Render Shell で <code>node attendance/backend/scripts/check-duplicates.js</code>（表示は最大20件）。修正は バックアップ → 確認 の上で手動で行ってください。</p>');
  return parts.join('\n');
}

async function runDuplicateCheck() {
  try {
    const result = await findDuplicates();
    console.log('[DuplicateCheck] result', {
      attendanceOverlappingPairs: result.attendanceOverlappingPairs,
      workReportIdenticalGroups: result.workReportIdenticalGroups,
    });
    if (!hasDuplicates(result)) return { sent: false, result };
    await mailService.sendMail({
      to: ALERT_EMAIL,
      subject: '【勤怠システム】重複データの疑いがあります',
      html: buildEmailHtml(result),
    });
    return { sent: true, result };
  } catch (err) {
    console.error('[DuplicateCheck] failed:', err && err.message);
    return { sent: false, error: err };
  }
}

function initDuplicateCheckCron() {
  // Thứ Hai 08:00 giờ Nhật
  cron.schedule('0 8 * * 1', () => { runDuplicateCheck(); }, { scheduled: true, timezone: 'Asia/Tokyo' });
  console.log('[DuplicateCheck] Đã lên lịch kiểm tra dữ liệu trùng vào 08:00 thứ Hai hằng tuần.');
}

module.exports = { initDuplicateCheckCron, runDuplicateCheck, buildEmailHtml };
