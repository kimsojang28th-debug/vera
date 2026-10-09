import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDateTime, getEventStatus, getEventWhen, isLottery } from '../../utils/format';
import { isAwaitingDraw } from '../../utils/adminEvents';
import { downloadCsv } from '../../utils/csv';
import { IconDownload, IconFile, IconPhone, IconShuffle } from '../../components/icons';

const STATUS_LABEL = { applied: '신청', waiting: '대기', cancelled: '취소' };
const LOTTERY_STATUS_LABEL = { ...STATUS_LABEL, applied: '접수', selected: '당첨', reserve: '예비', notSelected: '미당첨' };
const STATUS_TONE = {
  applied: 'open',
  waiting: 'waiting',
  cancelled: 'urgent',
  selected: 'open',
  reserve: 'waiting',
  notSelected: 'muted',
};

// 예비는 현재 순번까지 함께 표시합니다. (예: 예비 2번)
function labelOf(labels, a) {
  if (a.status === 'reserve' && a.reserveNo) return `예비 ${a.reserveNo}번`;
  return labels[a.status] || a.status;
}

function byAppliedAt(a, b) {
  return (a.appliedAt?.toMillis?.() || 0) - (b.appliedAt?.toMillis?.() || 0);
}

// 신청 시각을 줄여서 표시 (예: 10/8 11:30)
function shortTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : undefined;
}

export default function AdminApplications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [applications, setApplications] = useState([]);
  const [tab, setTab] = useState(searchParams.get('tab') === 'cancelled' ? 'cancelled' : 'all'); // 'all' | 'main' | 'cancelled'
  const [loading, setLoading] = useState(false);

  const selectedEventId = searchParams.get('event') || events[0]?.id || '';

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('applyStart', 'desc'));
    return onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    setLoading(true);
    (async () => {
      const snap = await getDocs(query(collection(db, 'applications'), where('eventId', '==', selectedEventId)));
      setApplications(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byAppliedAt)); // 입주민 신청현황(가장 먼저 신청한 순)과 동일
      setLoading(false);
    })();
  }, [selectedEventId]);

  const event = events.find((e) => e.id === selectedEventId);
  const lottery = isLottery(event);
  const drawn = lottery && event?.drawStatus === 'done';
  const labels = lottery ? LOTTERY_STATUS_LABEL : STATUS_LABEL;
  const extraFields = event?.extraFields || [];

  const count = (status) => applications.filter((a) => a.status === status).length;
  const cancelledCount = count('cancelled');
  const activeCount = applications.length - cancelledCount;

  // 상단 요약 숫자
  const tiles = drawn
    ? [
        { label: '당첨', value: count('selected'), tone: 'good' },
        { label: '예비', value: count('reserve'), tone: 'gold' },
        { label: '미당첨', value: count('notSelected'), tone: 'plain' },
        { label: '취소', value: cancelledCount, tone: 'bad' },
      ]
    : lottery
      ? [
          { label: '접수', value: count('applied'), tone: 'good' },
          { label: '선발 정원', value: event?.capacity ?? 0, tone: 'gold' },
          { label: '취소', value: cancelledCount, tone: 'bad' },
        ]
      : [
          { label: '신청', value: count('applied'), tone: 'good' },
          { label: '대기', value: count('waiting'), tone: 'gold' },
          { label: '취소', value: cancelledCount, tone: 'bad' },
        ];

  const mainLabel = drawn ? '당첨·예비' : lottery ? '접수' : '신청·대기';
  const mainCount = drawn ? count('selected') + count('reserve') : activeCount;

  const shown = useMemo(() => {
    let list = applications;
    if (tab === 'cancelled') list = applications.filter((a) => a.status === 'cancelled');
    else if (tab === 'main') {
      list = drawn
        ? applications.filter((a) => a.status === 'selected' || a.status === 'reserve')
        : applications.filter((a) => a.status !== 'cancelled');
      if (drawn) {
        list = [...list].sort((a, b) => {
          if (a.status !== b.status) return a.status === 'selected' ? -1 : 1;
          return a.status === 'selected' ? (a.drawRank || 0) - (b.drawRank || 0) : (a.reserveNo || 0) - (b.reserveNo || 0);
        });
      }
    }
    // 취소건은 대기열에 없었으므로 번호를 매기지 않고, 나머지는 보이는 순서대로 1번부터 번호를 매깁니다.
    let seq = 0;
    return list.map((a) => ({ ...a, seq: a.status === 'cancelled' ? null : ++seq }));
  }, [applications, tab, drawn]);

  function selectEvent(id) {
    setSearchParams({ event: id });
    setTab('all');
  }

  function handleExport() {
    const headers = ['번호', '동', '호수', '성명', '연락처', '상태', '신청일시', ...extraFields.map((f) => f.label)];
    const rows = shown.map((a) => {
      const row = {
        '번호': a.seq ?? '-',
        '동': a.dong,
        '호수': a.ho,
        '성명': a.residentName || '',
        '연락처': a.phone,
        '상태': labelOf(labels, a),
        '신청일시': formatDateTime(a.appliedAt),
      };
      extraFields.forEach((f) => {
        row[f.label] = a.answers?.[f.id] || '';
      });
      return row;
    });
    downloadCsv(`${event?.title || '신청현황'}.csv`, rows, headers);
  }

  if (events.length === 0) {
    return (
      <div>
        <h2 className="page-title">신청현황</h2>
        <p className="empty-state">등록된 행사가 없습니다.</p>
      </div>
    );
  }

  const status = event ? getEventStatus(event) : null;
  const awaiting = event ? isAwaitingDraw(event) : false;

  return (
    <div className="admin-applications">
      <h2 className="page-title">신청현황</h2>

      <div className="event-switcher">
        <label htmlFor="event-select">행사 선택</label>
        <select id="event-select" value={selectedEventId} onChange={(e) => selectEvent(e.target.value)}>
          {events.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
      </div>

      {event && (
        <section className="app-summary-head">
          <div className="badge-row">
            <span className={`badge badge-${awaiting ? 'waiting' : status.tone}`}>
              {awaiting ? '추첨 대기 · 접수 마감' : status.label}
            </span>
            <span className="muted">{getEventWhen(event).full}</span>
          </div>
          <h3 className="app-summary-title">{event.title}</h3>
        </section>
      )}

      <div className={`summary-tiles summary-tiles-${tiles.length}`}>
        {tiles.map((t) => (
          <div key={t.label} className={`summary-tile summary-tile-${t.tone}`}>
            <span className="summary-num">{t.value}</span>
            <span className="summary-label">{t.label}</span>
          </div>
        ))}
      </div>

      <div className="seg-tabs" role="tablist" aria-label="신청 구분">
        <button type="button" role="tab" aria-selected={tab === 'all'} className={`seg-tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
          전체 {applications.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'main'} className={`seg-tab${tab === 'main' ? ' active' : ''}`} onClick={() => setTab('main')}>
          {mainLabel} {mainCount}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'cancelled'} className={`seg-tab${tab === 'cancelled' ? ' active' : ''}`} onClick={() => setTab('cancelled')}>
          취소 {cancelledCount}
        </button>
      </div>

      {loading ? (
        <div className="page-loading">불러오는 중...</div>
      ) : shown.length === 0 ? (
        <p className="empty-state">해당하는 신청 내역이 없습니다.</p>
      ) : (
        <ul className="app-list">
          {shown.map((a) => {
            const extras = extraFields.map((f) => (a.answers?.[f.id] ? `${f.label}: ${a.answers[f.id]}` : null)).filter(Boolean);
            return (
              <li key={a.id} className={`app-row${a.status === 'cancelled' ? ' app-row-cancelled' : ''}`}>
                <span className="app-no">{a.seq ?? '-'}</span>
                <div className="app-main">
                  <div className="app-name">
                    {a.dong}동 {a.ho}호 <span className="app-resident">{a.residentName || '-'}</span>
                  </div>
                  <div className="app-sub">{a.phone}</div>
                  <div className="app-sub">신청 {shortTime(a.appliedAt)}</div>
                  {extras.length > 0 && <div className="app-extra">{extras.join(' · ')}</div>}
                </div>
                <span className={`badge badge-${STATUS_TONE[a.status] || 'muted'}`}>{labelOf(labels, a)}</span>
                {telHref(a.phone) && (
                  <a className="call-button" href={telHref(a.phone)} aria-label={`${a.dong}동 ${a.ho}호 전화 걸기`}>
                    <IconPhone size={20} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="admin-action-bar">
        <button type="button" className="btn btn-outline" onClick={handleExport} disabled={shown.length === 0}>
          <IconDownload size={18} />엑셀 받기
        </button>
        {lottery && event && (
          drawn ? (
            <Link className="btn btn-primary" to={`/admin/events/${event.id}/draw/report`} target="_blank">
              <IconFile size={18} />추첨 증빙서
            </Link>
          ) : (
            <Link className="btn btn-primary" to={`/admin/events/${event.id}/draw`}>
              <IconShuffle size={18} />{awaiting ? '추첨하기' : '추첨 화면'}
            </Link>
          )
        )}
      </div>
    </div>
  );
}
