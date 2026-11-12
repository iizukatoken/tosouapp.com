/**
 * @module attendance.checkin.controller
 * Các handler: checkIn, checkOut, recordGoOut, recordReturn, setWorkType
 */
'use strict';

const service = require('./attendance.service');
const auditRepo = require('../audit/audit.repository');
const repo = require('./attendance.repository');
const { formatInputToMySQLJST } = require('../../utils/dateTime');
const userRepo = require('../users/user.repository');
const noticesRepo = require('../notices/notices.repository');
const shiftReminderService = require('../../services/shiftReminder.service');
const log = require('../../core/logger');
const { getMonthStatusValue } = require('./attendance.utils');
const summaryRepo = require('./attendance.summary.repository');
const workReportsRepo = require('../workReports/workReports.repository');

// API: Nhân viên ấn nút Check-in (Đi làm)
exports.checkIn = async (req, res) => {
  try {
    // Nhân viên chỉ được check-in cho chính mình; admin/manager mới override được qua body
    const role = String(req.user?.role || '').toLowerCase();
    const canOverride = role === 'admin' || role === 'manager';
    const userId = (canOverride && req.body.userId) ? req.body.userId : req.user?.id;
    if (!userId) {
      return res.status(400).json({ message: 'Missing userId' });
    }
    const b = req.body || {};
    // 打刻時刻はサーバーの現在時刻。従業員が時刻を送ってきても受け付けない（画面の打刻ボタンは時刻を送らない）
    if (!canOverride && b.time != null && b.time !== '') {
      return res.status(400).json({ message: '打刻時刻は指定できません' });
    }

    const wt = String(b?.workType || b?.work_type || '').trim();
    const workType = wt === 'onsite' || wt === 'remote' || wt === 'satellite' ? wt : null;
    const loc = {
      latitude: b?.latitude,
      longitude: b?.longitude,
      accuracy: b?.accuracy,
      locationSource: b?.locationSource,
      countryCode: b?.countryCode,
      note: b?.note,
      deviceId: b?.deviceId,
      tzOffset: b?.tzOffset
    };
    const result = await service.checkIn(userId, b?.time, loc, workType, req.tenantId || null);
    if (!result) {
      return res.status(409).json({ message: 'Already checked in' });
    }

    // Tự động đặt kubun trong attendance_daily thành '出勤' khi check-in
    try {
      const dtStr = String(result?.checkIn || b?.time || '').slice(0, 10) || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const dailyRec = await repo.getDaily(userId, dtStr, { tenantId: req.tenantId || null });
      const dailies = dailyRec ? [dailyRec] : [];
      if (!dailies.length || !dailies[0].kubun || dailies[0].kubun !== '出勤') {
        await repo.upsertDaily(userId, dtStr, { kubun: '出勤' }, { tenantId: req.tenantId || null });
      }
    } catch (err) {
      log.warn('auto_set_kubun_failed', { userId, error_message: err.message });
    }

    // 出勤打刻と同時に、内容は空の作業報告を1件自動生成しておく（開始時刻だけ反映）。
    // 現場・作業内容は本人が後から入力するもので、システム側で埋められないため空のまま。
    try {
      const dtStr = String(result?.checkIn || b?.time || '').slice(0, 10) || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const startTime = String(result?.checkIn || '').slice(11, 19) || null;
      // 同じ日に複数回出勤打刻すると重複行が量産されるバグがあったため、
      // その日に既に作業報告がある場合は新規作成しない（2回目以降の出勤は既存行を使う）。
      const existingReports = await workReportsRepo.listByUserDate(userId, dtStr);
      if (!existingReports.length) {
        await workReportsRepo.create({
          userId, date: dtStr, startTime, endTime: null, workType,
          site: '', work: '', status: 'pending', attendanceId: result?.id || null
        });
      }
    } catch (err) {
      log.warn('auto_create_work_report_failed', { userId, error_message: err.message });
    }

    try {
      await auditRepo.writeLog({
        userId,
        action: 'checkin',
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        beforeData: null,
        afterData: JSON.stringify({ ...loc, workType, result })
      });
    } catch (e) { log.warn('audit_write_failed', { action: 'checkin', userId, error_message: e.message }); }
    try {
      const dtStr = String(result?.checkIn || b?.time || '').slice(0, 10) || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const y = parseInt(dtStr.slice(0, 4), 10);
      const m = parseInt(dtStr.slice(5, 7), 10);
      const st = await getMonthStatusValue(userId, y, m);
      if (st !== 'approved') await repo.setMonthStatus(userId, y, m, 'submitted', req.user?.id, { tenantId: req.tenantId || null });
      await summaryRepo.markDirty(userId, y, m, req.tenantId || null);
    } catch (e) { log.warn('month_status_update_failed', { userId, error_message: e.message }); }
    try {
      const u = await userRepo.getUserById(userId);
      const name = u ? (u.username || u.email || '従業員') : '従業員';
      const timeStr = String(result?.checkIn || '').slice(11, 16);
      await noticesRepo.createAdminNotification({
        kind: 'attendance_punch',
        title: '打刻通知',
        message: `${name}さんが出勤打刻をしました（${timeStr}）`,
        linkUrl: '/admin/attendance',
        createdBy: userId,
        audience: 'admin_manager'
      });
    } catch (e) {
      log.warn('notify_admin_checkin_failed', { userId, error_message: e.message });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Nhân viên ấn nút Check-out (Tan làm)
exports.checkOut = async (req, res) => {
  try {
    // Nhân viên chỉ được check-out cho chính mình; admin/manager mới override được qua body
    const role = String(req.user?.role || '').toLowerCase();
    const canOverride = role === 'admin' || role === 'manager';
    const userId = (canOverride && req.body.userId) ? req.body.userId : req.user?.id;
    if (!userId) {
      return res.status(400).json({ message: 'Missing userId' });
    }
    const b = req.body || {};
    // 打刻時刻はサーバーの現在時刻。従業員が時刻を送ってきても受け付けない
    if (!canOverride && b.time != null && b.time !== '') {
      return res.status(400).json({ message: '打刻時刻は指定できません' });
    }
    const loc = {
      latitude: b?.latitude,
      longitude: b?.longitude,
      accuracy: b?.accuracy,
      locationSource: b?.locationSource,
      countryCode: b?.countryCode,
      note: b?.note,
      deviceId: b?.deviceId,
      tzOffset: b?.tzOffset
    };
    const result = await service.checkOut(userId, b?.time, loc, req.tenantId || null);
    if (!result) {
      return res.status(404).json({ message: 'No open attendance' });
    }

    // check-in時に自動生成した作業報告(内容は空のまま)の終了時刻を反映する。
    try {
      const endTime = String(result?.checkOut || '').slice(11, 19) || null;
      if (result?.id) await workReportsRepo.setEndTimeByAttendanceId(result.id, endTime);
    } catch (err) {
      log.warn('auto_close_work_report_failed', { userId, error_message: err.message });
    }

    try {
      await auditRepo.writeLog({
        userId,
        action: 'checkout',
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        beforeData: null,
        afterData: JSON.stringify({ ...loc, result })
      });
    } catch (e) { log.warn('audit_write_failed', { action: 'checkout', userId, error_message: e.message }); }
    try {
      const dtStr = String(result?.checkOut || result?.checkIn || b?.time || '').slice(0, 10) || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const y = parseInt(dtStr.slice(0, 4), 10);
      const m = parseInt(dtStr.slice(5, 7), 10);
      const st = await getMonthStatusValue(userId, y, m);
      if (st !== 'approved') await repo.setMonthStatus(userId, y, m, 'submitted', req.user?.id, { tenantId: req.tenantId || null });
      await summaryRepo.markDirty(userId, y, m, req.tenantId || null);
    } catch (e) { log.warn('month_status_update_failed', { userId, error_message: e.message }); }
    try {
      const u = await userRepo.getUserById(userId);
      const name = u ? (u.username || u.email || '従業員') : '従業員';
      const timeStr = String(result?.checkOut || '').slice(11, 16);
      await noticesRepo.createAdminNotification({
        kind: 'attendance_punch',
        title: '打刻通知',
        message: `${name}さんが退勤打刻をしました（${timeStr}）`,
        linkUrl: '/admin/attendance',
        createdBy: userId,
        audience: 'admin_manager'
      });

      // Tính tổng giờ làm và gửi email tổng kết trong ngày
      if (u && u.email && result?.checkIn && result?.checkOut) {
        const inDate = new Date(result.checkIn);
        const outDate = new Date(result.checkOut);
        const dtStr2 = String(result.checkOut).slice(0, 10);
        let breakMin = 60;
        try {
          const dailyRec = await repo.getDaily(userId, dtStr2, { tenantId: req.tenantId || null });
          const dailies = dailyRec ? [dailyRec] : [];
          if (dailies.length > 0) {
            breakMin = Number(dailies[0].break_minutes || 0) + Number(dailies[0].night_break_minutes || 0);
          }
        } catch (e) { /* tra giờ nghỉ không bắt buộc, bỏ qua lỗi */ }

        const diffMs = outDate - inDate;
        let totalMinutes = Math.floor(diffMs / 60000) - breakMin;
        if (totalMinutes < 0) totalMinutes = 0;
        const totalHoursStr = `${Math.floor(totalMinutes / 60)}時間${String(totalMinutes % 60).padStart(2, '0')}分`;

        // shiftReminderService.sendDailySummaryEmail(u, dtStr2, result.checkIn, result.checkOut, totalHoursStr).catch(e => log.warn('daily_summary_email_failed', { userId, error_message: e.message }));
      }
    } catch (e) {
      log.warn('notify_admin_checkout_failed', { userId, error_message: e.message });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Nhân viên ấn nút Ra ngoài (外出)
exports.recordGoOut = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const canOverride = role === 'admin' || role === 'manager';
    const userId = (canOverride && req.body.userId) ? req.body.userId : req.user?.id;
    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    const { time, type, reason } = req.body || {};
    if (!type) return res.status(400).json({ message: 'Missing type (業務 or 私用)' });
    const tid = req.tenantId || null;

    const ts = time ? formatInputToMySQLJST(time) : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const dateStr = ts.slice(0, 10);

    const insertId = await repo.recordGoOut(userId, dateStr, ts, type, reason, { tenantId: tid });
    res.status(201).json({ id: insertId, userId, date: dateStr, go_out_time: ts, type, reason });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Nhân viên ấn nút Quay lại (戻り)
exports.recordReturn = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const canOverride = role === 'admin' || role === 'manager';
    const userId = (canOverride && req.body.userId) ? req.body.userId : req.user?.id;
    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    const { time } = req.body || {};
    const tid = req.tenantId || null;

    const ts = time ? formatInputToMySQLJST(time) : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const dateStr = ts.slice(0, 10);

    const affected = await repo.recordReturn(userId, dateStr, ts, { tenantId: tid });
    if (affected === 0) {
      return res.status(404).json({ message: 'No open go-out record found' });
    }
    res.status(200).json({ ok: true, return_time: ts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// API: Đổi loại hình công việc (onsite, remote, satellite)
exports.setWorkType = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const b = req.body || {};
    const date = String(b.date || '').slice(0, 10) || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const wt = String(b?.workType || b?.work_type || '').trim();
    const workType = wt === 'onsite' || wt === 'remote' || wt === 'satellite' ? wt : null;
    const r = await repo.setWorkTypeForUserDate(userId, date, workType, { tenantId: req.tenantId || null });
    res.status(200).json({ date, workType, updated: Number(r?.updated || 0) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
