import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatApplyPeriod, getEventWhen } from '../../utils/format';
import { formatDrawTime, maskNameClient } from '../../utils/draw';

// 추첨 결과 확인서. 브라우저의 '인쇄 → PDF로 저장'으로 PDF 파일을 만들 수 있습니다.
export default function AdminDrawReport() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [draw, setDraw] = useState(null);
  const [apps, setApps] = useState({});
  const [loading, setLoading] = useState(true);
  const [maskNames, setMaskNames] = useState(true);

  useEffect(() => {
    (async () => {
      const [evSnap, drawSnap, appSnap] = await Promise.all([
        getDoc(doc(db, 'events', eventId)),
        getDoc(doc(db, 'draws', eventId)),
        getDocs(query(collection(db, 'applications'), where('eventId', '==', eventId))),
      ]);
      setEvent(evSnap.exists() ? { id: evSnap.id, ...evSnap.data() } : null);
      setDraw(drawSnap.exists() ? drawSnap.data() : null);
      setApps(Object.fromEntries(appSnap.docs.map((d) => [d.id, d.data()])));
      setLoading(false);
    })();
  }, [eventId]);

  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (!event || !draw) return <p className="empty-state">추첨 기록이 없습니다.</p>;

  const nm = (n) => (maskNames ? maskNameClient(n) : n);
  const entryOf = (p) => draw.entries[p.index];
  const when = getEventWhen(event);
  const currentLabel = (p) => {
    const a = apps[p.applicationId];
    if (!a) return '-';
    if (a.status === 'cancelled') return '취소';
    if (a.status === 'selected') return p.result === 'reserve' ? '당첨 (예비 승계)' : '당첨';
    if (a.status === 'reserve') return `예비 ${a.reserveNo}번`;
    return '미당첨';
  };
  const winners = draw.picked.filter((p) => p.result === 'selected');
  const reserves = draw.picked.filter((p) => p.result === 'reserve');
  const notSelectedEntries = draw.notSelected.map((id) => draw.entries.find((e) => e.applicationId === id)).filter(Boolean);
  const drawnMs = draw.drawnAt?.toMillis?.() ?? Date.parse(draw.drawnAtIso);

  return (
    <div className="report-page">
      <div className="report-toolbar no-print">
        <Link to={`/admin/events/${eventId}/draw`} className="link-button">← 추첨 화면</Link>
        <label className="checkbox-inline">
          <input type="checkbox" checked={maskNames} onChange={(e) => setMaskNames(e.target.checked)} />
          이름 가리기 (게시용)
        </label>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>인쇄 / PDF로 저장</button>
      </div>

      <article className="report">
        <h1>추첨 결과 확인서</h1>
        <p className="report-sub">래미안베라힐즈 행사신청시스템</p>

        <table className="report-info">
          <tbody>
            <tr><th>행사명</th><td>{event.title}</td></tr>
            <tr><th>행사일시</th><td>{when.full}</td></tr>
            <tr><th>접수기간</th><td>{formatApplyPeriod(event)}</td></tr>
            <tr><th>추첨 일시</th><td>{formatDrawTime(drawnMs)}</td></tr>
            <tr><th>추첨 진행자</th><td>{draw.drawnBy}</td></tr>
            <tr><th>추첨 대상</th><td>접수 {draw.entryCount}명 (선발 {draw.capacity}명 · 당첨 {draw.winnerCount}명, 예비 {draw.reserveCount}명)</td></tr>
            <tr><th>추첨 방식</th><td>{draw.method}</td></tr>
            <tr><th>명단 증빙 코드</th><td className="mono">{draw.entriesHash}</td></tr>
            <tr><th>결과 증빙 코드</th><td className="mono">{draw.resultHash}</td></tr>
          </tbody>
        </table>
        <p className="report-note">
          증빙 코드는 추첨 대상 명단과 결과가 추첨 시점 이후 바뀌지 않았음을 확인하기 위한 값입니다.
          추첨 결과는 서버에서 먼저 확정·저장되었으며, 추첨 화면은 이를 순서대로 공개한 것입니다.
        </p>

        <h2>당첨자 ({winners.length}명)</h2>
        <table className="report-table">
          <thead><tr><th>추첨 순서</th><th>동</th><th>호수</th><th>성명</th><th>현재 상태</th></tr></thead>
          <tbody>
            {winners.map((p) => {
              const e = entryOf(p);
              return <tr key={p.rank}><td>{p.rank}</td><td>{e.dong}동</td><td>{e.ho}호</td><td>{nm(e.name)}</td><td>{currentLabel(p)}</td></tr>;
            })}
          </tbody>
        </table>

        {reserves.length > 0 && (
          <>
            <h2>예비 ({reserves.length}명)</h2>
            <table className="report-table">
              <thead><tr><th>예비 순번</th><th>동</th><th>호수</th><th>성명</th><th>현재 상태</th></tr></thead>
              <tbody>
                {reserves.map((p) => {
                  const e = entryOf(p);
                  return <tr key={p.rank}><td>예비 {p.reserveNo}번</td><td>{e.dong}동</td><td>{e.ho}호</td><td>{nm(e.name)}</td><td>{currentLabel(p)}</td></tr>;
                })}
              </tbody>
            </table>
          </>
        )}

        <h2>미당첨 ({notSelectedEntries.length}명)</h2>
        <p className="report-list">
          {notSelectedEntries.length === 0
            ? '없음'
            : notSelectedEntries.map((e) => `${e.dong}동 ${e.ho}호 ${nm(e.name)}`.trim()).join(', ')}
        </p>

        {(draw.history || []).length > 0 && (
          <>
            <h2>재추첨 이력</h2>
            <table className="report-table">
              <thead><tr><th>이전 추첨 일시</th><th>진행자</th><th>변경 일시</th><th>사유</th></tr></thead>
              <tbody>
                {draw.history.map((h, i) => (
                  <tr key={i}>
                    <td>{formatDrawTime(h.drawnAtIso ? Date.parse(h.drawnAtIso) : null)}</td>
                    <td>{h.drawnBy || '-'}</td>
                    <td>{formatDrawTime(h.replacedAtIso ? Date.parse(h.replacedAtIso) : null)}</td>
                    <td>{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="report-sign">
          <div>추첨 진행자 (서명)<span /></div>
          <div>입회자 (서명)<span /></div>
        </div>
      </article>
    </div>
  );
}
