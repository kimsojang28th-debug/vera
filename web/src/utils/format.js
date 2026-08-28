// Firestore Timestamp 또는 Date를 화면 표시용 문자열로 변환
export function formatDateTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function isEventFull(event) {
  return (event.appliedCount || 0) >= (event.capacity || 0);
}

// 정원 대비 신청 비율(%). 정원이 0이거나 없으면 0을 반환합니다.
export function getCapacityPercent(event) {
  const capacity = event.capacity || 0;
  if (!capacity) return 0;
  return Math.min(100, Math.round(((event.appliedCount || 0) / capacity) * 100));
}

// 행사 상태 계산: draft/closed는 그대로, open이면 신청기간·정원 기준으로
// 모집예정/모집중(D-day)/마감임박/정원마감(대기가능)/접수마감을 계산
export function getEventStatus(event) {
  if (event.status === 'draft') return { label: '준비중', tone: 'muted' };
  if (event.status === 'closed') return { label: '마감', tone: 'closed' };

  const now = new Date();
  const start = event.applyStart?.toDate ? event.applyStart.toDate() : new Date(event.applyStart);
  const end = event.applyEnd?.toDate ? event.applyEnd.toDate() : new Date(event.applyEnd);

  if (now < start) return { label: '모집예정', tone: 'muted' };
  if (now > end) return { label: '접수마감', tone: 'closed' };

  if (isEventFull(event)) return { label: '정원마감·대기가능', tone: 'waiting' };

  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  if (daysLeft <= 1) return { label: '마감임박', tone: 'urgent' };
  return { label: `모집중 (마감 D-${daysLeft})`, tone: 'open' };
}

// 신청 가능 여부: 공개 상태 + 신청기간만 확인합니다. 정원이 찬 경우에도
// 신청 자체는 가능하며(대기신청으로 전환), 실제 정원 여부는 isEventFull로 별도 확인합니다.
export function isApplyOpen(event) {
  const now = new Date();
  const start = event.applyStart?.toDate ? event.applyStart.toDate() : new Date(event.applyStart);
  const end = event.applyEnd?.toDate ? event.applyEnd.toDate() : new Date(event.applyEnd);
  return event.status === 'open' && now >= start && now <= end;
}
