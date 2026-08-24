export type CoinFace = 'front' | 'back';

export type SimulationPhase = 'idle' | 'holding' | 'tossing' | 'settled';

export type MotionInput = {
  ax: number;
  ay: number;
  az: number;
  tiltX: number;
  tiltY: number;
  rotationRate: number;
};

export type CoinState = {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  flip: number;
  yaw: number;
  flipVelocity: number;
  yawVelocity: number;
  settled: boolean;
};

export type PhysicsSnapshot = {
  phase: SimulationPhase;
  coins: CoinState[];
  shakeEnergy: number;
};

export type PhysicsEvents = {
  impact: number;
  justSettled: boolean;
};

const COIN_RADIUS = 0.165;
const INNER_RADIUS = 0.86;
const GRAVITY = 7.4;
const FLOOR_FLIP_STIFFNESS = 28;
const FLOOR_FLIP_DAMPING = 6.4;
const SETTLED_FLAT_TOLERANCE = 0.055;
const STATIC_FRICTION_FORCE = 0.34;
const STATIC_FRICTION_SPEED = 0.075;
const EMPTY_MOTION: MotionInput = {
  ax: 0,
  ay: 0,
  az: 0,
  tiltX: 0,
  tiltY: 0,
  rotationRate: 0,
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const damp = (value: number, amount: number, dt: number) =>
  value * Math.exp(-amount * dt);

const safeRandom = (values: number[], index: number) => {
  const value = values[index % Math.max(values.length, 1)];
  return Number.isFinite(value) ? clamp(value, 0, 0.999999) : 0.5;
};

const createCoins = (): CoinState[] => [
  {
    id: 0,
    x: -0.33,
    y: 0.24,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    flip: 0,
    yaw: -0.16,
    flipVelocity: 0,
    yawVelocity: 0,
    settled: true,
  },
  {
    id: 1,
    x: 0.31,
    y: 0.23,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    flip: Math.PI,
    yaw: 0.12,
    flipVelocity: 0,
    yawVelocity: 0,
    settled: true,
  },
  {
    id: 2,
    x: 0,
    y: -0.27,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    flip: 0,
    yaw: 0.04,
    flipVelocity: 0,
    yawVelocity: 0,
    settled: true,
  },
];

export const faceFromFlip = (flip: number): CoinFace => {
  const turns = Math.round(flip / Math.PI);
  return Math.abs(turns % 2) === 0 ? 'front' : 'back';
};

export const nearestFlatFlip = (flip: number) =>
  Math.round(flip / Math.PI) * Math.PI;

export const distanceFromFlat = (flip: number) =>
  Math.abs(flip - nearestFlatFlip(flip));

export class CoinPhysics {
  private coins: CoinState[] = createCoins();
  private phase: SimulationPhase = 'idle';
  private shakeEnergy = 0;
  private settleTime = 0;
  private lastMotion: MotionInput = EMPTY_MOTION;

  getSnapshot(): PhysicsSnapshot {
    return {
      phase: this.phase,
      coins: this.coins.map((coin) => ({ ...coin })),
      shakeEnergy: this.shakeEnergy,
    };
  }

  reset() {
    this.coins = createCoins();
    this.phase = 'idle';
    this.shakeEnergy = 0;
    this.settleTime = 0;
    this.lastMotion = EMPTY_MOTION;
  }

  beginHolding() {
    if (this.phase === 'tossing') return;
    this.phase = 'holding';
    this.shakeEnergy = 0;
    this.settleTime = 0;
    for (const coin of this.coins) {
      coin.settled = false;
    }
  }

  setHoldingEnergy(energy: number) {
    if (this.phase !== 'holding') return;
    this.shakeEnergy = clamp(energy, 0, 2);
  }

  release(randomValues: number[], motion: MotionInput = this.lastMotion) {
    if (this.phase !== 'holding') return;

    const energy = clamp(0.72 + this.shakeEnergy * 0.72, 0.72, 1.95);
    this.phase = 'tossing';
    this.settleTime = 0;

    this.coins.forEach((coin, index) => {
      const offset = index * 4;
      const direction = safeRandom(randomValues, offset) * Math.PI * 2;
      const lateralSpeed =
        0.48 + energy * 0.38 + safeRandom(randomValues, offset + 1) * 0.34;
      const spinDirection = safeRandom(randomValues, offset + 2) > 0.5 ? 1 : -1;

      coin.vx += Math.cos(direction) * lateralSpeed + motion.ax * 0.025;
      coin.vy += Math.sin(direction) * lateralSpeed - motion.ay * 0.025;
      coin.vz = 2.05 + energy * 1.1 + safeRandom(randomValues, offset + 3) * 0.55;
      coin.flipVelocity =
        spinDirection * (11 + energy * 9 + safeRandom(randomValues, offset + 1) * 8);
      coin.yawVelocity = (safeRandom(randomValues, offset) - 0.5) * (8 + energy * 5);
      coin.settled = false;
    });
  }

  step(dt: number, motion: MotionInput = EMPTY_MOTION): PhysicsEvents {
    const safeDt = clamp(dt, 0.001, 0.033);
    let impact = 0;
    let justSettled = false;
    this.lastMotion = motion;

    const accelerationMagnitude = Math.hypot(motion.ax, motion.ay, motion.az);
    const motionEnergy =
      accelerationMagnitude / 9.80665 + clamp(motion.rotationRate / 360, 0, 1.5);

    if (this.phase === 'holding') {
      this.shakeEnergy = clamp(
        this.shakeEnergy * Math.exp(-1.7 * safeDt) + motionEnergy * 1.45 * safeDt,
        0,
        2,
      );
    }

    if (this.phase === 'idle' || this.phase === 'settled') {
      return { impact: 0, justSettled: false };
    }

    const trayForceX = motion.ax * 0.055 + motion.tiltX * 1.4;
    const trayForceY = -motion.ay * 0.055 + motion.tiltY * 1.4;
    const trayForceMagnitude = Math.hypot(trayForceX, trayForceY);

    for (const coin of this.coins) {
      coin.vx += trayForceX * safeDt;
      coin.vy += trayForceY * safeDt;

      if (this.phase === 'holding' && coin.z === 0 && motionEnergy > 0.32) {
        coin.vz += clamp(motionEnergy * 0.16, 0, 0.5);
        coin.flipVelocity += motion.rotationRate * 0.006 * (coin.id % 2 === 0 ? 1 : -1);
      }

      if (coin.z > 0 || coin.vz > 0) {
        coin.vz -= GRAVITY * safeDt;
      }

      coin.x += coin.vx * safeDt;
      coin.y += coin.vy * safeDt;
      coin.z += coin.vz * safeDt;
      coin.flip += coin.flipVelocity * safeDt;
      coin.yaw += coin.yawVelocity * safeDt;

      coin.vx = damp(coin.vx, coin.z > 0 ? 0.28 : 2.65, safeDt);
      coin.vy = damp(coin.vy, coin.z > 0 ? 0.28 : 2.65, safeDt);
      coin.flipVelocity = damp(
        coin.flipVelocity,
        coin.z > 0 ? 0.08 : FLOOR_FLIP_DAMPING,
        safeDt,
      );
      coin.yawVelocity = damp(coin.yawVelocity, coin.z > 0 ? 0.12 : 2.8, safeDt);

      if (coin.z <= 0) {
        const floorImpact = Math.abs(coin.vz);
        coin.z = 0;
        if (floorImpact > 0.36) {
          coin.vz = floorImpact * 0.34;
          coin.vx *= 0.82;
          coin.vy *= 0.82;
          coin.flipVelocity *= 0.71;
          coin.yawVelocity *= 0.76;
          impact = Math.max(impact, floorImpact / 4.5);
        } else {
          coin.vz = 0;
          const flatTarget = nearestFlatFlip(coin.flip);
          coin.flipVelocity +=
            (flatTarget - coin.flip) * FLOOR_FLIP_STIFFNESS * safeDt;

          // A real coin at rest does not keep creeping under tiny sensor noise
          // or a shallow tray tilt. Model static friction once planar motion is
          // slow; a stronger tilt still overcomes it and makes the coin slide.
          if (
            Math.hypot(coin.vx, coin.vy) < STATIC_FRICTION_SPEED &&
            trayForceMagnitude < STATIC_FRICTION_FORCE
          ) {
            coin.vx = 0;
            coin.vy = 0;
          }
        }
      }

      const distance = Math.hypot(coin.x, coin.y);
      const maximumDistance = INNER_RADIUS - COIN_RADIUS;
      if (distance > maximumDistance) {
        const nx = coin.x / Math.max(distance, 0.0001);
        const ny = coin.y / Math.max(distance, 0.0001);
        coin.x = nx * maximumDistance;
        coin.y = ny * maximumDistance;
        const normalSpeed = coin.vx * nx + coin.vy * ny;
        if (normalSpeed > 0) {
          const tangentSpeed = -coin.vx * ny + coin.vy * nx;
          coin.vx -= (1.58 * normalSpeed) * nx;
          coin.vy -= (1.58 * normalSpeed) * ny;
          coin.flipVelocity += tangentSpeed * 2.8;
          coin.yawVelocity -= normalSpeed * 1.7;
          impact = Math.max(impact, Math.abs(normalSpeed) / 2.2);
        }
      }
    }

    for (let first = 0; first < this.coins.length; first += 1) {
      for (let second = first + 1; second < this.coins.length; second += 1) {
        const a = this.coins[first];
        const b = this.coins[second];
        if (Math.abs(a.z - b.z) > 0.14) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const minimumDistance = COIN_RADIUS * 2;
        if (distance <= 0 || distance >= minimumDistance) continue;

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minimumDistance - distance;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;

        const relativeSpeed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relativeSpeed < 0) {
          const impulse = -(1 + 0.62) * relativeSpeed * 0.5;
          const bothOnFloor = a.z === 0 && b.z === 0;
          const flipTransfer = bothOnFloor
            ? clamp(Math.abs(relativeSpeed) / 0.24, 0, 1)
            : 1;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
          // Low-speed face-to-face contact mostly pushes coins sideways. It
          // should not repeatedly lift an already grounded coin onto its edge.
          a.flipVelocity -= impulse * 2.4 * flipTransfer;
          b.flipVelocity += impulse * 2.4 * flipTransfer;
          impact = Math.max(impact, Math.abs(relativeSpeed) / 2.1);
        }
      }
    }

    const allNearlyStill = this.coins.every((coin) => {
      const nearlyStill =
        coin.z === 0 &&
        Math.hypot(coin.vx, coin.vy) < 0.045 &&
        Math.abs(coin.vz) < 0.02 &&
        Math.abs(coin.flipVelocity) < 0.42 &&
        Math.abs(coin.yawVelocity) < 0.32 &&
        distanceFromFlat(coin.flip) < SETTLED_FLAT_TOLERANCE;
      coin.settled = nearlyStill;
      return nearlyStill;
    });

    if (this.phase === 'tossing' && allNearlyStill) {
      this.settleTime += safeDt;
      if (this.settleTime >= 0.48) {
        for (const coin of this.coins) {
          coin.vx = 0;
          coin.vy = 0;
          coin.vz = 0;
          coin.flipVelocity = 0;
          coin.yawVelocity = 0;
          coin.flip = nearestFlatFlip(coin.flip);
          coin.settled = true;
        }
        this.phase = 'settled';
        justSettled = true;
      }
    } else {
      this.settleTime = 0;
    }

    return { impact: clamp(impact, 0, 1), justSettled };
  }
}
