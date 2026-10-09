import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { getCapacityPercent, getCompetitionRatio, getEventStatus, getEventWhen, isLottery } from '../../utils/format';
import { daysUntilClose, getEventGroup, isAwaitingDraw } from '../../utils/adminEvents';
import { IconCalendar, IconEdit, IconFile, IconLock, IconMore, IconPin, IconPlus, IconShuffle, IconTrash, IconUsers } from '../../components/icons';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'open', label: '접수중' },
  { key: 'closed', label: '마감·추첨' },
  { key: 'over', label: '종료' },
  { key: 'draft', label: '준비중' },
];

// 카드에서 지금 가장 필요한 버튼 하나를 정합니다.
function getPrimaryAction(event) {
  if (isLottery(event)) {
    if (event.drawStatus === 'done') return { label: '추첨결과 보기', to: `/admin/events/${event.id}/draw`, kind: 'outline', icon: 'shuffle' };
    if (isAwaitingDraw(event)) return { label: '추첨하기', to: `/admin/events/${event.id}/draw`, kind: 'primary', icon: 'shuffle' };
  }
  return { label: '신청현황 보기', to: `/admin/applications?event=${event.id}`, kind: 'outline' };
}

function EventActionSheet({ event, onClose, onEarlyClose, onDelete }) {
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
        <button type="button" className="sheet-item sheet-item-danger" onClick={() => onDelete(event)}>
          <IconTrash /> 행사 삭제
        </button>
        <p className="sheet-note">삭제 전에 한 번 더 확인합니다. 행사를 삭제해도 신청 내역은 삭제되지 않습니다.</p>
        <button type="button" className="btn btn-block sheet-close" onClick={onClose}>닫기</button>
      </section>
    </div>
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
    <article className={`admin-event-card${awaiting ? ' admin-event-card-attention' : ''}`}>
      <div className="admin-event-card-top">
        <span className={`badge badge-${badge.tone}`}>{badge.label}</span>
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
  };

  const awaitingDraw = grouped.filter((e) => isAwaitingDraw(e, now));
  const closingSoon = grouped.filter((e) => {
    const d = daysUntilClose(e, now);
    return d !== null && d <= 1;
  });
  const cancelTotal = Object.values(recentCancels).reduce((s, n) => s + n, 0);
  const cancelEventId = Object.entries(recentCancels).sort((a, b) => b[1] - a[1])[0]?.[0];

  const visible = grouped.filter((e) => filter === 'all' || e._group === filter);

  async function handleDelete(event) {
    if (!window.confirm(`'${event.title}' 행사를 삭제하시겠습니까?\n신청 내역은 삭제되지 않습니다.`)) return;
    setMenuEvent(null);
    await deleteDoc(doc(db, 'events', event.id));
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
        {FILTERS.filter((f) => f.key !== 'draft' || counts.draft > 0).map((f) => (
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
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
