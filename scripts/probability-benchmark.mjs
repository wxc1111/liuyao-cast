import { castLineFromFaces } from '../mobile/src/core/casting.ts';
import { CoinPhysics, faceFromFlip } from '../mobile/src/core/physics.ts';

const DEFAULT_SAMPLE_COUNT = 20_000;
const DEFAULT_SEED = 0x6d2b79f5;
const FRAME_SECONDS = 1 / 60;

const numberArgument = (name, fallback) => {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name} value: ${raw}`);
  }
  return Math.floor(parsed);
};

const sampleCount = numberArgument('samples', DEFAULT_SAMPLE_COUNT);
const initialSeed = numberArgument('seed', DEFAULT_SEED) >>> 0;

const createRandom = (seed) => {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

// Abramowitz and Stegun 7.1.26 approximation, sufficient for reporting the
// chi-square survival probability below.
const erfc = (value) => {
  const z = Math.abs(value);
  const t = 1 / (1 + 0.5 * z);
  const coefficients = [
    0.17087277,
    -0.82215223,
    1.48851587,
    -1.13520398,
    0.27886807,
    -0.18628806,
    0.09678418,
    0.37409196,
    1.00002368,
  ];
  const polynomial = coefficients.slice(1).reduce(
    (result, coefficient) => coefficient + t * result,
    coefficients[0],
  );
  const result = t * Math.exp(-z * z - 1.26551223 + t * polynomial);
  return value >= 0 ? result : 2 - result;
};

const chiSquareSurvivalWithThreeDegrees = (chiSquare) => {
  const x = chiSquare / 2;
  return erfc(Math.sqrt(x)) + (2 * Math.sqrt(x) * Math.exp(-x)) / Math.sqrt(Math.PI);
};

const percent = (value) => `${(value * 100).toFixed(3)}%`;
const signedPoints = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(3)} pp`;

const random = createRandom(initialSeed);
const sumCounts = { 6: 0, 7: 0, 8: 0, 9: 0 };
const frontByCoin = [0, 0, 0];
const jointFrontCounts = [0, 0, 0];
let totalFronts = 0;
let unsettledCount = 0;
let totalSettleFrames = 0;
let maximumSettleFrames = 0;

for (let run = 0; run < sampleCount; run += 1) {
  const physics = new CoinPhysics();
  physics.beginHolding();

  // Vary the hold duration, shake amplitude, phases, tilt and angular rate so
  // every result is produced by the complete physical path rather than by a
  // direct coin-face randomizer.
  const holdFrames = 36 + Math.floor(random() * 61);
  const amplitude = 3.2 + random() * 5.8;
  const rotationBase = 65 + random() * 250;
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  let releaseMotion;

  for (let frame = 0; frame < holdFrames; frame += 1) {
    releaseMotion = {
      ax: Math.sin(frame * (0.22 + random() * 0.08) + phaseA) * amplitude,
      ay: Math.cos(frame * (0.19 + random() * 0.08) + phaseB) * amplitude * 0.9,
      az: Math.sin(frame * 0.37 + phaseB) * amplitude * 0.55,
      tiltX: Math.sin(frame * 0.055 + phaseA) * 0.34,
      tiltY: Math.cos(frame * 0.049 + phaseB) * 0.3,
      rotationRate: rotationBase + Math.sin(frame * 0.13) * 90,
    };
    physics.step(FRAME_SECONDS, releaseMotion);
  }

  physics.release(Array.from({ length: 12 }, random), releaseMotion);

  let settledFrame = -1;
  for (let frame = 0; frame < 1200; frame += 1) {
    const residualMotion = Math.max(0, 1 - frame / 24);
    const events = physics.step(FRAME_SECONDS, {
      ax: Math.sin(frame * 0.35 + phaseA) * amplitude * 0.12 * residualMotion,
      ay: Math.cos(frame * 0.31 + phaseB) * amplitude * 0.12 * residualMotion,
      az: 0,
      tiltX: 0,
      tiltY: 0,
      rotationRate: rotationBase * 0.08 * residualMotion,
    });
    if (events.justSettled) {
      settledFrame = frame + 1;
      break;
    }
  }

  if (settledFrame < 0) {
    unsettledCount += 1;
    continue;
  }

  totalSettleFrames += settledFrame;
  maximumSettleFrames = Math.max(maximumSettleFrames, settledFrame);

  const faces = physics.getSnapshot().coins.map((coin, index) => {
    const face = faceFromFlip(coin.flip);
    if (face === 'front') {
      totalFronts += 1;
      frontByCoin[index] += 1;
    }
    return face;
  });

  const frontBits = faces.map((face) => (face === 'front' ? 1 : 0));
  jointFrontCounts[0] += frontBits[0] * frontBits[1];
  jointFrontCounts[1] += frontBits[0] * frontBits[2];
  jointFrontCounts[2] += frontBits[1] * frontBits[2];

  sumCounts[castLineFromFaces(faces, 1, `benchmark-${run}`).sum] += 1;
}

const completedCount = sampleCount - unsettledCount;
const theoretical = { 6: 1 / 8, 7: 3 / 8, 8: 3 / 8, 9: 1 / 8 };
const chiSquare = Object.entries(theoretical).reduce((total, [sum, probability]) => {
  const expected = completedCount * probability;
  return total + (sumCounts[sum] - expected) ** 2 / expected;
}, 0);
const pValue = chiSquareSurvivalWithThreeDegrees(chiSquare);

const pairs = [
  [0, 1],
  [0, 2],
  [1, 2],
];
const correlations = pairs.map(([first, second], index) => {
  const pFirst = frontByCoin[first] / completedCount;
  const pSecond = frontByCoin[second] / completedCount;
  const pBoth = jointFrontCounts[index] / completedCount;
  const denominator = Math.sqrt(
    pFirst * (1 - pFirst) * pSecond * (1 - pSecond),
  );
  return denominator === 0 ? 0 : (pBoth - pFirst * pSecond) / denominator;
});
const maximumCorrelation = Math.max(...correlations.map(Math.abs));

console.log('# Three-coin physical probability benchmark\n');
console.log(`- Samples: ${completedCount.toLocaleString('en-US')} complete three-coin casts`);
console.log(`- Seed: 0x${initialSeed.toString(16).padStart(8, '0')}`);
console.log(`- Coin faces: ${(completedCount * 3).toLocaleString('en-US')}`);
console.log(`- Unsettled simulations: ${unsettledCount}`);
console.log(
  `- Mean / maximum visible settling time: ${(totalSettleFrames / completedCount / 60).toFixed(3)} s / ${(maximumSettleFrames / 60).toFixed(3)} s`,
);
console.log('');
console.log('| Outcome | Fair-coin theory | Physics simulation | Difference | Count |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const sum of [6, 7, 8, 9]) {
  const observed = sumCounts[sum] / completedCount;
  console.log(
    `| ${sum} | ${percent(theoretical[sum])} | ${percent(observed)} | ${signedPoints(observed - theoretical[sum])} | ${sumCounts[sum].toLocaleString('en-US')} |`,
  );
}
const observedFrontRate = totalFronts / (completedCount * 3);
console.log(
  `| Front face | 50.000% | ${percent(observedFrontRate)} | ${signedPoints(observedFrontRate - 0.5)} | ${totalFronts.toLocaleString('en-US')} / ${(completedCount * 3).toLocaleString('en-US')} |`,
);
console.log('');
console.log(
  `Chi-square goodness-of-fit: χ²=${chiSquare.toFixed(3)}, df=3, p=${pValue.toFixed(3)}. ` +
    `Maximum absolute pairwise coin correlation: ${maximumCorrelation.toFixed(4)}.`,
);

if (sampleCount >= 5000) {
  const failed = unsettledCount > 0 || pValue < 0.01 || maximumCorrelation > 0.03;
  if (failed) {
    console.error('\nBenchmark failed its predeclared fairness or settling guardrail.');
    process.exitCode = 1;
  }
}
