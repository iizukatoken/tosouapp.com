/**
 * Chuẩn hóa role từ nhiều format (Tiếng Nhật, Tiếng Việt, English) về dạng chuẩn.
 * Dùng chung cho toàn hệ thống để đảm bảo nhất quán.
 *
 * Role hierarchy (cao → thấp):
 *   sysadmin → owner → admin → hr → manager → payroll → employee
 *
 * @param {string} input
 * @returns {string} one of: 'sysadmin'|'owner'|'admin'|'hr'|'manager'|'payroll'|'employee'
 */
function normalizeRole(input) {
  const r = String(input || '').trim().toLowerCase();
  // Exact matches first
  if (r === 'sysadmin') return 'sysadmin';
  if (r === 'owner') return 'owner';
  if (r === 'admin') return 'admin';
  if (r === 'hr') return 'hr';
  if (r === 'manager') return 'manager';
  if (r === 'payroll') return 'payroll';
  if (r === 'employee') return 'employee';
  // Aliases
  if (r === '管理者' || r === 'administrator' || r === 'quanly' || r === 'quản lý') return 'admin';
  if (r === 'マネージャー' || r === 'supervisor' || r === 'lead') return 'manager';
  if (r === '従業員' || r === 'nhanvien' || r === 'nhân viên' || r === 'staff') return 'employee';
  if (r === '取締役' || r === 'director' || r === 'ceo') return 'owner';
  return r || 'employee';
}

/**
 * Check if roleA has equal or higher privilege than roleB.
 * Useful for RBAC checks: canAccess('admin', 'manager') → true
 */
const ROLE_LEVEL = {
  sysadmin: 100,
  owner:    80,
  admin:    60,
  hr:       50,
  manager:  40,
  payroll:  30,
  employee: 10,
};

function roleLevel(role) {
  return ROLE_LEVEL[normalizeRole(role)] ?? 0;
}

function canAccess(actorRole, requiredRole) {
  return roleLevel(actorRole) >= roleLevel(requiredRole);
}

/**
 * Người có role actorRole có được gán role targetRole cho người khác không.
 * sysadmin (toàn nền tảng) chỉ sysadmin gán; owner chỉ sysadmin/owner gán —
 * admin của một công ty gán được 2 role này là xem được dữ liệu mọi công ty.
 * Role lạ (không có trong ROLE_LEVEL) luôn bị từ chối.
 */
function canAssignRole(actorRole, targetRole) {
  const target = normalizeRole(targetRole);
  if (!(target in ROLE_LEVEL)) return false;
  const actor = normalizeRole(actorRole);
  if (target === 'sysadmin') return actor === 'sysadmin';
  if (target === 'owner') return actor === 'sysadmin' || actor === 'owner';
  return true;
}

module.exports = { normalizeRole, roleLevel, canAccess, canAssignRole };
