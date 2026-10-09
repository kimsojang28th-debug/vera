import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, getDocs, query, collection, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatApplyPeriod, getCapacityPercent, getCompetitionRatio, getEventStatus, getEventWhen, isApplyOpen, isEventFull, isLottery } from '../../utils/format';
import { getApplicationBadge } from '../../utils/draw';
import { IconCalendar, IconCheckSquare, IconClock, IconPin, IconShuffle, IconUsers } from '../../components/icons';

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
  const [myApplications, setMyApplications] = useState([]);
  const [statusList, setStatusList] = useState([]);
  const [waitingList, setWaitingList] = useState([]);
  const [drawState, setDrawState] = useState({ drawn: false, selected: [], reserve: [] });
  const [residentName, setResidentName] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitMessage, setSubmitMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  const loadEvent = useCallback(async () => {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
  }, [eventId]);

  const loadStatusList = useCallback(async () => {
    try {
      const getApplicationStatus = httpsCallable(functions, 'getApplicationStatus');
      const result = await getApplicationStatus({ eventId });
      setStatusList(result.data.applications || []);
      setWaitingList(result.data.waiting || []);
      setDrawState({
        drawn: result.data.drawn === true,
        selected: result.data.selected || [],
        reserve: result.data.reserve || [],
      });
    } catch (err) {
      console.error(err);
    }
  }, [eventId]);

  const loadMyApplications = useCallback(async () => {
    const myQ = query(
      collection(db, 'applications'),
      where('eventId', '==', eventId),
      where('householdId', '==', user.uid)
    );
    const myApps = await getDocs(myQ);
    const active = myApps.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => ['applied', 'waiting', 'selected', 'reserve', 'notSelected'].includes(a.status));
    setMyApplications(active);
  }, [eventId, user.uid]);

  useEffect(() => {
    async function load() {
      await loadEvent();
      await loadMyApplications();
      await loadStatusList();
      setLoading(false);
    }
    load();
  }, [loadEvent, loadMyApplications, loadStatusList]);

  // 신청서가 화면에 보이면 하단 고정 '신청하기' 버튼을 숨깁니다.
  useEffect(() => {
    const el = document.getElementById('apply-form');
    if (!el || typeof IntersectionObserver === 'undefined') {
      setFormVisible(false);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setFormVisible(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, myApplications.length, event?.id]);

  if (loading) return <div className="page-loading">불러오는 중...</div>;
  if (!event) return <p className="empty-state">존재하지 않는 행사입니다.</p>;

  const status = getEventStatus(event);
  const lottery = isLottery(event);
  const percent = lottery ? 100 : getCapacityPercent(event);
  const when = getEventWhen(event);
  const ratio = getCompetitionRatio(event);
  const applied = event.appliedCount ?? 0;
  const multiPerHousehold = event.multiPerHousehold === true;
  const canApply = isApplyOpen(event) && (multiPerHousehold || myApplications.length === 0);
  const full = isEventFull(event);
  const extraFields = event.extraFields || [];

  function updatePhone(value) {
    setPhone(formatPhone(value));
  }

  async function handleApply(e) {
    e.preventDefault();
    setError('');
    setSubmitMessage('');
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
      const appliedName = residentName.trim();
      await applyToEvent({ eventId, answers, residentName: appliedName, phone });

      if (multiPerHousehold) {
        // 가족 여러 명이 이어서 신청할 수 있도록 페이지를 벗어나지 않고 폼을 초기화합니다.
        setResidentName('');
        setPhone('');
        setAnswers({});
        setAgreed(false);
        setSubmitMessage(`${appliedName}님 신청이 완료되었습니다. 다른 가족이 더 신청하시려면 아래에 이어서 입력해주세요.`);
        await Promise.all([loadEvent(), loadMyApplications(), loadStatusList()]);
      } else {
        await loadStatusList();
        navigate('/my');
      }
    } catch (err) {
      setError(err.message?.replace(/^\S+:\s*/, '') || '신청 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="event-detail">
      <button className="link-button back-link" onClick={() => navigate('/events')}>← 목록으로</button>

      <div className="event-hero">
        {event.bannerImageUrl && (
          <img className="event-hero-banner" src={event.bannerImageUrl} alt={event.title} />
        )}
        <div className="event-hero-body">
          <div className={`badge badge-${status.tone} badge-lg`}>
            {status.label}{status.dday ? ` · ${status.dday}` : ''}
          </div>
          <h2 className="event-hero-title">{event.title}</h2>
          {event.description && <p className="event-description">{event.description}</p>}
        </div>
      </div>

      <section className="detail-card">
        <div className="when-block">
          <div className="date-tile">
            <span className="date-tile-month">{when.month}</span>
            <span className="date-tile-day">{when.day}</span>
            <span className="date-tile-weekday">{when.weekdayLong}</span>
          </div>
          <div>
            <div className="info-label"><IconCalendar size={16} />행사일시</div>
            <div className="when-time">{when.timeLabel}</div>
          </div>
        </div>
        <div className="detail-divider" />
        <div className="info-row">
          <div className="icon-circle"><IconPin size={18} /></div>
          <div>
            <div className="info-label">장소</div>
            <div className="info-value">{event.place}</div>
          </div>
        </div>
        <div className="info-row">
          <div className="icon-circle"><IconClock size={18} /></div>
          <div>
            <div className="info-label">접수기간</div>
            <div className="info-value">{formatApplyPeriod(event)}</div>
          </div>
        </div>
      </section>

      <section className="detail-card">
        <p className="detail-note">
          {lottery
            ? `접수 마감까지 신청 순서와 관계없이 모두 접수되며, 마감 후 추첨으로 ${event.capacity}명을 선발합니다.`
            : '정원이 차면 이후 신청은 대기로 접수되고, 취소가 생기면 대기 순서대로 자동 확정됩니다.'}
        </p>
        <div className="stat-grid">
          <div className="stat-tile">
            <IconShuffle size={22} />
            <span className="stat-label">모집방식</span>
            <span className="stat-value">{lottery ? '추첨' : '선착순'}</span>
          </div>
          <div className="stat-tile">
            <IconUsers size={22} />
            <span className="stat-label">{lottery ? '선발 인원' : '정원'}</span>
            <span className="stat-value">{event.capacity}명</span>
          </div>
          <div className="stat-tile">
            <IconCheckSquare size={22} />
            <span className="stat-label">현재 신청</span>
            <span className="stat-value">{applied}명</span>
          </div>
        </div>
        <div className="capacity-row capacity-row-lg">
          <div className="capacity-track"><div className={`capacity-fill${lottery ? ' capacity-fill-lottery' : ''}`} style={{ width: `${percent}%` }} /></div>
          <span className="capacity-label capacity-label-lg">{lottery ? (ratio ? `경쟁률 ${ratio}` : '접수 중') : `${percent}%`}</span>
        </div>
      </section>

      {lottery && drawState.drawn && (
        <section className="detail-card draw-result-card">
          <h3 className="draw-result-title">추첨 결과</h3>
          {myApplications.length > 0 && (
            <ul className="my-result-list">
              {myApplications.map((a) => {
                const badge = getApplicationBadge(a, true);
                return (
                  <li key={a.id}>
                    <span className={`badge badge-${badge.tone} badge-lg`}>{badge.label}</span>
                    <span className="my-result-name">{a.residentName}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link className="btn btn-block" to={`/events/${event.id}/draw`}>추첨 과정 다시 보기</Link>
          <div>
            <div className="info-label">당첨자 ({drawState.selected.length}명)</div>
            <table className="result-table">
              <thead><tr><th>번호</th><th>동</th><th>호수</th><th>이름</th></tr></thead>
              <tbody>
                {drawState.selected.map((a, i) => (
                  <tr key={i}><td>{i + 1}</td><td>{a.dong}동</td><td>{a.ho}호</td><td>{a.name || '-'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {drawState.reserve.length > 0 && (
            <div>
              <div className="info-label">예비 ({drawState.reserve.length}명)</div>
              <table className="result-table">
                <thead><tr><th>순번</th><th>동</th><th>호수</th><th>이름</th></tr></thead>
                <tbody>
                  {drawState.reserve.map((a, i) => (
                    <tr key={i}><td>예비 {a.reserveNo}</td><td>{a.dong}동</td><td>{a.ho}호</td><td>{a.name || '-'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small-note">당첨자가 취소하면 예비 순번대로 자동 당첨됩니다. 명단은 이름을 가려서 표시합니다.</p>
        </section>
      )}

      {event.groupId && (
        <div className="notice-box notice-box-muted">
          이 행사는 같은 그룹의 다른 날짜와 묶여 있어, {multiPerHousehold ? '한 분당 그 중 하루만' : '그 중 하루만'} 신청하실 수 있습니다.
        </div>
      )}

      {multiPerHousehold && (
        <div className="notice-box notice-box-muted">
          이 행사는 한 세대에서 가족 여러 명이 각자 신청하실 수 있습니다. 신청하시는 분마다 이름과 연락처를 입력해주세요.
        </div>
      )}

      {multiPerHousehold && myApplications.length > 0 && (
        <div className="notice-box notice-box-muted">
          우리 세대에서 이미 신청하신 분: {myApplications.map((a) => `${a.residentName}(${getApplicationBadge(a, lottery).label})`).join(', ')}
        </div>
      )}

      {submitMessage && <div className="notice-box">{submitMessage}</div>}

      {!isApplyOpen(event) || (lottery && drawState.drawn) ? (
        !(lottery && drawState.drawn) && <div className="notice-box">현재 신청할 수 없는 행사입니다.</div>
      ) : !multiPerHousehold && myApplications.length > 0 ? (
        <div className="notice-box">
          {myApplications[0].status === 'waiting'
            ? '대기 신청 상태입니다. 자리가 나면 순서대로 자동으로 신청 확정됩니다. "나의 신청내역"에서 확인·취소하실 수 있습니다.'
            : lottery
              ? '추첨 접수가 완료되었습니다. 접수 마감 후 추첨으로 선발되며, "나의 신청내역"에서 수정 또는 취소하실 수 있습니다.'
              : '이미 신청하셨습니다. "나의 신청내역"에서 수정 또는 취소하실 수 있습니다.'}
        </div>
      ) : (
        <form id="apply-form" className="application-form" onSubmit={handleApply}>
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
            (필수) 개인정보 수집·이용에 동의합니다. 수집항목: 동/호수, 이름, 연락처 / 목적: 행사 신청·운영
          </label>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={submitting || !canApply}>
            {submitting ? '신청 중...' : full ? '대기 신청하기' : '신청하기'}
          </button>
        </form>
      )}

      <div className="status-list">
        <h3>{lottery ? `접수 현황 (${statusList.length}건 · 신청순)` : `신청 현황 (${statusList.length}${event.capacity ? ` / ${event.capacity}` : ''}건)`}</h3>
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

      {isApplyOpen(event) && canApply && !formVisible && !(lottery && drawState.drawn) && (
        <div className="cta-bar">
          <div className="cta-bar-inner">
            <button
              type="button"
              className="btn btn-primary btn-cta"
              onClick={() => document.getElementById('apply-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {lottery ? '추첨 신청하기' : full ? '대기 신청하기' : '신청하기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
