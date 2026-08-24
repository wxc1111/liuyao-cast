import assert from 'node:assert/strict';
import test from 'node:test';

import { castLineFromFaces } from '../mobile/src/core/casting.ts';
import {
  castFingerprint,
  createHistoryEntry,
  validStoredHistory,
  validStoredLines,
} from '../mobile/src/core/history.ts';
import {
  CoinPhysics,
  distanceFromFlat,
  faceFromFlip,
} from '../mobile/src/core/physics.ts';

test('three coin sums map to the four six-line states', () => {
  assert.equal(castLineFromFaces(['back', 'back', 'back'], 1).sum, 6);
  assert.equal(castLineFromFaces(['front', 'back', 'back'], 1).sum, 7);
  assert.equal(castLineFromFaces(['front', 'front', 'back'], 1).sum, 8);
  assert.equal(castLineFromFaces(['front', 'front', 'front'], 1).sum, 9);
});

test('face is derived from the physically settled flip angle', () => {
  assert.equal(faceFromFlip(0), 'front');
  assert.equal(faceFromFlip(Math.PI), 'back');
  assert.equal(faceFromFlip(Math.PI * 2), 'front');
});

test('only a complete six-line cast becomes a valid history entry', () => {
  const faceSets = [
    ['front', 'back', 'back'],
    ['front', 'front', 'back'],
    ['front', 'back', 'back'],
    ['back', 'back', 'back'],
    ['front', 'front', 'back'],
    ['front', 'front', 'front'],
  ] as const;
  const lines = faceSets.map((faces, index) =>
    castLineFromFaces([...faces], index + 1, `history-line-${index + 1}`),
  );
  const entry = createHistoryEntry(lines, 1_750_000_000_000);

  assert.equal(validStoredLines(lines, true), true);
  assert.equal(validStoredHistory([entry]), true);
  assert.equal(entry.lines.length, 6);
  assert.equal(castFingerprint(entry.lines), castFingerprint(lines));
  assert.throws(() => createHistoryEntry(lines.slice(0, 5)));
  assert.equal(validStoredHistory([{ ...entry, lines: lines.slice(0, 5) }]), false);
});

test('released coins eventually settle into the tray', () => {
  const physics = new CoinPhysics();
  physics.beginHolding();
  physics.release([0.1, 0.7, 0.2, 0.8, 0.4, 0.6, 0.3, 0.9, 0.15, 0.5, 0.25, 0.75]);

  let settled = false;
  for (let frame = 0; frame < 1200; frame += 1) {
    const events = physics.step(1 / 60, {
      ax: 0,
      ay: 0,
      az: 0,
      tiltX: 0,
      tiltY: 0,
      rotationRate: 0,
    });
    if (events.justSettled) {
      settled = true;
      break;
    }
  }

  assert.equal(settled, true);
  assert.equal(physics.getSnapshot().phase, 'settled');
  assert.equal(
    physics.getSnapshot().coins.every((coin) => Math.hypot(coin.x, coin.y) <= 0.86),
    true,
  );
});

test('explicit pointer energy increases toss height and spin', () => {
  const randoms = [0.1, 0.7, 0.2, 0.8, 0.4, 0.6, 0.3, 0.9, 0.15, 0.5, 0.25, 0.75];
  const lowEnergy = new CoinPhysics();
  const highEnergy = new CoinPhysics();

  lowEnergy.beginHolding();
  lowEnergy.setHoldingEnergy(0);
  lowEnergy.release(randoms);
  highEnergy.beginHolding();
  highEnergy.setHoldingEnergy(1.4);
  highEnergy.release(randoms);

  const lowCoins = lowEnergy.getSnapshot().coins;
  const highCoins = highEnergy.getSnapshot().coins;
  lowCoins.forEach((coin, index) => {
    assert.ok(highCoins[index].vz > coin.vz);
    assert.ok(Math.abs(highCoins[index].flipVelocity) > Math.abs(coin.flipVelocity));
  });
});

test('a shallow held tilt reaches static rest without a long invisible tail', () => {
  const physics = new CoinPhysics();
  physics.beginHolding();
  physics.release([0.1, 0.7, 0.2, 0.8, 0.4, 0.6, 0.3, 0.9, 0.15, 0.5, 0.25, 0.75]);

  let settledFrame = -1;
  for (let frame = 0; frame < 480; frame += 1) {
    const events = physics.step(1 / 60, {
      ax: 0,
      ay: 0,
      az: 0,
      tiltX: 0.12,
      tiltY: 0.036,
      rotationRate: 0,
    });
    if (events.justSettled) {
      settledFrame = frame;
      break;
    }
  }

  assert.ok(settledFrame >= 0, 'shallow tilt should settle within eight seconds');
  assert.equal(physics.getSnapshot().phase, 'settled');
  assert.equal(
    physics.getSnapshot().coins.every((coin) => distanceFromFlat(coin.flip) < 1e-9),
    true,
  );
});

test('varied shake inputs remain stable and produce both coin faces', () => {
  let frontCount = 0;
  let backCount = 0;
  let largestFinalSnap = 0;

  for (let run = 1; run <= 80; run += 1) {
    let seed = run * 97;
    const randoms = Array.from({ length: 12 }, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    });
    const physics = new CoinPhysics();
    physics.beginHolding();

    for (let frame = 0; frame < 72; frame += 1) {
      physics.step(1 / 60, {
        ax: Math.sin(frame * 0.31 + run) * 5.2,
        ay: Math.cos(frame * 0.27 + run) * 4.7,
        az: Math.sin(frame * 0.43) * 3.4,
        tiltX: Math.sin(frame * 0.08) * 0.28,
        tiltY: Math.cos(frame * 0.07) * 0.24,
        rotationRate: 95 + (frame % 9) * 16,
      });
    }

    physics.release(randoms);
    let settled = false;
    for (let frame = 0; frame < 1500; frame += 1) {
      const beforeStep = physics.getSnapshot();
      const events = physics.step(1 / 60, {
        ax: 0,
        ay: 0,
        az: 0,
        tiltX: 0,
        tiltY: 0,
        rotationRate: 0,
      });
      if (events.justSettled) {
        const afterStep = physics.getSnapshot();
        beforeStep.coins.forEach((coin, index) => {
          largestFinalSnap = Math.max(
            largestFinalSnap,
            Math.abs(coin.flip - afterStep.coins[index].flip),
          );
        });
        settled = true;
        break;
      }
    }

    assert.equal(settled, true, `simulation ${run} did not settle`);
    const coins = physics.getSnapshot().coins;
    for (const coin of coins) {
      assert.ok(Math.hypot(coin.x, coin.y) <= 0.7 + 1e-6, `coin ${coin.id} escaped the tray`);
      assert.ok(distanceFromFlat(coin.flip) < 1e-9, `coin ${coin.id} did not finish flat`);
      if (faceFromFlip(coin.flip) === 'front') frontCount += 1;
      else backCount += 1;
    }
    for (let first = 0; first < coins.length; first += 1) {
      for (let second = first + 1; second < coins.length; second += 1) {
        assert.ok(
          Math.hypot(coins[first].x - coins[second].x, coins[first].y - coins[second].y) >= 0.32,
          `coins overlapped after simulation ${run}`,
        );
      }
    }
  }

  assert.ok(frontCount > 70, 'front faces should occur across varied releases');
  assert.ok(backCount > 70, 'back faces should occur across varied releases');
  assert.ok(
    largestFinalSnap < 0.06,
    `final face snap was visibly large: ${largestFinalSnap.toFixed(3)} rad`,
  );
});
