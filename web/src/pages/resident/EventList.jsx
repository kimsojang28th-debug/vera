import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import EventCard from '../../components/EventCard';

export default function EventList() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('applyStart', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((e) => e.status !== 'draft')
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return <div className="page-loading">불러오는 중...</div>;

  return (
    <div>
      <h2 className="page-title">행사 목록</h2>
      {events.length === 0 ? (
        <p className="empty-state">현재 진행 중인 행사가 없습니다.</p>
      ) : (
        <div className="event-grid">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
