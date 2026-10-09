import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import bcrypt from 'bcryptjs';
import { buildDraw } from './draw.js';

initializeApp();
const db = getFirestore();
const auth = getAuth();

// 개발가이드 7장(개인정보 국외이전)에 따라 Cloud Functions 리전을 서울로 고정합니다.
setGlobalOptions({ region: 'asia-northeast3' });

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 10;

// 신청이 살아 있는(취소되지 않은) 상태들. 추첨 후에는 selected/reserve/notSelected가 추가됩니다.
const ACTIVE_STATUSES = ['applied', 'waiting', 'selected', 'reserve', 'notSelected'];
// 추첨 대상(접수된) 상태: 최초 추첨 전에는 applied, 재추첨 시에는 이전 추첨 결과 상태도 포함됩니다.
const DRAW_STATUSES = ['applied', 'selected', 'reserve', 'notSelected'];
const DRAW_METHOD = 'Fisher-Yates 셔플 + 암호학적 난수(Node.js crypto.randomInt), 서버에서 1회 실행 후 저장';

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

// ── 입주민 로그인/최초등록 ──────────────────────────────────────────
export const householdLogin = onCall(async (request) => {
  const { dong, ho, password } = request.data || {};
  if (!dong || !ho || !password) {
    throw new HttpsError('invalid-argument', '동, 호수, 비밀번호를 모두 입력해주세요.');
  }
  if (!/^\d{4}$/.test(String(password))) {
    throw new HttpsError('invalid-argument', '비밀번호는 숫자 4자리로 입력해주세요.');
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
      failedAttempts: 0,
      lockUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const token = await auth.createCustomToken(id, { dong: dongNorm, ho: hoNorm });
  return { token };
});

// ── 신청 접수 (정원 트랜잭션 + 정원마감 시 대기신청) ──────────────────
export const applyToEvent = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid || !uid.includes('-')) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  const { eventId, answers, residentName, phone } = request.data || {};
  if (!eventId) throw new HttpsError('invalid-argument', '행사 정보가 없습니다.');
  if (!residentName || !String(residentName).trim()) {
    throw new HttpsError('invalid-argument', '이름을 입력해주세요.');
  }
  if (!phone || !/^010-\d{4}-\d{4}$/.test(String(phone))) {
    throw new HttpsError('invalid-argument', '연락처는 010-0000-0000 형식으로 입력해주세요.');
  }

  const [dong, ho] = uid.split('-');
  const nameNorm = String(residentName).trim();
  const phoneNorm = String(phone).trim();
  const isSamePerson = (d) => (d.residentName || '').trim() === nameNorm && (d.phone || '').trim() === phoneNorm;

  const eventSnapPre = await db.doc(`events/${eventId}`).get();
  if (!eventSnapPre.exists) throw new HttpsError('not-found', '존재하지 않는 행사입니다.');
  const eventPre = eventSnapPre.data();
  const multiPerHousehold = eventPre.multiPerHousehold === true;

  // 같은 그룹(예: 이틀 중 하루만 신청 가능)의 다른 행사에 이미 신청했는지 확인
  if (eventPre.groupId) {
    const siblingsSnap = await db.collection('events').where('groupId', '==', eventPre.groupId).get();
    const siblingIds = siblingsSnap.docs.map((d) => d.id);
    const appliedSnap = await db.collection('applications').where('householdId', '==', uid).get();
    const conflict = appliedSnap.docs.some((d) => {
      const dd = d.data();
      if (!ACTIVE_STATUSES.includes(dd.status)) return false;
      if (!siblingIds.includes(dd.eventId)) return false;
      // 세대당 여러 명 신청이 가능한 행사는, 같은 사람이 다른 날짜에 이미 신청했을 때만 충돌로 봅니다.
      return multiPerHousehold ? isSamePerson(dd) : true;
    });
    if (conflict) {
      throw new HttpsError('already-exists', '같은 그룹의 다른 날짜에 이미 신청하셨습니다.');
    }
  }

  // 같은 행사 중복 신청 방지 (신청/대기신청 모두 포함)
  const existing = await db
    .collection('applications')
    .where('eventId', '==', eventId)
    .where('householdId', '==', uid)
    .get();
  const activeExisting = existing.docs.map((d) => d.data()).filter((d) => ACTIVE_STATUSES.includes(d.status));
  if (multiPerHousehold) {
    // 가족 여러 명 신청 가능: 이름과 연락처가 모두 같은 사람만 중복 신청으로 처리합니다.
    if (activeExisting.some(isSamePerson)) {
      throw new HttpsError('already-exists', '이미 신청하셨습니다.');
    }
  } else if (activeExisting.length > 0) {
    throw new HttpsError('already-exists', '이미 신청(또는 대기신청)한 행사입니다.');
  }

  const newRef = db.collection('applications').doc();
  let waitlisted = false;

  await db.runTransaction(async (tx) => {
    const eventRef = db.doc(`events/${eventId}`);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) throw new HttpsError('not-found', '존재하지 않는 행사입니다.');
    const event = eventSnap.data();

    const now = new Date();
    const applyStart = event.applyStart?.toDate?.() ?? new Date(event.applyStart);
    const applyEnd = event.applyEnd?.toDate?.() ?? new Date(event.applyEnd);

    if (event.status !== 'open') throw new HttpsError('failed-precondition', '현재 신청을 받지 않는 행사입니다.');
    if (event.drawStatus === 'done') throw new HttpsError('failed-precondition', '이미 추첨이 완료된 행사입니다.');
    if (now < applyStart || now > applyEnd) throw new HttpsError('failed-precondition', '신청 기간이 아닙니다.');

    // 추첨 행사는 접수 마감까지 정원과 관계없이 모두 접수합니다(대기 전환 없음).
    const isLottery = event.selectionMethod === 'lottery';
    const isFull = !isLottery && (event.appliedCount || 0) >= event.capacity;
    waitlisted = isFull;

    if (!isFull) {
      tx.update(eventRef, { appliedCount: FieldValue.increment(1) });
    }
    tx.set(newRef, {
      eventId,
      householdId: uid,
      dong,
      ho,
      phone: String(phone).trim(),
      residentName: String(residentName).trim(),
      answers: answers || {},
      status: isFull ? 'waiting' : 'applied',
      appliedAt: FieldValue.serverTimestamp(),
      cancelledAt: null,
    });
  });

  return { applicationId: newRef.id, waitlisted };
});

// ── 신청 취소 (정원 트랜잭션 복원 + 대기자/예비자 자동 승격) ──────────────
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

    const wasApplied = app.status === 'applied';
    // 추첨 후 상태: 당첨(selected) / 예비(reserve) / 미당첨(notSelected)
    const wasDrawn = ['selected', 'reserve', 'notSelected'].includes(app.status);

    // Firestore 트랜잭션은 모든 읽기(get)가 모든 쓰기(update/set)보다 먼저 실행되어야 하므로,
    // 대기자/예비자 조회와 행사 문서 조회는 취소 상태로 업데이트하기 "전"에 미리 수행합니다.
    let waitingSnap = null;
    let reserveSnap = null;
    let eventSnap = null;
    const eventRef = db.doc(`events/${app.eventId}`);
    if (wasApplied) {
      waitingSnap = await tx.get(
        db.collection('applications').where('eventId', '==', app.eventId).where('status', '==', 'waiting')
      );
      eventSnap = await tx.get(eventRef);
    } else if (wasDrawn) {
      if (app.status !== 'notSelected') {
        reserveSnap = await tx.get(
          db.collection('applications').where('eventId', '==', app.eventId).where('status', '==', 'reserve')
        );
      }
      eventSnap = await tx.get(eventRef);
    }

    tx.update(appRef, { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });

    if (wasApplied) {
      // 취소로 자리가 나면, 대기신청 중 가장 먼저 신청한 세대를 자동으로 승격합니다.
      if (waitingSnap && !waitingSnap.empty) {
        const sorted = waitingSnap.docs.slice().sort((a, b) => {
          const at = a.data().appliedAt?.toMillis?.() || 0;
          const bt = b.data().appliedAt?.toMillis?.() || 0;
          return at - bt;
        });
        const promote = sorted[0];
        tx.update(promote.ref, { status: 'applied', promotedAt: FieldValue.serverTimestamp() });
        // 취소 1명 + 승격 1명이므로 정원 카운트는 그대로 둡니다.
      } else if (eventSnap && eventSnap.exists) {
        // 관리자가 행사 자체를 삭제한 경우에는 더 이상 존재하지 않는 문서라 업데이트할 대상이 없습니다.
        tx.update(eventRef, { appliedCount: FieldValue.increment(-1) });
      }
    } else if (wasDrawn) {
      // 추첨 행사: 당첨자가 취소하면 예비 1번이 자동 당첨, 예비자가 취소하면 뒷번호가 한 칸씩 앞당겨집니다.
      if (reserveSnap && !reserveSnap.empty) {
        const reserves = reserveSnap.docs
          .filter((d) => d.id !== applicationId)
          .sort((a, b) => (a.data().reserveNo || 0) - (b.data().reserveNo || 0));
        if (app.status === 'selected') {
          if (reserves.length > 0) {
            const [first, ...rest] = reserves;
            tx.update(first.ref, {
              status: 'selected',
              reserveNo: FieldValue.delete(),
              promotedAt: FieldValue.serverTimestamp(),
            });
            rest.forEach((d, i) => tx.update(d.ref, { reserveNo: i + 1 }));
          }
        } else {
          reserves.forEach((d, i) => tx.update(d.ref, { reserveNo: i + 1 }));
        }
      }
      if (eventSnap && eventSnap.exists) {
        tx.update(eventRef, { appliedCount: FieldValue.increment(-1) });
      }
    }
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
  if (app.status === 'cancelled') {
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

  const maskEntry = (a) => ({
    dong: a.dong,
    ho: a.ho,
    name: maskName(a.residentName),
    phoneTail: phoneTail(a.phone),
  });
  const byAppliedAt = (a, b) => (a.appliedAt?.toMillis?.() || 0) - (b.appliedAt?.toMillis?.() || 0);

  const [appsSnap, eventSnap] = await Promise.all([
    db.collection('applications').where('eventId', '==', eventId).get(),
    db.doc(`events/${eventId}`).get(),
  ]);
  const all = appsSnap.docs.map((d) => d.data()).sort(byAppliedAt);
  const event = eventSnap.exists ? eventSnap.data() : {};
  const drawn = event.selectionMethod === 'lottery' && event.drawStatus === 'done';

  // 신청순으로 정렬 후 1번부터 번호를 매겨, 몇 번째로 신청했는지 한눈에 볼 수 있게 합니다.
  // 추첨이 끝난 행사는 당첨/예비/미당첨 모두 "접수 현황"(신청순)에 포함합니다.
  const listed = drawn ? DRAW_STATUSES : ['applied'];
  const applications = all.filter((a) => listed.includes(a.status)).map(maskEntry);
  const waiting = all.filter((a) => a.status === 'waiting').map(maskEntry);

  let selected = [];
  let reserve = [];
  if (drawn) {
    selected = all
      .filter((a) => a.status === 'selected')
      .sort((a, b) => (a.drawRank || 0) - (b.drawRank || 0))
      .map(maskEntry);
    reserve = all
      .filter((a) => a.status === 'reserve')
      .sort((a, b) => (a.reserveNo || 0) - (b.reserveNo || 0))
      .map((a) => ({ ...maskEntry(a), reserveNo: a.reserveNo }));
  }

  return { applications, waiting, drawn, selected, reserve };
});

// ── 추첨 실행 (관리자 전용) ──────────────────────────────────────────
// 서버에서 보안 난수로 전체 순서를 한 번에 정해 저장합니다. 화면의 휠/룰렛은 이 결과를 순서대로 공개할 뿐입니다.
export const runDraw = onCall(async (request) => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', '관리자만 추첨을 실행할 수 있습니다.');
  }
  const { eventId, reserveCount, redrawReason } = request.data || {};
  if (!eventId) throw new HttpsError('invalid-argument', '행사 정보가 없습니다.');

  const eventRef = db.doc(`events/${eventId}`);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', '존재하지 않는 행사입니다.');
  const event = eventSnap.data();

  if (event.selectionMethod !== 'lottery') {
    throw new HttpsError('failed-precondition', '추첨 방식의 행사가 아닙니다.');
  }
  const applyEnd = event.applyEnd?.toDate?.() ?? new Date(event.applyEnd);
  if (!(event.status === 'closed' || new Date() > applyEnd)) {
    throw new HttpsError('failed-precondition', '접수가 마감된 후에 추첨할 수 있습니다.');
  }

  const redraw = event.drawStatus === 'done';
  const reason = String(redrawReason ?? '').trim();
  if (redraw && !reason) {
    throw new HttpsError('failed-precondition', '이미 추첨이 완료되었습니다. 재추첨하려면 사유를 입력해주세요.');
  }

  const parsedReserve = Math.floor(Number(reserveCount));
  const reserveWanted = Number.isFinite(parsedReserve) ? parsedReserve : Number(event.reserveCount ?? 5);
  const reserve = Math.min(50, Math.max(0, reserveWanted));

  const appsSnap = await db.collection('applications').where('eventId', '==', eventId).get();
  const docs = appsSnap.docs
    .filter((d) => DRAW_STATUSES.includes(d.data().status))
    .sort((a, b) => {
      const diff = (a.data().appliedAt?.toMillis?.() || 0) - (b.data().appliedAt?.toMillis?.() || 0);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  if (docs.length === 0) throw new HttpsError('failed-precondition', '추첨할 신청자가 없습니다.');

  const entries = docs.map((d) => {
    const a = d.data();
    return {
      applicationId: d.id,
      dong: a.dong,
      ho: a.ho,
      name: String(a.residentName ?? '').trim(),
      phoneTail: phoneTail(a.phone),
    };
  });
  const result = buildDraw(entries, Number(event.capacity) || 0, reserve);
  const resultById = new Map(result.picked.map((p) => [p.applicationId, p]));

  // 신청 문서 상태 갱신 (배치 한도를 고려해 나누어 처리)
  const updates = docs.map((d) => {
    const p = resultById.get(d.id);
    if (!p) {
      return [d.ref, { status: 'notSelected', drawRank: FieldValue.delete(), reserveNo: FieldValue.delete(), promotedAt: FieldValue.delete() }];
    }
    if (p.result === 'selected') {
      return [d.ref, { status: 'selected', drawRank: p.rank, reserveNo: FieldValue.delete(), promotedAt: FieldValue.delete() }];
    }
    return [d.ref, { status: 'reserve', drawRank: p.rank, reserveNo: p.reserveNo, promotedAt: FieldValue.delete() }];
  });
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    updates.slice(i, i + 400).forEach(([ref, data]) => batch.update(ref, data));
    await batch.commit();
  }

  // 증빙 기록 + 행사 문서 갱신
  const drawRef = db.doc(`draws/${eventId}`);
  const prevSnap = await drawRef.get();
  const nowIso = new Date().toISOString();
  const drawnBy = request.auth.token.email || request.auth.uid;
  const history = prevSnap.exists ? [...(prevSnap.data().history || [])] : [];
  if (redraw && prevSnap.exists) {
    const prev = prevSnap.data();
    history.push({
      drawnAtIso: prev.drawnAtIso || null,
      drawnBy: prev.drawnBy || null,
      resultHash: prev.resultHash || null,
      entryCount: prev.entryCount || null,
      replacedAtIso: nowIso,
      reason,
    });
  }

  const finalBatch = db.batch();
  finalBatch.set(drawRef, {
    eventId,
    eventTitle: event.title || '',
    drawnAt: FieldValue.serverTimestamp(),
    drawnAtIso: nowIso,
    drawnBy,
    method: DRAW_METHOD,
    entryCount: entries.length,
    capacity: Number(event.capacity) || 0,
    winnerCount: result.winnerN,
    reserveCount: result.reserveN,
    entries,
    picked: result.picked,
    notSelected: result.notSelected,
    entriesHash: result.entriesHash,
    resultHash: result.resultHash,
    redrawReason: redraw ? reason : null,
    history,
  });
  finalBatch.update(eventRef, {
    drawStatus: 'done',
    drawnAt: FieldValue.serverTimestamp(),
    reserveCount: reserve,
  });
  await finalBatch.commit();

  return {
    ok: true,
    entryCount: entries.length,
    winnerCount: result.winnerN,
    reserveCount: result.reserveN,
    resultHash: result.resultHash,
  };
});

// ── 추첨 다시보기 데이터 (입주민용, 이름 마스킹) ──────────────────────────
export const getDrawReplay = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const { eventId } = request.data || {};
  if (!eventId) throw new HttpsError('invalid-argument', '행사 정보가 없습니다.');

  const snap = await db.doc(`draws/${eventId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', '아직 추첨 결과가 없습니다.');
  const d = snap.data();

  return {
    eventTitle: d.eventTitle || '',
    drawnAtMs: d.drawnAt?.toMillis?.() ?? null,
    entryCount: d.entryCount,
    winnerCount: d.winnerCount,
    reserveCount: d.reserveCount,
    capacity: d.capacity ?? null,
    method: d.method || '',
    // 신청자 전체(이름은 마스킹)와 뽑힌 순서(entries의 위치 번호)만 내려줍니다.
    entries: (d.entries || []).map((e) => ({ dong: e.dong, ho: e.ho, name: maskName(e.name) })),
    picked: (d.picked || []).map((p) => ({ index: p.index, rank: p.rank, result: p.result, reserveNo: p.reserveNo })),
    entriesHash: d.entriesHash,
    resultHash: d.resultHash,
  };
});
