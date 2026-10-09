import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDoc, collection, doc, getDoc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { IconChevronLeft } from '../../components/icons';

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
  selectionMethod: 'fcfs',
  reserveCount: 5,
};

const STEPS = ['기본정보', '일정', '모집방식', '배너'];

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
  const [step, setStep] = useState(1);
  const topRef = useRef(null);

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
          selectionMethod: data.selectionMethod === 'lottery' ? 'lottery' : 'fcfs',
          appliedCount: data.appliedCount || 0,
          reserveCount: data.reserveCount ?? 5,
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

  // ── 단계별 입력 확인 ──
  function validateStep(n) {
    if (n === 1) {
      if (!form.title.trim() || !form.place.trim()) return '행사명과 장소를 입력해 주세요.';
    }
    if (n === 2) {
      if (!form.applyStart || !form.applyEnd || !form.eventStart) return '접수 시작·종료와 행사 시작일시를 입력해 주세요.';
      if (new Date(form.applyEnd) <= new Date(form.applyStart)) return '접수 종료는 접수 시작보다 늦어야 합니다.';
      if (form.eventEnd && new Date(form.eventEnd) <= new Date(form.eventStart)) return '행사 종료는 행사 시작보다 늦어야 합니다.';
    }
    if (n === 3) {
      if (!(Number(form.capacity) >= 1)) return '인원은 1명 이상이어야 합니다.';
    }
    return '';
  }

  function goTo(target) {
    setError('');
    if (target > step) {
      for (let n = step; n < target; n += 1) {
        const msg = validateStep(n);
        if (msg) {
          setStep(n);
          setError(msg);
          return;
        }
      }
    }
    setStep(target);
    topRef.current?.scrollIntoView({ block: 'start' });
  }

  async function save() {
    for (let n = 1; n <= 3; n += 1) {
      const msg = validateStep(n);
      if (msg) {
        setStep(n);
        setError(msg);
        return;
      }
    }

    const payload = {
      title: form.title.trim(),
      description: form.description,
      place: form.place.trim(),
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
      selectionMethod: form.selectionMethod === 'lottery' ? 'lottery' : 'fcfs',
      reserveCount: Math.min(50, Math.max(0, Math.floor(Number(form.reserveCount)) || 0)),
      extraFields: extraFields
        .filter((f) => f.label)
        .map((f) => ({
          ...f,
          options: f.type === 'select' ? (f.options || []).map((o) => o.trim()).filter(Boolean) : [],
        })),
      updatedAt: serverTimestamp(),
    };

    setSaving(true);
    setError('');
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

  function handleSubmit(e) {
    e.preventDefault();
    if (step < STEPS.length) goTo(step + 1);
    else save();
  }

  function adjust(field, delta, min, max) {
    const cur = Number(form[field]) || 0;
    update(field, Math.min(max, Math.max(min, cur + delta)));
  }

  if (loading) return <div className="page-loading">불러오는 중...</div>;

  const lottery = form.selectionMethod === 'lottery';
  const methodLocked = (form.appliedCount || 0) > 0;
  const fmt = (v) => (v ? v.replace('T', ' ') : '-');

  return (
    <div className="admin-form-page" ref={topRef}>
      <div className="form-top">
        <button type="button" className="back-link" onClick={() => navigate('/admin/events')}>
          <IconChevronLeft size={20} />취소
        </button>
        <h2 className="page-title">{isNew ? '새 행사 등록' : '행사 수정'}</h2>
      </div>

      <ol className="stepper" aria-label="진행 단계">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n === step ? 'current' : n < step ? 'done' : 'todo';
          return (
            <li key={label} className={`stepper-item stepper-${state}`}>
              <button type="button" onClick={() => goTo(n)} aria-current={n === step ? 'step' : undefined}>
                <span className="stepper-bar" />
                <span className="stepper-label">{n} {label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <form className="admin-form step-form" onSubmit={handleSubmit}>
        {step === 1 && (
          <>
            <div className="step-head">
              <h3>어떤 행사인가요?</h3>
              <p className="muted">입주민에게 보이는 이름과 설명을 적어주세요.</p>
            </div>
            <div className="field">
              <label htmlFor="ev-title">행사명 *</label>
              <input id="ev-title" value={form.title} onChange={(e) => update('title', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ev-place">장소 *</label>
              <input id="ev-place" value={form.place} onChange={(e) => update('place', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ev-desc">행사 설명 (선택)</label>
              <textarea id="ev-desc" rows={4} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <details className="advanced-field" open={Boolean(form.groupId)}>
              <summary>그룹 설정 (여러 날짜 중 하루만 신청받을 때)</summary>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="ev-gid">그룹 ID</label>
                  <input id="ev-gid" value={form.groupId} onChange={(e) => update('groupId', e.target.value)} placeholder="예: health-2026-09" />
                </div>
                <div className="field">
                  <label htmlFor="ev-gtitle">그룹 제목</label>
                  <input id="ev-gtitle" value={form.groupTitle} onChange={(e) => update('groupTitle', e.target.value)} placeholder="예: 건강상담(택1)" />
                </div>
              </div>
              <p className="muted field-help">
                이틀 이상 진행하는 행사처럼 "여러 날짜 중 하루만 신청 가능"하게 묶으려면, 각 날짜를 별도 행사로 등록한 뒤
                동일한 그룹 ID를 입력하세요. 입주민 화면에는 그룹 제목으로 된 카드 하나에 날짜 선택지가 함께 표시됩니다.
                (그룹 제목을 비워두면 행사명이 대신 사용됩니다.)
              </p>
            </details>
          </>
        )}

        {step === 2 && (
          <>
            <div className="step-head">
              <h3>언제 접수하고, 언제 하나요?</h3>
              <p className="muted">접수 기간과 행사 일시를 정해주세요.</p>
            </div>
            <fieldset className="field-group">
              <legend>접수 기간</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="ev-as">시작 *</label>
                  <input id="ev-as" type="datetime-local" value={form.applyStart} onChange={(e) => update('applyStart', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="ev-ae">종료 *</label>
                  <input id="ev-ae" type="datetime-local" value={form.applyEnd} onChange={(e) => update('applyEnd', e.target.value)} />
                </div>
              </div>
            </fieldset>
            <fieldset className="field-group">
              <legend>행사 일시</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="ev-es">시작 *</label>
                  <input id="ev-es" type="datetime-local" value={form.eventStart} onChange={(e) => update('eventStart', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="ev-ee">종료</label>
                  <input id="ev-ee" type="datetime-local" value={form.eventEnd} onChange={(e) => update('eventEnd', e.target.value)} />
                </div>
              </div>
            </fieldset>
          </>
        )}

        {step === 3 && (
          <>
            <div className="step-head">
              <h3>어떻게 모집하나요?</h3>
              <p className="muted">선택한 방식에 맞는 항목만 아래에 나타납니다.</p>
            </div>

            <div className="method-cards" role="radiogroup" aria-label="모집 방식">
              <button
                type="button"
                role="radio"
                aria-checked={!lottery}
                className={`method-card${!lottery ? ' active' : ''}`}
                disabled={methodLocked}
                onClick={() => update('selectionMethod', 'fcfs')}
              >
                <strong>선착순</strong>
                <span>먼저 신청한 순서로 마감, 정원이 차면 대기 접수</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={lottery}
                className={`method-card${lottery ? ' active' : ''}`}
                disabled={methodLocked}
                onClick={() => update('selectionMethod', 'lottery')}
              >
                <strong>추첨</strong>
                <span>마감까지 모두 접수하고, 마감 후 앱에서 추첨</span>
              </button>
            </div>
            {methodLocked && <p className="muted field-help">이미 신청자가 있어 모집 방식은 변경할 수 없습니다.</p>}

            <div className="stepper-panel">
              <div className="count-row">
                <div className="count-label">
                  <strong>{lottery ? '선발 인원' : '정원'}</strong>
                  <span>{lottery ? '당첨자 수' : '신청 가능한 최대 인원'}</span>
                </div>
                <button type="button" className="count-btn" aria-label="1명 줄이기" onClick={() => adjust('capacity', -1, 1, 9999)}>−</button>
                <input
                  className="count-input"
                  type="number"
                  min="1"
                  aria-label={lottery ? '선발 인원' : '정원'}
                  value={form.capacity}
                  onChange={(e) => update('capacity', e.target.value)}
                />
                <button type="button" className="count-btn count-btn-plus" aria-label="1명 늘리기" onClick={() => adjust('capacity', 1, 1, 9999)}>+</button>
              </div>
              {lottery && (
                <div className="count-row">
                  <div className="count-label">
                    <strong>예비 인원</strong>
                    <span>취소에 대비해 순번 지정</span>
                  </div>
                  <button type="button" className="count-btn" aria-label="1명 줄이기" onClick={() => adjust('reserveCount', -1, 0, 50)}>−</button>
                  <input
                    className="count-input"
                    type="number"
                    min="0"
                    max="50"
                    aria-label="예비 인원"
                    value={form.reserveCount}
                    onChange={(e) => update('reserveCount', e.target.value)}
                  />
                  <button type="button" className="count-btn count-btn-plus" aria-label="1명 늘리기" onClick={() => adjust('reserveCount', 1, 0, 50)}>+</button>
                </div>
              )}
            </div>

            <div className="field">
              <label>세대당 신청</label>
              <div className="seg-tabs" role="radiogroup" aria-label="세대당 신청">
                <button type="button" role="radio" aria-checked={!form.multiPerHousehold} className={`seg-tab${!form.multiPerHousehold ? ' active' : ''}`} onClick={() => update('multiPerHousehold', false)}>1명</button>
                <button type="button" role="radio" aria-checked={form.multiPerHousehold} className={`seg-tab${form.multiPerHousehold ? ' active' : ''}`} onClick={() => update('multiPerHousehold', true)}>가족 여러 명</button>
              </div>
              <p className="muted field-help">
                "가족 여러 명"으로 설정하면 같은 세대에서도 이름·연락처가 다른 가족이 각자 신청할 수 있습니다.
                (이름과 연락처가 모두 같으면 중복 신청으로 처리됩니다.)
              </p>
            </div>

            <div className="extra-fields-editor">
              <div className="page-header-row">
                <h4>신청서 추가 항목</h4>
                <button type="button" className="btn" onClick={addField}>+ 항목 추가</button>
              </div>
              <p className="muted">예: "참가 희망 일시"처럼 신청자가 선택/입력해야 하는 항목을 정의합니다.</p>

              {extraFields.map((f) => (
                <div className="extra-field-row" key={f.id}>
                  <input
                    placeholder="항목명 (예: 참가 희망 일시)"
                    aria-label="항목명"
                    value={f.label}
                    onChange={(e) => updateField(f.id, { label: e.target.value })}
                  />
                  <select aria-label="항목 형식" value={f.type} onChange={(e) => updateField(f.id, { type: e.target.value })}>
                    <option value="select">선택형</option>
                    <option value="text">직접입력</option>
                  </select>
                  {f.type === 'select' && (
                    <input
                      placeholder="선택지 (쉼표로 구분, 예: 1회차,2회차)"
                      aria-label="선택지"
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
          </>
        )}

        {step === 4 && (
          <>
            <div className="step-head">
              <h3>배너와 공개 설정</h3>
              <p className="muted">마지막으로 배너 이미지를 올리고 공개 상태를 정해주세요.</p>
            </div>

            <div className="field">
              <label>배너 이미지 (권장 비율 3:1, 예: 1200x400px — 올리면 자동으로 맞춰 잘립니다)</label>
              {form.bannerImageUrl && <img src={form.bannerImageUrl} alt="배너 미리보기" className="banner-preview" />}
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

            <div className="field">
              <label>공개 상태</label>
              <div className="status-options" role="radiogroup" aria-label="공개 상태">
                {[
                  ['draft', '준비중', '입주민에게 보이지 않음'],
                  ['open', '모집중', '공개하고 접수 시작'],
                  ['closed', '마감', '공개하되 신청 불가'],
                ].map(([value, title, desc]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={form.status === value}
                    className={`status-option${form.status === value ? ' active' : ''}`}
                    onClick={() => update('status', value)}
                  >
                    <strong>{title}</strong>
                    <span>{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <dl className="form-summary">
              <div><dt>행사명</dt><dd>{form.title || '-'}</dd></div>
              <div><dt>장소</dt><dd>{form.place || '-'}</dd></div>
              <div><dt>행사 일시</dt><dd>{fmt(form.eventStart)}{form.eventEnd ? ` ~ ${fmt(form.eventEnd)}` : ''}</dd></div>
              <div><dt>접수 기간</dt><dd>{fmt(form.applyStart)} ~ {fmt(form.applyEnd)}</dd></div>
              <div><dt>모집 방식</dt><dd>{lottery ? `추첨 (선발 ${form.capacity}명 · 예비 ${form.reserveCount}명)` : `선착순 (정원 ${form.capacity}명)`}</dd></div>
            </dl>
          </>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="form-footer">
          {step > 1 && (
            <button type="button" className="btn btn-outline" onClick={() => goTo(step - 1)}>이전</button>
          )}
          {step < STEPS.length ? (
            <button type="submit" className="btn btn-primary">다음</button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={saving || uploading}>{saving ? '저장 중...' : '저장'}</button>
          )}
        </div>
      </form>
    </div>
  );
}
