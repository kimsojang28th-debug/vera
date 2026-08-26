import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatDateTime, getEventStatus } from '../../utils/format';

export default function AdminEvents() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('applyStart', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function handleDelete(id) {
    if (!window.confirm('행사를 삭제하시겠습니까? 신청 내역은 삭제되지 않습니다.')) return;
    await deleteDoc(doc(db, 'events', id));
  }

  async function handleEarlyClose(id) {
    if (!window.confirm('신청 기간이 남아있어도 지금 바로 접수를 마감하시겠습니까?')) return;
    await updateDoc(doc(db, 'events', id), { status: 'closed', updatedAt: serverTimestamp() });
  }

  if (loading) return <div className="page-loading">불러오는 중...</div>;

  return (
    <div>
      <div className="page-header-row">
        <h2 className="page-title">행사배너 관리</h2>
        <button className="btn btn-primary" onClick={() => navigate('/admin/events/new')}>+ 새 행사 등록</button>
      </div>

      {events.length === 0 ? (
        <p className="empty-state">등록된 행사가 없습니다.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>행사명</th><th>그룹</th><th>세대당인원</th><th>상태</th><th>접수기간</th><th>정원</th><th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const status = getEventStatus(e);
              return (
                <tr key={e.id}>
                  <td>{e.title}</td>
                  <td>{e.groupId ? (e.groupTitle || e.groupId) : '-'}</td>
                  <td>{e.multiPerHousehold ? '가족 여러 명' : '1명'}</td>
                  <td><span className={`badge badge-${status.tone}`}>{status.label}</span></td>
                  <td>{formatDateTime(e.applyStart)} ~ {formatDateTime(e.applyEnd)}</td>
                  <td>{e.appliedCount ?? 0} / {e.capacity}</td>
                  <td className="table-actions">
                    <Link to={`/admin/events/${e.id}`}>수정</Link>
                    {e.status === 'open' && (
                      <button className="link-button" onClick={() => handleEarlyClose(e.id)}>조기마감</button>
                    )}
                    <button className="link-button" onClick={() => handleDelete(e.id)}>삭제</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
