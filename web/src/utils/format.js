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

// ---- 짧고 눈에 띄는 날짜/시간 표기 ----
const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

function toDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 24시간 표기 (예: 11:00)
function time24(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 오전/오후 표기 (예: 오전 10:00)
function timeMeridiem(d) {
  const h = d.getHours();
  return `${h < 12 ? '오전' : '오후'}\u00A0${h % 12 || 12}:${pad2(d.getMinutes())}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// 10/8(목) 형식. 올해가 아니면 연도를 앞에 붙입니다.
function shortMonthDay(d) {
  const year = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}.` : '';
  return `${year}${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_SHORT[d.getDay()]})`;
}

// 행사 일시를 화면용 조각으로 나눕니다.
// 같은 날이면 날짜는 한 번만, 시간은 '오전 10:00 ~ 12:00'처럼 줄입니다.
export function getEventWhen(event) {
  const start = toDate(event.eventStart);
  const end = toDate(event.eventEnd);
  if (!start) return { month: '', day: '', weekdayLong: '', dateLabel: '-', timeLabel: '', full: '-' };

  const dateLabel = `${start.getMonth() + 1}월 ${start.getDate()}일(${WEEKDAY_SHORT[start.getDay()]})`;
  let timeLabel = timeMeridiem(start);
  if (end) {
    if (!sameDay(start, end)) {
      timeLabel = `${timeMeridiem(start)} ~ ${shortMonthDay(end)} ${timeMeridiem(end)}`;
    } else if (end > start && (end.getHours() < 12) === (start.getHours() < 12)) {
      timeLabel = `${timeMeridiem(start)} ~ ${end.getHours() % 12 || 12}:${pad2(end.getMinutes())}`;
    } else {
      timeLabel = `${timeMeridiem(start)} ~ ${timeMeridiem(end)}`;
    }
  }
  return {
    month: `${start.getMonth() + 1}월`,
    day: String(start.getDate()),
    weekdayLong: WEEKDAY_LONG[start.getDay()],
    dateLabel,
    timeLabel,
    full: `${dateLabel} ${timeLabel}`,
  };
}

// 접수기간: '10/8(목) 11:00 ~ 10/15(목) 12:00'
export function formatApplyPeriod(event) {
  const start = toDate(event.applyStart);
  const end = toDate(event.applyEnd);
  if (!start || !end) return '-';
  return `${shortMonthDay(start)} ${time24(start)} ~ ${shortMonthDay(end)} ${time24(end)}`;
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
// 모집예정/모집중/마감임박/정원마감(대기가능)/접수마감을 계산하고, 접수 중이면 dday(마감 D-n)도 함께 돌려줍니다.
export function getEventStatus(event) {
  if (event.status === 'draft') return { label: '준비중', tone: 'muted' };
  if (isLottery(event) && event.drawStatus === 'done') return { label: '추첨완료', tone: 'done' };
  if (event.status === 'closed') return { label: '마감', tone: 'closed' };

  const now = new Date();
  const start = event.applyStart?.toDate ? event.applyStart.toDate() : new Date(event.applyStart);
  const end = event.applyEnd?.toDate ? event.applyEnd.toDate() : new Date(event.applyEnd);

  if (now < start) return { label: '모집예정', tone: 'muted' };
  if (now > end) return { label: isLottery(event) ? '접수마감·추첨예정' : '접수마감', tone: 'closed' };

  const lottery = isLottery(event);
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const dday = daysLeft <= 0 ? '오늘 마감' : `마감 D-${daysLeft}`;

  if (isEventFull(event)) return { label: '정원마감·대기가능', tone: 'waiting', dday, daysLeft };
  if (daysLeft <= 1) return { label: lottery ? '추첨접수·마감임박' : '마감임박', tone: 'urgent', dday, daysLeft };
  if (lottery) return { label: '추첨접수중', tone: 'open', dday, daysLeft };
  return { label: '모집중', tone: 'open', dday, daysLeft };
}

// 신청 가능 여부: 공개 상태 + 신청기간만 확인합니다. 정원이 찬 경우에도
// 신청 자체는 가능하며(대기신청으로 전환), 실제 정원 여부는 isEventFull로 별도 확인합니다.
export function isApplyOpen(event) {
  const now = new Date();
  const start = event.applyStart?.toDate ? event.applyStart.toDate() : new Date(event.applyStart);
  const end = event.applyEnd?.toDate ? event.applyEnd.toDate() : new Date(event.applyEnd);
  return event.status === 'open' && now >= start && now <= end;
}
