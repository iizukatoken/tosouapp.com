/**
 * Kiểm tra (CHỈ ĐỌC) các ngày có nhiều dòng chấm công / báo cáo công việc,
 * để phân biệt:
 *   - nhiều ca hợp lệ trong một ngày (giờ tách rời nhau)  → KHÔNG phải lỗi
 *   - dòng trùng thật (giờ chồng lên nhau, hoặc báo cáo giống hệt nhau)
 *
 * Chạy: node attendance/backend/scripts/check-duplicates.js
 * Không thay đổi dữ liệu.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/core/database/mysql');

async function show(label, sql) {
  const [rows] = await db.query(sql);
  console.log(`\n== ${label}`);
  console.table(rows);
}

(async () => {
  console.log('\n=== Kiểm tra dòng trùng (chỉ đọc) ===');

  await show('attendance: số ngày có nhiều hơn 1 dòng (theo số dòng mỗi ngày)', `
    SELECT cnt AS rows_per_day, COUNT(*) AS days FROM (
      SELECT userId, DATE(checkIn) AS d, COUNT(*) AS cnt FROM attendance
      WHERE checkIn IS NOT NULL GROUP BY userId, DATE(checkIn) HAVING cnt > 1
    ) x GROUP BY cnt ORDER BY cnt`);

  await show('attendance: các cặp dòng cùng ngày — giờ CHỒNG nhau (nghi trùng) / TÁCH rời (nhiều ca)', `
    SELECT
      COALESCE(SUM(a.checkIn < COALESCE(b.checkOut, b.checkIn) AND b.checkIn < COALESCE(a.checkOut, a.checkIn)), 0) AS overlapping_pairs,
      COALESCE(SUM(NOT (a.checkIn < COALESCE(b.checkOut, b.checkIn) AND b.checkIn < COALESCE(a.checkOut, a.checkIn))), 0) AS separate_pairs
    FROM attendance a
    JOIN attendance b ON a.userId = b.userId AND DATE(a.checkIn) = DATE(b.checkIn) AND a.id < b.id`);

  await show('attendance: các cặp CHỒNG giờ gần đây nhất (tối đa 20)', `
    SELECT a.tenant_id, a.userId, DATE(a.checkIn) AS date,
           a.id AS id_a, TIME(a.checkIn) AS in_a, TIME(a.checkOut) AS out_a,
           b.id AS id_b, TIME(b.checkIn) AS in_b, TIME(b.checkOut) AS out_b
    FROM attendance a
    JOIN attendance b ON a.userId = b.userId AND DATE(a.checkIn) = DATE(b.checkIn) AND a.id < b.id
    WHERE a.checkIn < COALESCE(b.checkOut, b.checkIn) AND b.checkIn < COALESCE(a.checkOut, a.checkIn)
    ORDER BY a.checkIn DESC LIMIT 20`);

  await show('work_reports: số ngày có nhiều hơn 1 báo cáo', `
    SELECT cnt AS rows_per_day, COUNT(*) AS days FROM (
      SELECT userId, date, COUNT(*) AS cnt FROM work_reports GROUP BY userId, date HAVING cnt > 1
    ) x GROUP BY cnt ORDER BY cnt`);

  await show('work_reports: báo cáo GIỐNG HỆT nhau (cùng ngày, hiện trường, nội dung, giờ)', `
    SELECT COUNT(*) AS identical_groups, COALESCE(SUM(cnt - 1), 0) AS extra_rows FROM (
      SELECT COUNT(*) AS cnt FROM work_reports
      GROUP BY userId, date, site, LEFT(work, 255), start_time, end_time HAVING cnt > 1
    ) x`);

  console.log('\nKhông có thay đổi nào được ghi vào DB.\n');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
