import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getCountFromServer, getDocs, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { getCapacityPercent, getCompetitionRatio, getEventStatus, getEventWhen, isLottery } from '../../utils/format';
import { daysUntilClose, getEventGroup, hiddenDays, isAwaitingDraw } from '../../utils/adminEvents';
import ConfirmSheet from '../../components/ConfirmSheet';
import { IconCalendar, IconEdit, IconEye, IconEyeOff, IconFile, IconLock, IconMore, IconPin, IconPlus, IconShuffle, IconTrash, IconUsers } from '../../components/icons';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'open', label: '접수중' },
  { key: 'closed', label: '마감·추첨' },
  { key: 'over', label: '종료' },
  { key: 'draft', label: '준비중' },
  { key: 'hidden', label: '숨김' },
];

// 카드에서 지금 가장 필요한 버튼 하나를 정합니다.
function getPrimaryAction(event) {
  if (isLottery(event)) {
    if (event.drawStatus === 'done') return { label: '추첨결과 보기', to: `/admin/events/${event.id}/draw`, kind: 'outline', icon: 'shuffle' };
    if (isAwaitingDraw(event)) return { label: '추첨하기', to: `/admin/events/${event.id}/draw`, kind: 'primary', icon: 'shuffle' };
  }
  return { label: '신청현황 보기', to: `/admin/applications?event=${event.id}`, kind: 'outline' };
}

function EventActionSheet({ event, onClose, onEarlyClose, onToggleHidden, onDelete }) {
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canClose = event.status === 'open' && getEventGroup(event) === 'open';
  const lottery = isLottery(event);

  function go(path) {
    onClose();
    navigate(path);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label="행사 메뉴" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-eyebrow">행사 관리</div>
        <div className="sheet-title">{event.title}</div>

        <button type="button" className="sheet-item" onClick={() => go(`/admin/events/${event.id}`)}>
          <IconEdit /> 행사 수정
        </button>
        <button type="button" className="sheet-item" onClick={() => go(`/admin/applications?event=${event.id}`)}>
          <IconUsers size={22} /> 신청현황 보기
        </button>
        {lottery && event.drawStatus === 'done' && (
          <button type="button" className="sheet-item" onClick={() => go(`/admin/events/${event.id}/draw/report`)}>
            <IconFile /> 추첨 증빙서 보기
          </button>
        )}
        {canClose && (
          <button type="button" className="sheet-item" onClick={() => onEarlyClose(event)}>
            <IconLock /> 지금 접수 마감하기
          </button>
        )}
        <button type="button" className="sheet-item" onClick={() => onToggleHidden(event)}>
          {event.hidden ? <IconEye /> : <IconEyeOff />} {event.hidden ? '숨김 해제 (입주민 화면에 다시 표시)' : '입주민 화면에서 숨기기'}
        </button>
        <button
          type="button"
          className="sheet-item sheet-item-danger"
          onClick={() => event.hidden && onDelete(event)}
          disabled={!event.hidden}
          aria-disabled={!event.hidden}
        >
          <IconTrash /> 행사 삭제
        </button>
        <p className="sheet-note">
          {event.hidden
            ? '삭제하면 신청 내역·추첨 기록·배너 이미지가 모두 사라지며 복구할 수 없습니다.'
            : "삭제는 '숨김' 상태인 행사만 할 수 있습니다. 먼저 '입주민 화면에서 숨기기'를 해 주세요."}
        </p>
        <button type="button" className="btn btn-block sheet-close" onClick={onClose}>닫기</button>
      </section>
    </div>
  );
}

function DeleteEventDialog({ event, onClose, onDeleted }) {
  const [count, setCount] = useState(null); // null: 확인 중, -1: 확인 실패
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const snap = await getCountFromServer(query(collection(db, 'applications'), where('eventId', '==', event.id)));
        setCount(snap.data().count);
      } catch {
        setCount(-1);
      }
    })();
  }, [event.id]);

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      const res = await httpsCallable(functions, 'deleteEvent')({ eventId: event.id });
      onDeleted(res.data);
    } catch (err) {
      setError(err.message?.replace(/^\S+:\s*/, '') || '삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
    }
  }

  const drawn = isLottery(event) && event.drawStatus === 'done';
  return (
    <ConfirmSheet
      eyebrow="행사 삭제"
      title={event.title}
      confirmLabel="영구 삭제"
      requireText={count === 0 ? '' : event.title}
      disabled={count === null}
      busy={busy}
      error={error}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      <p>
        {count === null ? '신청 내역을 확인하는 중입니다...' : count >= 0 ? `신청 내역 ${count}건(취소·예비 포함)` : '신청 내역'}
        , 추첨 증빙 기록, 배너 이미지가 <strong>모두 삭제</strong>되며 복구할 수 없습니다.
      </p>
      <p className="confirm-links">
        삭제 전에 필요한 자료를 받아 두세요:{' '}
        <Link to={`/admin/applications?event=${event.id}`} target="_blank">신청현황 (엑셀 받기)</Link>
        {drawn && (
          <>
            {' · '}
            <Link to={`/admin/events/${event.id}/draw/report`} target="_blank">추첨 증빙서 (PDF 저장)</Link>
          </>
        )}
      </p>
    </ConfirmSheet>
  );
}

function EventAdminCard({ event, onOpenMenu }) {
  const status = getEventStatus(event);
  const when = getEventWhen(event);
  const lottery = isLottery(event);
  const awaiting = isAwaitingDraw(event);
  const action = getPrimaryAction(event);
  const ratio = lottery ? getCompetitionRatio(event) : null;
  const applied = event.appliedCount ?? 0;
  const percent = getCapacityPercent(event);

  // 추첨 대기는 상태 배지를 따로 크게 보여 줍니다.
  const badge = awaiting
    ? { label: '추첨 대기 · 접수 마감', tone: 'waiting' }
    : { label: status.dday ? `${status.label} · ${status.dday}` : status.label, tone: status.tone };

  return (
    <article className={`admin-event-card${awaiting ? ' admin-event-card-attention' : ''}${event.hidden ? ' admin-event-card-hidden' : ''}`}>
      <div className="admin-event-card-top">
        <div className="admin-event-card-badges">
          <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
          {event.hidden && (
            <span className="badge badge-hidden">
              <IconEyeOff size={14} />숨김{hiddenDays(event) ? ` · ${hiddenDays(event)}일째` : ''}
            </span>
          )}
        </div>
        <button type="button" className="icon-button" aria-label={`${event.title} 더보기 메뉴`} onClick={() => onOpenMenu(event)}>
          <IconMore />
        </button>
      </div>

      <h3 className="admin-event-title">{event.title}</h3>

      <div className="admin-event-when"><IconCalendar size={18} />{when.full}</div>
      {event.place && <div className="admin-event-place"><IconPin size={18} />{event.place}</div>}

      <div className="detail-divider" />

      {lottery ? (
        <div className="admin-event-stats">
          <IconUsers size={18} />
          <strong>신청 {applied}명</strong>
          <span className="muted">· 선발 {event.capacity}명</span>
          {ratio && <span className="ratio-pill">경쟁률 {ratio}</span>}
        </div>
      ) : (
        <>
          <div className="admin-event-stats">
            <strong>{applied} / {event.capacity}명</strong>
            <span className="muted">· 선착순</span>
          </div>
          <div className="capacity-track"><div className="capacity-fill" style={{ width: `${percent}%` }} /></div>
        </>
      )}

      <div className="admin-event-chips">
        <span className="chip">{lottery ? '추첨' : '선착순'}</span>
        <span className="chip">{event.multiPerHousehold ? '가족 여러 명 가능' : '세대당 1명'}</span>
        {event.groupId && <span className="chip">그룹 · {event.groupTitle || event.groupId}</span>}
      </div>

      <Link to={action.to} className={`btn btn-action ${action.kind === 'primary' ? 'btn-primary' : 'btn-outline'}`}>
        {action.icon === 'shuffle' && <IconShuffle size={20} />}
        {action.label}
      </Link>
    </article>
  );
}

export default function AdminEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [menuEvent, setMenuEvent] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [notice, setNotice] = useState(null); // { tone, text }
  const [recentCancels, setRecentCancels] = useState({}); // { eventId: 최근 24시간 취소 건수 }
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('applyStart', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  // 최근 24시간에 취소된 신청 수(행사별). 실패해도 화면은 정상 동작합니다.
  useEffect(() => {
    (async () => {
      try {
        const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
        const snap = await getDocs(query(collection(db, 'applications'), where('cancelledAt', '>=', since)));
        const counts = {};
        snap.docs.forEach((d) => {
          const id = d.data().eventId;
          counts[id] = (counts[id] || 0) + 1;
        });
        setRecentCancels(counts);
      } catch {
        setRecentCancels({});
      }
    })();
  }, []);

  const now = new Date();
  const grouped = useMemo(() => events.map((e) => ({ ...e, _group: getEventGroup(e) })), [events]);

  const counts = {
    all: grouped.length,
    open: grouped.filter((e) => e._group === 'open').length,
    closed: grouped.filter((e) => e._group === 'closed').length,
    over: grouped.filter((e) => e._group === 'over').length,
    draft: grouped.filter((e) => e._group === 'draft').length,
    hidden: grouped.filter((e) => e.hidden === true).length,
  };

  const awaitingDraw = grouped.filter((e) => isAwaitingDraw(e, now));
  const closingSoon = grouped.filter((e) => {
    const d = daysUntilClose(e, now);
    return d !== null && d <= 1;
  });
  const cancelTotal = Object.values(recentCancels).reduce((s, n) => s + n, 0);
  const cancelEventId = Object.entries(recentCancels).sort((a, b) => b[1] - a[1])[0]?.[0];

  const visible = grouped.filter((e) => filter === 'all' || (filter === 'hidden' ? e.hidden === true : e._group === filter));

  async function handleToggleHidden(event) {
    setMenuEvent(null);
    setNotice(null);
    try {
      if (event.hidden) {
        if (!window.confirm(`'${event.title}' 행사를 입주민 화면에 다시 표시하시겠습니까?`)) return;
        await updateDoc(doc(db, 'events', event.id), { hidden: false, hiddenAt: null, updatedAt: serverTimestamp() });
        setNotice({ tone: 'ok', text: `'${event.title}' 행사를 입주민 화면에 다시 표시합니다.` });
        return;
      }
      const over = getEventGroup(event) === 'over';
      const applied = event.appliedCount ?? 0;
      const message = over
        ? `'${event.title}' 행사를 입주민 화면에서 숨기시겠습니까?\n관리자 화면에서는 그대로 보이며, 언제든 숨김을 해제할 수 있습니다.`
        : `'${event.title}' 행사는 아직 끝나지 않았습니다.${applied > 0 ? `\n신청자 ${applied}명이 있습니다.` : ''}\n숨기면 입주민은 이 행사와 자신의 신청 내역을 볼 수 없고, 새 신청도 받을 수 없습니다.\n그래도 숨기시겠습니까?`;
      if (!window.confirm(message)) return;
      await updateDoc(doc(db, 'events', event.id), { hidden: true, hiddenAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setNotice({ tone: 'ok', text: `'${event.title}' 행사를 입주민 화면에서 숨겼습니다. 관리자 화면에서는 그대로 보입니다.` });
    } catch {
      setNotice({ tone: 'error', text: '숨김 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  }

  function handleDeleteStart(event) {
    setMenuEvent(null);
    setNotice(null);
    setDeleteTarget(event);
  }

  function handleDeleted(result) {
    setDeleteTarget(null);
    setNotice({ tone: 'ok', text: `'${result.title}' 행사를 삭제했습니다. (신청 내역 ${result.applications}건 삭제)` });
  }

  async function handleEarlyClose(event) {
    if (!window.confirm('신청 기간이 남아있어도 지금 바로 접수를 마감하시겠습니까?')) return;
    setMenuEvent(null);
    await updateDoc(doc(db, 'events', event.id), { status: 'closed', updatedAt: serverTimestamp() });
  }

  if (loading) return <div className="page-loading">불러오는 중...</div>;

  return (
    <div className="admin-events">
      <div className="page-header-row">
        <h2 className="page-title">행사 관리</h2>
        <button type="button" className="btn btn-primary btn-new-event" onClick={() => navigate('/admin/events/new')}>
          <IconPlus size={18} />새 행사
        </button>
      </div>

      {notice && (
        <p className={notice.tone === 'error' ? 'form-error' : 'admin-accounts-notice'} role="status">{notice.text}</p>
      )}

      <section className="today-section" aria-label="오늘 할 일">
        <h3 className="section-label">오늘 할 일</h3>
        <div className="today-tiles">
          <button
            type="button"
            className={`today-tile today-tile-gold${awaitingDraw.length ? '' : ' today-tile-zero'}`}
            onClick={() => awaitingDraw.length && setFilter('closed')}
          >
            <span className="today-num">{awaitingDraw.length}</span>
            <span className="today-label">추첨 대기</span>
          </button>
          <button
            type="button"
            className={`today-tile today-tile-danger${closingSoon.length ? '' : ' today-tile-zero'}`}
            onClick={() => closingSoon.length && setFilter('open')}
          >
            <span className="today-num">{closingSoon.length}</span>
            <span className="today-label">마감 임박</span>
          </button>
          <button
            type="button"
            className={`today-tile${cancelTotal ? '' : ' today-tile-zero'}`}
            onClick={() => cancelEventId && navigate(`/admin/applications?event=${cancelEventId}&tab=cancelled`)}
          >
            <span className="today-num">{cancelTotal}</span>
            <span className="today-label">새 취소</span>
          </button>
        </div>
        <p className="today-help">새 취소는 최근 24시간 기준입니다.</p>
      </section>

      <nav className="filter-chips" aria-label="행사 필터">
        {FILTERS.filter((f) => (f.key !== 'draft' || counts.draft > 0) && (f.key !== 'hidden' || counts.hidden > 0)).map((f) => (
          <button
            key={f.key}
            type="button"
            className={`filter-chip${filter === f.key ? ' active' : ''}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {counts[f.key]}
          </button>
        ))}
      </nav>

      {visible.length === 0 ? (
        <p className="empty-state">{events.length === 0 ? '등록된 행사가 없습니다.' : '이 구분에 해당하는 행사가 없습니다.'}</p>
      ) : (
        <div className="admin-event-grid">
          {visible.map((e) => (
            <EventAdminCard key={e.id} event={e} onOpenMenu={setMenuEvent} />
          ))}
        </div>
      )}

      {menuEvent && (
        <EventActionSheet
          event={menuEvent}
          onClose={() => setMenuEvent(null)}
          onEarlyClose={handleEarlyClose}
          onToggleHidden={handleToggleHidden}
          onDelete={handleDeleteStart}
        />
      )}

      {deleteTarget && (
        <DeleteEventDialog event={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={handleDeleted} />
      )}
    </div>
  );
}
