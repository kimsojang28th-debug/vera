import { useEffect, useState } from 'react';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 되돌릴 수 없는 작업 앞에 띄우는 확인창. requireText를 주면 그 문구를 직접 입력해야 진행됩니다.
export default function ConfirmSheet({
  eyebrow = '확인',
  title,
  children,
  confirmLabel,
  confirmTone = 'danger',
  requireText = '',
  disabled = false,
  busy = false,
  error = '',
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const typedOk = !requireText || norm(typed) === norm(requireText);
  const canConfirm = typedOk && !disabled && !busy;

  return (
    <div className="sheet-backdrop" onClick={() => !busy && onCancel()}>
      <section className="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-eyebrow">{eyebrow}</div>
        <div className="sheet-title">{title}</div>
        <div className="confirm-body">{children}</div>

        {requireText && (
          <label className="confirm-type">
            <span>계속하려면 아래 칸에 다음 문구를 그대로 입력하세요.</span>
            <strong className="confirm-type-text">{requireText}</strong>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="확인 문구 입력"
            />
          </label>
        )}

        {error && <p className="form-error">{error}</p>}

        <button
          type="button"
          className={`btn btn-block confirm-go${confirmTone === 'danger' ? ' confirm-go-danger' : ' btn-primary'}`}
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          {busy ? '처리 중...' : confirmLabel}
        </button>
        <button type="button" className="btn btn-block sheet-close" onClick={onCancel} disabled={busy}>취소</button>
      </section>
    </div>
  );
}
