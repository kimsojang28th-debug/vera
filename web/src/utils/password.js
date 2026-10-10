// 관리자 새 비밀번호 규칙: 8자 이상, 영문과 숫자를 모두 포함 (서버 functions/admins.js 와 같은 규칙)
export const PASSWORD_RULE_TEXT = '8자 이상, 영문과 숫자를 모두 포함';

// 문제가 있으면 안내 문구를, 괜찮으면 빈 문자열을 돌려줍니다.
export function validateNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (pw.length > 64) return '비밀번호는 64자 이하로 입력해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 모두 포함해 주세요.';
  return '';
}

// 남은 일수(올림). 이미 지났으면 0 이하.
export function daysLeft(untilMs, now = Date.now()) {
  return Math.ceil((untilMs - now) / 86400000);
}

export function formatUntil(untilMs) {
  const d = new Date(untilMs);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
