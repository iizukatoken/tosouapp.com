/**
 * Kiểm tra (CHỈ ĐỌC) dữ liệu trùng, để phân biệt:
 *   - nhiều ca hợp lệ trong một ngày (giờ tách rời nhau)  → KHÔNG phải lỗi
 *   - dòng trùng thật (giờ chồng lên nhau, hoặc báo cáo giống hệt nhau)
 * Cùng logic với email cảnh báo hằng tuần (src/cron/duplicateCheckCron.js).
 *
 * Chạy: node attendance/backend/scripts/check-duplicates.js
 * Không thay đổi dữ liệu.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { findDuplicates, hasDuplicates } = require('../src/services/duplicateCheck.service');

(async () => {
  console.log('\n=== Kiểm tra dòng trùng (chỉ đọc) ===');
  const r = await findDuplicates();

  console.log('\n== attendance: các cặp dòng cùng ngày');
  console.table([{ overlapping_pairs: r.attendanceOverlappingPairs, separate_pairs: r.attendanceSeparatePairs }]);
  console.log('   overlapping = giờ CHỒNG nhau (nghi trùng) / separate = TÁCH rời (nhiều ca hợp lệ)');
  if (r.attendanceOverlapSamples.length) {
    console.log('\n== attendance: các cặp CHỒNG giờ gần đây nhất (tối đa 20)');
    console.table(r.attendanceOverlapSamples);
  }

  console.log('\n== work_reports: báo cáo GIỐNG HỆT nhau (cùng ngày, hiện trường, nội dung, giờ)');
  console.table([{ identical_groups: r.workReportIdenticalGroups, extra_rows: r.workReportExtraRows }]);
  if (r.workReportIdenticalSamples.length) console.table(r.workReportIdenticalSamples);

  console.log(hasDuplicates(r) ? '\n⚠️  Có dữ liệu nghi trùng.' : '\n✅ Không có dữ liệu trùng.');
  console.log('Không có thay đổi nào được ghi vào DB.\n');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
