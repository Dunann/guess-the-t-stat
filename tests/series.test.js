import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, normal } from '../site/js/random.js';
import {
  tStat,
  mean,
  standardDeviation,
  cumulative,
  roundTo2,
  returnsWithTStat,
  sampleTargetT,
  sampleLength,
  makeRound,
  MIN_LENGTH,
  MAX_LENGTH,
  TARGET_SHIFT,
} from '../site/js/series.js';

test('basic statistics on known data', () => {
  const data = [1, 2, 3, 4, 5];
  assert.equal(mean(data), 3);
  assert.ok(Math.abs(standardDeviation(data) - Math.sqrt(2.5)) < 1e-12);
  // t = 3 / (sqrt(2.5) / sqrt(5)) = 3 * sqrt(2)
  assert.ok(Math.abs(tStat(data) - 3 * Math.SQRT2) < 1e-12);
});

test('cumulative starts at 0 and adds up', () => {
  assert.deepEqual(cumulative([1, 2, 3]), [0, 1, 3, 6]);
});

test('roundTo2 rounds and never returns -0', () => {
  assert.equal(roundTo2(1.234), 1.23);
  assert.equal(roundTo2(1.236), 1.24);
  assert.ok(Object.is(roundTo2(-0.001), 0));
});

test('returnsWithTStat hits the target exactly', () => {
  const rng = createRng(11);
  for (const target of [-0.25, 0, 0.5, 1.37, 4, 12.5]) {
    const noise = Array.from({ length: 500 }, () => normal(rng));
    const returns = returnsWithTStat(noise, target);
    assert.ok(Math.abs(tStat(returns) - target) < 1e-9, `target ${target}`);
  }
});

test('every round has the exact sampled t-stat and a valid path', () => {
  const modelsSeen = new Set();
  for (let seed = 0; seed < 1000; seed++) {
    const round = makeRound(seed);
    const target = sampleTargetT(createRng(seed)); // first draw of the round
    modelsSeen.add(round.model);

    assert.equal(round.t, target, `seed ${seed}`);
    assert.ok(Math.abs(tStat(round.returns) - target) < 1e-9, `seed ${seed}`);
    assert.ok(round.n >= MIN_LENGTH && round.n <= MAX_LENGTH);
    assert.equal(round.returns.length, round.n);
    assert.equal(round.path.length, round.n + 1);
    assert.equal(round.path[0], 0);
    assert.ok(round.path.every(Number.isFinite));
    assert.ok(round.standardError > 0);
    // The endpoint, measured in standard errors, is the t-stat.
    const endInUnits = round.path[round.n] / round.standardError;
    assert.ok(Math.abs(endInUnits - target) < 1e-6, `seed ${seed}: ${endInUnits}`);
  }
  assert.deepEqual([...modelsSeen].sort(), ['fat-tails', 'normal', 'vol-clustering']);
});

test('rounds are reproducible from their seed', () => {
  assert.deepEqual(makeRound(7), makeRound(7));
  assert.notDeepEqual(makeRound(7).returns, makeRound(8).returns);
});

test('target t-stats follow the intended distribution', () => {
  const rng = createRng(99);
  const count = 200000;
  const draws = Array.from({ length: count }, () => sampleTargetT(rng));
  const share = (condition) => draws.filter(condition).length / count;

  const sorted = [...draws].sort((a, b) => a - b);
  const median = sorted[count / 2];

  assert.ok(sorted[0] >= -TARGET_SHIFT, `min ${sorted[0]}`);
  assert.ok(share((t) => t < 0) < 0.05, 'negative share');
  assert.ok(share((t) => t < 0) > 0.02, 'some slightly negative values');
  const core = share((t) => t >= 0.5 && t < 4);
  assert.ok(core > 0.64 && core < 0.72, `0.5-4 share ${core}`);
  assert.ok(share((t) => t > 10) < 0.01, 'share above 10');
  assert.ok(sorted[count - 1] > 10, 'no hard cap at 10');
  assert.ok(median > 1.5 && median < 1.85, `median ${median}`);
  assert.ok(draws.every((t) => roundTo2(t) === t), 'targets have 2 decimals');
});

test('lengths stay within range and cover it', () => {
  const rng = createRng(5);
  const lengths = Array.from({ length: 20000 }, () => sampleLength(rng));
  assert.ok(lengths.every((n) => Number.isInteger(n) && n >= MIN_LENGTH && n <= MAX_LENGTH));
  assert.ok(Math.min(...lengths) < 160);
  assert.ok(Math.max(...lengths) > 2400);
});
