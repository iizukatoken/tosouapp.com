'use strict';
// Các trường nhân viên được tự yêu cầu đổi qua 申請 hồ sơ (chỉ thông tin cá nhân).
// role / lương / phòng ban / quản lý / hợp đồng chỉ admin sửa trực tiếp ở màn hình nhân viên —
// nếu cho vào đây, nhân viên (hoặc manager tự duyệt) sẽ tự nâng quyền / tự đổi lương được.
// Dùng chung cho lúc tạo yêu cầu và lúc duyệt (yêu cầu cũ còn pending có thể chứa trường khác).
const PROFILE_CHANGE_FIELDS = ['username', 'email', 'birthDate', 'gender', 'phone', 'avatarUrl', 'address'];

function pickProfileChangeFields(obj) {
  const out = {};
  for (const k of PROFILE_CHANGE_FIELDS) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v;
  }
  return out;
}

module.exports = { PROFILE_CHANGE_FIELDS, pickProfileChangeFields };
