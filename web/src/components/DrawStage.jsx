import { useEffect, useMemo, useRef, useState } from 'react';
import { maskNameClient, pickLabel } from '../utils/draw';

const WHEEL_MAX = 30; // 이 인원 이하면 휠, 넘으면 룰렛(이름이 빠르게 넘어가는 방식)
const SPIN_MS = 4200;
const REEL_MS = 3200;
const AUTO_GAP_MS = 1800;
const COLORS = ['#1E3A5C', '#8A5A12', '#2F6B3D', '#5B3A6B', '#A73B33', '#2F6B8F'];

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

// 남은 신청자를 조각으로 나눈 휠. 위쪽 화살표가 가리키는 칸이 이번에 뽑힌 사람입니다.
function Wheel({ items, rotation, animate }) {
  const n = items.length;
  const a = 360 / n;
  const fontSize = n <= 8 ? 15 : n <= 16 ? 12 : 9.5;
  return (
    <div className="wheel-wrap">
      <svg className="wheel-pointer" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M20 38 L6 6 Q20 12 34 6 Z" fill="#E3C768" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <svg
        className="wheel-svg"
        viewBox="0 0 300 300"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: animate ? `transform ${SPIN_MS}ms cubic-bezier(0.14, 0.68, 0.12, 1)` : 'none',
        }}
        role="img"
        aria-label="추첨 휠"
      >
        {n === 1 ? (
          <circle cx="150" cy="150" r="140" fill={COLORS[0]} />
        ) : (
          items.map((item, i) => {
            const [x1, y1] = polar(150, 150, 140, i * a);
            const [x2, y2] = polar(150, 150, 140, (i + 1) * a);
            const large = a > 180 ? 1 : 0;
            return (
              <path
                key={item.index}
                d={`M150 150 L${x1} ${y1} A140 140 0 ${large} 1 ${x2} ${y2} Z`}
                fill={COLORS[i % COLORS.length]}
                stroke="#F4EFE2"
                strokeWidth="1.5"
              />
            );
          })
        )}
        {items.map((item, i) => {
          const mid = n === 1 ? 0 : (i + 0.5) * a;
          return (
            <text
              key={`t-${item.index}`}
              transform={`rotate(${mid - 90} 150 150)`}
              x="282"
              y="150"
              textAnchor="end"
              dominantBaseline="central"
              fill="#FFFFFF"
              fontSize={fontSize}
              fontWeight="700"
            >
              {item.short}
            </text>
          );
        })}
        <circle cx="150" cy="150" r="16" fill="#F4EFE2" stroke="#C9A227" strokeWidth="3" />
      </svg>
    </div>
  );
}

// data: { entries:[{dong,ho,name}], picked:[{index,rank,result,reserveNo}], winnerCount, reserveCount, resultHash }
export default function DrawStage({ data, mode = 'replay', maskNames = false, autoDefault = false, onClose, children }) {
  const { entries, picked, winnerCount, reserveCount } = data;
  const total = picked.length;
  const useWheel = entries.length <= WHEEL_MAX;
  const replay = mode === 'replay'; // 입주민 다시 보기: 자동 진행만 지원

  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [auto, setAuto] = useState(autoDefault || replay);
  const [pendingStart, setPendingStart] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [reelEntry, setReelEntry] = useState(null);
  const [lastPick, setLastPick] = useState(null);
  const [isFull, setIsFull] = useState(false);
  const timers = useRef([]);
  const rootRef = useRef(null);

  const nameOf = (e) => (maskNames ? maskNameClient(e.name) : e.name);
  const fullLabel = (e) => `${e.dong}동 ${e.ho}호 ${nameOf(e)}`.trim();

  const revealed = useMemo(() => new Set(picked.slice(0, step).map((p) => p.index)), [picked, step]);
  const pool = useMemo(
    () =>
      entries
        .map((e, index) => ({ ...e, index, short: `${e.dong}-${e.ho}` }))
        .filter((e) => !revealed.has(e.index)),
    [entries, revealed]
  );

  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.current.push(id);
  }
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    []
  );
  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function finishSpin(target) {
    setSpinning(false);
    setAnimate(false);
    setRotation(0);
    setReelEntry(null);
    setLastPick({ pick: target, entry: entries[target.index] });
    setStep((s) => s + 1);
  }

  function spinNext() {
    if (spinning || step >= total) return;
    const target = picked[step];
    setStarted(true);
    setSpinning(true);
    setLastPick(null);
    if (useWheel) {
      const idx = pool.findIndex((e) => e.index === target.index);
      const a = 360 / pool.length;
      const jitter = (Math.random() - 0.5) * a * 0.6;
      const finalRot = 5 * 360 + (360 - (idx + 0.5) * a) + jitter;
      setAnimate(false);
      setRotation(0);
      later(() => {
        setAnimate(true);
        setRotation(finalRot);
      }, 60);
      later(() => finishSpin(target), 60 + SPIN_MS + 300);
    } else {
      let elapsed = 0;
      let delay = 40;
      const tick = () => {
        if (elapsed >= REEL_MS) {
          finishSpin(target);
          return;
        }
        setReelEntry(pool[Math.floor(Math.random() * pool.length)]);
        elapsed += delay;
        delay = Math.min(320, delay * 1.13);
        later(tick, delay);
      };
      tick();
    }
  }

  // 자동 진행: 한 명 공개가 끝나면 잠시 뒤 다음 사람을 뽑습니다.
  useEffect(() => {
    if (!auto || !started || spinning || step >= total) return undefined;
    const id = setTimeout(spinNext, AUTO_GAP_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, started, spinning, step]);

  // 처음부터 다시 보기: 상태를 모두 되돌린 뒤 자동으로 바로 시작합니다.
  function restart() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSpinning(false);
    setAnimate(false);
    setRotation(0);
    setReelEntry(null);
    setLastPick(null);
    setStarted(false);
    setStep(0);
    setPendingStart(true);
  }

  useEffect(() => {
    if (pendingStart && !started && step === 0 && !spinning) {
      setPendingStart(false);
      spinNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStart, started, step, spinning]);

  function showAll() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSpinning(false);
    setAnimate(false);
    setRotation(0);
    setReelEntry(null);
    setStarted(true);
    setStep(total);
    if (total > 0) setLastPick({ pick: picked[total - 1], entry: entries[picked[total - 1].index] });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current?.requestFullscreen?.();
    } catch {
      // 전체화면을 지원하지 않는 환경에서는 무시합니다.
    }
  }

  const done = step >= total;
  const winnerSlots = Array.from({ length: winnerCount }, (_, i) => picked[i]);
  const reserveSlots = Array.from({ length: reserveCount }, (_, i) => picked[winnerCount + i]);

  const renderSlot = (pick, i, kind) => {
    const shown = pick && picked.indexOf(pick) < step;
    const entry = shown ? entries[pick.index] : null;
    return (
      <li key={`${kind}-${i}`} className={`stage-slot${shown ? ' stage-slot-filled' : ''}`}>
        <span className="stage-slot-no">{kind === 'selected' ? i + 1 : `예비 ${i + 1}`}</span>
        <span className="stage-slot-name">{entry ? fullLabel(entry) : '—'}</span>
      </li>
    );
  };

  return (
    <div className={`draw-stage${isFull ? ' draw-stage-full' : ''}`} ref={rootRef}>
      <div className="draw-stage-top">
        <div>
          <div className="draw-stage-eyebrow">{mode === 'live' ? '추첨 진행' : '추첨 다시 보기'}</div>
          <h2 className="draw-stage-title">{data.eventTitle}</h2>
          <div className="draw-stage-sub">
            신청 {entries.length}명 · 당첨 {winnerCount}명 · 예비 {reserveCount}명
          </div>
        </div>
        <div className="draw-stage-tools">
          <button type="button" className="stage-btn" onClick={toggleFullscreen}>
            {isFull ? '전체화면 종료' : '전체화면'}
          </button>
          {onClose && (
            <button type="button" className="stage-btn" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
      </div>

      <div className="draw-stage-body">
        <div className="draw-stage-main">
          <div className="stage-board">
            {done ? (
              <div className="stage-done">
                <div className="stage-done-title">추첨이 모두 끝났습니다</div>
                <div className="stage-done-sub">당첨 {winnerCount}명 · 예비 {reserveCount}명</div>
              </div>
            ) : !started ? (
              <div className="stage-done">
                <div className="stage-done-title">{entries.length}명 중 {total}명을 순서대로 뽑습니다</div>
                <div className="stage-done-sub">먼저 당첨 {winnerCount}명, 이어서 예비 {reserveCount}명</div>
              </div>
            ) : useWheel && pool.length > 0 ? (
              <Wheel items={pool} rotation={rotation} animate={animate} />
            ) : (
              <div className="reel-box" aria-live="polite">
                <div className="reel-name">{reelEntry ? fullLabel(reelEntry) : '…'}</div>
              </div>
            )}
          </div>

          {lastPick && !spinning && !done && (
            <div className={`stage-banner stage-banner-${lastPick.pick.result}`} role="status">
              <span className="stage-banner-tag">{pickLabel(lastPick.pick)}</span>
              <span className="stage-banner-name">{fullLabel(lastPick.entry)}</span>
            </div>
          )}

          <div className="stage-controls">
            {!started ? (
              <button type="button" className="stage-cta" onClick={spinNext} disabled={total === 0}>
                {replay ? '추첨 과정 다시 보기' : '추첨 시작'}
              </button>
            ) : done ? (
              replay ? (
                <button type="button" className="stage-cta" onClick={restart}>
                  처음부터 다시 보기
                </button>
              ) : (
                <>{children}</>
              )
            ) : replay ? (
              <div className="stage-progress" role="status">
                추첨 중… ({Math.min(total, step + (spinning ? 1 : 0))}/{total})
              </div>
            ) : (
              <button type="button" className="stage-cta" onClick={spinNext} disabled={spinning || auto}>
                {spinning ? '추첨 중…' : `다음 추첨 (${step + 1}/${total})`}
              </button>
            )}
            {!done && (
              <div className="stage-sub-controls">
                {!replay && (
                  <label className="stage-check">
                    <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                    자동 진행
                  </label>
                )}
                <button type="button" className="stage-link" onClick={showAll}>
                  결과 바로 보기
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="draw-stage-results">
          <h3>당첨 {winnerCount}명</h3>
          <ol className="stage-list">{winnerSlots.map((p, i) => renderSlot(p, i, 'selected'))}</ol>
          {reserveCount > 0 && (
            <>
              <h3>예비 {reserveCount}명</h3>
              <ol className="stage-list">{reserveSlots.map((p, i) => renderSlot(p, i, 'reserve'))}</ol>
            </>
          )}
        </div>
      </div>

      <p className="draw-stage-foot">
        ※ 추첨 결과는 서버에서 먼저 확정·저장된 뒤, 이 화면에서 순서대로 공개됩니다.
        {data.resultHash ? ` (증빙 코드 ${data.resultHash.slice(0, 12)})` : ''}
      </p>
    </div>
  );
}
