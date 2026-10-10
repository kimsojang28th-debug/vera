import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { PASSWORD_RULE_TEXT, validateNewPassword } from '../../utils/password';

// 로그인한 관리자가 자기 비밀번호를 직접 바꿉니다. (구글 로그인 전용 계정에는 보이지 않음)
export default function AdminPasswordChange() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }

  const hasPassword = (user?.providerData || []).some((p) => p.providerId === 'password');
  if (!user || !hasPassword) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage(null);
    const problem = validateNewPassword(next);
    if (problem) return setMessage({ tone: 'error', text: problem });
    if (next !== confirm) return setMessage({ tone: 'error', text: '새 비밀번호 확인이 일치하지 않습니다.' });
    if (next === current) return setMessage({ tone: 'error', text: '지금 비밀번호와 다른 비밀번호를 사용해 주세요.' });
    setBusy(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, current);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ tone: 'ok', text: '비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 사용하세요.' });
    } catch (err) {
      const code = err?.code || '';
      let text = '비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') text = '지금 비밀번호가 맞지 않습니다.';
      else if (code === 'auth/too-many-requests') text = '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
      else if (code === 'auth/weak-password') text = '더 안전한 비밀번호를 사용해 주세요.';
      setMessage({ tone: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-pw-change" aria-label="내 비밀번호 변경">
      <h3 className="section-label">내 비밀번호 변경</h3>
      <form className="detail-card" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="pw-current">지금 비밀번호</label>
          <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw-next">새 비밀번호</label>
          <input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <span className="muted">{PASSWORD_RULE_TEXT}</span>
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">새 비밀번호 확인</label>
          <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {message && (
          <p className={message.tone === 'error' ? 'form-error' : 'admin-accounts-notice'} role="status">{message.text}</p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !current || !next || !confirm}>
          {busy ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </section>
  );
}
