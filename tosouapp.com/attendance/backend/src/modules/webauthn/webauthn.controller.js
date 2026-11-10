const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const authRepository = require('../auth/auth.repository');
const passkeyRepo = require('./webauthn.repository');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const refreshRepo = require('../auth/refresh.repository');
const { jwtSecretCurrent, accessTokenExpires, refreshTokenExpiresDays } = require('../../config/env');

const challengeStore = new Map();

function originFromReq(req) {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = xfProto.includes('https') || req.protocol === 'https';
  const host = String(req.headers.host || '');
  const proto = isHttps ? 'https' : 'http';
  return `${proto}://${host}`;
}

function rpIdFromReq(req) {
  const host = String(req.headers.host || '').split(':')[0];
  return host || 'localhost';
}

function setSessionCookie(req, res, token) {
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = xfProto.includes('https') || req.protocol === 'https';
  res.cookie('session_token', token, { httpOnly: true, secure: isHttps, sameSite: 'lax', path: '/' });
}

exports.registerOptions = async (req, res) => {
  const email = String((req.body || {}).email || '').trim();
  if (!email) return res.status(400).json({ message: 'Missing email' });
  if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' });
  if (String(req.user.email || '').toLowerCase() !== String(email).toLowerCase()) {
    return res.status(403).json({ message: 'Forbidden: email mismatch' });
  }
  const user = await authRepository.findUserByEmail(email);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const existing = await passkeyRepo.listUserPasskeys(user.id);
  const rpId = rpIdFromReq(req);
  const options = await generateRegistrationOptions({
    rpName: process.env.COMPANY_NAME || 'Attendance',
    rpID: rpId,
    userID: new Uint8Array(Buffer.from(String(user.id))),
    userName: user.email,
    excludeCredentials: existing.map(p => ({ id: Buffer.from(p.credential_id, 'base64url'), type: 'public-key' })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }
  });
  challengeStore.set(`reg:${email}`, options.challenge);
  res.status(200).json(options);
};

exports.registerVerify = async (req, res) => {
  try {
  const email = String((req.body || {}).email || '').trim();
  const attResp = (req.body || {}).response;
  if (!email || !attResp) return res.status(400).json({ message: 'Missing email/response' });
  if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized' });
  if (String(req.user.email || '').toLowerCase() !== String(email).toLowerCase()) {
    return res.status(403).json({ message: 'Forbidden: email mismatch' });
  }
  const expectedChallenge = challengeStore.get(`reg:${email}`);
  if (!expectedChallenge) return res.status(400).json({ message: 'Challenge missing or expired. Please try again.' });
  const rpId = rpIdFromReq(req);
  const origin = originFromReq(req);
  console.log('[WebAuthn] Verify attempt:', { email, rpId, origin, hasChallenge: !!expectedChallenge });
  const verification = await verifyRegistrationResponse({
    response: attResp,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: false
  });
  if (!verification.verified) return res.status(401).json({ message: 'Verification failed' });
  const { registrationInfo } = verification;
  const user = await authRepository.findUserByEmail(email);
  const credId = registrationInfo.credential?.id || registrationInfo.credentialID;
  const pubKey = registrationInfo.credential?.publicKey || registrationInfo.credentialPublicKey;
  const counter = registrationInfo.credential?.counter ?? registrationInfo.counter ?? 0;
  await passkeyRepo.createPasskey({
    userId: user.id,
    credentialId: typeof credId === 'string' ? credId : Buffer.from(credId).toString('base64url'),
    publicKey: typeof pubKey === 'string' ? pubKey : Buffer.from(pubKey).toString('base64url'),
    counter: counter,
    transports: Array.isArray(attResp.response?.transports) ? attResp.response.transports.join(',') : null,
    aaguid: registrationInfo.aaguid || registrationInfo.credential?.aaguid || null
  });
  challengeStore.delete(`reg:${email}`);
  res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[WebAuthn registerVerify ERROR]', e.message, e.stack?.slice(0, 500));
    res.status(500).json({ message: e.message || 'Internal Server Error', detail: String(e.stack || '').slice(0, 200) });
  }
};

exports.loginOptions = async (req, res) => {
  const email = String((req.body || {}).email || '').trim();
  if (!email) return res.status(400).json({ message: 'Missing email' });
  const user = await authRepository.findUserByEmail(email);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const passkeys = await passkeyRepo.listUserPasskeys(user.id);
  const rpId = rpIdFromReq(req);
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'preferred',
    allowCredentials: passkeys.map(p => ({ id: Buffer.from(p.credential_id, 'base64url'), type: 'public-key' }))
  });
  challengeStore.set(`auth:${email}`, options.challenge);
  res.status(200).json(options);
};

exports.loginVerify = async (req, res) => {
  const email = String((req.body || {}).email || '').trim();
  const authResp = (req.body || {}).response;
  if (!email || !authResp) return res.status(400).json({ message: 'Missing email/response' });
  const expectedChallenge = challengeStore.get(`auth:${email}`);
  if (!expectedChallenge) return res.status(400).json({ message: 'Challenge missing' });
  // Challenge chỉ dùng một lần, kể cả khi xác thực thất bại.
  challengeStore.delete(`auth:${email}`);
  const rpId = rpIdFromReq(req);
  const origin = originFromReq(req);
  const credIdBuf = Buffer.from(String(authResp.rawId || ''), 'base64url');
  const stored = await passkeyRepo.findByCredentialId(Buffer.from(credIdBuf).toString('base64url'));
  if (!stored) return res.status(401).json({ message: 'Unknown credential' });
  // Passkey phải thuộc đúng người có email này — nếu không, ai có passkey của mình
  // cũng đăng nhập được vào tài khoản người khác chỉ bằng cách đổi email.
  const user = await authRepository.findUserByEmail(email);
  if (!user || String(stored.user_id) !== String(user.id)) {
    return res.status(401).json({ message: 'Verification failed' });
  }
  if (String(user.employment_status || 'active') !== 'active') {
    return res.status(403).json({ message: 'Account inactive' });
  }
  if (await authRepository.isLocked(user.id)) {
    return res.status(423).json({ message: 'Account locked. Try later.' });
  }
  const verification = await verifyAuthenticationResponse({
    response: authResp,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    authenticator: {
      credentialID: Buffer.from(stored.credential_id, 'base64url'),
      credentialPublicKey: Buffer.from(stored.public_key, 'base64url'),
      counter: Number(stored.counter || 0)
    }
  });
  if (!verification.verified) return res.status(401).json({ message: 'Verification failed' });
  if (verification.authenticationInfo) {
    await passkeyRepo.updateCounter(stored.credential_id, verification.authenticationInfo.newCounter || stored.counter || 0);
  }
  const role = user.role || 'employee';
  const tokenVersion = user.token_version || 1;
  const token = jwt.sign({ id: user.id, role, v: tokenVersion }, jwtSecretCurrent, { expiresIn: accessTokenExpires });
  const rt = crypto.randomBytes(48).toString('base64url');
  const expires = new Date(Date.now() + refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
  await refreshRepo.createToken({ userId: user.id, token: rt, expiresAt: expires.toISOString().slice(0,19).replace('T',' '), userAgent: req.headers['user-agent'], ip: req.ip });
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = xfProto.includes('https') || req.protocol === 'https';
  res.cookie('refreshToken', rt, { httpOnly: true, secure: isHttps, sameSite: 'lax', maxAge: refreshTokenExpiresDays * 24 * 60 * 60 * 1000, path: '/api/auth' });
  const csrf = crypto.randomBytes(24).toString('hex');
  res.cookie('csrfToken', csrf, { httpOnly: false, secure: isHttps, sameSite: 'lax', maxAge: refreshTokenExpiresDays * 24 * 60 * 60 * 1000, path: '/' });
  setSessionCookie(req, res, token);
  challengeStore.delete(`auth:${email}`);
  res.status(200).json({ id: user.id, username: user.username, email: user.email, role, accessToken: token });
};
