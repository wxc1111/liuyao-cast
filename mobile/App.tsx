import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import {
  Alert,
  AppState,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { HistoryScreen } from './src/HistoryScreen';
import { castLineFromFaces, faceLabel, type CastLine } from './src/core/casting';
import {
  castFingerprint,
  createHistoryEntry,
  HISTORY_STORAGE_KEY,
  validStoredHistory,
  validStoredLines,
  type CastHistoryEntry,
} from './src/core/history';
import {
  CoinPhysics,
  faceFromFlip,
  type MotionInput,
  type PhysicsSnapshot,
} from './src/core/physics';

const STORAGE_KEY = 'liuyao.cast-lines.v1';
const EMPTY_MOTION: MotionInput = {
  ax: 0,
  ay: 0,
  az: 0,
  tiltX: 0,
  tiltY: 0,
  rotationRate: 0,
};

const traySource = require('./assets/generated/casting-tray.png');
const coinFrontSource = require('./assets/generated/coin-front.png');
const coinBackSource = require('./assets/generated/coin-back.png');
const COIN_EDGE_LAYERS = [
  { offset: 1, tintColor: '#4b3016' },
  { offset: 0.8, tintColor: '#67461f' },
  { offset: 0.6, tintColor: '#87602d' },
  { offset: 0.4, tintColor: '#ad8246' },
  { offset: 0.2, tintColor: '#765126' },
] as const;

type SensorState = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const normalizedMotion = (measurement: DeviceMotionMeasurement): MotionInput => {
  const acceleration = measurement.acceleration ?? { x: 0, y: 0, z: 0 };
  const gravity = measurement.accelerationIncludingGravity ?? { x: 0, y: 0, z: 0 };
  const rotation = measurement.rotationRate ?? { alpha: 0, beta: 0, gamma: 0 };
  return {
    ax: acceleration.x,
    ay: acceleration.y,
    az: acceleration.z,
    tiltX: clamp(gravity.x / 9.80665, -1, 1),
    tiltY: clamp(-gravity.y / 9.80665, -1, 1),
    rotationRate: Math.hypot(rotation.alpha, rotation.beta, rotation.gamma),
  };
};

const randomUnitValues = () => {
  const values = new Uint32Array(12);
  Crypto.getRandomValues(values);
  return Array.from(values, (value) => value / 0x1_0000_0000);
};

const hapticImpact = async (strength: number) => {
  try {
    if (Platform.OS === 'android') {
      await Haptics.performAndroidHapticsAsync(
        strength > 0.55
          ? Haptics.AndroidHaptics.Context_Click
          : Haptics.AndroidHaptics.Clock_Tick,
      );
      return;
    }
    await Haptics.impactAsync(
      strength > 0.55
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  } catch {
    // Haptics are optional and can be disabled by the operating system.
  }
};

const hapticConfirmed = async () => {
  try {
    if (Platform.OS === 'android') {
      await Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm);
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // The cast still completes when haptics are unavailable.
  }
};

function CoinSprite({
  coin,
  traySize,
}: {
  coin: PhysicsSnapshot['coins'][number];
  traySize: number;
}) {
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
  const shadowOpacity = clamp(0.3 - coin.z * 0.12, 0.08, 0.3);
  const faceSource = face === 'front' ? coinFrontSource : coinBackSource;

  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.coinShadow,
          {
            width: size * (0.8 + flipScale * 0.08),
            height: size * (0.13 + flipScale * 0.05),
            borderRadius: size * 0.2,
            left: left + size * (0.06 + (1 - flipScale) * 0.03) + coin.z * 2,
            top: top + size * 0.76 + coin.z * 17,
            opacity: shadowOpacity,
            transform: [{ scale: clamp(1 - coin.z * 0.08, 0.72, 1) }],
          },
        ]}
      />
      <View
        pointerEvents="none"
        accessibilityLabel={`铜钱${coin.id + 1}，${faceLabel(face)}面`}
        style={[
          styles.coin,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            left,
            top,
            transform: [
              { scale: elevationScale },
              { rotateZ: `${coin.yaw}rad` },
            ],
          },
        ]}
      >
        {COIN_EDGE_LAYERS.map((layer) => (
          <Image
            key={layer.offset}
            source={coinFrontSource}
            style={[
              styles.coinEdge,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                top: edgeDirection * edgeDepth * layer.offset,
                tintColor: layer.tintColor,
                transform: [{ scaleY: flipScale }],
              },
            ]}
            resizeMode="cover"
          />
        ))}
        <Image
          source={faceSource}
          style={[
            styles.coinFace,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              transform: [{ scaleY: flipScale }],
            },
          ]}
          resizeMode="cover"
        />
      </View>
    </>
  );
}

function LineShape({ line, muted = false }: { line?: CastLine; muted?: boolean }) {
  const isYang = line?.yang ?? false;
  const color = muted ? '#b9b4ac' : line?.moving ? '#8b6a31' : '#292722';
  return (
    <View style={styles.lineShape} accessibilityLabel={line ? `${line.label}${line.moving ? '，动爻' : ''}` : '未记录'}>
      {isYang ? (
        <View style={[styles.lineFull, { backgroundColor: color }]} />
      ) : (
        <>
          <View style={[styles.lineHalf, { backgroundColor: color }]} />
          <View style={[styles.lineHalf, { backgroundColor: color }]} />
        </>
      )}
    </View>
  );
}

function LineProgress({ lines }: { lines: CastLine[] }) {
  const labels = ['初', '二', '三', '四', '五', '上'];
  const current = Math.min(lines.length + 1, 6);
  return (
    <View style={styles.progress} accessibilityLabel={`已经记录${lines.length}爻，共六爻`}>
      {[6, 5, 4, 3, 2, 1].map((number) => {
        const line = lines[number - 1];
        const isCurrent = lines.length < 6 && number === current;
        return (
          <View key={number} style={[styles.progressRow, isCurrent && styles.progressRowCurrent]}>
            <Text style={[styles.progressLabel, isCurrent && styles.progressLabelCurrent]}>
              {labels[number - 1]}
            </Text>
            <LineShape line={line} muted={!line} />
            <Text style={styles.progressMeta}>{line ? `${line.sum}` : ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

function CastFeedback({
  snapshot,
  lines,
  lastCast,
  motion,
  onOpenHistory,
}: {
  snapshot: PhysicsSnapshot;
  lines: CastLine[];
  lastCast: CastLine | null;
  motion: MotionInput;
  onOpenHistory: () => void;
}) {
  const completed = lines.length === 6 && snapshot.phase !== 'holding' && snapshot.phase !== 'tossing';
  const energy = clamp(snapshot.shakeEnergy / 1.4, 0, 1);
  const tilt = clamp(Math.hypot(motion.tiltX, motion.tiltY), 0, 1);
  const energyLabel = energy < 0.3 ? '轻' : energy < 0.68 ? '适中' : '强';

  if (completed) {
    return (
      <View style={[styles.feedbackPanel, styles.feedbackPanelComplete]}>
        <View style={styles.feedbackCopy}>
          <Text style={styles.feedbackEyebrow}>本次起卦</Text>
          <Text style={styles.feedbackTitle}>六爻记录完成</Text>
          <Text style={styles.feedbackHint}>已保存到本机历史，不含解卦</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看本次起卦历史"
          hitSlop={8}
          onPress={onOpenHistory}
          style={({ pressed }) => [styles.feedbackAction, pressed && styles.feedbackActionPressed]}
        >
          <Ionicons name="time-outline" size={17} color="#725528" />
          <Text style={styles.feedbackActionText}>查看历史</Text>
        </Pressable>
      </View>
    );
  }

  if (snapshot.phase === 'holding') {
    return (
      <View style={styles.feedbackPanel}>
        <View style={styles.feedbackHeadingRow}>
          <View>
            <Text style={styles.feedbackEyebrow}>动作反馈</Text>
            <Text style={styles.feedbackTitle}>摇动力度</Text>
          </View>
          <Text style={styles.feedbackValue}>{energyLabel}</Text>
        </View>
        <View style={styles.energyTrack}>
          <View style={[styles.energyFill, { width: `${Math.max(4, energy * 100)}%` }]} />
        </View>
        <Text style={styles.feedbackHint}>倾斜 {Math.round(tilt * 100)}% · 松开后抛出</Text>
      </View>
    );
  }

  if (snapshot.phase === 'tossing') {
    return (
      <View style={styles.feedbackPanel}>
        <View style={styles.tossingRow}>
          <View style={styles.tossingDots}>
            {[0, 1, 2].map((index) => (
              <View key={index} style={[styles.tossingDot, index === 1 && styles.tossingDotBright]} />
            ))}
          </View>
          <View style={styles.feedbackCopy}>
            <Text style={styles.feedbackEyebrow}>物理模拟</Text>
            <Text style={styles.feedbackTitle}>正在碰撞与落稳</Text>
            <Text style={styles.feedbackHint}>三枚铜钱全部停稳后才会记录</Text>
          </View>
        </View>
      </View>
    );
  }

  if (snapshot.phase === 'settled' && lastCast) {
    return (
      <View style={styles.feedbackPanel}>
        <View style={styles.settledRow}>
          <View style={styles.feedbackCopy}>
            <Text style={styles.feedbackEyebrow}>第 {lines.length} 爻 · 已记录</Text>
            <View style={styles.faceRow}>
              {lastCast.faces.map((face, index) => (
                <View key={`${face}-${index}`} style={styles.faceChip}>
                  <Text style={styles.faceChipText}>{faceLabel(face)}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.resultSummary}>
            <Text style={styles.feedbackResult}>{lastCast.sum} · {lastCast.label}</Text>
            <View style={styles.feedbackLine}>
              <LineShape line={lastCast} />
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.feedbackPanel}>
      <View style={styles.gestureSteps}>
        {['按住', '摇动', '松开'].map((label, index) => (
          <View key={label} style={styles.gestureStep}>
            <Text style={styles.gestureNumber}>{index + 1}</Text>
            <Text style={styles.gestureLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.feedbackHint}>动作力度会影响高度、翻转与碰撞</Text>
    </View>
  );
}

function LiuYaoApp() {
  const { width, height } = useWindowDimensions();
  const traySize = Math.min(width - 28, height * (height < 760 ? 0.39 : 0.43), 370);
  const engineRef = useRef(new CoinPhysics());
  const motionRef = useRef<MotionInput>(EMPTY_MOTION);
  const motionSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const lastHapticRef = useRef(0);
  const recordedRoundRef = useRef(false);
  const linesRef = useRef<CastLine[]>([]);
  const [snapshot, setSnapshot] = useState(() => engineRef.current.getSnapshot());
  const [lines, setLines] = useState<CastLine[]>([]);
  const [lastCast, setLastCast] = useState<CastLine | null>(null);
  const [sensorState, setSensorState] = useState<SensorState>('idle');
  const [history, setHistory] = useState<CastHistoryEntry[]>([]);
  const [screen, setScreen] = useState<'cast' | 'history'>('cast');
  const [hydrated, setHydrated] = useState(false);

  linesRef.current = lines;

  useEffect(() => {
    let alive = true;
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(HISTORY_STORAGE_KEY),
    ])
      .then(([storedLines, storedHistory]) => {
        if (!alive) return;

        let restoredLines: CastLine[] = [];
        let restoredHistory: CastHistoryEntry[] = [];

        try {
          const parsedLines: unknown = JSON.parse(storedLines ?? '[]');
          if (validStoredLines(parsedLines)) restoredLines = parsedLines;
        } catch {
          // Ignore malformed local progress and keep the app usable.
        }

        try {
          const parsedHistory: unknown = JSON.parse(storedHistory ?? '[]');
          if (validStoredHistory(parsedHistory)) restoredHistory = parsedHistory;
        } catch {
          // Ignore malformed local history and keep the app usable.
        }

        // Migrate a completed pre-history session and avoid restoring an
        // unplayable six-line in-progress state after an app restart.
        if (restoredLines.length === 6) {
          const fingerprint = castFingerprint(restoredLines);
          if (!restoredHistory.some((entry) => castFingerprint(entry.lines) === fingerprint)) {
            restoredHistory = [createHistoryEntry(restoredLines), ...restoredHistory];
          }
          restoredLines = [];
        }

        setLines(restoredLines);
        setHistory(restoredHistory);
      })
      .catch(() => undefined)
      .finally(() => alive && setHydrated(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lines)).catch(() => undefined);
  }, [hydrated, lines]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)).catch(() => undefined);
  }, [history, hydrated]);

  const stopMotion = useCallback(() => {
    motionSubscriptionRef.current?.remove();
    motionSubscriptionRef.current = null;
    motionRef.current = EMPTY_MOTION;
    setSensorState((current) => (current === 'active' ? 'idle' : current));
  }, []);

  const ensureMotion = useCallback(async () => {
    if (motionSubscriptionRef.current) return true;
    setSensorState('requesting');
    try {
      const available = await DeviceMotion.isAvailableAsync();
      if (!available) {
        setSensorState('unavailable');
        return false;
      }

      // Android exposes motion sensors without a runtime permission prompt.
      // Asking Expo Go for an iOS-style permission can report a false denial.
      if (Platform.OS !== 'android') {
        let permission = await DeviceMotion.getPermissionsAsync();
        if (!permission.granted) permission = await DeviceMotion.requestPermissionsAsync();
        if (!permission.granted) {
          setSensorState('denied');
          return false;
        }
      }

      DeviceMotion.setUpdateInterval(20);
      motionSubscriptionRef.current = DeviceMotion.addListener((measurement) => {
        motionRef.current = normalizedMotion(measurement);
      });
      setSensorState('active');
      return true;
    } catch {
      setSensorState('unavailable');
      return false;
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stopMotion();
    });
    return () => {
      subscription.remove();
      stopMotion();
    };
  }, [stopMotion]);

  const recordSettledCast = useCallback(() => {
    if (recordedRoundRef.current || linesRef.current.length >= 6) return;
    const settled = engineRef.current.getSnapshot();
    const faces = settled.coins.map((coin) => faceFromFlip(coin.flip)) as [
      'front' | 'back',
      'front' | 'back',
      'front' | 'back',
    ];
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
    hapticConfirmed();
  }, []);

  useEffect(() => {
    let frame = 0;
    let previous = Date.now();
    const tick = () => {
      const now = Date.now();
      const events = engineRef.current.step((now - previous) / 1000, motionRef.current);
      previous = now;
      const nextSnapshot = engineRef.current.getSnapshot();
      if (nextSnapshot.phase !== 'idle' || snapshot.phase !== 'idle') {
        setSnapshot(nextSnapshot);
      }
      if (events.impact > 0.16 && now - lastHapticRef.current > 85) {
        lastHapticRef.current = now;
        hapticImpact(events.impact);
      }
      if (events.justSettled) recordSettledCast();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recordSettledCast, snapshot.phase]);

  const startHolding = useCallback(() => {
    if (linesRef.current.length >= 6 || engineRef.current.getSnapshot().phase === 'tossing') return;
    if (engineRef.current.getSnapshot().phase === 'settled') return;
    engineRef.current.beginHolding();
    setSnapshot(engineRef.current.getSnapshot());
    ensureMotion();
    hapticImpact(0.2);
  }, [ensureMotion]);

  const releaseCoins = useCallback(() => {
    if (engineRef.current.getSnapshot().phase !== 'holding') return;
    engineRef.current.release(randomUnitValues(), motionRef.current);
    setSnapshot(engineRef.current.getSnapshot());
  }, []);

  const nextRound = useCallback(() => {
    if (snapshot.phase !== 'settled') return;
    if (lines.length >= 6) {
      setLines([]);
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    }
    engineRef.current.reset();
    recordedRoundRef.current = false;
    setLastCast(null);
    setSnapshot(engineRef.current.getSnapshot());
  }, [lines.length, snapshot.phase]);

  const restart = useCallback(() => {
    Alert.alert('重新开始？', '当前已经记录的爻会被清除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '重新开始',
        style: 'destructive',
        onPress: () => {
          setLines([]);
          linesRef.current = [];
          engineRef.current.reset();
          recordedRoundRef.current = false;
          setLastCast(null);
          setSnapshot(engineRef.current.getSnapshot());
          AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
        },
      },
    ]);
  }, []);

  const openHistory = useCallback(() => {
    if (snapshot.phase === 'holding' || snapshot.phase === 'tossing') return;
    stopMotion();
    setScreen('history');
  }, [snapshot.phase, stopMotion]);

  const deleteHistoryEntry = useCallback((entry: CastHistoryEntry) => {
    Alert.alert('删除这条记录？', '删除后无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => setHistory((current) => current.filter((item) => item.id !== entry.id)),
      },
    ]);
  }, []);

  const clearHistory = useCallback(() => {
    Alert.alert('清空全部历史？', '所有已完成的六爻记录都会被删除，且无法恢复。', [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: () => setHistory([]) },
    ]);
  }, []);

  const statusText = useMemo(() => {
    if (lines.length >= 6 && snapshot.phase === 'settled') return '六爻已经记录完成';
    if (snapshot.phase === 'holding') {
      if (sensorState === 'active') return '正在感应动作';
      if (sensorState === 'denied') return '未获动作权限，将使用触控力度';
      if (sensorState === 'unavailable') return '未检测到传感器，将使用触控力度';
      return '正在准备动作传感器';
    }
    if (snapshot.phase === 'tossing') return '铜钱正在碰撞与落稳';
    if (snapshot.phase === 'settled' && lastCast) {
      return `${lastCast.faces.map(faceLabel).join(' · ')}，${lastCast.sum} ${lastCast.label}`;
    }
    return '按住圆盘，摇动手机';
  }, [lastCast, lines.length, sensorState, snapshot.phase]);

  const buttonLabel = useMemo(() => {
    if (snapshot.phase === 'holding') return '松开抛出';
    if (snapshot.phase === 'tossing') return '铜钱落下中';
    if (snapshot.phase === 'settled') return lines.length >= 6 ? '重新起卦' : '下一轮';
    return '按住开始';
  }, [lines.length, snapshot.phase]);

  const currentRound = Math.min(lines.length + 1, 6);
  const actionDisabled = snapshot.phase === 'tossing' || !hydrated;

  if (screen === 'history') {
    return (
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
        <StatusBar style="dark" />
        <HistoryScreen
          history={history}
          onBack={() => setScreen('cast')}
          onDelete={deleteHistoryEntry}
          onClear={clearHistory}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="清除并关闭当前起卦"
            hitSlop={14}
            onPress={restart}
            style={styles.iconButton}
          >
            <Ionicons name="close" size={32} color="#25231f" />
          </Pressable>
          <Text style={styles.title}>六爻起卦</Text>
          <View style={styles.headerActions}>
            <Text style={styles.counter}>{currentRound} / 6</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`查看起卦历史，共${history.length}条`}
              disabled={snapshot.phase === 'holding' || snapshot.phase === 'tossing'}
              hitSlop={8}
              onPress={openHistory}
              style={styles.historyButton}
            >
              <Ionicons name="time-outline" size={24} color="#34312c" />
              {history.length > 0 && <View style={styles.historyBadge} />}
            </Pressable>
          </View>
        </View>

        <View style={styles.sensorStatus}>
          <View
            style={[
              styles.sensorDot,
              snapshot.phase === 'holding' && sensorState === 'active' && styles.sensorDotActive,
            ]}
          />
          <Text numberOfLines={1} style={styles.sensorText}>{statusText}</Text>
        </View>

        <View style={[styles.trayStage, { width: traySize, height: traySize }]}>
          <Image source={traySource} style={styles.trayImage} resizeMode="contain" />
          <View
            pointerEvents="none"
            style={[
              styles.motionArc,
              {
                width: traySize * 0.93,
                height: traySize * 0.93,
                borderRadius: traySize,
                opacity: snapshot.phase === 'holding' ? 0.5 + snapshot.shakeEnergy * 0.22 : 0.18,
                transform: [
                  { rotateZ: `${motionRef.current.tiltX * 22 + motionRef.current.tiltY * 16}deg` },
                ],
              },
            ]}
          />
          {snapshot.coins.map((coin) => (
            <CoinSprite key={coin.id} coin={coin} traySize={traySize} />
          ))}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
            disabled={actionDisabled}
            onPressIn={startHolding}
            onPressOut={releaseCoins}
            onPress={snapshot.phase === 'settled' ? nextRound : undefined}
            style={({ pressed }) => [
              styles.castButton,
              {
                width: traySize * 0.54,
                height: Math.max(50, traySize * 0.15),
                bottom: traySize * 0.075,
              },
              pressed && styles.castButtonPressed,
              actionDisabled && styles.castButtonDisabled,
            ]}
          >
            <Text style={styles.castButtonText}>{buttonLabel}</Text>
          </Pressable>
        </View>

        <Text style={styles.instruction}>
          {snapshot.phase === 'settled'
            ? `第 ${lines.length} 爻已自动记录`
            : '按住圆盘，摇动手机'}
        </Text>

        <LineProgress lines={lines} />

        <CastFeedback
          snapshot={snapshot}
          lines={lines}
          lastCast={lastCast}
          motion={motionRef.current}
          onOpenHistory={openHistory}
        />

        <Pressable accessibilityRole="button" hitSlop={10} onPress={restart} style={styles.restartButton}>
          <Ionicons name="refresh" size={18} color="#34312c" />
          <Text style={styles.restartText}>重新开始</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <LiuYaoApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#e7e3dc',
  },
  app: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 6,
    backgroundColor: '#e7e3dc',
  },
  header: {
    width: '100%',
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    position: 'absolute',
    right: 0,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    position: 'absolute',
    left: 4,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#25231f',
    fontSize: 27,
    fontWeight: '600',
    letterSpacing: 1.8,
  },
  counter: {
    color: '#2c2a25',
    fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  historyButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyBadge: {
    position: 'absolute',
    right: 5,
    top: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#987238',
  },
  sensorStatus: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sensorDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#77736b',
  },
  sensorDotActive: {
    backgroundColor: '#987238',
  },
  sensorText: {
    maxWidth: '82%',
    color: '#6c6861',
    fontSize: 14,
    letterSpacing: 0.2,
  },
  trayStage: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayImage: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  motionArc: {
    position: 'absolute',
    borderWidth: 3,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: 'rgba(255, 250, 231, 0.72)',
    borderTopColor: 'rgba(255, 250, 231, 0.24)',
  },
  coinShadow: {
    position: 'absolute',
    backgroundColor: '#070604',
  },
  coin: {
    position: 'absolute',
    overflow: 'visible',
  },
  coinEdge: {
    position: 'absolute',
    left: 0,
  },
  coinFace: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  castButton: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#756550',
    backgroundColor: 'rgba(39, 33, 27, 0.94)',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  castButtonPressed: {
    transform: [{ scale: 0.975 }],
    backgroundColor: 'rgba(52, 43, 34, 0.98)',
  },
  castButtonDisabled: {
    opacity: 0.72,
  },
  castButtonText: {
    color: '#f5efe4',
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: 1.6,
  },
  instruction: {
    color: '#36332e',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 1,
    marginTop: 2,
    marginBottom: 4,
  },
  progress: {
    width: '58%',
    maxWidth: 236,
    justifyContent: 'center',
    gap: 2,
  },
  progressRow: {
    minHeight: 26,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  progressRowCurrent: {
    borderColor: '#9a7a42',
    backgroundColor: 'rgba(255, 252, 244, 0.28)',
  },
  progressLabel: {
    width: 28,
    color: '#5d5952',
    fontSize: 15,
  },
  progressLabelCurrent: {
    color: '#8b6a31',
    fontWeight: '600',
  },
  lineShape: {
    flex: 1,
    height: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  lineFull: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  lineHalf: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  progressMeta: {
    width: 20,
    color: '#777169',
    fontSize: 12,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  feedbackPanel: {
    width: '88%',
    maxWidth: 326,
    minHeight: 76,
    marginTop: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(117, 101, 80, 0.28)',
    borderRadius: 15,
    backgroundColor: 'rgba(250, 247, 239, 0.56)',
  },
  feedbackPanelComplete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderColor: 'rgba(139, 106, 49, 0.42)',
    backgroundColor: 'rgba(248, 242, 226, 0.72)',
  },
  feedbackCopy: {
    flexShrink: 1,
  },
  feedbackEyebrow: {
    marginBottom: 2,
    color: '#8b6a31',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  feedbackTitle: {
    color: '#302d28',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.35,
  },
  feedbackHint: {
    marginTop: 5,
    color: '#746e65',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  feedbackHeadingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  feedbackValue: {
    color: '#725528',
    fontSize: 15,
    fontWeight: '700',
  },
  energyTrack: {
    height: 5,
    marginTop: 7,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: 'rgba(85, 76, 64, 0.14)',
  },
  energyFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#9a7336',
  },
  tossingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tossingDots: {
    width: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tossingDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#806339',
    backgroundColor: '#b08a4d',
  },
  tossingDotBright: {
    marginTop: -6,
    backgroundColor: '#d1b06e',
  },
  settledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  faceRow: {
    flexDirection: 'row',
    gap: 5,
  },
  faceChip: {
    minWidth: 29,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 106, 49, 0.32)',
    borderRadius: 9,
    backgroundColor: 'rgba(255, 252, 244, 0.66)',
  },
  faceChipText: {
    color: '#514b42',
    fontSize: 12,
    fontWeight: '500',
  },
  resultSummary: {
    width: 106,
    alignItems: 'flex-end',
  },
  feedbackResult: {
    color: '#725528',
    fontSize: 14,
    fontWeight: '700',
  },
  feedbackLine: {
    width: 90,
    height: 10,
    marginTop: 8,
    flexDirection: 'row',
  },
  gestureSteps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gestureStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  gestureNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    color: '#f4ead6',
    backgroundColor: '#745a31',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
  gestureLabel: {
    color: '#3f3b35',
    fontSize: 13,
    fontWeight: '600',
  },
  feedbackAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(139, 106, 49, 0.42)',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 252, 244, 0.6)',
  },
  feedbackActionPressed: {
    backgroundColor: 'rgba(139, 106, 49, 0.1)',
  },
  feedbackActionText: {
    color: '#725528',
    fontSize: 12,
    fontWeight: '600',
  },
  restartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  restartText: {
    color: '#34312c',
    fontSize: 14,
    letterSpacing: 0.4,
  },
});
