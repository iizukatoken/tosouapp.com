'use strict';

const repo = require('./attendance.repository');
const { reportSwallowed } = require('../../core/errorReporter');
const auditRepo = require('../audit/audit.repository');
const userRepo = require('../users/user.repository');
const salaryInputRepo = require('../salary/salaryInput.repository');
const { calculatePaidLeaveEntitlement } = require('../../utils/leaveRules');
const { resolveEmploymentStartDate } = require('../../utils/employmentDate');
const db = require('../../core/database/mysql');
const log = require('../../core/logger');
const {
  syncPaidLeaveByKubun,
  resolveTargetUserId,
  isEditableMonth,
  assertMonthWritable,
} = require('./attendance.utils');
const summaryRepo = require('./attendance.summary.repository');

// ─── Work details CRUD ────────────────────────────────────────────────────────

exports.getWorkDetails = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(404).json({ message: 'User not found' });
    const from = String(req.query?.from || '').slice(0, 10);
    const to = String(req.query?.to || '').slice(0, 10);
    const rows = await repo.listWorkDetailsBetween(userId, from || '1900-01-01', to || '2999-12-31', { tenantId: req.tenantId || null });
    const items = (rows || []).map(r => ({
      id: r.id, startDate: String(r.start_date || '').slice(0, 10) || null, endDate: r.end_date ? String(r.end_date).slice(0, 10) : null,
      companyName: r.company_name || null, workPlaceAddress: r.work_place_address || null, workContent: r.work_content || null,
      roleTitle: r.role_title || null, responsibilityLevel: r.responsibility_level || null
    }));
    res.status(200).json({ userId, items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.postWorkDetail = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(404).json({ message: 'User not found' });
    const id = await repo.createWorkDetail(userId, req.body || {}, { tenantId: req.tenantId || null });
    if (!id) return res.status(400).json({ message: 'Invalid payload' });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.putWorkDetail = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(404).json({ message: 'User not found' });
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const r = await repo.updateWorkDetail(id, userId, req.body || {}, { tenantId: req.tenantId || null });
    if (!r?.ok) return res.status(404).json({ message: 'Not found' });
    res.status(200).json({ id, updated: r.updated || 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteWorkDetail = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'manager') return res.status(403).json({ message: 'Forbidden' });
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    if (!userId) return res.status(404).json({ message: 'User not found' });
    const id = parseInt(String(req.params.id), 10);
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const r = await repo.deleteWorkDetail(id, userId, { tenantId: req.tenantId || null });
    res.status(200).json({ id, deleted: r.deleted || 0 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Month bulk update ────────────────────────────────────────────────────────

exports.putMonthBulk = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { year, month, updates, dailyUpdates } = req.body || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month || !Array.isArray(updates)) return res.status(400).json({ message: 'Missing fields' });
    const y = parseInt(year, 10), m = parseInt(month, 10);
    await assertMonthWritable(req, userId, y, m);

    // Chụp lại trạng thái trước khi sửa để ghi audit
    let beforeSnap = null;
    try {
      const pad = n => String(n).padStart(2, '0');
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const from = `${y}-${pad(m)}-01`;
      const to = `${y}-${pad(m)}-${pad(lastDay)}`;
      const [rows] = await db.query(
        'SELECT id, checkIn, checkOut, work_type FROM attendance WHERE userId = ? AND (DATE(checkIn) BETWEEN ? AND ? OR (checkIn IS NULL AND DATE(checkOut) BETWEEN ? AND ?))',
        [userId, from, to, from, to]
      );
      const [dailyRows] = await db.query(
        'SELECT date, kubun, break_minutes, work_type, location, memo, notes FROM attendance_daily WHERE userId = ? AND date BETWEEN ? AND ?',
        [userId, from, to]
      );
      beforeSnap = { attendance: rows || [], daily: dailyRows || [] };
    } catch (e) { /* bỏ qua lỗi */ }

    if (req.user.role === 'employee' && !isEditableMonth(y, m)) {
      return res.status(403).json({ message: 'Forbidden: cannot edit past months' });
    }

    if (req.user.role === 'employee' && Array.isArray(dailyUpdates)) {
      for (const d of dailyUpdates) {
        if (d.kubun === '' || d.kubun === null) {
          const date = String(d.date || '').slice(0, 10);
          const hasActualInBody = Array.isArray(updates) && updates.some(u => {
            const uDate = String(u.checkIn || u.checkOut || '').slice(0, 10);
            return uDate === date && (u.checkIn || u.checkOut) && u.delete !== true;
          });
          if (hasActualInBody) {
            return res.status(400).json({ message: 'Cannot set classification to Planned when attendance times are provided' });
          }
        }
      }
    }

    const normalizedUpdates = Array.isArray(updates) ? updates.map(u => ({ ...(u || {}) })) : [];
    const normalizedDailyUpdates = Array.isArray(dailyUpdates) ? dailyUpdates : dailyUpdates;

    // Khử trùng lặp trong cùng request theo (userId, checkIn)
    try {
      const seen = new Map();
      for (let i = 0; i < normalizedUpdates.length; i++) {
        const u = normalizedUpdates[i];
        const key = (!u?.id && u?.checkIn) ? String(u.checkIn) : null;
        if (!key) continue;
        if (seen.has(key)) normalizedUpdates[seen.get(key)] = null;
        seen.set(key, i);
      }
    } catch (e) { /* bỏ qua lỗi */ }

    // Chuẩn hóa: nếu segment đã tồn tại (cùng checkIn) thì chuyển "create" thành "update"
    try {
      const timesToLookup = [];
      const lookupIndices = [];
      for (let i = 0; i < normalizedUpdates.length; i++) {
        const u = normalizedUpdates[i];
        if (!u || u.delete === true || u.id) continue;
        const inV = String(u.checkIn || '').trim();
        if (!inV) continue;
        timesToLookup.push(inV);
        lookupIndices.push(i);
      }
      if (timesToLookup.length) {
        const existingMap = await repo.findCheckInsByTimes(userId, timesToLookup, { tenantId: req.tenantId || null }).catch(() => new Map());
        for (let j = 0; j < timesToLookup.length; j++) {
          const existing = existingMap.get(timesToLookup[j]);
          if (existing?.id) {
            normalizedUpdates[lookupIndices[j]].id = Number(existing.id);
            delete normalizedUpdates[lookupIndices[j]].clientId;
          }
        }
      }
    } catch (e) { reportSwallowed('attendance.bulk.findExistingCheckIns', e); }

    const cleanedUpdates = normalizedUpdates.filter(Boolean);

    let result = null;
    try {
      result = await repo.bulkUpsertAttendance(userId, { updates: cleanedUpdates, dailyUpdates: normalizedDailyUpdates }, { tenantId: req.tenantId || null });
    } catch (err) {
      if (String(err?.code || '') === 'ER_DUP_ENTRY') {
        try {
          const timesToLookup = [];
          const lookupItems = [];
          for (const u of cleanedUpdates) {
            if (u?.id || u?.delete === true) continue;
            const inV = String(u.checkIn || '').trim();
            if (!inV) continue;
            timesToLookup.push(inV);
            lookupItems.push(u);
          }
          if (timesToLookup.length) {
            const existingMap = await repo.findCheckInsByTimes(userId, timesToLookup, { tenantId: req.tenantId || null }).catch(() => new Map());
            for (let j = 0; j < timesToLookup.length; j++) {
              const existing = existingMap.get(timesToLookup[j]);
              if (existing?.id) {
                lookupItems[j].id = Number(existing.id);
                delete lookupItems[j].clientId;
              }
            }
          }
        } catch (e) { reportSwallowed('attendance.bulk.findExistingCheckIns.retry', e); }
        result = await repo.bulkUpsertAttendance(userId, { updates: cleanedUpdates, dailyUpdates: normalizedDailyUpdates }, { tenantId: req.tenantId || null });
      } else {
        throw err;
      }
    }

    try {
      await auditRepo.writeLog({ userId: req.user?.id, action: 'attendance_month_bulk', path: req.path, method: req.method, ip: req.ip, userAgent: req.headers['user-agent'], beforeData: JSON.stringify(beforeSnap || null), afterData: JSON.stringify({ targetUserId: userId, year: y, month: m, saved: result.saved }) });
    } catch (e) { /* bỏ qua lỗi */ }

    try {
      const dailyList = Array.isArray(normalizedDailyUpdates) ? normalizedDailyUpdates : [];
      const latestByDate = new Map();
      for (const d of dailyList) {
        const ds = String(d?.date || '').slice(0, 10);
        const kubun = String(d?.kubun || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
        latestByDate.set(ds, kubun);
      }
      for (const [ds, kubun] of latestByDate.entries()) {
        await syncPaidLeaveByKubun(userId, ds, kubun, 'from_attendance', req.tenantId || null);
      }
    } catch (e) { reportSwallowed('attendance.bulk.syncPaidLeaveByKubun', e); }

    // 勤怠データが変わったので、この月の36協定サマリーは再計算が必要 (次のバッチが拾う)
    try { await summaryRepo.markDirty(userId, y, m, req.tenantId || null); } catch (e) { /* bỏ qua lỗi */ }

    res.status(200).json(result);
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// API: Đồng bộ dữ liệu chấm công sang hệ thống tính lương
exports.syncSalary = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { year, month } = req.body || {};
    if (!userId) return res.status(404).json({ message: 'User not found' });
    if (!year || !month) return res.status(400).json({ message: 'Missing year/month' });

    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const dailyRows = await repo.listDailyBetween(userId, from, to, { tenantId: req.tenantId || null }).catch(() => []);
    const attendanceRows = await repo.listByUserBetween(userId, from, to, { tenantId: req.tenantId || null }).catch(() => []);

    const workKubunSet = new Set(['出勤', '半休', '半休(有給)', '振替出勤', '休日出勤', '代替出勤']);
    const workDaysSet = new Set();
    let paidLeaveDays = 0;

    for (const r of dailyRows) {
      const date = String(r.date || '').slice(0, 10);
      const kubun = String(r.kubun || '').trim();
      if (workKubunSet.has(kubun)) workDaysSet.add(date);
      if (kubun === '有給休暇') paidLeaveDays++;
      if (kubun === '半休(有給)') paidLeaveDays += 0.5;
    }
    for (const r of attendanceRows) {
      const date = String(r.checkIn || r.checkOut || '').slice(0, 10);
      if (date) workDaysSet.add(date);
    }

    const workDays = workDaysSet.size;
    const user = await userRepo.getUserById(userId);
    const paidLeaveEntitlement = calculatePaidLeaveEntitlement(resolveEmploymentStartDate(user));

    const existingInput = await salaryInputRepo.getByUserMonth(userId, ym);
    const payload = existingInput?.payload || {};
    payload.kintai = payload.kintai || {};
    payload.kintai['出勤日数'] = workDays;
    payload.kintai['有給休暇'] = paidLeaveDays;
    payload.kintai['有給休暇付与'] = paidLeaveEntitlement;

    await salaryInputRepo.upsert({ userId, month: ym, payload, updatedBy: req.user?.id });
    res.status(200).json({ ok: true, workDays, paidLeaveDays, paidLeaveEntitlement });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.putPlan = async (req, res) => {
  try {
    const userId = await resolveTargetUserId(req);
    if (userId === '__forbidden__') return res.status(403).json({ message: 'Forbidden' });
    const { date, plan } = req.body || {};
    if (!userId || !date) return res.status(400).json({ message: 'Missing userId/date' });
    const result = await repo.upsertPlan(userId, date, plan, { tenantId: req.tenantId || null });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
