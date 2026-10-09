import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { formatApplyPeriod, getEventWhen } from '../../utils/format';
import { formatDrawTime } from '../../utils/draw';

// 입주민용 추첨 결과 확인서. 관리자 증빙서와 달리 연락처·진행자·서명란·미당첨자 명단·재추첨 이력은 넣지 않고,
// 이름은 서버에서 가린 상태(getDrawReplay)로만 받습니다. '인쇄 → PDF로 저장'으로 파일을 만들 수 있습니다.
export default function DrawReport() {
  const { eventId } = useParams();
  const [data, setData] = useState(null);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const getDrawReplay = httpsCallable(functions, 'getDrawReplay');
        const [result, evSnap] = await Promise.all([
          getDrawReplay({ eventId }),
          getDoc(doc(db, 'events', eventId)).catch(() => null),
        ]);
        setData(result.data);
        setEvent(evSnap && evSnap.exists() ? evSnap.data() : null);
      } catch (err) {
        setError(err.message?.replace(/^\S+:\s*/, '') || '추첨 결과를 불러오지 못했습니다.');
      }
    })();
  }, [eventId]);

  const back = (
    <Link to={`/events/${eventId}/draw`} className="link-button">← 다시 보기로 돌아가기</Link>
  );

  if (error) {
    return (
      <div className="report-page">
        <div className="report-toolbar no-print">{back}</div>
        <p className="empty-state">{error}</p>
      </div>
    );
  }
  if (!data) return <div className="page-loading">불러오는 중...</div>;

  const entryOf = (p) => data.entries[p.index] || {};
  const winners = (data.picked || []).filter((p) => p.result === 'selected').sort((a, b) => a.rank - b.rank);
  const reserves = (data.picked || []).filter((p) => p.result === 'reserve').sort((a, b) => (a.reserveNo || 0) - (b.reserveNo || 0));
  const title = event?.title || data.eventTitle;

  return (
    <div className="report-page">
      <div className="report-toolbar no-print">
        {back}
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>인쇄 / PDF로 저장</button>
      </div>

      <article className="report">
        <h1>추첨 결과 확인서</h1>
        <p className="report-sub">래미안베라힐즈 행사신청시스템</p>

        <table className="report-info">
          <tbody>
            <tr><th>행사명</th><td>{title}</td></tr>
            {event && <tr><th>행사일시</th><td>{getEventWhen(event).full}</td></tr>}
            {event?.place && <tr><th>장소</th><td>{event.place}</td></tr>}
            {event && <tr><th>접수기간</th><td>{formatApplyPeriod(event)}</td></tr>}
            <tr><th>추첨 일시</th><td>{formatDrawTime(data.drawnAtMs)}</td></tr>
            <tr>
              <th>추첨 대상</th>
              <td>
                접수 {data.entryCount}명 ({data.capacity != null ? `선발 ${data.capacity}명 · ` : ''}당첨 {data.winnerCount}명, 예비 {data.reserveCount}명)
              </td>
            </tr>
            {data.method && <tr><th>추첨 방식</th><td>{data.method}</td></tr>}
            <tr><th>명단 증빙 코드</th><td className="mono">{data.entriesHash}</td></tr>
            <tr><th>결과 증빙 코드</th><td className="mono">{data.resultHash}</td></tr>
          </tbody>
        </table>
        <p className="report-note">
          증빙 코드는 추첨 대상 명단과 결과가 추첨 시점 이후 바뀌지 않았음을 확인하기 위한 값입니다.
          추첨 결과는 서버에서 먼저 확정·저장되었으며, 추첨 화면은 이를 순서대로 공개한 것입니다.
          개인정보 보호를 위해 성명은 일부를 가려 표시하며, 원본 증빙은 관리사무소에서 보관합니다.
        </p>

        <h2>당첨자 ({winners.length}명)</h2>
        <table className="report-table">
          <thead><tr><th>추첨 순서</th><th>동</th><th>호수</th><th>성명</th></tr></thead>
          <tbody>
            {winners.map((p) => {
              const e = entryOf(p);
              return <tr key={p.rank}><td>{p.rank}</td><td>{e.dong}동</td><td>{e.ho}호</td><td>{e.name}</td></tr>;
            })}
          </tbody>
        </table>

        {reserves.length > 0 && (
          <>
            <h2>예비 ({reserves.length}명)</h2>
            <table className="report-table">
              <thead><tr><th>예비 순번</th><th>동</th><th>호수</th><th>성명</th></tr></thead>
              <tbody>
                {reserves.map((p) => {
                  const e = entryOf(p);
                  return <tr key={p.rank}><td>예비 {p.reserveNo}번</td><td>{e.dong}동</td><td>{e.ho}호</td><td>{e.name}</td></tr>;
                })}
              </tbody>
            </table>
          </>
        )}

        <p className="report-note">
          이 확인서는 추첨 시점의 결과입니다. 이후 당첨자의 취소로 예비자가 당첨으로 바뀐 내용은 ‘나의 신청내역’에서 확인하실 수 있습니다.
        </p>
      </article>
    </div>
  );
}
