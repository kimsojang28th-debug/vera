import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import EventCard from '../../components/EventCard';
import GroupedEventCard from '../../components/GroupedEventCard';

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

  // 같은 groupId를 가진 행사(예: 이틀 중 하루만 신청 가능한 행사)는 카드 하나로 묶습니다.
  const cards = [];
  const seenGroups = new Set();
  for (const e of events) {
    if (e.groupId) {
      if (seenGroups.has(e.groupId)) continue;
      seenGroups.add(e.groupId);
      const groupEvents = events.filter((x) => x.groupId === e.groupId);
      const groupTitle = groupEvents.find((x) => x.groupTitle)?.groupTitle || groupEvents[0].title;
      cards.push({ type: 'group', groupId: e.groupId, groupTitle, events: groupEvents });
    } else {
      cards.push({ type: 'single', event: e });
    }
  }

  return (
    <div>
      <h2 className="page-title">행사 목록</h2>
      {cards.length === 0 ? (
        <p className="empty-state">현재 진행 중인 행사가 없습니다.</p>
      ) : (
        <div className="event-grid">
          {cards.map((c) =>
            c.type === 'group' ? (
              <GroupedEventCard key={c.groupId} groupId={c.groupId} groupTitle={c.groupTitle} events={c.events} />
            ) : (
              <EventCard key={c.event.id} event={c.event} />
            )
          )}
        </div>
      )}
    </div>
  );
}
