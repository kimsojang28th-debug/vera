// 추첨 기능 공용 도우미

// 서버(functions/index.js)의 maskName과 같은 규칙: 2글자면 성만, 3글자 이상이면 첫/끝 글자만 남깁니다.
export function maskNameClient(name) {
  if (!name) return '';
  const chars = Array.from(String(name).trim());
  if (chars.length <= 1) return chars.join('');
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

// 신청 상태별 표시(배지 문구/색/안내문). 추첨 행사 여부(lottery)에 따라 '신청'과 '접수'를 구분합니다.
export function getApplicationBadge(app, lottery) {
  switch (app.status) {
    case 'selected':
      return { label: '당첨', tone: 'open', note: '추첨에 당첨되셨습니다. 참석이 어려우시면 꼭 취소해 주세요. 예비 대기자에게 기회가 넘어갑니다.' };
    case 'reserve':
      return {
        label: `예비 ${app.reserveNo ?? ''}번`.trim(),
        tone: 'waiting',
        note: '당첨자가 취소하면 예비 순번대로 자동 당첨됩니다. 당첨으로 바뀌면 이 화면에서 확인하실 수 있습니다.',
      };
    case 'notSelected':
      return { label: '미당첨', tone: 'muted', note: '이번 추첨에서는 선발되지 않았습니다.' };
    case 'waiting':
      return { label: '대기중', tone: 'waiting', note: '자리가 나면 대기 순서대로 자동으로 신청 확정됩니다.' };
    case 'cancelled':
      return { label: '취소', tone: 'muted', note: '' };
    default:
      return {
        label: lottery ? '접수완료' : '신청완료',
        tone: 'open',
        note: lottery ? '추첨 행사입니다. 접수 마감 후 추첨으로 선발되며, 결과는 이 화면에서 확인하실 수 있습니다.' : '',
      };
  }
}

// 관리자용 추첨 기록(draws 문서)을 화면 연출용 데이터로 바꿉니다.
export function stageDataFromDraw(draw) {
  const indexById = new Map((draw.entries || []).map((e, i) => [e.applicationId, i]));
  return {
    eventTitle: draw.eventTitle || '',
    drawnAtMs: draw.drawnAt?.toMillis?.() ?? (draw.drawnAtIso ? Date.parse(draw.drawnAtIso) : null),
    winnerCount: draw.winnerCount,
    reserveCount: draw.reserveCount,
    entries: (draw.entries || []).map((e) => ({ dong: e.dong, ho: e.ho, name: e.name })),
    picked: (draw.picked || []).map((p) => ({
      index: p.index ?? indexById.get(p.applicationId),
      rank: p.rank,
      result: p.result,
      reserveNo: p.reserveNo,
    })),
    entriesHash: draw.entriesHash,
    resultHash: draw.resultHash,
  };
}

// 추첨 결과 문구: 당첨 / 예비 n번
export function pickLabel(pick) {
  return pick.result === 'selected' ? '당첨' : `예비 ${pick.reserveNo}번`;
}

export function formatDrawTime(ms) {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
