import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { IconPlus, IconTrash } from '../../components/icons';

const listAdmins = httpsCallable(functions, 'listAdmins');
const addAdmin = httpsCallable(functions, 'addAdmin');
const removeAdmin = httpsCallable(functions, 'removeAdmin');

function errMessage(err, fallback) {
  const msg = err?.message || '';
  // Firebase 함수 오류는 "functions/permission-denied: ..." 형태가 아니라 message만 오는 경우가 많습니다.
  return msg.replace(/^\S+:\s*/, '') || fallback;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 새 관리자가 직접 비밀번호를 정하도록 설정 메일을 보냅니다. (메일 문구는 한국어)
async function sendSetupMail(email) {
  const prev = auth.languageCode;
  auth.languageCode = 'ko';
  try {
    await sendPasswordResetEmail(auth, email);
  } finally {
    auth.languageCode = prev;
  }
}

// 최고관리자 전용: 일반관리자 추가/해제
export default function AdminAccounts() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone: 'ok' | 'error', text }

  const load = useCallback(async () => {
    try {
      const res = await listAdmins();
      setAdmins(res.data.admins || []);
      setLoadError('');
    } catch (err) {
      setLoadError(errMessage(err, '관리자 목록을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    const target = email.trim();
    if (!target) return;
    setBusy(true);
    setMessage(null);
    try {
      await addAdmin({ email: target });
      setEmail('');
      try {
        await sendSetupMail(target);
        setMessage({ tone: 'ok', text: `${target} 을(를) 관리자로 추가했습니다. 비밀번호 설정 메일을 보냈습니다. 구글 계정이면 메일 없이 구글 로그인으로 들어올 수도 있습니다.` });
      } catch {
        setMessage({ tone: 'error', text: `${target} 을(를) 관리자로 추가했지만 설정 메일을 보내지 못했습니다. 목록의 '설정 메일 다시 보내기'를 눌러 주세요.` });
      }
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: errMessage(err, '관리자를 추가하지 못했습니다.') });
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(admin) {
    setBusy(true);
    setMessage(null);
    try {
      await sendSetupMail(admin.email);
      setMessage({ tone: 'ok', text: `${admin.email} 로 비밀번호 설정 메일을 다시 보냈습니다. 스팸함도 확인하도록 안내해 주세요.` });
    } catch {
      setMessage({ tone: 'error', text: '메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(admin) {
    if (!window.confirm(`'${admin.email}' 관리자를 해제하시겠습니까?\n이 계정은 삭제되어 더 이상 로그인할 수 없습니다.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await removeAdmin({ uid: admin.uid });
      setMessage({ tone: 'ok', text: `${admin.email} 관리자를 해제했습니다. 이미 열려 있는 화면은 최대 1시간 안에 사용할 수 없게 됩니다.` });
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: errMessage(err, '관리자를 해제하지 못했습니다.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-accounts" aria-label="관리자 관리">
      <h3 className="section-label">관리자 관리</h3>
      <p className="muted admin-accounts-help">
        일반관리자는 관리자 추가·해제를 뺀 모든 업무를 할 수 있습니다. 비밀번호는 본인이 직접 정하므로 공유할 필요가 없습니다.
      </p>

      <form className="detail-card admin-add-form" onSubmit={handleAdd}>
        <label htmlFor="new-admin-email" className="info-label">추가할 관리자 이메일</label>
        <div className="admin-add-row">
          <input
            id="new-admin-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="example@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
            <IconPlus size={18} />추가
          </button>
        </div>
      </form>

      {message && (
        <p className={message.tone === 'error' ? 'form-error' : 'admin-accounts-notice'} role="status">{message.text}</p>
      )}

      {loading ? (
        <div className="page-loading">불러오는 중...</div>
      ) : loadError ? (
        <p className="form-error">{loadError}</p>
      ) : (
        <ul className="admin-account-list">
          {admins.map((a) => {
            const isMe = a.uid === user?.uid;
            return (
              <li key={a.uid} className="admin-account-row">
                <div className="admin-account-main">
                  <div className="admin-account-email">
                    {a.email}
                    {isMe && <span className="admin-account-me">나</span>}
                  </div>
                  <div className="admin-account-meta">
                    <span className={`badge ${a.role === 'super' ? 'badge-waiting' : 'badge-open'}`}>
                      {a.role === 'super' ? '최고관리자' : '일반관리자'}
                    </span>
                    <span className="muted">
                      {a.pending ? '비밀번호 설정 전' : a.lastSignInAt ? `최근 로그인 ${shortDate(a.lastSignInAt)}` : ''}
                    </span>
                  </div>
                </div>
                {a.role !== 'super' && (
                  <div className="admin-account-actions">
                    {a.pending && (
                      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => handleResend(a)}>
                        설정 메일 다시 보내기
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => handleRemove(a)}
                      aria-label={`${a.email} 관리자 해제`}
                    >
                      <IconTrash size={18} />해제
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
