import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { auth, functions } from '../../firebase';

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ dong: '', ho: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.dong || !form.ho || !form.phone || !form.password) {
      setError('동, 호수, 연락처, 비밀번호를 모두 입력해주세요.');
      return;
    }
    if (form.password.length < 4) {
      setError('비밀번호는 4자 이상 입력해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const householdLogin = httpsCallable(functions, 'householdLogin');
      const result = await householdLogin({
        dong: form.dong.trim(),
        ho: form.ho.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      await signInWithCustomToken(auth, result.data.token);
      navigate('/events');
    } catch (err) {
      setError(err.message?.replace(/^\S+:\s*/, '') || '로그인에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>래미안베라힐즈</h1>
        <p className="auth-subtitle">행사 신청 시스템</p>

        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="dong">동</label>
              <input id="dong" placeholder="예: 101" value={form.dong} onChange={(e) => update('dong', e.target.value)} inputMode="numeric" />
            </div>
            <div className="field">
              <label htmlFor="ho">호수</label>
              <input id="ho" placeholder="예: 1502" value={form.ho} onChange={(e) => update('ho', e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="phone">연락처</label>
            <input id="phone" placeholder="010-0000-0000" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input id="password" type="password" placeholder="처음 접속 시 사용할 비밀번호를 설정합니다" value={form.password} onChange={(e) => update('password', e.target.value)} />
          </div>

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? '확인 중...' : '입장하기'}
          </button>
        </form>

        <p className="auth-hint">
          처음 접속하시는 경우 입력하신 비밀번호로 자동 등록됩니다.<br />
          동/호수가 등록되어 있지 않거나 비밀번호를 잊으셨다면 관리사무소로 문의해주세요.
        </p>

        <a className="admin-link" href="/admin/login">관리자 로그인</a>
      </div>
    </div>
  );
}
