import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, getDocs, query, collection, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTime, getEventStatus, isApplyOpen, isEventFull } from '../../utils/format';

// 숫자만 남기고 010-0000-0000 형식으로 자동 정리합니다.
function formatPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export default function EventDetail() {
  const { eventId } = useParams();
  const { household, user } = useAuth();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [myApplication, setMyApplication] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [waitingList, setWaitingList] = useState([]);
  const [residentName, setResidentName] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadStatusList = useCallback(async () => {
    try {
      const getApplicationStatus = httpsCallable(functions, 'getApplicationStatus');
      const result = await getApplicationStatus({ eventId });
      setStatusList(result.data.applications || []);
      setWaitingList(result.data.waiting || []);
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

  function updatePhone(value) {
    setPhone(formatPhone(value));
  }

  async function handleApply(e) {
    e.preventDefault();
    setError('');
    if (!residentName.trim()) {
      setError('이름을 입력해주세요.');
      return;
    }
    if (!/^010-\d{4}-\d{4}$/.test(phone)) {
      setError('연락처는 010-0000-0000 형식으로 입력해주세요.');
      return;
    }
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
      await applyToEvent({ eventId, answers, residentName: residentName.trim(), phone });
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

      <div className="event-hero">
        {event.bannerImageUrl && (
          <img className="event-hero-banner" src={event.bannerImageUrl} alt={event.title} />
        )}
        <div className="event-hero-body">
          <div className={`badge badge-${status.tone}`}>{status.label}</div>
          <h2 className="event-hero-title">{event.title}</h2>
          {event.description && <p className="event-description">{event.description}</p>}

          <dl className="event-detail-meta">
            <div><dt>행사일시</dt><dd>{formatDateTime(event.eventStart)} ~ {formatDateTime(event.eventEnd)}</dd></div>
            <div><dt>장소</dt><dd>{event.place}</dd></div>
            <div><dt>접수기간</dt><dd>{formatDateTime(event.applyStart)} ~ {formatDateTime(event.applyEnd)}</dd></div>
            <div><dt>정원</dt><dd>{event.appliedCount ?? 0} / {event.capacity}명</dd></div>
          </dl>
        </div>
      </div>

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
          <div className="field-row">
            <div className="field">
              <label htmlFor="residentName">이름</label>
              <input
                id="residentName"
                placeholder="예: 홍길동"
                value={residentName}
                onChange={(e) => setResidentName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="applyPhone">연락처</label>
              <input
                id="applyPhone"
                placeholder="010-0000-0000"
                value={phone}
                onChange={(e) => updatePhone(e.target.value)}
                inputMode="numeric"
                maxLength={13}
              />
            </div>
          </div>
          <p className="muted small-note">같은 세대라도 신청하시는 분의 이름과 연락처를 입력해주세요.</p>

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
            (필수) 개인정보 수집·이용에 동의합니다. 수집항목: 동/호수, 이름, 연락처 / 목적: 행사 신청·운영 / 보유기간: 행사 종료 후 1년
          </label>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting || !canApply}>
            {submitting ? '신청 중...' : full ? '대기 신청하기' : '신청하기'}
          </button>
        </form>
      )}

      <div className="status-list">
        <h3>신청 현황 ({statusList.length}{event.capacity ? ` / ${event.capacity}` : ''}건)</h3>
        {statusList.length === 0 ? (
          <p className="empty-state">아직 신청자가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr><th>번호</th><th>동</th><th>호수</th><th>이름</th><th>연락처</th></tr>
            </thead>
            <tbody>
              {statusList.map((a, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
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

      {waitingList.length > 0 && (
        <div className="status-list">
          <h3>대기자 명단 ({waitingList.length}건)</h3>
          <p className="muted small-note">정원 마감 이후 신청한 분들로, 취소가 발생하면 대기 순서대로 자동 신청 확정됩니다.</p>
          <table>
            <thead>
              <tr><th>대기순번</th><th>동</th><th>호수</th><th>이름</th><th>연락처</th></tr>
            </thead>
            <tbody>
              {waitingList.map((a, i) => (
                <tr key={i}>
                  <td>대기 {i + 1}</td>
                  <td>{a.dong}동</td>
                  <td>{a.ho}호</td>
                  <td>{a.name || '-'}</td>
                  <td>{a.phoneTail ? `010-****-${a.phoneTail}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
