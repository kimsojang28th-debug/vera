import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
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
  groupId: '',
  groupTitle: '',
  multiPerHousehold: false,
};

const BANNER_WIDTH = 1200;
const BANNER_HEIGHT = 400;

function toInputDateTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// 업로드한 이미지를 배너 권장 비율(3:1)에 맞춰 가운데를 기준으로 잘라 리사이즈합니다.
async function resizeImageToBanner(file, targetW = BANNER_WIDTH, targetH = BANNER_HEIGHT) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  const srcRatio = img.width / img.height;
  const targetRatio = targetW / targetH;
  let sx, sy, sw, sh;
  if (srcRatio > targetRatio) {
    sh = img.height;
    sw = sh * targetRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / targetRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
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
          groupId: data.groupId || '',
          groupTitle: data.groupTitle || '',
          multiPerHousehold: data.multiPerHousehold === true,
        });
        setExtraFields(data.extraFields || []);
      }
      setLoading(false);
    })();
  }, [eventId, isNew]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleImageSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('이미지 파일만 업로드할 수 있습니다.');
      return;
    }
    setUploadError('');
    setUploading(true);
    try {
      const blob = await resizeImageToBanner(file);
      const path = `event-banners/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
      const url = await getDownloadURL(fileRef);
      update('bannerImageUrl', url);
    } catch (err) {
      setUploadError('이미지 업로드에 실패했습니다: ' + (err.message || ''));
    } finally {
      setUploading(false);
    }
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
      groupId: form.groupId.trim(),
      groupTitle: form.groupTitle.trim(),
      multiPerHousehold: form.multiPerHousehold === true,
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
          <label>배너 이미지 (권장 비율 3:1, 예: 1200x400px — 업로드 시 자동으로 맞춰 잘립니다)</label>
          {form.bannerImageUrl && (
            <img src={form.bannerImageUrl} alt="배너 미리보기" className="banner-preview" />
          )}
          <div className="btn-row">
            <label className="btn">
              {uploading ? '업로드 중...' : '이미지 업로드'}
              <input type="file" accept="image/*" onChange={handleImageSelect} disabled={uploading} style={{ display: 'none' }} />
            </label>
            {form.bannerImageUrl && (
              <button type="button" className="btn" onClick={() => update('bannerImageUrl', '')}>이미지 삭제</button>
            )}
          </div>
          {uploadError && <p className="form-error">{uploadError}</p>}
          <details className="advanced-field">
            <summary>또는 이미지 주소 직접 입력(고급)</summary>
            <input value={form.bannerImageUrl} onChange={(e) => update('bannerImageUrl', e.target.value)} placeholder="https://..." />
          </details>
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

        <div className="field">
          <label>1세대당 신청 인원</label>
          <select
            value={form.multiPerHousehold ? 'multi' : 'single'}
            onChange={(e) => update('multiPerHousehold', e.target.value === 'multi')}
          >
            <option value="single">1명만 신청 가능 (기본)</option>
            <option value="multi">가족 여러 명 각자 신청 가능</option>
          </select>
          <p className="muted field-help">
            "가족 여러 명 각자 신청 가능"으로 설정하면, 같은 세대에서도 이름·연락처가 다른 가족 구성원이 각자 신청서를 제출할 수 있습니다.
            (이름과 연락처가 모두 같은 경우에만 중복 신청으로 처리됩니다.)
          </p>
        </div>

        <div className="field-row">
          <div className="field">
            <label>그룹 ID (선택)</label>
            <input
              value={form.groupId}
              onChange={(e) => update('groupId', e.target.value)}
              placeholder="예: health-2026-09"
            />
          </div>
          <div className="field">
            <label>그룹 제목 (선택)</label>
            <input
              value={form.groupTitle}
              onChange={(e) => update('groupTitle', e.target.value)}
              placeholder="예: 건강상담(택1)"
            />
          </div>
        </div>
        <p className="muted field-help">
          이틀 이상 진행하는 행사처럼 "여러 날짜 중 하루만 신청 가능"하게 묶으려면, 각 날짜를 별도 행사로 등록한 뒤
          동일한 그룹 ID를 입력하세요. 입주민 화면에는 그룹 제목으로 된 카드 하나에 날짜 선택지가 함께 표시되고,
          그 중 하루만 신청할 수 있습니다. (그룹 제목을 비워두면 행사명이 대신 사용됩니다.)
        </p>

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
