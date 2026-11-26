// Builds one round: a simulated strategy's returns with a chosen t-stat.
//
// The t-stat of returns r1..rn is  t = mean / (sd / sqrt(n)).
// Since the cumulative return is n * mean, this equals
//   t = (final cumulative return) / (sd * sqrt(n)),
// so the chart's shape alone (how high it ends compared to how much it
// wobbles) carries the answer, whatever the axis scales are.

import {
  createRng,
  uniform,
  normal,
  gamma,
  studentTUnitVariance,
} from './random.js';

// Target t-stat: Gamma(shape, scale) - shift. Mostly 0.5-4, rarely above 10,
// occasionally slightly negative, with no upper cap.
export const TARGET_SHAPE = 1.6;
export const TARGET_SCALE = 1.5;
export const TARGET_SHIFT = 0.25;

// Number of returns per chart, drawn log-uniformly in this range.
export const MIN_LENGTH = 150;
export const MAX_LENGTH = 2500;

const GARCH_BURN_IN = 200;

export function roundTo2(x) {
  const rounded = Math.round(x * 100) / 100;
  return rounded === 0 ? 0 : rounded; // avoid -0
}

export function sampleTargetT(rng) {
  return roundTo2(gamma(rng, TARGET_SHAPE, TARGET_SCALE) - TARGET_SHIFT);
}

export function sampleLength(rng) {
  const logLength = uniform(rng, Math.log(MIN_LENGTH), Math.log(MAX_LENGTH));
  return Math.round(Math.exp(logLength));
}

export function mean(values) {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// Sample standard deviation (divides by n - 1).
export function standardDeviation(values) {
  const m = mean(values);
  let sumSquares = 0;
  for (const v of values) sumSquares += (v - m) ** 2;
  return Math.sqrt(sumSquares / (values.length - 1));
}

export function tStat(returns) {
  const n = returns.length;
  return mean(returns) / (standardDeviation(returns) / Math.sqrt(n));
}

// Cumulative sum starting at 0, so the result has n + 1 points.
export function cumulative(returns) {
  const path = new Array(returns.length + 1);
  path[0] = 0;
  for (let i = 0; i < returns.length; i++) path[i + 1] = path[i] + returns[i];
  return path;
}

// ---- Noise models: each returns n draws with mean 0 and variance about 1,
// uncorrelated over time. ----

function normalNoise(rng, n) {
  const noise = new Array(n);
  for (let i = 0; i < n; i++) noise[i] = normal(rng);
  return noise;
}

// Fat tails: occasional large jumps.
function fatTailNoise(rng, n) {
  const df = uniform(rng, 3, 6);
  const noise = new Array(n);
  for (let i = 0; i < n; i++) noise[i] = studentTUnitVariance(rng, df);
  return noise;
}

// Volatility clustering: calm and wild stretches (GARCH(1,1)).
function clusteredNoise(rng, n) {
  const alpha = uniform(rng, 0.05, 0.12);
  const persistence = uniform(rng, 0.93, 0.985);
  const beta = persistence - alpha;
  const omega = 1 - persistence; // long-run variance of 1
  const fatShocks = rng() < 0.5;
  const shock = () => (fatShocks ? studentTUnitVariance(rng, 5) : normal(rng));

  const noise = new Array(n);
  let variance = 1;
  for (let i = -GARCH_BURN_IN; i < n; i++) {
    const value = Math.sqrt(variance) * shock();
    if (i >= 0) noise[i] = value;
    variance = omega + alpha * value * value + beta * variance;
  }
  return noise;
}

export const NOISE_MODELS = [
  { name: 'normal', weight: 0.4, generate: normalNoise },
  { name: 'fat-tails', weight: 0.3, generate: fatTailNoise },
  { name: 'vol-clustering', weight: 0.3, generate: clusteredNoise },
];

function pickNoiseModel(rng) {
  let u = rng();
  for (const model of NOISE_MODELS) {
    if (u < model.weight) return model;
    u -= model.weight;
  }
  return NOISE_MODELS[NOISE_MODELS.length - 1];
}

// Shifts the noise so its t-stat is exactly targetT. Demeaning and adding a
// constant leave the standard deviation unchanged, so the mean can be set
// directly: mean = targetT * sd / sqrt(n).
export function returnsWithTStat(noise, targetT) {
  const n = noise.length;
  const noiseMean = mean(noise);
  const demeaned = noise.map((v) => v - noiseMean);
  const sd = standardDeviation(demeaned);
  const drift = (targetT * sd) / Math.sqrt(n);
  return demeaned.map((v) => v + drift);
}

export function makeRound(seed) {
  const rng = createRng(seed);
  const targetT = sampleTargetT(rng);
  const n = sampleLength(rng);
  const model = pickNoiseModel(rng);
  const returns = returnsWithTStat(model.generate(rng, n), targetT);

  // The answer comes from the returns themselves; it equals targetT up to
  // floating-point error, and rounds to it exactly.
  const t = roundTo2(tStat(returns));
  const standardError = standardDeviation(returns) * Math.sqrt(n);

  return {
    seed,
    n,
    model: model.name,
    returns,
    path: cumulative(returns),
    t,
    standardError, // the chart's "pure luck" unit: sd * sqrt(n)
  };
}
