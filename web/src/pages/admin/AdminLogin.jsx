import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GoogleAuthProvider, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from '../../firebase';

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const RESET_NOTICE = '관리자로 등록된 이메일이면 비밀번호 설정(재설정) 메일이 발송됩니다. 스팸함도 확인해 주세요.';

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(
    location.state?.passwordChanged ? '비밀번호를 바꿨습니다. 새 비밀번호로 로그인해 주세요.' : ''
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const tokenResult = await cred.user.getIdTokenResult();
      if (tokenResult.claims.pendingAdmin === true) {
        // 임시 비밀번호로 처음 들어온 경우: 새 비밀번호를 정해야 관리자 화면을 쓸 수 있습니다.
        navigate('/admin/change-password');
        return;
      }
      if (tokenResult.claims.admin !== true) {
        await signOut(auth);
        setError('관리자 권한이 없는 계정입니다.');
        return;
      }
      navigate('/admin/events');
    } catch (err) {
      setError(`로그인 실패 (${err.code || err.message}). 이메일/비밀번호를 확인해주세요.`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);
      // 방금 추가된 관리자도 바로 들어올 수 있도록 최신 권한을 다시 받아 확인합니다.
      const tokenResult = await cred.user.getIdTokenResult(true);
      if (tokenResult.claims.pendingAdmin === true) {
        // 임시 비밀번호를 받은 계정은 지우면 안 됩니다. 임시 비밀번호 로그인을 먼저 안내합니다.
        await signOut(auth);
        setError('이 계정은 임시 비밀번호로 먼저 로그인해 새 비밀번호를 정해야 합니다. 위 이메일·비밀번호 칸에 입력해 주세요. 안 되면 최고관리자에게 비밀번호 초기화를 요청해 주세요.');
        return;
      }
      if (tokenResult.claims.admin !== true) {
        // 관리자가 아닌 구글 계정이 앱에 남지 않도록 방금 만들어진 계정을 바로 정리합니다.
        try {
          await cred.user.delete();
        } catch {
          await signOut(auth);
        }
        setError('관리자로 등록되지 않은 구글 계정입니다. 최고관리자에게 등록을 요청해 주세요.');
        return;
      }
      navigate('/admin/events');
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
      if (err.code === 'auth/popup-blocked') setError('팝업이 차단되었습니다. 브라우저의 팝업 허용 후 다시 눌러 주세요.');
      else if (err.code === 'auth/operation-not-allowed') setError('구글 로그인이 아직 켜져 있지 않습니다. 시스템 설정을 확인해 주세요.');
      else if (err.code === 'auth/unauthorized-domain') setError('이 주소는 구글 로그인이 허용되지 않았습니다. 시스템 설정을 확인해 주세요.');
      else setError(`구글 로그인 실패 (${err.code || err.message})`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset() {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('위의 이메일 칸에 이메일을 먼저 입력해 주세요.');
      return;
    }
    const prev = auth.languageCode;
    auth.languageCode = 'ko';
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice(RESET_NOTICE);
    } catch (err) {
      if (err.code === 'auth/invalid-email') setError('이메일 주소를 정확히 입력해 주세요.');
      else setNotice(RESET_NOTICE);
    } finally {
      auth.languageCode = prev;
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>관리자 로그인</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="admin-accounts-notice">{notice}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? '확인 중...' : '로그인'}
          </button>
        </form>

        <div className="login-or" aria-hidden="true"><span>또는</span></div>
        <button type="button" className="btn btn-block btn-google" onClick={handleGoogle} disabled={submitting}>
          <GoogleMark />구글 계정으로 로그인
        </button>

        <button type="button" className="link-button login-reset" onClick={handleReset}>
          비밀번호 설정 · 재설정 메일 받기
        </button>
        <a className="admin-link" href="/">입주민 화면으로</a>
      </div>
    </div>
  );
}
