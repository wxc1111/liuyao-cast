import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiChevronDown,
  FiChevronLeft,
  FiChevronUp,
  FiClock,
  FiRefreshCw,
  FiTrash2,
  FiX,
} from 'react-icons/fi';

import { castLineFromFaces, faceLabel } from '../mobile/src/core/casting.ts';
import {
  castFingerprint,
  createHistoryEntry,
  formatHistoryTime,
  HISTORY_STORAGE_KEY,
  validStoredHistory,
} from '../mobile/src/core/history.ts';
import { CoinPhysics, faceFromFlip } from '../mobile/src/core/physics.ts';

const STORAGE_KEY = 'liuyao.web-lines.v1';
const EMPTY_MOTION = { ax: 0, ay: 0, az: 0, tiltX: 0, tiltY: 0, rotationRate: 0 };
const EMPTY_POINTER = {
  active: false,
  pointerId: null,
  originX: 0,
  originY: 0,
  localOriginX: 0,
  localOriginY: 0,
  localScaleX: 1,
  localScaleY: 1,
  lastX: 0,
  lastY: 0,
  lastTime: 0,
  velocityX: 0,
  velocityY: 0,
  distanceForce: 0,
  force: 0,
};
const EMPTY_GESTURE = { active: false, originX: 0, originY: 0, dx: 0, dy: 0, force: 0 };
const COIN_EDGE_LAYERS = [
  { offset: 1, filter: 'brightness(.43) sepia(.55) saturate(1.4)' },
  { offset: 0.8, filter: 'brightness(.57) sepia(.5) saturate(1.35)' },
  { offset: 0.6, filter: 'brightness(.72) sepia(.42) saturate(1.2)' },
  { offset: 0.4, filter: 'brightness(.93) sepia(.28) saturate(1.1)' },
  { offset: 0.2, filter: 'brightness(.64) sepia(.45) saturate(1.3)' },
];

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const hasFinePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const randomUnitValues = () => {
  const values = new Uint32Array(12);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => value / 0x1_0000_0000);
};

const loadLines = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) && parsed.length <= 6 ? parsed : [];
  } catch {
    return [];
  }
};

const loadHistory = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]');
    return validStoredHistory(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const vibrate = (pattern) => {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
};

function CoinSprite({ coin, traySize }) {
  const innerDiameter = traySize * 0.76;
  const size = traySize * 0.19;
  const face = faceFromFlip(coin.flip);
  const flipCosine = Math.cos(coin.flip);
  const flipSine = Math.sin(coin.flip);
  const flipScale = Math.max(0.055, Math.abs(flipCosine));
  const edgeDirection = Math.abs(flipSine) < 0.02 || flipSine > 0 ? 1 : -1;
  const edgeDepth = size * (0.026 + Math.abs(flipSine) * 0.078);
  const elevationScale = 1 + coin.z * 0.055;
  const left = traySize / 2 + coin.x * (innerDiameter / 2) - size / 2;
  const top = traySize / 2 + coin.y * (innerDiameter / 2) - size / 2 - coin.z * 17;
  const faceSource = face === 'front' ? '/assets/coin-front.png' : '/assets/coin-back.png';

  return (
    <>
      <span
        aria-hidden="true"
        className="coin-shadow"
        style={{
          width: size * (0.8 + flipScale * 0.08),
          height: size * (0.13 + flipScale * 0.05),
          left: left + size * (0.06 + (1 - flipScale) * 0.03) + coin.z * 2,
          top: top + size * 0.76 + coin.z * 17,
          opacity: Math.max(0.08, 0.3 - coin.z * 0.12),
          transform: `scale(${Math.max(0.72, 1 - coin.z * 0.08)})`,
        }}
      />
      <span
        className="coin-body"
        role="img"
        aria-label={`铜钱${coin.id + 1}，${faceLabel(face)}面`}
        style={{
          width: size,
          height: size,
          left,
          top,
          transform: `scale(${elevationScale}) rotate(${coin.yaw}rad)`,
        }}
      >
        {COIN_EDGE_LAYERS.map((layer) => (
          <img
            key={layer.offset}
            aria-hidden="true"
            className="coin-layer coin-edge"
            src="/assets/coin-front.png"
            alt=""
            style={{
              top: edgeDirection * edgeDepth * layer.offset,
              filter: layer.filter,
              transform: `scaleY(${flipScale})`,
            }}
          />
        ))}
        <img
          aria-hidden="true"
          className="coin-layer coin-face"
          src={faceSource}
          alt=""
          style={{ transform: `scaleY(${flipScale})` }}
        />
      </span>
    </>
  );
}

function LineShape({ line, muted }) {
  const isYang = line?.yang ?? false;
  const color = muted ? '#b9b4ac' : line?.moving ? '#8b6a31' : '#292722';
  return (
    <span className="line-shape" aria-label={line ? `${line.label}${line.moving ? '，动爻' : ''}` : '未记录'}>
      {isYang ? (
        <span className="line-full" style={{ backgroundColor: color }} />
      ) : (
        <>
          <span className="line-half" style={{ backgroundColor: color }} />
          <span className="line-half" style={{ backgroundColor: color }} />
        </>
      )}
    </span>
  );
}

function LineProgress({ lines }) {
  const labels = ['初', '二', '三', '四', '五', '上'];
  const current = Math.min(lines.length + 1, 6);
  return (
    <section className="progress" aria-label={`已经记录${lines.length}爻，共六爻`}>
      {[6, 5, 4, 3, 2, 1].map((number) => {
        const line = lines[number - 1];
        const active = lines.length < 6 && current === number;
        return (
          <div className={`progress-row${active ? ' is-current' : ''}`} key={number}>
            <span className="progress-label">{labels[number - 1]}</span>
            <LineShape line={line} muted={!line} />
            <span className="progress-meta">{line?.sum ?? ''}</span>
          </div>
        );
      })}
    </section>
  );
}

function CastFeedback({ snapshot, lines, lastCast, motion, controlMode, onOpenHistory }) {
  const completed = lines.length === 6 && snapshot.phase !== 'holding' && snapshot.phase !== 'tossing';
  const energy = Math.max(0, Math.min(1, snapshot.shakeEnergy / 1.4));
  const tilt = Math.max(0, Math.min(1, Math.hypot(motion.tiltX, motion.tiltY)));
  const energyLabel = energy < 0.3 ? '轻' : energy < 0.68 ? '适中' : '强';

  if (completed) {
    return (
      <section className="feedback-panel is-complete" aria-live="polite">
        <span className="feedback-copy">
          <small>本次起卦</small>
          <strong>六爻记录完成</strong>
          <span>已保存到本机历史，不含解卦</span>
        </span>
        <button className="feedback-action" type="button" onClick={onOpenHistory}>
          <FiClock aria-hidden="true" />
          查看历史
        </button>
      </section>
    );
  }

  if (snapshot.phase === 'holding') {
    return (
      <section className="feedback-panel" aria-live="polite">
        <span className="feedback-heading-row">
          <span className="feedback-copy">
            <small>动作反馈</small>
            <strong>摇动力度</strong>
          </span>
          <b className="feedback-value">{energyLabel}</b>
        </span>
        <span className="energy-track" aria-hidden="true">
          <span className="energy-fill" style={{ width: `${Math.max(4, energy * 100)}%` }} />
        </span>
        <span className="feedback-hint">
          {controlMode === 'pointer'
            ? `拖动倾斜 ${Math.round(tilt * 100)}% · 松开抛出`
            : `倾斜 ${Math.round(tilt * 100)}% · 松开后抛出`}
        </span>
      </section>
    );
  }

  if (snapshot.phase === 'tossing') {
    return (
      <section className="feedback-panel" aria-live="polite">
        <span className="tossing-row">
          <span className="tossing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="feedback-copy">
            <small>物理模拟</small>
            <strong>正在碰撞与落稳</strong>
            <span>三枚铜钱全部停稳后才会记录</span>
          </span>
        </span>
      </section>
    );
  }

  if (snapshot.phase === 'settled' && lastCast) {
    return (
      <section className="feedback-panel" aria-live="polite">
        <span className="settled-row">
          <span className="feedback-copy">
            <small>第 {lines.length} 爻 · 已记录</small>
            <span className="face-row">
              {lastCast.faces.map((face, index) => (
                <span className="face-chip" key={`${face}-${index}`}>{faceLabel(face)}</span>
              ))}
            </span>
          </span>
          <span className="result-summary">
            <b>{lastCast.sum} · {lastCast.label}</b>
            <span className="feedback-line"><LineShape line={lastCast} /></span>
          </span>
        </span>
      </section>
    );
  }

  return (
    <section className="feedback-panel" aria-label="抛掷动作说明">
      <span className="gesture-steps">
        {(controlMode === 'pointer' ? ['按住', '拖动', '松开'] : ['按住', '摇动', '松开']).map((label, index) => (
          <span className="gesture-step" key={label}>
            <b>{index + 1}</b>
            <span>{label}</span>
          </span>
        ))}
      </span>
      <span className="feedback-hint">
        {controlMode === 'pointer'
          ? '拖动距离控制力度，方向控制托盘倾斜'
          : '动作力度会影响高度、翻转与碰撞'}
      </span>
    </section>
  );
}

function HistoryView({ history, onBack, onDelete, onClear }) {
  const [expandedId, setExpandedId] = useState(null);
  const labels = ['初', '二', '三', '四', '五', '上'];

  return (
    <main className="mobile-prototype is-history">
      <header className="header history-header">
        <button className="icon-button" type="button" aria-label="返回起卦" onClick={onBack}>
          <FiChevronLeft aria-hidden="true" />
        </button>
        <h1>起卦历史</h1>
        {history.length > 0 && (
          <button className="clear-history-button" type="button" onClick={onClear}>清空</button>
        )}
      </header>

      {history.length === 0 ? (
        <section className="history-empty">
          <span className="history-empty-icon"><FiClock aria-hidden="true" /></span>
          <h2>还没有历史记录</h2>
          <p>完成六轮抛掷后，会自动保存在这里</p>
        </section>
      ) : (
        <section className="history-list">
          <p className="history-count">共 {history.length} 次完整起卦</p>
          {history.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <article className="history-card" key={entry.id}>
                <button
                  className="history-card-summary"
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                >
                  <span className="mini-hexagram" aria-hidden="true">
                    {[6, 5, 4, 3, 2, 1].map((number) => (
                      <LineShape key={number} line={entry.lines[number - 1]} />
                    ))}
                  </span>
                  <span className="history-card-copy">
                    <strong>{formatHistoryTime(entry.createdAt)}</strong>
                    <small>六爻完整记录</small>
                    <span>{entry.lines.map((line) => line.sum).join(' · ')}</span>
                  </span>
                  {expanded ? <FiChevronUp aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
                </button>

                {expanded && (
                  <div className="history-details">
                    <p>自下而上记录，画面自上而下排列</p>
                    {[6, 5, 4, 3, 2, 1].map((number) => {
                      const line = entry.lines[number - 1];
                      return (
                        <div className="history-detail-row" key={number}>
                          <span>{labels[number - 1]}</span>
                          <LineShape line={line} />
                          <small>{line.faces.map(faceLabel).join(' · ')}</small>
                          <b>{line.sum}</b>
                        </div>
                      );
                    })}
                    <button className="delete-history-button" type="button" onClick={() => onDelete(entry)}>
                      <FiTrash2 aria-hidden="true" />
                      删除记录
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}

export function App() {
  const engineRef = useRef(new CoinPhysics());
  const motionRef = useRef(EMPTY_MOTION);
  const pointerRef = useRef(EMPTY_POINTER);
  const controlModeRef = useRef(hasFinePointer() ? 'pointer' : 'device');
  const recordedRoundRef = useRef(false);
  const linesRef = useRef([]);
  const lastImpactRef = useRef(0);
  const [snapshot, setSnapshot] = useState(() => engineRef.current.getSnapshot());
  const [lines, setLines] = useState(loadLines);
  const [lastCast, setLastCast] = useState(null);
  const [sensorState, setSensorState] = useState('idle');
  const [controlMode, setControlMode] = useState(controlModeRef.current);
  const [gesture, setGesture] = useState(EMPTY_GESTURE);
  const [history, setHistory] = useState(loadHistory);
  const [screen, setScreen] = useState('cast');
  const traySize = 354;

  linesRef.current = lines;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const ensureMotion = useCallback(async () => {
    if (sensorState === 'active') return;
    setSensorState('requesting');
    try {
      if (typeof window.DeviceMotionEvent === 'undefined') {
        setSensorState('unavailable');
        return;
      }
      if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
        const result = await window.DeviceMotionEvent.requestPermission();
        if (result !== 'granted') {
          setSensorState('denied');
          return;
        }
      }
      const listener = (event) => {
        if (controlModeRef.current !== 'device') return;
        const acceleration = event.acceleration ?? {};
        const gravity = event.accelerationIncludingGravity ?? {};
        const rotation = event.rotationRate ?? {};
        motionRef.current = {
          ax: acceleration.x ?? 0,
          ay: acceleration.y ?? 0,
          az: acceleration.z ?? 0,
          tiltX: Math.max(-1, Math.min(1, (gravity.x ?? 0) / 9.80665)),
          tiltY: Math.max(-1, Math.min(1, -(gravity.y ?? 0) / 9.80665)),
          rotationRate: Math.hypot(rotation.alpha ?? 0, rotation.beta ?? 0, rotation.gamma ?? 0),
        };
      };
      window.addEventListener('devicemotion', listener, { passive: true });
      setSensorState('active');
    } catch {
      setSensorState('unavailable');
    }
  }, [sensorState]);

  const recordSettledCast = useCallback(() => {
    if (recordedRoundRef.current || linesRef.current.length >= 6) return;
    const faces = engineRef.current.getSnapshot().coins.map((coin) => faceFromFlip(coin.flip));
    const next = castLineFromFaces(faces, linesRef.current.length + 1);
    const completedLines = [...linesRef.current, next];
    recordedRoundRef.current = true;
    linesRef.current = completedLines;
    setLastCast(next);
    setLines(completedLines);
    if (completedLines.length === 6) {
      const entry = createHistoryEntry(completedLines);
      const fingerprint = castFingerprint(completedLines);
      setHistory((current) => [
        entry,
        ...current.filter((item) => castFingerprint(item.lines) !== fingerprint),
      ]);
    }
    vibrate([18, 20, 28]);
  }, []);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const tick = (now) => {
      const events = engineRef.current.step((now - previous) / 1000, motionRef.current);
      if (engineRef.current.getSnapshot().phase === 'holding' && controlModeRef.current === 'pointer') {
        engineRef.current.setHoldingEnergy(pointerRef.current.force * 1.4);
      }
      previous = now;
      const next = engineRef.current.getSnapshot();
      if (next.phase !== 'idle' || engineRef.current.getSnapshot().phase !== 'idle') setSnapshot(next);
      if (events.impact > 0.17 && now - lastImpactRef.current > 85) {
        lastImpactRef.current = now;
        vibrate(events.impact > 0.55 ? 20 : 8);
      }
      if (events.justSettled) recordSettledCast();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recordSettledCast]);

  const startHolding = (event) => {
    if (snapshot.phase !== 'idle' || lines.length >= 6) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const localScaleX = event.currentTarget.clientWidth / Math.max(rect.width, 1);
    const localScaleY = event.currentTarget.clientHeight / Math.max(rect.height, 1);
    const nextControlMode = event.pointerType === 'mouse' || event.pointerType === 'pen'
      ? 'pointer'
      : 'device';
    controlModeRef.current = nextControlMode;
    setControlMode(nextControlMode);
    pointerRef.current = {
      ...EMPTY_POINTER,
      active: true,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      localOriginX: (event.clientX - rect.left) * localScaleX,
      localOriginY: (event.clientY - rect.top) * localScaleY,
      localScaleX,
      localScaleY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
    };
    setGesture({
      active: nextControlMode === 'pointer',
      originX: (event.clientX - rect.left) * localScaleX,
      originY: (event.clientY - rect.top) * localScaleY,
      dx: 0,
      dy: 0,
      force: 0,
    });
    engineRef.current.beginHolding();
    setSnapshot(engineRef.current.getSnapshot());
    if (nextControlMode === 'device') ensureMotion();
    vibrate(8);
  };

  const moveHolding = (event) => {
    const pointer = pointerRef.current;
    if (
      engineRef.current.getSnapshot().phase !== 'holding' ||
      !pointer.active ||
      pointer.pointerId !== event.pointerId ||
      (controlModeRef.current === 'device' && !['denied', 'unavailable'].includes(sensorState))
    ) return;
    event.preventDefault();
    const now = performance.now();
    const dt = Math.max(8, now - pointer.lastTime);
    const frameX = event.clientX - pointer.lastX;
    const frameY = event.clientY - pointer.lastY;
    const dx = event.clientX - pointer.originX;
    const dy = event.clientY - pointer.originY;
    const instantVelocityX = frameX / dt;
    const instantVelocityY = frameY / dt;
    const velocityX = pointer.velocityX * 0.42 + instantVelocityX * 0.58;
    const velocityY = pointer.velocityY * 0.42 + instantVelocityY * 0.58;
    const distanceForce = clamp(Math.hypot(dx, dy) / 118, 0, 1);
    const speedForce = clamp(Math.hypot(velocityX, velocityY) / 1.15, 0, 1);
    const force = clamp(distanceForce * 0.78 + speedForce * 0.22, 0, 1);

    if (controlModeRef.current === 'device') {
      controlModeRef.current = 'pointer';
      setControlMode('pointer');
    }

    motionRef.current = {
      ax: clamp(dx / 20 + velocityX * 2.2, -9, 9),
      ay: clamp(dy / 20 + velocityY * 2.2, -9, 9),
      az: force * 4.5,
      tiltX: clamp(dx / 112, -1, 1),
      tiltY: clamp(-dy / 112, -1, 1),
      rotationRate: force * 180,
    };
    pointerRef.current = {
      ...pointer,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: now,
      velocityX,
      velocityY,
      distanceForce,
      force,
    };
    engineRef.current.setHoldingEnergy(force * 1.4);
    setGesture({
      active: true,
      originX: pointer.localOriginX,
      originY: pointer.localOriginY,
      dx: dx * pointer.localScaleX,
      dy: dy * pointer.localScaleY,
      force,
    });
  };

  const releaseCoins = (event) => {
    if (engineRef.current.getSnapshot().phase !== 'holding') return;
    const pointer = pointerRef.current;
    if (event?.pointerId != null && pointer.pointerId !== event.pointerId) return;

    let releaseMotion = motionRef.current;
    if (controlModeRef.current === 'pointer') {
      const movementAge = Math.max(0, performance.now() - pointer.lastTime);
      const velocityWeight = clamp(1 - movementAge / 150, 0, 1);
      const speedForce = clamp(
        Math.hypot(pointer.velocityX, pointer.velocityY) * velocityWeight / 1.15,
        0,
        1,
      );
      const force = clamp(pointer.distanceForce * 0.78 + speedForce * 0.22, 0, 1);
      const totalX = pointer.lastX - pointer.originX;
      const totalY = pointer.lastY - pointer.originY;
      releaseMotion = {
        ax: clamp(totalX / 20 + pointer.velocityX * velocityWeight * 2.2, -9, 9),
        ay: clamp(totalY / 20 + pointer.velocityY * velocityWeight * 2.2, -9, 9),
        az: force * 4.5,
        tiltX: clamp(totalX / 112, -1, 1),
        tiltY: clamp(-totalY / 112, -1, 1),
        rotationRate: force * 180,
      };
      engineRef.current.setHoldingEnergy(force * 1.4);
    }

    engineRef.current.release(randomUnitValues(), releaseMotion);
    if (controlModeRef.current === 'pointer') motionRef.current = EMPTY_MOTION;
    pointerRef.current = EMPTY_POINTER;
    setGesture(EMPTY_GESTURE);
    setSnapshot(engineRef.current.getSnapshot());
  };

  const nextRound = () => {
    if (snapshot.phase !== 'settled' && lines.length < 6) return;
    if (lines.length >= 6) setLines([]);
    engineRef.current.reset();
    recordedRoundRef.current = false;
    motionRef.current = EMPTY_MOTION;
    pointerRef.current = EMPTY_POINTER;
    setGesture(EMPTY_GESTURE);
    setLastCast(null);
    setSnapshot(engineRef.current.getSnapshot());
  };

  const restart = () => {
    if (lines.length > 0 && !window.confirm('清除当前已经记录的爻，重新开始？')) return;
    setLines([]);
    engineRef.current.reset();
    recordedRoundRef.current = false;
    motionRef.current = EMPTY_MOTION;
    pointerRef.current = EMPTY_POINTER;
    setGesture(EMPTY_GESTURE);
    setLastCast(null);
    setSnapshot(engineRef.current.getSnapshot());
  };

  const statusText = useMemo(() => {
    if (lines.length >= 6 && snapshot.phase === 'settled') return '六爻已经记录完成';
    if (snapshot.phase === 'holding') {
      if (controlMode === 'pointer') return '拖动距离控制力度，松开抛出';
      if (sensorState === 'active') return '正在感应动作';
      if (sensorState === 'requesting') return '正在准备动作传感器';
      return '拖动模拟摇动，松开完成抛掷';
    }
    if (snapshot.phase === 'tossing') return '铜钱正在碰撞与落稳';
    if (snapshot.phase === 'settled' && lastCast) {
      return `${lastCast.faces.map(faceLabel).join(' · ')}，${lastCast.sum} ${lastCast.label}`;
    }
    return controlMode === 'pointer' ? '按住托盘，拖动鼠标控制力度' : '按住圆盘，摇动手机';
  }, [controlMode, lastCast, lines.length, sensorState, snapshot.phase]);

  const buttonLabel =
    lines.length >= 6 && snapshot.phase !== 'holding' && snapshot.phase !== 'tossing'
      ? '重新起卦'
      : snapshot.phase === 'holding'
      ? '松开抛出'
      : snapshot.phase === 'tossing'
        ? '铜钱落下中'
        : snapshot.phase === 'settled'
          ? lines.length >= 6
            ? '重新起卦'
            : '下一轮'
          : '按住开始';

  const currentRound = Math.min(lines.length + 1, 6);

  const deleteHistoryEntry = (entry) => {
    if (!window.confirm('删除这条历史记录？删除后无法恢复。')) return;
    setHistory((current) => current.filter((item) => item.id !== entry.id));
  };

  const clearHistory = () => {
    if (!window.confirm('清空全部历史记录？此操作无法恢复。')) return;
    setHistory([]);
  };

  if (screen === 'history') {
    return (
      <HistoryView
        history={history}
        onBack={() => setScreen('cast')}
        onDelete={deleteHistoryEntry}
        onClear={clearHistory}
      />
    );
  }

  return (
    <main className="mobile-prototype">
      <header className="header">
        <button className="icon-button" type="button" aria-label="清除当前记录" onClick={restart}>
          <FiX aria-hidden="true" />
        </button>
        <h1>六爻起卦</h1>
        <span className="header-actions">
          <span className="counter">{currentRound} / 6</span>
          <button
            className="history-button"
            type="button"
            aria-label={`查看起卦历史，共${history.length}条`}
            disabled={snapshot.phase === 'holding' || snapshot.phase === 'tossing'}
            onClick={() => setScreen('history')}
          >
            <FiClock aria-hidden="true" />
            {history.length > 0 && <span className="history-badge" />}
          </button>
        </span>
      </header>

      <div className="sensor-status" aria-live="polite">
        <span className={`sensor-dot${snapshot.phase === 'holding' && (controlMode === 'pointer' || sensorState === 'active') ? ' is-active' : ''}`} />
        <span>{statusText}</span>
      </div>

      <section
        className={`tray-stage${gesture.active ? ' is-dragging' : ''}`}
        style={{ width: traySize, height: traySize }}
        aria-label={controlMode === 'pointer' ? '三枚铜钱托盘，按住拖动控制力度' : '三枚铜钱托盘'}
        onPointerDown={startHolding}
        onPointerMove={moveHolding}
        onPointerUp={releaseCoins}
        onPointerCancel={releaseCoins}
      >
        <img className="tray-image" src="/assets/casting-tray.png" alt="深色木质铜钱圆盘" />
        <span
          aria-hidden="true"
          className="motion-arc"
          style={{
            opacity: snapshot.phase === 'holding' ? 0.5 + snapshot.shakeEnergy * 0.22 : 0.18,
            transform: `rotate(${motionRef.current.tiltX * 22 + motionRef.current.tiltY * 16}deg)`,
          }}
        />
        {snapshot.coins.map((coin) => (
          <CoinSprite key={coin.id} coin={coin} traySize={traySize} />
        ))}
        {gesture.active && (
          <span className="drag-guide" aria-hidden="true">
            <span
              className="drag-line"
              style={{
                left: gesture.originX,
                top: gesture.originY,
                width: Math.hypot(gesture.dx, gesture.dy),
                opacity: 0.35 + gesture.force * 0.55,
                transform: `rotate(${Math.atan2(gesture.dy, gesture.dx)}rad)`,
              }}
            />
            <span
              className="drag-origin"
              style={{ left: gesture.originX, top: gesture.originY }}
            />
            <span
              className="drag-handle"
              style={{
                left: gesture.originX + gesture.dx,
                top: gesture.originY + gesture.dy,
                transform: `scale(${0.82 + gesture.force * 0.28})`,
              }}
            />
          </span>
        )}
        <button
          className="cast-button"
          type="button"
          disabled={snapshot.phase === 'tossing'}
          onClick={snapshot.phase === 'settled' || lines.length >= 6 ? nextRound : undefined}
        >
          {buttonLabel}
        </button>
      </section>

      <p className="instruction">
        {snapshot.phase === 'settled'
          ? `第 ${lines.length} 爻已自动记录`
          : controlMode === 'pointer'
            ? '按住托盘，拖动蓄力后松开'
            : '按住圆盘，摇动手机'}
      </p>

      <LineProgress lines={lines} />

      <CastFeedback
        snapshot={snapshot}
        lines={lines}
        lastCast={lastCast}
        motion={motionRef.current}
        controlMode={controlMode}
        onOpenHistory={() => setScreen('history')}
      />

      <button className="restart-button" type="button" onClick={restart}>
        <FiRefreshCw aria-hidden="true" />
        重新开始
      </button>
    </main>
  );
}
