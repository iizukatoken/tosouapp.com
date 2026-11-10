/**
 * Đăng nhập passkey (audit 2026-11-10): passkey phải thuộc đúng user của email,
 * user nghỉ việc / bị khoá không đăng nhập được, challenge chỉ dùng một lần.
 * Chữ ký WebAuthn được mock là hợp lệ — đúng tình huống kẻ tấn công ký bằng passkey của chính mình.
 */
'use strict';

jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: jest.fn(async () => ({ challenge: 'CHAL' })),
  verifyAuthenticationResponse: jest.fn(async () => ({ verified: true, authenticationInfo: { newCounter: 1 } })),
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));
jest.mock('../../src/modules/auth/auth.repository', () => ({
  findUserByEmail: jest.fn(),
  isLocked: jest.fn(),
}));
jest.mock('../../src/modules/webauthn/webauthn.repository', () => ({
  listUserPasskeys: jest.fn(async () => []),
  findByCredentialId: jest.fn(),
  updateCounter: jest.fn(),
}));
jest.mock('../../src/modules/auth/refresh.repository', () => ({ createToken: jest.fn() }));

const authRepo = require('../../src/modules/auth/auth.repository');
const passkeyRepo = require('../../src/modules/webauthn/webauthn.repository');
const ctrl = require('../../src/modules/webauthn/webauthn.controller');

const ADMIN = { id: 1, role: 'admin', email: 'boss@x', token_version: 1, employment_status: 'active' };

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  return res;
}
const mkReq = (body) => ({ body, headers: { host: 'localhost:3000' }, protocol: 'http', ip: '1.1.1.1' });
const assertion = { rawId: 'QUFB', id: 'QUFB', response: {}, type: 'public-key' };

async function login(email = 'boss@x') {
  await ctrl.loginOptions(mkReq({ email }), mockRes());
  const res = mockRes();
  await ctrl.loginVerify(mkReq({ email, response: assertion }), res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  authRepo.findUserByEmail.mockResolvedValue({ ...ADMIN });
  authRepo.isLocked.mockResolvedValue(false);
});

describe('Đăng nhập passkey', () => {
  it('passkey của user khác → 401, không cấp phiên', async () => {
    passkeyRepo.findByCredentialId.mockResolvedValue({ user_id: 77, credential_id: 'QUFB', public_key: 'QUFB', counter: 0 });
    const res = await login();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('passkey của chính mình → đăng nhập được', async () => {
    passkeyRepo.findByCredentialId.mockResolvedValue({ user_id: 1, credential_id: 'QUFB', public_key: 'QUFB', counter: 0 });
    const res = await login();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ id: 1 });
  });

  it('nhân viên đã nghỉ việc → 403', async () => {
    authRepo.findUserByEmail.mockResolvedValue({ ...ADMIN, employment_status: 'inactive' });
    passkeyRepo.findByCredentialId.mockResolvedValue({ user_id: 1, credential_id: 'QUFB', public_key: 'QUFB', counter: 0 });
    const res = await login();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('tài khoản đang bị khoá → 423', async () => {
    authRepo.isLocked.mockResolvedValue(true);
    passkeyRepo.findByCredentialId.mockResolvedValue({ user_id: 1, credential_id: 'QUFB', public_key: 'QUFB', counter: 0 });
    const res = await login();
    expect(res.status).toHaveBeenCalledWith(423);
  });

  it('challenge không dùng lại được sau một lần thử thất bại', async () => {
    passkeyRepo.findByCredentialId.mockResolvedValue({ user_id: 77, credential_id: 'QUFB', public_key: 'QUFB', counter: 0 });
    await login();
    const res = mockRes();
    await ctrl.loginVerify(mkReq({ email: 'boss@x', response: assertion }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
