import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, getDocs, query, collection, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTime, getEventStatus, isApplyOpen, isEventFull } from '../../utils/format';

export default function EventDetail() {
  const { eventId } = useParams();
  const { household, user } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myApplication, setMyApplication] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [answers, setAnswers] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadStatusList = useCallback(async () => {
    try {
      const getApplicationStatus = httpsCallable(functions, 'getApplicationStatus');
      const result = await getApplicationStatus({ eventId });
      setStatusList(result.data.applications || []);
    } catch (err) {
      console.error(err);
    }
  }, [eventId]);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, 'events', eventId));
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });

      const myQ = query(
        collection(db, 'applications'),
        where('eventId', '==', eventId),
        where('householdId', '==', user.uid)
      );
      const myApps = await getDocs(myQ);
      const active = myApps.docs.find((d) => ['applied', 'waiting'].includes(d.data().status));
      if (active) {
        setMyApplication({ id: active.id, ...active.data() });
      }

      await loadStatusList();
      setLoading(false);
    }
    load();
  }, [eventId, user.uid, loadStatusList]);

  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (!event) return <p className="empty-state">존재하지 않는 행사입니다.</p>;

  const status = getEventStatus(event);
  const canApply = isApplyOpen(event) && !myApplication;
  const full = isEventFull(event);
  const extraFields = event.extraFields || [];

  async function handleApply(e) {
    e.preventDefault();
    setError('');
    if (!agreed) {
      setError('개인정보 수집·이용에 동의해주세요.');
      return;
    }
    for (const f of extraFields) {
      if (f.required && !answers[f.id]) {
        setError(`${f.label} 항목을 선택(입력)해주세요.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const applyToEvent = httpsCallable(functions, 'applyToEvent');
      await applyToEvent({ eventId, answers });
      await loadStatusList();
      navigate('/my');
    } catch (err) {
      setError(err.message?.replace(/^\S+:\s*/, '') || '신청 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="event-detail">
      <button className="link-button back-link" onClick={() => navigate('/events')}>&larr; 목록으로</button>

      <div className={`badge badge-${status.tone}`}>{status.label}</div>
      <h2 className="page-title">{event.title}</h2>
      <p className="event-description">{event.description}</p>

      <dl className="event-detail-meta">
        <div><dt>행사일시</dt><dd>{formatDateTime(event.eventStart)} ~ {formatDateTime(event.eventEnd)}</dd></div>
        <div><dt>장소</dt><dd>{event.place}</dd></div>
        <div><dt>접수기간</dt><dd>{formatDateTime(event.applyStart)} ~ {formatDateTime(event.applyEnd)}</dd></div>
        <div><dt>정원</dt><dd>{event.appliedCount ?? 0} / {event.capacity}명</dd></div>
      </dl>

      {event.groupId && (
        <div className="notice-box notice-box-muted">
          이 행사는 같은 그룹의 다른 날짜와 묶여 있어, 그 중 하루만 신청하실 수 있습니다.
        </div>
      )}

      {myApplication ? (
        <div className="notice-box">
          {myApplication.status === 'waiting'
            ? '대기 신청 상태입니다. 자리가 나면 순서대로 자동으로 신청 확정됩니다. "나의 신청내역"에서 확인·취소하실 수 있습니다.'
            : '이미 신청하셨습니다. "나의 신청내역"에서 수정 또는 취소하실 수 있습니다.'}
        </div>
      ) : !isApplyOpen(event) ? (
        <div className="notice-box">현재 신청할 수 없는 행사입니다.</div>
      ) : (
        <form className="application-form" onSubmit={handleApply}>
          <h3>신청서</h3>
          {full && (
            <div className="notice-box notice-box-muted">
              정원이 마감되어 대기 신청으로 접수됩니다. 취소가 발생하면 대기 순서대로 자동 신청 확정됩니다.
            </div>
          )}
          <div className="field-row">
            <div className="field">
              <label>동/호수</label>
              <input value={`${household.dong}동 ${household.ho}호`} disabled />
            </div>
          </div>

          {extraFields.map((f) => (
            <div className="field" key={f.id}>
              <label>{f.label}{f.required && ' *'}</label>
              {f.type === 'select' ? (
                <select
                  value={answers[f.id] || ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                >
                  <option value="">선택해주세요</option>
                  {(f.options || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={answers[f.id] || ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                />
              )}
            </div>
          ))}

          <label className="checkbox-row">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            (필수) 개인정보 수집·이용에 동의합니다. 수집항목: 동/호수, 연락처 / 목적: 행사 신청·운영 / 보유기간: 행사 종료 후 1년
          </label>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting || !canApply}>
            {submitting ? '신청 중...' : full ? '대기 신청하기' : '신청하기'}
          </button>
        </form>
      )}

      <div className="status-list">
        <h3>신청 현황 ({statusList.length}건)</h3>
        {statusList.length === 0 ? (
          <p className="empty-state">아직 신청자가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr><th>동</th><th>호수</th><th>이름</th><th>연락처</th></tr>
            </thead>
            <tbody>
              {statusList.map((a, i) => (
                <tr key={i}>
                  <td>{a.dong}동</td>
                  <td>{a.ho}호</td>
                  <td>{a.name || '-'}</td>
                  <td>{a.phoneTail ? `010-****-${a.phoneTail}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
