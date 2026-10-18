const repo = require('./department.repository');
const { nowJSTMySQL } = require('../../utils/dateTime');
const historyService = require('./department.history.service');
const auditRepo = require('../audit/audit.repository');
const userRepo = require('../users/user.repository');

function _logAudit(req, action, beforeData, afterData) {
  auditRepo.writeLog({
    userId: req.user?.id,
    tenantId: req.tenantId || null,
    action,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    beforeData: beforeData != null ? JSON.stringify(beforeData) : null,
    afterData: afterData != null ? JSON.stringify(afterData) : null
  }).catch(() => { /* audit ログ失敗で本処理は止めない */ });
}

// Controller quản trị phòng ban
exports.list = async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || '') === '1';
    const rows = await repo.getAllDepartments(req.tenantId || null, { includeInactive });
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.create = async (req, res) => {
  try {
    const { name, code, corporationId } = req.body || {};
    if (!name) return res.status(400).json({ message: 'Missing name' });
    const id = await repo.createDepartment(name, code || null, req.tenantId || null, req.user?.id || null, corporationId || null);
    _logAudit(req, 'department_create', null, { id, name, code: code || null, corporationId: corporationId || null });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, code, corporationId } = req.body || {};
    if (!id || (!name && !code && !corporationId)) return res.status(400).json({ message: 'Missing id or fields' });
    const before = await repo.getDepartmentById(id, req.tenantId || null);
    await repo.updateDepartment(id, name || null, code || null, req.tenantId || null, req.user?.id || null, corporationId || null);
    _logAudit(req, 'department_update', before, { id, name: name || before?.name, code: code || before?.code, corporationId: corporationId || before?.corporation_id });
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
// 削除ではなく無効化 (異動履歴・監査ログが参照するIDを消さないため)
exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const before = await repo.getDepartmentById(id, req.tenantId || null);
    await repo.deactivateDepartment(id, req.tenantId || null);
    _logAudit(req, 'department_deactivate', before, { id, is_active: 0 });
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createBulk = async (req, res) => {
  try {
    const names = req.body?.names;
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ message: 'Missing names[]' });
    }
    const ids = await repo.createMany(names, req.tenantId || null);
    res.status(201).json({ ids });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 社員一覧 (指定日時点。省略時は今日) — legacy はこれをクライアント側フィルタでやっていた
exports.listDepartmentUsers = async (req, res) => {
  try {
    const id = req.params.id;
    const asOf = String(req.query.asOf || '').slice(0, 10) || nowJSTMySQL().slice(0, 10);
    const userIds = await historyService.getUsersInDepartmentAsOf(id, asOf, { tenantId: req.tenantId || null });
    res.status(200).json({ departmentId: Number(id), asOf, userIds });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ---- 異動 (assignments) ----
exports.listAssignments = async (req, res) => {
  try {
    const { userId, from, to } = req.query || {};
    if (userId) {
      const rows = await repo.listAssignmentsForUser(userId, req.tenantId || null);
      return res.status(200).json(rows);
    }
    const rows = await repo.listAssignmentsAll({ tenantId: req.tenantId || null, from, to });
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createAssignment = async (req, res) => {
  try {
    const { userId, departmentId, assignmentType, startDate, endDate, reason } = req.body || {};
    if (!userId || !departmentId || !startDate) {
      return res.status(400).json({ message: 'Missing userId/departmentId/startDate' });
    }
    const closed = await repo.isDateInClosedMonth(startDate, req.tenantId || null);
    if (closed) return res.status(409).json({ message: '締め済みの月には遡った異動を登録できません' });
    const id = await repo.createAssignment({
      userId, departmentId, assignmentType: assignmentType || 'regular', startDate, endDate: endDate || null,
      reason: reason || null, actorId: req.user?.id || null, tenantId: req.tenantId || null
    });
    _logAudit(req, 'department_assignment_create', null, { id, userId, departmentId, assignmentType, startDate, endDate, reason });
    res.status(201).json({ id });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

exports.updateAssignment = async (req, res) => {
  try {
    const id = req.params.id;
    const before = await repo.getAssignmentById(id, req.tenantId || null);
    if (!before) return res.status(404).json({ message: 'Not found' });
    const closedBefore = await repo.isDateInClosedMonth(before.start_date, req.tenantId || null);
    if (closedBefore) return res.status(409).json({ message: '締め済みの月に含まれる異動は編集できません' });
    const { departmentId, startDate, endDate, reason } = req.body || {};
    if (startDate) {
      const closedNew = await repo.isDateInClosedMonth(startDate, req.tenantId || null);
      if (closedNew) return res.status(409).json({ message: '締め済みの月には遡った異動を登録できません' });
    }
    await repo.updateAssignment(id, { departmentId, startDate, endDate, reason, actorId: req.user?.id || null, tenantId: req.tenantId || null });
    _logAudit(req, 'department_assignment_update', before, { id, departmentId, startDate, endDate, reason });
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteAssignment = async (req, res) => {
  try {
    const id = req.params.id;
    const before = await repo.getAssignmentById(id, req.tenantId || null);
    if (!before) return res.status(404).json({ message: 'Not found' });
    const closed = await repo.isDateInClosedMonth(before.start_date, req.tenantId || null);
    if (closed) return res.status(409).json({ message: '締め済みの月に含まれる異動は削除できません' });
    await repo.deleteAssignment(id, req.tenantId || null);
    _logAudit(req, 'department_assignment_delete', before, null);
    res.status(200).json({ id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ---- 月次締め ----
exports.getMonthLocks = async (req, res) => {
  try {
    const rows = await repo.getMonthLocks(req.tenantId || null);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.closeMonth = async (req, res) => {
  try {
    const { year, month } = req.body || {};
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!y || !m) return res.status(400).json({ message: 'Missing year/month' });
    await repo.closeMonth(y, m, req.user?.id || null, req.tenantId || null);
    _logAudit(req, 'department_month_close', null, { year: y, month: m });
    res.status(200).json({ year: y, month: m, status: 'closed' });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// システム管理者相当 (admin ロール) のみ。理由必須。指定月より後で締まっている月も連動して再オープンする。
exports.reopenMonth = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ message: 'Forbidden: admin only' });
    const { year, month, reason } = req.body || {};
    const y = parseInt(String(year), 10);
    const m = parseInt(String(month), 10);
    if (!y || !m) return res.status(400).json({ message: 'Missing year/month' });
    const reopened = await repo.reopenMonth(y, m, req.user?.id || null, reason, req.tenantId || null);
    for (const r of reopened) {
      _logAudit(req, 'department_month_reopen', null, { year: r.year, month: r.month, reason, triggeredFor: { year: y, month: m } });
    }
    res.status(200).json({ reopened });
  } catch (err) {
    res.status(Number(err?.status || 500)).json({ message: err.message });
  }
};

// 部署別集計: 当時 (指定月末時点の異動履歴) と 現在 (今のusers.departmentId) を突き合わせる
exports.getReport = async (req, res) => {
  try {
    const y = parseInt(String(req.query.year), 10);
    const m = parseInt(String(req.query.month), 10);
    if (!y || !m) return res.status(400).json({ message: 'Missing year/month' });
    const tenantId = req.tenantId || null;
    const pad = (n) => String(n).padStart(2, '0');
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const asOf = `${y}-${pad(m)}-${pad(lastDay)}`;

    const departments = await repo.getAllDepartments(tenantId, { includeInactive: true });
    const rows = [];
    for (const dept of departments) {
      const thenIds = await historyService.getUsersInDepartmentAsOf(dept.id, asOf, { tenantId });
      const nameThen = await historyService.getDepartmentNameAsOf(dept.id, asOf, { tenantId });
      rows.push({
        departmentId: dept.id,
        nameNow: dept.name,
        nameThen: nameThen.name,
        isActiveNow: !!dept.is_active,
        headcountThen: thenIds.length,
        headcountNow: null // đổ ở dưới
      });
    }
    // headcount hiện tại: đếm trực tiếp theo users.departmentId (đơn giản, không cần lịch sử)
    for (const row of rows) {
      const page = await userRepo.listUsersPaged({ departmentId: row.departmentId, limit: 1, tenantId }).catch(() => ({ total: 0 }));
      row.headcountNow = page.total || 0;
    }
    res.status(200).json({ year: y, month: m, asOf, departments: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
