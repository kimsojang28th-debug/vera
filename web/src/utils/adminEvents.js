import { isLottery } from './format';

// 관리자 행사 목록용 분류/요약 도우미

function toDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 접수가 끝났는지(조기마감 또는 접수 종료일시 경과). 준비중은 제외.
export function isApplyClosed(event, now = new Date()) {
  if (event.status === 'draft') return false;
  if (event.status === 'closed') return true;
  const end = toDate(event.applyEnd);
  return !!end && now > end;
}

// 행사 자체가 끝났는지(행사 종료일시, 없으면 시작일시 기준)
export function isEventOver(event, now = new Date()) {
  const end = toDate(event.eventEnd) || toDate(event.eventStart);
  return !!end && now > end;
}

// 추첨 대기: 추첨 방식이고 접수가 끝났으며 아직 추첨하지 않았고 행사 전
export function isAwaitingDraw(event, now = new Date()) {
  return (
    isLottery(event) &&
    event.drawStatus !== 'done' &&
    isApplyClosed(event, now) &&
    !isEventOver(event, now) &&
    (event.appliedCount || 0) > 0
  );
}

// 목록 탭 분류: draft(준비중·모집예정) / open(접수중) / closed(마감·추첨) / over(종료)
export function getEventGroup(event, now = new Date()) {
  if (event.status === 'draft') return 'draft';
  if (isEventOver(event, now)) return 'over';
  const start = toDate(event.applyStart);
  if (event.status === 'open' && start && now < start) return 'draft';
  if (isApplyClosed(event, now)) return 'closed';
  return 'open';
}

// 접수 마감까지 남은 일수(오늘 마감이면 0). 접수 중이 아니면 null.
export function daysUntilClose(event, now = new Date()) {
  if (getEventGroup(event, now) !== 'open') return null;
  const end = toDate(event.applyEnd);
  if (!end) return null;
  return Math.max(0, Math.ceil((end - now) / 86400000));
}
