import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRng,
  randomInt32,
  normal,
  gamma,
  studentTUnitVariance,
} from '../site/js/random.js';

function moments(draw, count) {
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < count; i++) {
    const x = draw();
    sum += x;
    sumSquares += x * x;
  }
  const m = sum / count;
  return { mean: m, variance: sumSquares / count - m * m };
}

test('same seed gives the same sequence, different seeds differ', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const seqA = Array.from({ length: 50 }, a);
  const seqB = Array.from({ length: 50 }, b);
  const seqC = Array.from({ length: 50 }, c);
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test('uniform outputs stay in [0, 1) and average about 0.5', () => {
  const rng = createRng(1);
  let sum = 0;
  for (let i = 0; i < 100000; i++) {
    const x = rng();
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 100000 - 0.5) < 0.005);
});

test('randomInt32 gives integers in the 32-bit range', () => {
  const rng = createRng(5);
  for (let i = 0; i < 1000; i++) {
    const x = randomInt32(rng);
    assert.ok(Number.isInteger(x) && x >= 0 && x < 2 ** 32);
  }
});

test('normal draws have mean 0 and variance 1', () => {
  const rng = createRng(2);
  const { mean, variance } = moments(() => normal(rng), 200000);
  assert.ok(Math.abs(mean) < 0.01, `mean ${mean}`);
  assert.ok(Math.abs(variance - 1) < 0.02, `variance ${variance}`);
});

test('gamma draws match the expected mean and variance', () => {
  const cases = [
    [1.6, 1.5],
    [0.5, 1],
    [3, 2],
  ];
  for (const [shape, scale] of cases) {
    const rng = createRng(3);
    const { mean, variance } = moments(() => gamma(rng, shape, scale), 200000);
    const expectedMean = shape * scale;
    const expectedVariance = shape * scale * scale;
    assert.ok(Math.abs(mean / expectedMean - 1) < 0.02, `shape ${shape}: mean ${mean}`);
    assert.ok(
      Math.abs(variance / expectedVariance - 1) < 0.04,
      `shape ${shape}: variance ${variance}`,
    );
  }
});

test('gamma draws are never negative', () => {
  const rng = createRng(4);
  for (let i = 0; i < 50000; i++) assert.ok(gamma(rng, 0.7, 1) >= 0);
});

test('unit-variance Student-t draws have mean 0 and variance 1', () => {
  for (const df of [5, 6]) {
    const rng = createRng(6);
    const { mean, variance } = moments(() => studentTUnitVariance(rng, df), 300000);
    assert.ok(Math.abs(mean) < 0.01, `df ${df}: mean ${mean}`);
    assert.ok(Math.abs(variance - 1) < 0.05, `df ${df}: variance ${variance}`);
  }
});
