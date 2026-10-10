// 관리자 계정 관리 로직 (최고관리자 전용 함수에서 사용).
// Firebase Auth의 custom claim으로 권한을 구분합니다.
//   admin: true       → 관리자 화면의 모든 업무 (일반관리자·최고관리자 공통)
//   superAdmin: true  → 위 권한 + 관리자 추가/해제 (최고관리자)
// auth 객체를 인자로 받아서, 실제 Firebase 없이도 테스트할 수 있게 했습니다.
import { HttpsError } from 'firebase-functions/v2/https';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

// 호출자가 최고관리자인지 확인합니다. (request.auth.token 기준)
export function assertSuperAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const token = request.auth.token || {};
  if (token.admin !== true || token.superAdmin !== true) {
    throw new HttpsError('permission-denied', '최고관리자만 사용할 수 있습니다.');
  }
}

// 관리자 권한이 있는 계정 목록 (최고관리자 먼저, 그다음 이메일순)
export async function listAdminUsers(auth) {
  const admins = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if (u.customClaims?.admin !== true) continue;
      admins.push({
        uid: u.uid,
        email: u.email || '',
        role: u.customClaims?.superAdmin === true ? 'super' : 'admin',
        // 비밀번호 설정이나 구글 로그인을 아직 한 적 없는(초대만 된) 계정은 연결된 로그인 수단이 없습니다.
        pending: (u.providerData || []).length === 0,
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

// 이메일 계정을 관리자로 지정합니다. 계정이 없으면 비밀번호 없이 새로 만들고,
// 비밀번호는 본인이 설정 메일(또는 구글 로그인)로 직접 정합니다.
export async function addAdminUser(auth, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', '이메일 주소를 정확히 입력해 주세요.');

  let user = null;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }

  if (user && user.customClaims?.admin === true) {
    throw new HttpsError('already-exists', '이미 관리자로 등록된 이메일입니다.');
  }

  const created = !user;
  if (!user) user = await auth.createUser({ email, emailVerified: false });

  // 일반관리자 권한만 부여합니다. (최고관리자 지정은 scripts/setAdminClaim.js --super 로만 가능)
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
  return { uid: user.uid, email, created };
}

// 일반관리자를 해제합니다. 계정을 삭제하므로 이후 로그인할 수 없습니다.
// (이미 열려 있는 화면은 로그인 정보가 만료되는 최대 1시간 안에 사용할 수 없게 됩니다.)
export async function removeAdminUser(auth, uid, callerUid) {
  if (!uid) throw new HttpsError('invalid-argument', '해제할 관리자 정보가 없습니다.');
  if (uid === callerUid) throw new HttpsError('failed-precondition', '본인 계정은 해제할 수 없습니다.');

  let user;
  try {
    user = await auth.getUser(uid);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') throw new HttpsError('not-found', '이미 삭제된 계정입니다.');
    throw err;
  }
  if (user.customClaims?.superAdmin === true) {
    throw new HttpsError('permission-denied', '최고관리자는 앱에서 해제할 수 없습니다.');
  }
  if (user.customClaims?.admin !== true) {
    throw new HttpsError('failed-precondition', '관리자로 등록된 계정이 아닙니다.');
  }

  await auth.deleteUser(uid);
  return { uid, email: user.email || '' };
}
