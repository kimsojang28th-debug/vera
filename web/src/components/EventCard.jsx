import { Link } from 'react-router-dom';
import { formatDateTime, getCapacityPercent, getEventStatus } from '../utils/format';
import { IconCalendar, IconPin } from './icons';

export default function EventCard({ event }) {
  const status = getEventStatus(event);
  const percent = getCapacityPercent(event);
  return (
    <Link to={`/events/${event.id}`} className="event-card">
      {event.bannerImageUrl ? (
        <img className="event-card-banner" src={event.bannerImageUrl} alt={event.title} />
      ) : (
        <div className="event-card-banner event-card-banner-placeholder">
          <span>{event.title || '행사'}</span>
        </div>
      )}
      <div className="event-card-body">
        <div className={`badge badge-${status.tone}`}>{status.label}</div>
        <h3>{event.title}</h3>
        <dl className="event-card-meta">
          <div><dt><IconCalendar />일시</dt><dd>{formatDateTime(event.eventStart)}</dd></div>
          <div><dt><IconPin />장소</dt><dd>{event.place}</dd></div>
          <div><dt>접수기간</dt><dd>{formatDateTime(event.applyStart)} ~ {formatDateTime(event.applyEnd)}</dd></div>
        </dl>
        <div className="capacity-row">
          <div className="capacity-track"><div className="capacity-fill" style={{ width: `${percent}%` }} /></div>
          <span className="capacity-label">{event.appliedCount ?? 0}/{event.capacity}명</span>
        </div>
      </div>
    </Link>
  );
}
