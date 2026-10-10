import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { IconPlus, IconTrash } from '../../components/icons';
import ConfirmSheet from '../../components/ConfirmSheet';
import { PASSWORD_RULE_TEXT, daysLeft, formatUntil } from '../../utils/password';

const listAdmins = httpsCallable(functions, 'listAdmins');
const addAdmin = httpsCallable(functions, 'addAdmin');
const removeAdmin = httpsCallable(functions, 'removeAdmin');
const resetAdminPassword = httpsCallable(functions, 'resetAdminPassword');

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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// 새 관리자에게 전달할 안내 문구
function buildGuide({ email, tempPassword, tempUntil }) {
  return [
    '[래미안베라힐즈 행사신청 관리자 계정 안내]',
    `접속 주소: ${window.location.origin}/admin/login`,
    `이메일: ${email}`,
    `임시 비밀번호: ${tempPassword}`,
    '',
    `1) 위 주소에서 이메일과 임시 비밀번호로 로그인합니다.`,
    `2) 새 비밀번호를 정합니다. (${PASSWORD_RULE_TEXT})`,
    `※ 임시 비밀번호는 ${formatUntil(tempUntil)}까지만 사용할 수 있습니다.`,
  ].join('\n');
}

// 한 번만 보여 주는 임시 비밀번호 카드
function CredentialCard({ credential, onClose }) {
  const [copied, setCopied] = useState('');
  async function copy(kind, text) {
    const ok = await copyText(text);
    setCopied(ok ? kind : 'fail');
  }
  return (
    <section className="credential-card" role="status" aria-label="임시 비밀번호 안내">
      <div className="credential-title">
        {credential.kind === 'reset' ? '비밀번호를 초기화했습니다' : '관리자를 추가했습니다'}
      </div>
      <dl className="credential-lines">
        <div><dt>이메일</dt><dd>{credential.email}</dd></div>
        <div><dt>임시 비밀번호</dt><dd className="credential-pw">{credential.tempPassword}</dd></div>
        <div><dt>사용 기한</dt><dd>{formatUntil(credential.tempUntil)}까지 (15일)</dd></div>
      </dl>
      <p className="credential-warn">
        이 화면을 닫으면 임시 비밀번호를 다시 볼 수 없습니다. 지금 복사해서 본인에게 직접 전달해 주세요.
        받은 사람이 로그인 후 새 비밀번호를 정하기 전까지는 관리자 업무를 할 수 없습니다.
      </p>
      <div className="credential-actions">
        <button type="button" className="btn btn-primary" onClick={() => copy('guide', buildGuide(credential))}>
          {copied === 'guide' ? '복사됨' : '안내 문구 복사'}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => copy('pw', credential.tempPassword)}>
          {copied === 'pw' ? '복사됨' : '비밀번호만 복사'}
        </button>
        <button type="button" className="btn" onClick={onClose}>닫기</button>
      </div>
      {copied === 'fail' && <p className="form-error">복사하지 못했습니다. 위 비밀번호를 직접 적어 주세요.</p>}
    </section>
  );
}

function statusText(a) {
  if (a.status === 'temp') {
    const left = a.tempUntil ? daysLeft(a.tempUntil) : null;
    if (left != null && left <= 0) return { text: '임시 비밀번호 기간 만료 · 초기화 필요', tone: 'bad' };
    return { text: `임시 비밀번호 · 변경 전${left != null ? ` (${left}일 남음)` : ''}`, tone: 'warn' };
  }
  if (a.status === 'invited') return { text: '구글 로그인 · 첫 로그인 전', tone: '' };
  return { text: a.lastSignInAt ? `최근 로그인 ${shortDate(a.lastSignInAt)}` : '', tone: '' };
}

// 최고관리자 전용: 일반관리자 추가/해제/비밀번호 초기화
export default function AdminAccounts() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('temp'); // 'temp' 임시 비밀번호 | 'google' 구글 로그인
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone: 'ok' | 'error', text }
  const [credential, setCredential] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetError, setResetError] = useState('');

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
    setCredential(null);
    try {
      const res = await addAdmin({ email: target, mode });
      setEmail('');
      if (res.data.tempPassword) {
        setCredential({ kind: 'add', email: res.data.email, tempPassword: res.data.tempPassword, tempUntil: res.data.tempUntil });
      } else {
        setMessage({ tone: 'ok', text: `${res.data.email} 을(를) 관리자로 추가했습니다. 로그인 화면의 '구글 계정으로 로그인'으로 들어오면 됩니다.` });
      }
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: errMessage(err, '관리자를 추가하지 못했습니다.') });
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!resetTarget) return;
    setBusy(true);
    setResetError('');
    try {
      const res = await resetAdminPassword({ uid: resetTarget.uid });
      setResetTarget(null);
      setMessage(null);
      setCredential({ kind: 'reset', email: res.data.email, tempPassword: res.data.tempPassword, tempUntil: res.data.tempUntil });
      await load();
    } catch (err) {
      setResetError(errMessage(err, '비밀번호를 초기화하지 못했습니다.'));
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
        일반관리자는 관리자 추가·해제·비밀번호 초기화를 뺀 모든 업무를 할 수 있습니다.
      </p>

      <form className="detail-card admin-add-form" onSubmit={handleAdd}>
        <div className="info-label">로그인 방식</div>
        <div className="seg-tabs" role="tablist" aria-label="로그인 방식">
          <button type="button" role="tab" aria-selected={mode === 'temp'} className={`seg-tab${mode === 'temp' ? ' active' : ''}`} onClick={() => setMode('temp')}>
            임시 비밀번호
          </button>
          <button type="button" role="tab" aria-selected={mode === 'google'} className={`seg-tab${mode === 'google' ? ' active' : ''}`} onClick={() => setMode('google')}>
            구글 로그인
          </button>
        </div>
        <p className="muted admin-mode-help">
          {mode === 'temp'
            ? '무작위 임시 비밀번호가 만들어집니다(15일간 유효). 받은 사람이 이메일과 임시 비밀번호로 로그인한 뒤 새 비밀번호를 정해야 업무를 시작할 수 있습니다.'
            : '비밀번호를 만들지 않습니다. 해당 이메일의 구글 계정으로 로그인 화면의 \'구글 계정으로 로그인\'을 누르면 바로 들어올 수 있습니다.'}
        </p>
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

      {credential && <CredentialCard credential={credential} onClose={() => setCredential(null)} />}

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
            const st = statusText(a);
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
                    <span className={`muted${st.tone ? ` admin-status-${st.tone}` : ''}`}>{st.text}</span>
                  </div>
                </div>
                {a.role !== 'super' && (
                  <div className="admin-account-actions">
                    <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setResetError(''); setResetTarget(a); }}>
                      비밀번호 초기화
                    </button>
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

      {resetTarget && (
        <ConfirmSheet
          eyebrow="비밀번호 초기화"
          title={`${resetTarget.email}`}
          confirmLabel="초기화하고 임시 비밀번호 받기"
          confirmTone="primary"
          busy={busy}
          error={resetError}
          onConfirm={handleReset}
          onCancel={() => setResetTarget(null)}
        >
          <p>
            새 임시 비밀번호(15일간 유효)를 만듭니다. 지금 쓰던 비밀번호는 바로 쓸 수 없게 되고,
            열려 있는 로그인도 끊깁니다(최대 1시간 안에 적용). 본인이 새 비밀번호를 정하기 전까지는 관리자 업무를 할 수 없습니다.
          </p>
          <p>구글 로그인만 쓰던 사람도 초기화 후에는 임시 비밀번호로 먼저 로그인해야 합니다.</p>
        </ConfirmSheet>
      )}
    </section>
  );
}
