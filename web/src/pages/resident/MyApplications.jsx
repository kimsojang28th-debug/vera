import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTime } from '../../utils/format';

export default function MyApplications() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editAnswers, setEditAnswers] = useState({});
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const q = query(collection(db, 'applications'), where('householdId', '==', user.uid));
    const snap = await getDocs(q);
    const apps = await Promise.all(
      snap.docs
        .filter((d) => d.data().status !== 'cancelled')
        .map(async (d) => {
          const app = { id: d.id, ...d.data() };
          const eventSnap = await getDoc(doc(db, 'events', app.eventId));
          app.event = eventSnap.exists() ? { id: eventSnap.id, ...eventSnap.data() } : null;
          return app;
        })
    );
    // 관리자가 삭제한 행사에 연결된 신청 내역은 목록에 표시하지 않습니다.
    const visible = apps.filter((app) => app.event !== null);
    visible.sort((a, b) => (b.appliedAt?.toMillis?.() || 0) - (a.appliedAt?.toMillis?.() || 0));
    setItems(visible);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  async function handleCancel(applicationId) {
    if (!window.confirm('신청을 취소하시겠습니까?')) return;
    setMessage('');
    try {
      const cancelApplication = httpsCallable(functions, 'cancelApplication');
      await cancelApplication({ applicationId });
      await load();
      setMessage('신청이 취소되었습니다.');
    } catch (err) {
      setMessage(err.message?.replace(/^\S+:\s*/, '') || '취소 중 오류가 발생했습니다.');
    }
  }

  function startEdit(app) {
    setEditingId(app.id);
    setEditAnswers(app.answers || {});
  }

  async function handleSaveEdit(applicationId) {
    setMessage('');
    try {
      const updateApplication = httpsCallable(functions, 'updateApplication');
      await updateApplication({ applicationId, answers: editAnswers });
      setEditingId(null);
      await load();
      setMessage('신청 내용이 수정되었습니다.');
    } catch (err) {
      setMessage(err.message?.replace(/^\S+:\s*/, '') || '수정 중 오류가 발생했습니다.');
    }
  }

  if (loading) return <div className="page-loading">불러오는 중...</div>;

  return (
    <div>
      <h2 className="page-title">나의 신청내역</h2>
      {message && <p className="notice-box">{message}</p>}

      {items.length === 0 ? (
        <p className="empty-state">신청한 행사가 없습니다.</p>
      ) : (
        <div className="my-application-list">
          {items.map((app) => (
            <div key={app.id} className="my-application-card">
              <span className={`badge badge-${app.status === 'waiting' ? 'muted' : 'open'}`}>
                {app.status === 'waiting' ? '대기중' : '신청완료'}
              </span>
              <h3>{app.event?.title || '(삭제된 행사)'}</h3>
              {app.event && (
                <p className="muted">{formatDateTime(app.event.eventStart)} · {app.event.place}</p>
              )}
              <p className="muted">신청일시: {formatDateTime(app.appliedAt)}</p>
              {app.status === 'waiting' && (
                <p className="muted small-note">자리가 나면 대기 순서대로 자동으로 신청 확정됩니다.</p>
              )}

              {editingId === app.id ? (
                <div className="edit-block">
                  {(app.event?.extraFields || []).map((f) => (
                    <div className="field" key={f.id}>
                      <label>{f.label}</label>
                      {f.type === 'select' ? (
                        <select
                          value={editAnswers[f.id] || ''}
                          onChange={(e) => setEditAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                        >
                          <option value="">선택해주세요</option>
                          {(f.options || []).map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={editAnswers[f.id] || ''}
                          onChange={(e) => setEditAnswers((a) => ({ ...a, [f.id]: e.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                  <div className="btn-row">
                    <button className="btn btn-primary" onClick={() => handleSaveEdit(app.id)}>저장</button>
                    <button className="btn" onClick={() => setEditingId(null)}>취소</button>
                  </div>
                </div>
              ) : (
                <>
                  {Object.keys(app.answers || {}).length > 0 && (
                    <ul className="answer-list">
                      {(app.event?.extraFields || []).map((f) => (
                        <li key={f.id}>{f.label}: {app.answers?.[f.id] || '-'}</li>
                      ))}
                    </ul>
                  )}
                  <div className="btn-row">
                    {(app.event?.extraFields || []).length > 0 && (
                      <button className="btn" onClick={() => startEdit(app)}>수정</button>
                    )}
                    <button className="btn btn-danger" onClick={() => handleCancel(app.id)}>신청취소</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
