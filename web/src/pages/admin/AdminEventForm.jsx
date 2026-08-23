import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const emptyEvent = {
  title: '',
  description: '',
  place: '',
  applyStart: '',
  applyEnd: '',
  eventStart: '',
  eventEnd: '',
  capacity: 30,
  status: 'draft',
  bannerImageUrl: '',
};

function toInputDateTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let fieldCounter = 0;
function newFieldId() {
  fieldCounter += 1;
  return `f${Date.now()}${fieldCounter}`;
}

export default function AdminEventForm() {
  const { eventId } = useParams();
  const isNew = !eventId || eventId === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState(emptyEvent);
  const [extraFields, setExtraFields] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const snap = await getDoc(doc(db, 'events', eventId));
      if (snap.exists()) {
        const data = snap.data();
        setForm({
          title: data.title || '',
          description: data.description || '',
          place: data.place || '',
          applyStart: toInputDateTime(data.applyStart),
          applyEnd: toInputDateTime(data.applyEnd),
          eventStart: toInputDateTime(data.eventStart),
          eventEnd: toInputDateTime(data.eventEnd),
          capacity: data.capacity || 30,
          status: data.status || 'draft',
          bannerImageUrl: data.bannerImageUrl || '',
        });
        setExtraFields(data.extraFields || []);
      }
      setLoading(false);
    })();
  }, [eventId, isNew]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function addField() {
    setExtraFields((fs) => [...fs, { id: newFieldId(), label: '', type: 'select', options: [''], required: true }]);
  }

  function updateField(id, patch) {
    setExtraFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function removeField(id) {
    setExtraFields((fs) => fs.filter((f) => f.id !== id));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.title || !form.place || !form.applyStart || !form.applyEnd || !form.eventStart) {
      setError('행사명, 장소, 접수기간, 행사일시는 필수입니다.');
      return;
    }

    const payload = {
      title: form.title,
      description: form.description,
      place: form.place,
      applyStart: Timestamp.fromDate(new Date(form.applyStart)),
      applyEnd: Timestamp.fromDate(new Date(form.applyEnd)),
      eventStart: Timestamp.fromDate(new Date(form.eventStart)),
      eventEnd: form.eventEnd ? Timestamp.fromDate(new Date(form.eventEnd)) : null,
      capacity: Number(form.capacity) || 0,
      status: form.status,
      bannerImageUrl: form.bannerImageUrl,
      extraFields: extraFields
        .filter((f) => f.label)
        .map((f) => ({
          ...f,
          options: f.type === 'select' ? (f.options || []).map((o) => o.trim()).filter(Boolean) : [],
        })),
      updatedAt: serverTimestamp(),
    };

    setSaving(true);
    try {
      if (isNew) {
        await addDoc(collection(db, 'events'), {
          ...payload,
          appliedCount: 0,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'events', eventId), payload);
      }
      navigate('/admin/events');
    } catch (err) {
      setError(err.message || '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page-loading">불러오는 중...</div>;

  return (
    <div>
      <h2 className="page-title">{isNew ? '새 행사 등록' : '행사 수정'}</h2>
      <form className="admin-form" onSubmit={handleSubmit}>
        <div className="field">
          <label>행사명 *</label>
          <input value={form.title} onChange={(e) => update('title', e.target.value)} />
        </div>
        <div className="field">
          <label>설명</label>
          <textarea rows={3} value={form.description} onChange={(e) => update('description', e.target.value)} />
        </div>
        <div className="field">
          <label>장소 *</label>
          <input value={form.place} onChange={(e) => update('place', e.target.value)} />
        </div>
        <div className="field">
          <label>배너 이미지 URL</label>
          <input value={form.bannerImageUrl} onChange={(e) => update('bannerImageUrl', e.target.value)} placeholder="https://..." />
        </div>

        <div className="field-row">
          <div className="field">
            <label>신청 접수 시작 *</label>
            <input type="datetime-local" value={form.applyStart} onChange={(e) => update('applyStart', e.target.value)} />
          </div>
          <div className="field">
            <label>신청 접수 종료 *</label>
            <input type="datetime-local" value={form.applyEnd} onChange={(e) => update('applyEnd', e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>행사 시작일시 *</label>
            <input type="datetime-local" value={form.eventStart} onChange={(e) => update('eventStart', e.target.value)} />
          </div>
          <div className="field">
            <label>행사 종료일시</label>
            <input type="datetime-local" value={form.eventEnd} onChange={(e) => update('eventEnd', e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>정원 *</label>
            <input type="number" min="1" value={form.capacity} onChange={(e) => update('capacity', e.target.value)} />
          </div>
          <div className="field">
            <label>공개 상태</label>
            <select value={form.status} onChange={(e) => update('status', e.target.value)}>
              <option value="draft">준비중(입주민에게 미노출)</option>
              <option value="open">모집중(공개)</option>
              <option value="closed">마감(공개, 신청불가)</option>
            </select>
          </div>
        </div>

        <div className="extra-fields-editor">
          <div className="page-header-row">
            <h3>신청서 추가 항목</h3>
            <button type="button" className="btn" onClick={addField}>+ 항목 추가</button>
          </div>
          <p className="muted">예: "참가 희망 일시"처럼 신청자가 선택/입력해야 하는 항목을 정의합니다.</p>

          {extraFields.map((f) => (
            <div className="extra-field-row" key={f.id}>
              <input
                placeholder="항목명 (예: 참가 희망 일시)"
                value={f.label}
                onChange={(e) => updateField(f.id, { label: e.target.value })}
              />
              <select value={f.type} onChange={(e) => updateField(f.id, { type: e.target.value })}>
                <option value="select">선택형</option>
                <option value="text">직접입력</option>
              </select>
              {f.type === 'select' && (
                <input
                  placeholder="선택지 (쉼표로 구분, 예: 1회차,2회차,3회차)"
                  value={(f.options || []).join(',')}
                  onChange={(e) => updateField(f.id, { options: e.target.value.split(',') })}
                />
              )}
              <label className="checkbox-inline">
                <input type="checkbox" checked={f.required} onChange={(e) => updateField(f.id, { required: e.target.checked })} /> 필수
              </label>
              <button type="button" className="link-button" onClick={() => removeField(f.id)}>삭제</button>
            </div>
          ))}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
          <button type="button" className="btn" onClick={() => navigate('/admin/events')}>취소</button>
        </div>
      </form>
    </div>
  );
}
