import { Link } from 'react-router-dom';
import { getCapacityPercent, getCompetitionRatio, getEventStatus, getEventWhen, isLottery } from '../utils/format';
import { IconCalendar, IconPin, IconUsers } from './icons';

export default function EventCard({ event }) {
  const status = getEventStatus(event);
  const lottery = isLottery(event);
  const percent = lottery ? 100 : getCapacityPercent(event);
  const when = getEventWhen(event);
  const ratio = getCompetitionRatio(event);
  const applied = event.appliedCount ?? 0;
  const showDday = Boolean(status.dday);

  return (
    <Link to={`/events/${event.id}`} className="event-card">
      <div className="event-card-media">
        {event.bannerImageUrl ? (
          <img className="event-card-banner" src={event.bannerImageUrl} alt={event.title} />
        ) : (
          <div className="event-card-banner event-card-banner-placeholder">
            <span>{event.title || '행사'}</span>
          </div>
        )}
        {showDday && (
          <span className={`dday-pill${status.tone === 'urgent' ? ' dday-pill-urgent' : ''}`}>{status.dday}</span>
        )}
      </div>
      <div className="event-card-body">
        <div className={`badge badge-${status.tone}`}>{status.label}</div>
        <h3>{event.title}</h3>
        <div className="event-card-when">
          <IconCalendar size={18} />
          <span>{when.full}</span>
        </div>
        <div className="event-card-place">
          <IconPin size={18} />
          <span>{event.place}</span>
        </div>
        <div className="event-card-divider" />
        <div className="event-card-count">
          <IconUsers size={18} />
          {lottery ? (
            <>
              <strong>신청 {applied}명</strong>
              <span className="count-sub">· 선발 {event.capacity}명</span>
              {ratio && <span className="ratio-pill">경쟁률 {ratio}</span>}
            </>
          ) : (
            <>
              <strong>{applied} / {event.capacity}명</strong>
              <span className="count-sub">· 선착순</span>
            </>
          )}
        </div>
        <div className="capacity-row">
          <div className="capacity-track"><div className={`capacity-fill${lottery ? ' capacity-fill-lottery' : ''}`} style={{ width: `${percent}%` }} /></div>
        </div>
      </div>
    </Link>
  );
}
