import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import bcrypt from 'bcryptjs';

initializeApp();
const db = getFirestore();
const auth = getAuth();

// 개발가이드 7장(개인정보 국외이전)에 따라 Cloud Functions 리전을 서울로 고정합니다.
setGlobalOptions({ region: 'asia-northeast3' });

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 10;

// 입력값 뒤에 "동"/"호"/"호수"가 붙어 있어도(예: "201동", "1001호") 숫자만 남기고 정리합니다.
function normalizeUnit(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/(동|호수|호)\s*$/u, '')
    .trim();
}

function householdId(dong, ho) {
  return `${normalizeUnit(dong)}-${normalizeUnit(ho)}`;
}

// 이름 마스킹: 2글자면 성만, 3글자 이상이면 첫/끝 글자만 남기고 가운데를 마스킹
function maskName(name) {
  if (!name) return null;
  const chars = Array.from(name.trim());
  if (chars.length <= 1) return chars.join('');
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

function phoneTail(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-4);
}

// ── 입주민 로그인/최초등록 ─────────────────────────────────────────
export const householdLogin = onCall(async (request) => {
  const { dong, ho, phone, password } = request.data || {};
  if (!dong || !ho || !phone || !password) {
    throw new HttpsError('invalid-argument', '동, 호수, 연락처, 비밀번호를 모두 입력해주세요.');
  }
  if (String(password).length < 4) {
    throw new HttpsError('invalid-argument', '비밀번호는 4자 이상이어야 합니다.');
  }

  const dongNorm = normalizeUnit(dong);
  const hoNorm = normalizeUnit(ho);
  const id = householdId(dongNorm, hoNorm);
  const ref = db.doc(`households/${id}`);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError('not-found', '등록되지 않은 동/호수입니다. 관리사무소로 문의해주세요.');
  }
  const hh = snap.data();

  if (hh.lockUntil && hh.lockUntil.toMillis() > Date.now()) {
    throw new HttpsError('resource-exhausted', '비밀번호 오류가 누적되어 잠시 후 다시 시도해주세요.');
  }

  if (!hh.passwordHash) {
    // 최초 접속 → 입력한 비밀번호로 등록
    const hash = await bcrypt.hash(String(password), 10);
    await ref.update({
      passwordHash: hash,
      phone: String(phone).trim(),
      isRegistered: true,
      failedAttempts: 0,
      lockUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    const ok = await bcrypt.compare(String(password), hh.passwordHash);
    if (!ok) {
      const attempts = (hh.failedAttempts || 0) + 1;
      const patch = { failedAttempts: attempts };
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        patch.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      }
      await ref.update(patch);
      throw new HttpsError('permission-denied', '비밀번호가 일치하지 않습니다.');
    }
    await ref.update({
      phone: String(phone).trim(),
      failedAttempts: 0,
      lockUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const token = await auth.createCustomToken(id, { dong: dongNorm, ho: hoNorm });
  return { token };
});

// ── 신청 접수 (정원 트랜잭션) ───────────────────────────────────────
export const applyToEvent = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid || !uid.includes('-')) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  const { eventId, answers } = request.data || {};
  if (!eventId) throw new HttpsError('invalid-argument', '행사 정보가 없습니다.');

  const [dong, ho] = uid.split('-');
  const householdSnap = await db.doc(`households/${uid}`).get();
  const household = householdSnap.data() || {};

  // 중복 신청 방지: 같은 세대가 같은 행사에 이미 신청했는지 확인
  const existing = await db
    .collection('applications')
    .where('eventId', '==', eventId)
    .where('householdId', '==', uid)
    .where('status', '==', 'applied')
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new HttpsError('already-exists', '이미 신청한 행사입니다.');
  }

  const newRef = db.collection('applications').doc();

  await db.runTransaction(async (tx) => {
    const eventRef = db.doc(`events/${eventId}`);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) throw new HttpsError('not-found', '존재하지 않는 행사입니다.');
    const event = eventSnap.data();

    const now = new Date();
    const applyStart = event.applyStart?.toDate?.() ?? new Date(event.applyStart);
    const applyEnd = event.applyEnd?.toDate?.() ?? new Date(event.applyEnd);

    if (event.status !== 'open') throw new HttpsError('failed-precondition', '현재 신청을 받지 않는 행사입니다.');
    if (now < applyStart || now > applyEnd) throw new HttpsError('failed-precondition', '신청 기간이 아닙니다.');
    if ((event.appliedCount || 0) >= event.capacity) {
      throw new HttpsError('resource-exhausted', '정원이 마감되었습니다.');
    }

    tx.update(eventRef, { appliedCount: FieldValue.increment(1) });
    tx.set(newRef, {
      eventId,
      householdId: uid,
      dong,
      ho,
      phone: household.phone || '',
      residentName: household.residentName || null,
      answers: answers || {},
      status: 'applied',
      appliedAt: FieldValue.serverTimestamp(),
      cancelledAt: null,
    });
  });

  return { applicationId: newRef.id };
});

// ── 신청 취소 (정원 트랜잭션 복원) ──────────────────────────────────
export const cancelApplication = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

  const { applicationId } = request.data || {};
  if (!applicationId) throw new HttpsError('invalid-argument', '신청 정보가 없습니다.');

  const isAdmin = request.auth.token?.admin === true;
  const appRef = db.doc(`applications/${applicationId}`);

  await db.runTransaction(async (tx) => {
    const appSnap = await tx.get(appRef);
    if (!appSnap.exists) throw new HttpsError('not-found', '신청 내역을 찾을 수 없습니다.');
    const app = appSnap.data();

    if (!isAdmin && app.householdId !== uid) {
      throw new HttpsError('permission-denied', '본인 세대의 신청만 취소할 수 있습니다.');
    }
    if (app.status === 'cancelled') return;

    tx.update(appRef, { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`events/${app.eventId}`), { appliedCount: FieldValue.increment(-1) });
  });

  return { ok: true };
});

// ── 신청 내용 수정 ─────────────────────────────────────────────────
export const updateApplication = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

  const { applicationId, answers } = request.data || {};
  if (!applicationId) throw new HttpsError('invalid-argument', '신청 정보가 없습니다.');

  const appRef = db.doc(`applications/${applicationId}`);
  const appSnap = await appRef.get();
  if (!appSnap.exists) throw new HttpsError('not-found', '신청 내역을 찾을 수 없습니다.');
  const app = appSnap.data();

  if (app.householdId !== uid) {
    throw new HttpsError('permission-denied', '본인 세대의 신청만 수정할 수 있습니다.');
  }
  if (app.status !== 'applied') {
    throw new HttpsError('failed-precondition', '취소된 신청은 수정할 수 없습니다.');
  }

  await appRef.update({ answers: answers || {}, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ── 신청현황 조회 (서버 측 마스킹) ──────────────────────────────────
export const getApplicationStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

  const { eventId } = request.data || {};
  if (!eventId) throw new HttpsError('invalid-argument', '행사 정보가 없습니다.');

  const snap = await db
    .collection('applications')
    .where('eventId', '==', eventId)
    .where('status', '==', 'applied')
    .get();

  const applications = snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.appliedAt?.toMillis?.() || 0) - (b.appliedAt?.toMillis?.() || 0))
    .map((a) => ({
      dong: a.dong,
      ho: a.ho,
      name: maskName(a.residentName),
      phoneTail: phoneTail(a.phone),
    }));

  return { applications };
});
