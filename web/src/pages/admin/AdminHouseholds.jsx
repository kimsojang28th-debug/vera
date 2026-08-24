import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';

// 입력값 뒤에 "동"/"호"/"호수"가 붙어 있어도(예: "201동", "1001호") 숫자만 남기고 정리합니다.
function normalizeUnit(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/(동|호수|호)\s*$/u, '')
    .trim();
}

export default function AdminHouseholds() {
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dong, setDong] = useState('');
  const [ho, setHo] = useState('');
  const [name, setName] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'households'), orderBy('dong'));
    const unsub = onSnapshot(q, (snap) => {
      setHouseholds(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function addHousehold(dongRaw, hoRaw, nameVal) {
    const dongVal = normalizeUnit(dongRaw);
    const hoVal = normalizeUnit(hoRaw);
    if (!dongVal || !hoVal) return false;
    const id = `${dongVal}-${hoVal}`;
    const existing = await getDoc(doc(db, 'households', id));
    if (existing.exists()) return false;
    await setDoc(doc(db, 'households', id), {
      dong: dongVal,
      ho: hoVal,
      phone: '',
      residentName: nameVal || null,
      passwordHash: null,
      isRegistered: false,
      failedAttempts: 0,
      lockUntil: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  }

  async function handleAddSingle(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!dong.trim() || !ho.trim()) {
      setError('동, 호수를 입력해주세요.');
      return;
    }
    const ok = await addHousehold(dong.trim(), ho.trim(), name.trim());
    if (!ok) {
      setError('이미 등록된 동/호수입니다.');
      return;
    }
    setMessage('등록되었습니다.');
    setDong('');
    setHo('');
    setName('');
  }

  async function handleBulkAdd() {
    setError('');
    setMessage('');
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    let added = 0;
    let skipped = 0;
    for (const line of lines) {
      const parts = line.split(/[,\s]+/).filter(Boolean);
      if (parts.length < 2) { skipped += 1; continue; }
      const [d, h, n] = parts;
      const ok = await addHousehold(d, h, n);
      if (ok) added += 1; else skipped += 1;
    }
    setMessage(`${added}건 등록, ${skipped}건 건너뜀(형식오류 또는 중복)`);
    setBulkText('');
  }

  async function handleEditName(id, currentName) {
    const next = window.prompt('입주민 성명(선택, 신청현황 마스킹 표시용)', currentName || '');
    if (next === null) return;
    await updateDoc(doc(db, 'households', id), { residentName: next.trim() || null, updatedAt: serverTimestamp() });
  }

  async function handleResetPassword(id) {
    if (!window.confirm('비밀번호를 초기화하시겠습니까? 다음 접속 시 새 비밀번호로 재등록됩니다.')) return;
    await updateDoc(doc(db, 'households', id), {
      passwordHash: null,
      isRegistered: false,
      failedAttempts: 0,
      lockUntil: null,
      updatedAt: serverTimestamp(),
    });
  }

  async function handleDelete(id) {
    if (!window.confirm('세대를 목록에서 삭제하시겠습니까? (이사 등으로 더 이상 유효하지 않은 경우)')) return;
    await deleteDoc(doc(db, 'households', id));
  }

  return (
    <div>
      <h2 className="page-title">동호수관리</h2>
      <p className="muted">여기 등록된 동/호수만 입주민 로그인이 가능합니다.</p>

      <div className="admin-panels">
        <form className="admin-panel" onSubmit={handleAddSingle}>
          <h3>개별 등록</h3>
          <div className="field-row">
            <input placeholder="동 (예: 101)" value={dong} onChange={(e) => setDong(e.target.value)} />
            <input placeholder="호수 (예: 1502)" value={ho} onChange={(e) => setHo(e.target.value)} />
          </div>
          <div className="field-row">
            <input placeholder="성명(선택, 마스킹 표시용)" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn btn-primary">등록</button>
          </div>
        </form>

        <div className="admin-panel">
          <h3>일괄 등록</h3>
          <p className="muted">한 줄에 하나씩 "동,호수,성명(선택)" 형식으로 입력하세요. (예: 101,1502,홍길동)</p>
          <textarea rows={5} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={'101,1501,홍길동\n101,1502\n102,301'} />
          <button className="btn" onClick={handleBulkAdd} disabled={!bulkText.trim()}>일괄 등록</button>
        </div>
      </div>

      {message && <p className="notice-box">{message}</p>}
      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <div className="page-loading">불러오는 중...</div>
      ) : (
        <table>
          <thead>
            <tr><th>동</th><th>호수</th><th>성명</th><th>연락처</th><th>등록상태</th><th></th></tr>
          </thead>
          <tbody>
            {households.map((h) => (
              <tr key={h.id}>
                <td>{h.dong}동</td>
                <td>{h.ho}호</td>
                <td>{h.residentName || '-'}</td>
                <td>{h.phone || '-'}</td>
                <td>{h.isRegistered ? '등록완료' : '미등록(비밀번호 대기)'}</td>
                <td className="table-actions">
                  <button className="link-button" onClick={() => handleEditName(h.id, h.residentName)}>성명수정</button>
                  {h.isRegistered && <button className="link-button" onClick={() => handleResetPassword(h.id)}>비번초기화</button>}
                  <button className="link-button" onClick={() => handleDelete(h.id)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
