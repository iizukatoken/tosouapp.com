// Kiểm tra (CHỈ ĐỌC) dữ liệu trùng — dùng chung cho scripts/check-duplicates.js và
// cron/duplicateCheckCron.js (email cảnh báo hằng tuần).
//
// Nhiều dòng chấm công trong một ngày là tính năng có chủ đích (ca thứ 2 / dòng phụ),
// nên chỉ coi là trùng khi:
//   - attendance: hai dòng cùng người, cùng ngày, có khoảng giờ CHỒNG lên nhau
//   - work_reports: hai báo cáo giống hệt nhau (ngày, hiện trường, nội dung, giờ)
const db = require('../core/database/mysql');

const OVERLAP = `a.checkIn < COALESCE(b.checkOut, b.checkIn) AND b.checkIn < COALESCE(a.checkOut, a.checkIn)`;
const SAME_DAY_PAIRS = `
  FROM attendance a
  JOIN attendance b ON a.userId = b.userId AND DATE(a.checkIn) = DATE(b.checkIn) AND a.id < b.id`;

async function findDuplicates({ sampleLimit = 20 } = {}) {
  const [[pairs]] = await db.query(`
    SELECT
      COALESCE(SUM(${OVERLAP}), 0) AS overlapping,
      COALESCE(SUM(NOT (${OVERLAP})), 0) AS separate
    ${SAME_DAY_PAIRS}`);

  const [overlapSamples] = await db.query(`
    SELECT a.tenant_id, a.userId, u.username, DATE_FORMAT(a.checkIn, '%Y-%m-%d') AS date,
           a.id AS id_a, DATE_FORMAT(a.checkIn, '%H:%i') AS in_a, DATE_FORMAT(a.checkOut, '%H:%i') AS out_a,
           b.id AS id_b, DATE_FORMAT(b.checkIn, '%H:%i') AS in_b, DATE_FORMAT(b.checkOut, '%H:%i') AS out_b
    ${SAME_DAY_PAIRS}
    LEFT JOIN users u ON u.id = a.userId
    WHERE ${OVERLAP}
    ORDER BY a.checkIn DESC
    LIMIT ?`, [Number(sampleLimit)]);

  const [[identical]] = await db.query(`
    SELECT COUNT(*) AS groups_cnt, COALESCE(SUM(cnt - 1), 0) AS extra_rows FROM (
      SELECT COUNT(*) AS cnt FROM work_reports
      GROUP BY userId, date, site, LEFT(work, 255), start_time, end_time HAVING cnt > 1
    ) x`);

  const [identicalSamples] = await db.query(`
    SELECT w.tenant_id, w.userId, u.username, DATE_FORMAT(w.date, '%Y-%m-%d') AS date, w.site,
           COUNT(*) AS cnt, GROUP_CONCAT(w.id ORDER BY w.id) AS ids
    FROM work_reports w
    LEFT JOIN users u ON u.id = w.userId
    GROUP BY w.tenant_id, w.userId, u.username, w.date, w.site, LEFT(w.work, 255), w.start_time, w.end_time
    HAVING cnt > 1
    ORDER BY w.date DESC
    LIMIT ?`, [Number(sampleLimit)]);

  return {
    attendanceOverlappingPairs: Number(pairs?.overlapping || 0),
    attendanceSeparatePairs: Number(pairs?.separate || 0),
    attendanceOverlapSamples: overlapSamples || [],
    workReportIdenticalGroups: Number(identical?.groups_cnt || 0),
    workReportExtraRows: Number(identical?.extra_rows || 0),
    workReportIdenticalSamples: identicalSamples || [],
  };
}

function hasDuplicates(result) {
  return result.attendanceOverlappingPairs > 0 || result.workReportIdenticalGroups > 0;
}

module.exports = { findDuplicates, hasDuplicates };
