import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import DrawStage from '../../components/DrawStage';
import { formatApplyPeriod, formatDateTime, getEventWhen } from '../../utils/format';
import { formatDrawTime, stageDataFromDraw } from '../../utils/draw';

export default function AdminDraw() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [apps, setApps] = useState([]);
  const [draw, setDraw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reserveInput, setReserveInput] = useState(5);
  const [maskStage, setMaskStage] = useState(false);
  const [stage, setStage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const evSnap = await getDoc(doc(db, 'events', eventId));
    if (!evSnap.exists()) {
      setEvent(null);
      setLoading(false);
      return null;
    }
    const ev = { id: evSnap.id, ...evSnap.data() };
    setEvent(ev);
    setReserveInput(ev.reserveCount ?? 5);

    const appSnap = await getDocs(query(collection(db, 'applications'), where('eventId', '==', eventId)));
    setApps(appSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

    let drawData = null;
    if (ev.drawStatus === 'done') {
      const drawSnap = await getDoc(doc(db, 'draws', eventId));
      drawData = drawSnap.exists() ? drawSnap.data() : null;
    }
    setDraw(drawData);
    setLoading(false);
    return drawData;
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (!event) return <p className="empty-state">존재하지 않는 행사입니다.</p>;
  if (event.selectionMethod !== 'lottery') {
    return (
      <div>
        <Link to="/admin/events" className="link-button">← 행사 목록</Link>
        <p className="empty-state">추첨 방식의 행사가 아닙니다. 행사 수정에서 모집 방식을 '추첨'으로 설정해 주세요.</p>
      </div>
    );
  }

  const applyEnd = event.applyEnd?.toDate ? event.applyEnd.toDate() : new Date(event.applyEnd);
  const canDraw = event.status === 'closed' || new Date() > applyEnd;
  const drawn = event.drawStatus === 'done' && draw;
  const live = apps.filter((a) => a.status !== 'cancelled');
  const cancelledCount = apps.length - live.length;
  const selected = live.filter((a) => a.status === 'selected').sort((a, b) => (a.drawRank || 0) - (b.drawRank || 0));
  const reserve = live.filter((a) => a.status === 'reserve').sort((a, b) => (a.reserveNo || 0) - (b.reserveNo || 0));
  const notSelected = live.filter((a) => a.status === 'notSelected');
  const vacancy = drawn ? Math.max(0, (draw.winnerCount || 0) - selected.length) : 0;
  const when = getEventWhen(event);

  async function executeDraw(redrawReason) {
    setError('');
    setBusy(true);
    try {
      const runDraw = httpsCallable(functions, 'runDraw');
      await runDraw({ eventId, reserveCount: Number(reserveInput), redrawReason });
      const drawData = await load();
      if (drawData) setStage({ data: stageDataFromDraw(drawData), mode: 'live' });
    } catch (err) {
      setError(err.message?.replace(/^\S+:\s*/, '') || '추첨 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function handleStart() {
    const reserveText = Number(reserveInput) > 0 ? `, 예비 ${Number(reserveInput)}명` : '';
    const ok = window.confirm(
      `접수 ${live.length}명 중 당첨 ${event.capacity}명${reserveText}을 추첨합니다.\n\n` +
        '추첨은 한 번 실행하면 결과가 확정되어 저장됩니다. (다시 하려면 사유 입력이 필요합니다.)\n진행할까요?'
    );
    if (ok) executeDraw(undefined);
  }

  function handleRedraw() {
    const reason = window.prompt('재추첨 사유를 입력해 주세요. (증빙서에 기록됩니다)');
    if (!reason || !reason.trim()) return;
    if (window.confirm('재추첨하면 기존 당첨·예비 결과가 모두 바뀝니다. 진행할까요?')) executeDraw(reason.trim());
  }

  const nameCell = (a) => a.residentName || '-';

  return (
    <div className="admin-draw">
      <div className="page-header-row">
        <h2 className="page-title">{event.title} · 추첨</h2>
        <Link to="/admin/events" className="link-button">← 행사 목록</Link>
      </div>

      <section className="admin-panel draw-summary">
        <dl className="draw-info">
          <div><dt>행사일시</dt><dd>{when.full}</dd></div>
          <div><dt>접수기간</dt><dd>{formatApplyPeriod(event)}</dd></div>
          <div><dt>선발 인원</dt><dd>{event.capacity}명</dd></div>
          <div><dt>접수 현황</dt><dd>{live.length}명{cancelledCount > 0 ? ` (취소 ${cancelledCount}명 제외)` : ''}</dd></div>
        </dl>
      </section>

      {error && <p className="form-error">{error}</p>}

      {!drawn ? (
        <section className="admin-panel">
          <h3>추첨 실행</h3>
          {!canDraw && (
            <p className="notice-box notice-box-muted">
              접수가 마감된 후에 추첨할 수 있습니다. (접수 마감: {formatDateTime(event.applyEnd)} · 마감 전에 추첨하려면 행사의 공개 상태를 '마감'으로 바꿔 주세요.)
            </p>
          )}
          <div className="field-row draw-run-row">
            <div className="field">
              <label htmlFor="reserveInput">예비 인원 (취소에 대비해 순번을 정합니다)</label>
              <input
                id="reserveInput"
                type="number"
                min="0"
                max="50"
                value={reserveInput}
                onChange={(e) => setReserveInput(e.target.value)}
              />
            </div>
            <div className="field draw-run-btn">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={!canDraw || busy || live.length === 0}
                onClick={handleStart}
              >
                {busy ? '추첨 중...' : '추첨 시작'}
              </button>
            </div>
          </div>
          <label className="checkbox-inline">
            <input type="checkbox" checked={maskStage} onChange={(e) => setMaskStage(e.target.checked)} />
            추첨 화면에서 이름 가리기 (공개 화면·녹화용)
          </label>
          <p className="muted small-note">
            접수된 {live.length}명 중에서 당첨 {event.capacity}명 → 예비 {Number(reserveInput) || 0}명 순서로 뽑습니다.
            결과는 서버에서 먼저 확정·저장되고, 추첨 화면은 이를 순서대로 공개합니다.
          </p>
        </section>
      ) : (
        <>
          <section className="admin-panel">
            <h3>추첨 완료</h3>
            <dl className="draw-info">
              <div><dt>추첨 일시</dt><dd>{formatDrawTime(draw.drawnAt?.toMillis?.() ?? Date.parse(draw.drawnAtIso))}</dd></div>
              <div><dt>진행자</dt><dd>{draw.drawnBy}</dd></div>
              <div><dt>추첨 대상</dt><dd>{draw.entryCount}명 (당첨 {draw.winnerCount} · 예비 {draw.reserveCount})</dd></div>
              <div><dt>증빙 코드</dt><dd className="mono">{draw.resultHash?.slice(0, 16)}</dd></div>
              {(draw.history || []).length > 0 && (
                <div><dt>재추첨</dt><dd>{draw.history.length}회 (마지막 사유: {draw.redrawReason})</dd></div>
              )}
            </dl>
            <label className="checkbox-inline">
              <input type="checkbox" checked={maskStage} onChange={(e) => setMaskStage(e.target.checked)} />
              추첨 화면에서 이름 가리기
            </label>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={() => setStage({ data: stageDataFromDraw(draw), mode: 'replay' })}>
                추첨 화면 다시 보기
              </button>
              <Link className="btn" to={`/admin/events/${eventId}/draw/report`} target="_blank">증빙서 출력 (PDF)</Link>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={handleRedraw}>재추첨</button>
            </div>
          </section>

          {vacancy > 0 && (
            <p className="notice-box">
              당첨자 {vacancy}명 자리가 비어 있습니다. 예비 순번이 모두 소진되었습니다. 필요하면 대상자에게 별도로 안내해 주세요.
            </p>
          )}

          <section className="admin-panel">
            <h3>당첨자 ({selected.length}/{draw.winnerCount}명) — 현재 기준</h3>
            <table>
              <thead><tr><th>순번</th><th>동</th><th>호수</th><th>성명</th><th>연락처</th><th>비고</th></tr></thead>
              <tbody>
                {selected.map((a, i) => (
                  <tr key={a.id}>
                    <td>{i + 1}</td><td>{a.dong}동</td><td>{a.ho}호</td><td>{nameCell(a)}</td><td>{a.phone}</td>
                    <td>{a.promotedAt ? '예비 승계' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="admin-panel">
            <h3>예비 ({reserve.length}명)</h3>
            {reserve.length === 0 ? (
              <p className="muted">남은 예비 순번이 없습니다.</p>
            ) : (
              <table>
                <thead><tr><th>예비</th><th>동</th><th>호수</th><th>성명</th><th>연락처</th></tr></thead>
                <tbody>
                  {reserve.map((a) => (
                    <tr key={a.id}>
                      <td>예비 {a.reserveNo}번</td><td>{a.dong}동</td><td>{a.ho}호</td><td>{nameCell(a)}</td><td>{a.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <details className="admin-panel">
            <summary>미당첨 {notSelected.length}명 보기</summary>
            <table>
              <thead><tr><th>동</th><th>호수</th><th>성명</th><th>연락처</th></tr></thead>
              <tbody>
                {notSelected.map((a) => (
                  <tr key={a.id}><td>{a.dong}동</td><td>{a.ho}호</td><td>{nameCell(a)}</td><td>{a.phone}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}

      {stage && (
        <div className="draw-overlay">
          <DrawStage
            data={stage.data}
            mode={stage.mode}
            maskNames={maskStage}
            onClose={() => setStage(null)}
          >
            <Link className="stage-cta stage-cta-link" to={`/admin/events/${eventId}/draw/report`} target="_blank">
              증빙서 출력 (PDF)
            </Link>
          </DrawStage>
        </div>
      )}
    </div>
  );
}
