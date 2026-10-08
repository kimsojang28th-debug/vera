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

// 추첨 모집 행사 여부 (selectionMethod가 없으면 기존 선착순)
export function isLottery(event) {
  return event?.selectionMethod === 'lottery';
}

// 추첨 행사는 정원이 차도 계속 접수하므로 항상 false
export function isEventFull(event) {
  if (isLottery(event)) return false;
  return (event.appliedCount || 0) >= (event.capacity || 0);
}

// 추첨 행사 경쟁률 문자열 (예: '2.5:1'). 선발 인원이 없거나 신청자가 없으면 null.
export function getCompetitionRatio(event) {
  const capacity = event.capacity || 0;
  const applied = event.appliedCount || 0;
  if (!capacity || !applied) return null;
  return `${(applied / capacity).toFixed(1).replace(/\.0$/, '')}:1`;
}

// 카드에 표시할 인원 문구
export function getCapacityText(event) {
  const applied = event.appliedCount ?? 0;
  if (isLottery(event)) {
    const ratio = getCompetitionRatio(event);
    return `신청 ${applied}명 · 선발 ${event.capacity}명${ratio ? ` (경쟁률 ${ratio})` : ''}`;
  }
  return `${applied}/${event.capacity}명`;
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
  if (now > end) return { label: isLottery(event) ? '접수마감·추첨예정' : '접수마감', tone: 'closed' };

  const lottery = isLottery(event);
  if (isEventFull(event)) return { label: '정원마감·대기가능', tone: 'waiting' };

  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  if (daysLeft <= 1) return { label: lottery ? '추첨접수·마감임박' : '마감임박', tone: 'urgent' };
  if (lottery) return { label: `추첨접수중 (마감 D-${daysLeft})`, tone: 'open' };
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
