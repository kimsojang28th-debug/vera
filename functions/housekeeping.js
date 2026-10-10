// 행사 삭제 · 남은 데이터(고아) 정리 · 비밀번호 일괄 초기화 로직.
// db / bucket / FieldValue를 인자로 받아서, 실제 Firebase 없이도 테스트할 수 있게 했습니다.
import { HttpsError } from 'firebase-functions/v2/https';

const BATCH_SIZE = 400; // Firestore 배치 한도(500) 안쪽으로 여유 있게

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// 문서 참조 목록을 배치로 나눠 삭제합니다.
async function deleteRefs(db, refs) {
  for (const part of chunk(refs, BATCH_SIZE)) {
    const batch = db.batch();
    part.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}

// 쿼리 결과를 계속 지워 나갑니다. (한 번에 BATCH_SIZE건씩)
async function deleteByQuery(db, makeQuery) {
  let total = 0;
  for (;;) {
    const snap = await makeQuery().limit(BATCH_SIZE).get();
    if (snap.empty) break;
    total += await deleteRefs(db, snap.docs.map((d) => d.ref));
    if (snap.size < BATCH_SIZE) break;
  }
  return total;
}

// Firebase Storage 다운로드 주소에서 파일 경로를 꺼냅니다. (행사 배너만 대상)
export function bannerPathFromUrl(url) {
  const m = /\/o\/([^?]+)/.exec(String(url || ''));
  if (!m) return null;
  try {
    const path = decodeURIComponent(m[1]);
    return path.startsWith('event-banners/') ? path : null;
  } catch {
    return null;
  }
}

// 행사 하나를 모두 삭제합니다: 신청 내역 → 추첨 기록 → 배너 이미지 → 행사 문서 순.
// 행사 문서를 마지막에 지우므로, 중간에 실패해도 다시 시도할 수 있습니다.
// 반드시 '숨김' 상태인 행사만 삭제할 수 있습니다.
export async function deleteEventData(db, bucket, eventId) {
  if (!eventId || typeof eventId !== 'string' || eventId.includes('/')) {
    throw new HttpsError('invalid-argument', '삭제할 행사 정보가 없습니다.');
  }
  const eventRef = db.doc(`events/${eventId}`);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', '이미 삭제되었거나 없는 행사입니다.');
  const event = eventSnap.data();
  if (event.hidden !== true) {
    throw new HttpsError('failed-precondition', "삭제하려면 먼저 '숨김' 처리해 주세요.");
  }

  const applications = await deleteByQuery(db, () => db.collection('applications').where('eventId', '==', eventId));
  await db.doc(`draws/${eventId}`).delete();

  // 배너 이미지: 다른 행사가 같은 이미지를 쓰고 있지 않을 때만 지웁니다.
  let bannerDeleted = false;
  const path = bannerPathFromUrl(event.bannerImageUrl);
  if (path && bucket) {
    try {
      const sameBanner = await db.collection('events').where('bannerImageUrl', '==', event.bannerImageUrl).limit(2).get();
      const usedElsewhere = sameBanner.docs.some((d) => d.id !== eventId);
      if (!usedElsewhere) {
        await bucket.file(path).delete({ ignoreNotFound: true });
        bannerDeleted = true;
      }
    } catch (err) {
      console.error('배너 이미지 삭제 실패', err);
    }
  }

  await eventRef.delete();
  return { title: event.title || '', applications, bannerDeleted };
}

// 행사가 이미 없는데 남아 있는 신청 내역/추첨 기록을 찾습니다.
export async function findOrphans(db) {
  const appSnap = await db.collection('applications').select('eventId').get();
  const drawSnap = await db.collection('draws').select().get();

  const ids = new Set();
  appSnap.docs.forEach((d) => {
    const id = d.data().eventId;
    if (id && typeof id === 'string' && !id.includes('/')) ids.add(id);
  });
  drawSnap.docs.forEach((d) => ids.add(d.id));

  const existing = new Set();
  for (const part of chunk([...ids], 300)) {
    const snaps = await db.getAll(...part.map((id) => db.doc(`events/${id}`)));
    snaps.forEach((s) => s.exists && existing.add(s.id));
  }

  const appRefs = [];
  const eventIds = new Set();
  appSnap.docs.forEach((d) => {
    const id = d.data().eventId;
    const valid = id && typeof id === 'string' && !id.includes('/');
    if (!valid || !existing.has(id)) {
      appRefs.push(d.ref);
      if (valid) eventIds.add(id);
    }
  });
  const drawRefs = drawSnap.docs.filter((d) => !existing.has(d.id)).map((d) => d.ref);
  drawRefs.forEach((r) => eventIds.add(r.id));

  return { eventIds: [...eventIds], appRefs, drawRefs };
}

// 남은 데이터를 찾아서(dryRun) 개수만 알려 주거나, 실제로 삭제합니다.
export async function cleanupOrphans(db, { dryRun }) {
  const found = await findOrphans(db);
  const result = {
    events: found.eventIds.length,
    applications: found.appRefs.length,
    draws: found.drawRefs.length,
  };
  if (dryRun) return { ...result, deleted: false };
  await deleteRefs(db, found.appRefs);
  await deleteRefs(db, found.drawRefs);
  return { ...result, deleted: true };
}

// 입주민 비밀번호 초기화(다음 접속 시 새 4자리로 다시 등록). ids를 주면 그 세대만, all이면 등록된 전체.
export async function resetHouseholdPasswords(db, FieldValue, { ids, all }) {
  let docs;
  if (all === true) {
    docs = (await db.collection('households').get()).docs;
  } else {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new HttpsError('invalid-argument', '초기화할 세대를 선택해 주세요.');
    }
    if (ids.length > 3000) throw new HttpsError('invalid-argument', '한 번에 처리할 수 있는 세대 수를 넘었습니다.');
    const clean = [...new Set(ids.filter((id) => typeof id === 'string' && id && !id.includes('/')))];
    docs = [];
    for (const part of chunk(clean, 300)) {
      const snaps = await db.getAll(...part.map((id) => db.doc(`households/${id}`)));
      snaps.forEach((s) => s.exists && docs.push(s));
    }
  }

  const targets = docs.filter((d) => {
    const h = d.data();
    return Boolean(h.passwordHash) || h.isRegistered === true;
  });

  for (const part of chunk(targets, BATCH_SIZE)) {
    const batch = db.batch();
    part.forEach((d) =>
      batch.update(d.ref, {
        passwordHash: null,
        isRegistered: false,
        failedAttempts: 0,
        lockUntil: null,
        passwordResetAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    );
    await batch.commit();
  }
  return { reset: targets.length, skipped: docs.length - targets.length, total: docs.length };
}
