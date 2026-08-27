import { useEffect, useState } from 'react';
import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDateTime } from '../../utils/format';
import { downloadCsv } from '../../utils/csv';

const STATUS_LABEL = { applied: '신청', waiting: '대기', cancelled: '취소' };

export default function AdminApplications() {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [applications, setApplications] = useState([]);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('applyStart', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setEvents(list);
      if (!selectedEventId && list.length > 0) setSelectedEventId(list[0].id);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    setLoading(true);
    (async () => {
      const q = query(collection(db, 'applications'), where('eventId', '==', selectedEventId));
      const snap = await getDocs(q);
      let apps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!includeCancelled) apps = apps.filter((a) => a.status !== 'cancelled');
      apps.sort((a, b) => (a.appliedAt?.toMillis?.() || 0) - (b.appliedAt?.toMillis?.() || 0)); // 입주민 신청현황(가장 먼저 신청한 순)과 동일하게 정렬
      setApplications(apps);
      setLoading(false);
    })();
  }, [selectedEventId, includeCancelled]);

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const extraFields = selectedEvent?.extraFields || [];

  function handleExport() {
    const headers = ['동', '호수', '성명', '연락처', '상태', '신청일시', ...extraFields.map((f) => f.label)];
    const rows = applications.map((a) => {
      const row = {
        '동': a.dong,
        '호수': a.ho,
        '성명': a.residentName || '',
        '연락처': a.phone,
        '상태': STATUS_LABEL[a.status] || a.status,
        '신청일시': formatDateTime(a.appliedAt),
      };
      extraFields.forEach((f) => {
        row[f.label] = a.answers?.[f.id] || '';
      });
      return row;
    });
    downloadCsv(`${selectedEvent?.title || '신청현황'}.csv`, rows, headers);
  }

  return (
    <div>
      <h2 className="page-title">신청현황</h2>

      <div className="admin-toolbar">
        <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)}>
          {events.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        <label className="checkbox-inline">
          <input type="checkbox" checked={includeCancelled} onChange={(e) => setIncludeCancelled(e.target.checked)} />
          취소건 포함
        </label>
        <button className="btn" onClick={handleExport} disabled={applications.length === 0}>CSV(엑셀) 다운로드</button>
      </div>

      {loading ? (
        <div className="page-loading">불러오는 중...</div>
      ) : applications.length === 0 ? (
        <p className="empty-state">신청 내역이 없습니다.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>동</th><th>호수</th><th>성명</th><th>연락처</th><th>상태</th><th>신청일시</th>
              {extraFields.map((f) => <th key={f.id}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>{a.dong}동</td>
                <td>{a.ho}호</td>
                <td>{a.residentName || '-'}</td>
                <td>{a.phone}</td>
                <td>{STATUS_LABEL[a.status] || a.status}</td>
                <td>{formatDateTime(a.appliedAt)}</td>
                {extraFields.map((f) => <td key={f.id}>{a.answers?.[f.id] || '-'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
