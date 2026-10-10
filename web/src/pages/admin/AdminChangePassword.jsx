import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { PASSWORD_RULE_TEXT, daysLeft, formatUntil, validateNewPassword } from '../../utils/password';

const completePasswordChange = httpsCallable(functions, 'completePasswordChange');

// 임시 비밀번호로 처음 로그인한 관리자가 새 비밀번호를 정하는 화면.
// 이 단계를 마치기 전에는 관리자 권한이 켜지지 않습니다. (서버에서 막고 있음)
export default function AdminChangePassword() {
  const navigate = useNavigate();
  const { loading } = useAuth();
  const [info, setInfo] = useState(null); // { email, tempUntil, pending }
  const [checked, setChecked] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    const u = auth.currentUser;
    if (!u) {
      setChecked(true);
      return;
    }
    u.getIdTokenResult().then((t) => {
      setInfo({ email: u.email || '', tempUntil: Number(t.claims.tempUntil) || null, pending: t.claims.pendingAdmin === true, admin: t.claims.admin === true });
      setChecked(true);
    });
  }, [loading]);

  if (loading || !checked) return <div className="page-loading">불러오는 중...</div>;
  if (!info) return <Navigate to="/admin/login" replace />;
  if (!info.pending) return <Navigate to={info.admin ? '/admin/events' : '/admin/login'} replace />;

  const expired = info.tempUntil != null && Date.now() > info.tempUntil;
  const left = info.tempUntil != null ? daysLeft(info.tempUntil) : null;

  async function handleLogout() {
    await signOut(auth);
    navigate('/admin/login');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const problem = validateNewPassword(newPw);
    if (problem) return setError(problem);
    if (newPw !== confirmPw) return setError('새 비밀번호 확인이 일치하지 않습니다.');
    setBusy(true);
    try {
      await completePasswordChange({ newPassword: newPw });
    } catch (err) {
      setError((err?.message || '').replace(/^\S+:\s*/, '') || '비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
      return;
    }
    // 서버에서 권한을 켜고 기존 로그인을 끊었으므로, 새 비밀번호로 다시 로그인해 새 권한을 받습니다.
    try {
      await signOut(auth);
      const cred = await signInWithEmailAndPassword(auth, info.email, newPw);
      await cred.user.getIdTokenResult(true);
      navigate('/admin/events');
    } catch {
      await signOut(auth).catch(() => {});
      navigate('/admin/login', { state: { passwordChanged: true } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>새 비밀번호 정하기</h1>
        <p className="muted auth-sub">{info.email}</p>

        {expired ? (
          <>
            <p className="form-error" role="alert">
              임시 비밀번호 유효기간이 지났습니다. 최고관리자에게 비밀번호 초기화를 요청해 주세요.
            </p>
            <button type="button" className="btn btn-block" onClick={handleLogout}>처음 화면으로</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="admin-accounts-notice">
              임시 비밀번호로 로그인하셨습니다. 지금 새 비밀번호를 정해야 관리자 화면을 사용할 수 있습니다.
              {info.tempUntil != null && ` (${formatUntil(info.tempUntil)}까지${left != null ? `, ${left}일 남음` : ''})`}
            </p>
            <div className="field">
              <label htmlFor="new-pw">새 비밀번호</label>
              <input id="new-pw" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              <span className="muted">{PASSWORD_RULE_TEXT}</span>
            </div>
            <div className="field">
              <label htmlFor="confirm-pw">새 비밀번호 확인</label>
              <input id="confirm-pw" type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || !newPw || !confirmPw}>
              {busy ? '변경 중...' : '비밀번호 변경하고 시작하기'}
            </button>
            <button type="button" className="link-button login-reset" onClick={handleLogout} disabled={busy}>
              나중에 하기 (로그아웃)
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
