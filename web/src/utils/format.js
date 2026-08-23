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

// 행사 상태 계산: draft/closed는 그대로, open이면 신청기간 기준으로 모집예정/모집중/마감 계산
export function getEventStatus(event) {
  if (event.status === 'draft') return { label: '준비중', tone: 'muted' };
  if (event.status === 'closed') return { label: '마감', tone: 'closed' };

  const now = new Date();
  const start = event.applyStart?.toDate ? event.applyStart.toDate() : new Date(event.applyStart);
  const end = event.applyEnd?.toDate ? event.applyEnd.toDate() : new Date(event.applyEnd);

  if (event.appliedCount >= event.capacity) return { label: '정원마감', tone: 'closed' };
  if (now < start) return { label: '모집예정', tone: 'muted' };
  if (now > end) return { label: '접수마감', tone: 'closed' };
  return { label: '모집중', tone: 'open' };
}

export function isApplyOpen(event) {
  const now = new Date();
  const start = event.applyStart?.toDate ? event.applyStart.toDate() : new Date(event.applyStart);
  const end = event.applyEnd?.toDate ? event.applyEnd.toDate() : new Date(event.applyEnd);
  return event.status === 'open' && now >= start && now <= end && event.appliedCount < event.capacity;
}
