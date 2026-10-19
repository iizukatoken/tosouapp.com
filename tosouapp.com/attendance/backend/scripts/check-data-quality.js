/**
 * Kiểm tra (CHỈ ĐỌC) các dữ liệu chấm công khiến 画面 / Excel / サーバー(給与) tính ra
 * kết quả khác nhau (tìm thấy bằng scripts/dev/compare-calc.js trên local, 2026-10):
 *
 *   1. 退勤 trước 出勤 → tính toán phía server lỗi cho CẢ THÁNG của nhân viên đó
 *   2. Có 打刻 vào ngày nghỉ nhưng chưa lưu 区分 → 画面 không hiện giờ, Excel coi là 休日出勤,
 *      サーバー tính toàn bộ là 残業
 *   3. Có 打刻 vào ngày đã lưu 区分 là nghỉ (有給休暇/休日/欠勤/代替休日…) → 画面 không hiện giờ, Excel có
 *   4. Có 出勤 mà chưa có 退勤 (trước hôm nay) → 画面 vẫn báo 遅刻, Excel thì không
 *
 * Chạy: node attendance/backend/scripts/check-data-quality.js
 * Không thay đổi dữ liệu.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/core/database/mysql');

const OFF_KUBUN = ['休日', '法定休日', '有給休暇', '欠勤', '代替休日', '無給休暇', '代休'];

async function show(label, sql, params = []) {
  const [rows] = await db.query(sql, params);
  console.log(`\n== ${label}`);
  console.table(rows);
  return rows;
}

(async () => {
  console.log('\n=== Kiểm tra chất lượng dữ liệu chấm công (chỉ đọc) ===');

  await show('1. 退勤 trước 出勤 (theo công ty)', `
    SELECT tenant_id, COUNT(*) AS rows_cnt, COUNT(DISTINCT userId) AS users,
           MIN(DATE(checkIn)) AS first_date, MAX(DATE(checkIn)) AS last_date
    FROM attendance WHERE checkOut IS NOT NULL AND checkOut < checkIn
    GROUP BY tenant_id`);
  await show('1b. 退勤 trước 出勤 — chi tiết (tối đa 20)', `
    SELECT a.id, a.tenant_id, a.userId, u.username, a.checkIn, a.checkOut
    FROM attendance a LEFT JOIN users u ON u.id = a.userId
    WHERE a.checkOut IS NOT NULL AND a.checkOut < a.checkIn
    ORDER BY a.checkIn DESC LIMIT 20`);

  await show('2. 打刻 vào thứ 7 / CN / ngày lễ chung nhưng CHƯA lưu 区分 (theo công ty, theo tháng)', `
    SELECT a.tenant_id, DATE_FORMAT(a.checkIn, '%Y-%m') AS ym, COUNT(*) AS days
    FROM attendance a
    LEFT JOIN attendance_daily d ON d.userId = a.userId AND d.date = DATE(a.checkIn)
    WHERE a.checkIn IS NOT NULL
      AND (d.id IS NULL OR d.kubun IS NULL OR d.kubun = '')
      AND (DAYOFWEEK(a.checkIn) IN (1, 7)
           OR EXISTS (SELECT 1 FROM company_holidays h WHERE h.date = DATE(a.checkIn) AND h.is_off = 1 AND h.tenant_id IN (0, a.tenant_id)))
    GROUP BY a.tenant_id, ym ORDER BY ym DESC, a.tenant_id LIMIT 24`);

  await show('3. 打刻 vào ngày đã lưu 区分 là nghỉ (theo 区分)', `
    SELECT a.tenant_id, d.kubun, COUNT(*) AS days
    FROM attendance a
    JOIN attendance_daily d ON d.userId = a.userId AND d.date = DATE(a.checkIn)
    WHERE a.checkIn IS NOT NULL AND d.kubun IN (?)
    GROUP BY a.tenant_id, d.kubun ORDER BY a.tenant_id, days DESC`, [OFF_KUBUN]);

  await show('4. Có 出勤 nhưng chưa 退勤 (các ngày trước hôm nay, theo tháng)', `
    SELECT tenant_id, DATE_FORMAT(checkIn, '%Y-%m') AS ym, COUNT(*) AS days
    FROM attendance
    WHERE checkIn IS NOT NULL AND checkOut IS NULL
      AND DATE(checkIn) < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+09:00'))
    GROUP BY tenant_id, ym ORDER BY ym DESC, tenant_id LIMIT 24`);

  console.log('\nKhông có thay đổi nào được ghi vào DB.\n');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
