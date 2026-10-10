import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import ConfirmSheet from '../../components/ConfirmSheet';

const cleanup = httpsCallable(functions, 'cleanupOrphanData');

// 예전에 행사를 삭제하면서 남은 신청 내역·추첨 기록을 찾아 정리합니다.
export default function AdminDataCleanup() {
  const [found, setFound] = useState(null); // { events, applications, draws }
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }

  async function handleCheck() {
    setChecking(true);
    setMessage(null);
    setFound(null);
    try {
      const res = await cleanup({ dryRun: true });
      const { events, applications, draws } = res.data;
      if (applications === 0 && draws === 0) {
        setMessage({ tone: 'ok', text: '남아 있는 데이터가 없습니다. 정리할 것이 없습니다.' });
      } else {
        setFound({ events, applications, draws });
      }
    } catch (err) {
      setMessage({ tone: 'error', text: err.message?.replace(/^\S+:\s*/, '') || '확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setChecking(false);
    }
  }

  async function handleClean() {
    setBusy(true);
    try {
      const res = await cleanup({ dryRun: false });
      setConfirmOpen(false);
      setFound(null);
      setMessage({ tone: 'ok', text: `정리했습니다. (신청 내역 ${res.data.applications}건, 추첨 기록 ${res.data.draws}건 삭제)` });
    } catch (err) {
      setConfirmOpen(false);
      setMessage({ tone: 'error', text: err.message?.replace(/^\S+:\s*/, '') || '정리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-cleanup" aria-label="데이터 정리">
      <h3 className="section-label">데이터 정리</h3>
      <div className="detail-card">
        <p>
          예전에 행사를 삭제하면서 남은 신청 내역·추첨 기록을 찾아 정리합니다. 지금부터는 행사를 삭제하면 함께 삭제되므로,
          이전에 삭제한 행사 때문에 남은 자료가 있을 때만 필요합니다.
        </p>
        <button type="button" className="btn btn-block" onClick={handleCheck} disabled={checking || busy}>
          {checking ? '확인 중...' : '남은 데이터 찾기'}
        </button>

        {found && (
          <div className="cleanup-found">
            <p>
              이미 삭제된 행사 {found.events}개의 <strong>신청 내역 {found.applications}건</strong>
              {found.draws > 0 ? `, 추첨 기록 ${found.draws}건` : ''}이(가) 남아 있습니다.
            </p>
            <button type="button" className="btn btn-block confirm-go-danger" onClick={() => setConfirmOpen(true)}>
              남은 데이터 모두 삭제
            </button>
          </div>
        )}
      </div>

      {message && (
        <p className={message.tone === 'error' ? 'form-error' : 'admin-accounts-notice'} role="status">{message.text}</p>
      )}

      {confirmOpen && found && (
        <ConfirmSheet
          eyebrow="데이터 정리"
          title="남은 데이터 삭제"
          confirmLabel="영구 삭제"
          busy={busy}
          onConfirm={handleClean}
          onCancel={() => setConfirmOpen(false)}
        >
          <p>
            이미 삭제된 행사의 신청 내역 {found.applications}건과 추첨 기록 {found.draws}건을 삭제합니다.
            입주민 개인정보가 포함되어 있고 복구할 수 없습니다.
          </p>
        </ConfirmSheet>
      )}
    </section>
  );
}
