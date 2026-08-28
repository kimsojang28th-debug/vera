import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateTime, getCapacityPercent, getEventStatus, isEventFull } from '../utils/format';

// 이틀 등 여러 날짜 중 하루만 신청 가능한 행사를 하나의 카드로 묶어 보여줍니다.
export default function GroupedEventCard({ groupId, groupTitle, events }) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(events[0]?.id);
  const selected = events.find((e) => e.id === selectedId) || events[0];
  const status = getEventStatus(selected);
  const percent = getCapacityPercent(selected);

  return (
    <div className="event-card event-card-grouped">
      {selected.bannerImageUrl ? (
        <img className="event-card-banner" src={selected.bannerImageUrl} alt={groupTitle} />
      ) : (
        <div className="event-card-banner event-card-banner-placeholder">
          <span>{groupTitle || '행사'}</span>
        </div>
      )}
      <div className="event-card-body">
        <div className={`badge badge-${status.tone}`}>{status.label}</div>
        <h3>{groupTitle}</h3>
        <p className="muted">{selected.place}</p>

        <div className="group-choice-list">
          {events.map((ev) => (
            <label key={ev.id} className="group-choice-option">
              <input
                type="radio"
                name={`group-${groupId}`}
                checked={selectedId === ev.id}
                onChange={() => setSelectedId(ev.id)}
              />
              <span>
                {formatDateTime(ev.eventStart)} · {ev.appliedCount ?? 0}/{ev.capacity}명
                {isEventFull(ev) ? ' · 대기가능' : ''}
              </span>
            </label>
          ))}
        </div>

        <div className="capacity-row">
          <div className="capacity-track"><div className="capacity-fill" style={{ width: `${percent}%` }} /></div>
          <span className="capacity-label">{selected.appliedCount ?? 0}/{selected.capacity}명</span>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => navigate(`/events/${selectedId}`)}
        >
          선택한 날짜로 신청하러 가기
        </button>
        <p className="muted small-note">두 날짜 중 하루만 신청하실 수 있습니다.</p>
      </div>
    </div>
  );
}
