// 관리자 계정 관리 로직 (최고관리자 전용 함수에서 사용).
// Firebase Auth의 custom claim으로 권한을 구분합니다.
//   admin: true         → 관리자 화면의 모든 업무 (일반관리자·최고관리자 공통)
//   superAdmin: true    → 위 권한 + 관리자 추가/해제/비밀번호 초기화 (최고관리자)
//   pendingAdmin: true  → 임시 비밀번호를 받았지만 아직 새 비밀번호로 바꾸지 않은 계정.
//                         admin 권한이 '없는' 상태이므로 관리자 업무는 서버에서 모두 거절됩니다.
//   tempUntil: <ms>     → 임시 비밀번호 유효기간(15일) 끝나는 시각
// auth / store를 인자로 받아서, 실제 Firebase 없이도 테스트할 수 있게 했습니다.
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { HttpsError } from 'firebase-functions/v2/https';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const TEMP_PASSWORD_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'; // 헷갈리는 I, O, l, o 제외
const DIGITS = '23456789'; // 헷갈리는 0, 1 제외

export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

// 무작위 임시 비밀번호 (영문+숫자, 기본 10자). 암호학적으로 안전한 난수를 씁니다.
export function generateTempPassword(length = 10) {
  const pool = LETTERS + DIGITS;
  const chars = [LETTERS[randomInt(LETTERS.length)], DIGITS[randomInt(DIGITS.length)]];
  while (chars.length < length) chars.push(pool[randomInt(pool.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// 새 비밀번호 규칙: 8자 이상, 영문과 숫자를 모두 포함
export function validatePasswordPolicy(pw) {
  const ok =
    typeof pw === 'string' && pw.length >= 8 && pw.length <= 64 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  if (!ok) throw new HttpsError('invalid-argument', '새 비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.');
}

// 호출자가 최고관리자인지 확인합니다. (request.auth.token 기준)
export function assertSuperAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const token = request.auth.token || {};
  if (token.admin !== true || token.superAdmin !== true) {
    throw new HttpsError('permission-denied', '최고관리자만 사용할 수 있습니다.');
  }
}

// 관리자 계정 목록 (최고관리자 먼저, 그다음 이메일순). 임시 비밀번호 상태의 계정도 포함합니다.
//   status: 'temp'    → 임시 비밀번호를 받고 아직 변경 전
//           'invited' → 구글 로그인용으로 추가했고 아직 한 번도 로그인하지 않음
//           'active'  → 사용 중
export async function listAdminUsers(auth) {
  const admins = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const claims = u.customClaims || {};
      const isAdmin = claims.admin === true;
      const isPending = claims.pendingAdmin === true;
      if (!isAdmin && !isPending) continue;
      let status = 'active';
      if (isPending) status = 'temp';
      else if ((u.providerData || []).length === 0) status = 'invited';
      admins.push({
        uid: u.uid,
        email: u.email || '',
        role: claims.superAdmin === true ? 'super' : 'admin',
        status,
        tempUntil: isPending && Number.isFinite(claims.tempUntil) ? claims.tempUntil : null,
        createdAt: u.metadata?.creationTime || null,
        lastSignInAt: u.metadata?.lastSignInTime || null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  admins.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'super' ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
  return admins;
}

// 계정에 임시 비밀번호를 걸고 '변경 전' 상태(관리자 권한 없음)로 만듭니다.
async function issueTempPassword(auth, store, uid, existingClaims, now) {
  const tempPassword = generateTempPassword();
  const tempUntil = now + TEMP_PASSWORD_DAYS * DAY_MS;
  await auth.updateUser(uid, { password: tempPassword });
  // admin 권한은 빼고 pendingAdmin만 둡니다. (새 비밀번호로 바꾸기 전에는 어떤 관리자 업무도 할 수 없음)
  const { admin: _a, superAdmin: _s, pendingAdmin: _p, tempUntil: _t, ...rest } = existingClaims || {};
  await auth.setCustomUserClaims(uid, { ...rest, pendingAdmin: true, tempUntil });
  await auth.revokeRefreshTokens(uid);
  await store.save(uid, await bcrypt.hash(tempPassword, 10), tempUntil);
  return { tempPassword, tempUntil };
}

// 이메일을 관리자로 추가합니다.
//   mode 'temp'   : 무작위 임시 비밀번호를 만들어 한 번만 돌려줍니다. (본인이 로그인 후 새 비밀번호로 변경)
//   mode 'google' : 비밀번호를 만들지 않고 바로 관리자 권한을 줍니다. (구글 로그인으로만 사용)
export async function addAdminUser(auth, store, rawEmail, mode = 'temp', now = Date.now()) {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', '이메일 주소를 정확히 입력해 주세요.');
  if (mode !== 'temp' && mode !== 'google') throw new HttpsError('invalid-argument', '추가 방식을 확인해 주세요.');

  let user = null;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }

  if (user?.customClaims?.admin === true) {
    throw new HttpsError('already-exists', '이미 관리자로 등록된 이메일입니다.');
  }
  if (user?.customClaims?.pendingAdmin === true) {
    throw new HttpsError(
      'already-exists',
      "이미 임시 비밀번호가 발급된 이메일입니다. 목록의 '비밀번호 초기화'를 사용해 주세요."
    );
  }

  if (mode === 'google') {
    const created = !user;
    if (!user) user = await auth.createUser({ email, emailVerified: false });
    // 일반관리자 권한만 부여합니다. (최고관리자 지정은 scripts/setAdminClaim.js --super 로만 가능)
    await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
    return { uid: user.uid, email, created, mode, tempPassword: null, tempUntil: null };
  }

  const tempPassword = generateTempPassword();
  const tempUntil = now + TEMP_PASSWORD_DAYS * DAY_MS;
  let created = false;
  if (!user) {
    user = await auth.createUser({ email, password: tempPassword, emailVerified: false });
    created = true;
    await auth.setCustomUserClaims(user.uid, { pendingAdmin: true, tempUntil });
    await store.save(user.uid, await bcrypt.hash(tempPassword, 10), tempUntil);
    return { uid: user.uid, email, created, mode, tempPassword, tempUntil };
  }
  // 이미 있는 계정(예: 이미 구글로 로그인해 본 계정)에는 임시 비밀번호만 새로 정합니다.
  const issued = await issueTempPassword(auth, store, user.uid, user.customClaims, now);
  return { uid: user.uid, email, created, mode, ...issued };
}

// 일반관리자의 비밀번호를 초기화합니다. (새 임시 비밀번호 발급, 열려 있던 로그인은 끊김)
export async function resetAdminTempPassword(auth, store, uid, callerUid, now = Date.now()) {
  if (!uid) throw new HttpsError('invalid-argument', '대상 관리자 정보가 없습니다.');
  if (uid === callerUid) {
    throw new HttpsError('failed-precondition', '본인 비밀번호는 설정 화면에서 바꿀 수 있습니다.');
  }
  let user;
  try {
    user = await auth.getUser(uid);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') throw new HttpsError('not-found', '없는 계정입니다.');
    throw err;
  }
  const claims = user.customClaims || {};
  if (claims.superAdmin === true) {
    throw new HttpsError('permission-denied', '최고관리자 비밀번호는 앱에서 초기화할 수 없습니다.');
  }
  if (claims.admin !== true && claims.pendingAdmin !== true) {
    throw new HttpsError('failed-precondition', '관리자로 등록된 계정이 아닙니다.');
  }
  const issued = await issueTempPassword(auth, store, uid, claims, now);
  return { uid, email: user.email || '', ...issued };
}

// 임시 비밀번호로 로그인한 사람이 새 비밀번호를 정하면, 그때 비로소 관리자 권한을 켭니다.
export async function completeTempPasswordChange(auth, store, uid, newPassword, now = Date.now()) {
  validatePasswordPolicy(newPassword);
  const user = await auth.getUser(uid);
  const claims = user.customClaims || {};
  if (claims.pendingAdmin !== true) {
    throw new HttpsError('failed-precondition', '임시 비밀번호 상태가 아닌 계정입니다.');
  }
  const tempUntil = Number(claims.tempUntil);
  if (!Number.isFinite(tempUntil) || now > tempUntil) {
    throw new HttpsError(
      'permission-denied',
      `임시 비밀번호 유효기간(${TEMP_PASSWORD_DAYS}일)이 지났습니다. 최고관리자에게 비밀번호 초기화를 요청해 주세요.`
    );
  }
  const saved = await store.get(uid);
  if (saved?.hash && (await bcrypt.compare(newPassword, saved.hash))) {
    throw new HttpsError('invalid-argument', '임시 비밀번호와 다른 비밀번호를 사용해 주세요.');
  }

  await auth.updateUser(uid, { password: newPassword });
  const { pendingAdmin: _p, tempUntil: _t, ...rest } = claims;
  await auth.setCustomUserClaims(uid, { ...rest, admin: true });
  await auth.revokeRefreshTokens(uid);
  await store.delete(uid);
  return { uid, email: user.email || '' };
}

// 관리자(또는 임시 비밀번호 상태의 계정)를 해제합니다. 계정을 삭제하므로 이후 로그인할 수 없습니다.
// (이미 열려 있는 화면은 로그인 정보가 만료되는 최대 1시간 안에 사용할 수 없게 됩니다.)
export async function removeAdminUser(auth, uid, callerUid, store) {
  if (!uid) throw new HttpsError('invalid-argument', '해제할 관리자 정보가 없습니다.');
  if (uid === callerUid) throw new HttpsError('failed-precondition', '본인 계정은 해제할 수 없습니다.');

  let user;
  try {
    user = await auth.getUser(uid);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') throw new HttpsError('not-found', '이미 삭제된 계정입니다.');
    throw err;
  }
  const claims = user.customClaims || {};
  if (claims.superAdmin === true) {
    throw new HttpsError('permission-denied', '최고관리자는 앱에서 해제할 수 없습니다.');
  }
  if (claims.admin !== true && claims.pendingAdmin !== true) {
    throw new HttpsError('failed-precondition', '관리자로 등록된 계정이 아닙니다.');
  }

  await auth.deleteUser(uid);
  if (store) await store.delete(uid);
  return { uid, email: user.email || '' };
}
