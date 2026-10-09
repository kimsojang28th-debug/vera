import { createHash, randomInt } from 'node:crypto';

// 추첨 로직(순수 함수). Firestore와 분리해 두어 단독으로 검증할 수 있습니다.

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Fisher-Yates 셔플. 난수는 Node.js의 암호학적 난수(crypto.randomInt)를 사용합니다.
export function shuffleIndices(n, rand = randomInt) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = rand(0, i + 1); // 0 이상 i 이하
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// entries: 신청순으로 정렬된 [{ applicationId, dong, ho, name }]
// 당첨(winnerCount명) → 예비(reserveCount명) 순서로 뽑고, 나머지는 미당첨입니다.
export function buildDraw(entries, winnerCount, reserveCount, rand = randomInt) {
  const n = entries.length;
  const winnerN = Math.min(Math.max(0, winnerCount), n);
  const reserveN = Math.min(Math.max(0, reserveCount), n - winnerN);
  const order = shuffleIndices(n, rand);

  const picked = order.slice(0, winnerN + reserveN).map((index, i) => ({
    index,
    applicationId: entries[index].applicationId,
    rank: i + 1,
    result: i < winnerN ? 'selected' : 'reserve',
    reserveNo: i < winnerN ? null : i - winnerN + 1,
  }));
  const pickedSet = new Set(picked.map((p) => p.index));
  const notSelected = entries.filter((_, i) => !pickedSet.has(i)).map((e) => e.applicationId);

  // 증빙 코드: 추첨 대상 명단 해시 + 결과 해시. 명단/결과가 한 글자라도 바뀌면 값이 달라집니다.
  const entriesHash = sha256(JSON.stringify(entries.map((e) => [e.applicationId, e.dong, e.ho, e.name])));
  const resultHash = sha256(`${entriesHash}|${JSON.stringify(picked.map((p) => [p.applicationId, p.rank, p.result]))}`);

  return { winnerN, reserveN, picked, notSelected, entriesHash, resultHash };
}
