import { Link } from 'react-router-dom';
import { formatDateTime } from '../utils/format';
import { getEventStatus } from '../utils/format';

export default function EventCard({ event }) {
  const status = getEventStatus(event);
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
          <div><dt>일시</dt><dd>{formatDateTime(event.eventStart)}</dd></div>
          <div><dt>장소</dt><dd>{event.place}</dd></div>
          <div><dt>접수기간</dt><dd>{formatDateTime(event.applyStart)} ~ {formatDateTime(event.applyEnd)}</dd></div>
          <div><dt>정원</dt><dd>{event.appliedCount ?? 0} / {event.capacity}명</dd></div>
        </dl>
      </div>
    </Link>
  );
}
