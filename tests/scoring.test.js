import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGuess,
  grade,
  roundError,
  emptyStats,
  applyRound,
  averageError,
  isValidStats,
  format2,
  formatCompact,
  RECENT_LIMIT,
} from '../site/js/scoring.js';
import { loadStats, saveStats, clearStats, STORAGE_KEY } from '../site/js/storage.js';

test('parseGuess accepts common number formats', () => {
  assert.equal(parseGuess('2.5'), 2.5);
  assert.equal(parseGuess('2,5'), 2.5);
  assert.equal(parseGuess('.5'), 0.5);
  assert.equal(parseGuess('3.'), 3);
  assert.equal(parseGuess('-0.3'), -0.3);
  assert.equal(parseGuess('−0.3'), -0.3);
  assert.equal(parseGuess('+1'), 1);
  assert.equal(parseGuess('  4  '), 4);
  assert.equal(parseGuess('1000'), 1000);
  assert.ok(Object.is(parseGuess('-0'), 0));
});

test('parseGuess rejects anything else', () => {
  const bad = ['', ' ', 'abc', '1e999', '1e2', '2..5', '1,2,3', '--1', '.', '-', '1001', 'NaN', 'Infinity'];
  for (const text of bad) {
    assert.equal(parseGuess(text), null, `"${text}"`);
  }
});

test('grade boundaries', () => {
  assert.equal(grade(0).label, 'Bullseye');
  assert.equal(grade(0.1).label, 'Bullseye');
  assert.equal(grade(0.11).label, 'Excellent');
  assert.equal(grade(0.25).label, 'Excellent');
  assert.equal(grade(0.5).label, 'Great');
  assert.equal(grade(1).label, 'Good');
  assert.equal(grade(2).label, 'Off');
  assert.equal(grade(2.01).label, 'Way off');
  assert.equal(grade(999).label, 'Way off');
});

test('errors are rounded so grades match the shown number', () => {
  // 3.52 - 3.42 is 0.10000000000000009 in floating point.
  const error = roundError(3.42, 3.52);
  assert.equal(error, 0.1);
  assert.equal(grade(error).label, 'Bullseye');
  assert.equal(format2(error), '0.10');
});

test('applyRound updates rounds, average and recent history', () => {
  let stats = emptyStats();
  assert.equal(averageError(stats), null);

  const result = applyRound(stats, 2, 2.5);
  stats = result.stats;
  assert.equal(result.error, 0.5);
  assert.equal(result.grade.label, 'Great');

  stats = applyRound(stats, 1, 0).stats;
  assert.equal(stats.rounds, 2);
  assert.ok(Math.abs(averageError(stats) - 0.75) < 1e-12);
  assert.deepEqual(stats.recent[1], { t: 1, guess: 0, error: 1 });

  const original = emptyStats();
  applyRound(original, 1, 1);
  assert.deepEqual(original, emptyStats(), 'input is not changed');
});

test('recent history keeps only the latest rounds', () => {
  let stats = emptyStats();
  for (let i = 0; i < RECENT_LIMIT + 5; i++) stats = applyRound(stats, i, i).stats;
  assert.equal(stats.rounds, RECENT_LIMIT + 5);
  assert.equal(stats.recent.length, RECENT_LIMIT);
  assert.equal(stats.recent[0].t, 5);
  assert.ok(isValidStats(stats));
});

test('isValidStats rejects malformed data', () => {
  assert.ok(isValidStats(emptyStats()));
  assert.ok(!isValidStats(null));
  assert.ok(!isValidStats({ rounds: -1, sumError: 0, recent: [] }));
  assert.ok(!isValidStats({ rounds: 1.5, sumError: 0, recent: [] }));
  assert.ok(!isValidStats({ rounds: 1, sumError: 'x', recent: [] }));
  assert.ok(!isValidStats({ rounds: 0, sumError: 0, recent: [{ t: 1, guess: 1, error: 0 }] }));
  assert.ok(!isValidStats({ rounds: 1, sumError: 0, recent: [{ t: 1, guess: null, error: 0 }] }));
});

test('number formatting', () => {
  assert.equal(format2(-0.001), '0.00');
  assert.equal(format2(3.456), '3.46');
  assert.equal(formatCompact(3.456), '3.46');
  assert.equal(formatCompact(12.34), '12.3');
  assert.equal(formatCompact(-250.6), '-251');
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

test('stats survive a save and load', () => {
  const storage = fakeStorage();
  const stats = applyRound(emptyStats(), 2, 3).stats;
  saveStats(stats, storage);
  assert.deepEqual(loadStats(storage), stats);
  clearStats(storage);
  assert.deepEqual(loadStats(storage), emptyStats());
});

test('corrupt or missing storage falls back to empty stats', () => {
  assert.deepEqual(loadStats(fakeStorage({ [STORAGE_KEY]: '{not json' })), emptyStats());
  assert.deepEqual(loadStats(fakeStorage({ [STORAGE_KEY]: JSON.stringify({ rounds: 'x' }) })), emptyStats());
  assert.deepEqual(loadStats(null), emptyStats());

  const blocked = () => {
    throw new Error('blocked');
  };
  const throwing = { getItem: blocked, setItem: blocked, removeItem: blocked };
  assert.deepEqual(loadStats(throwing), emptyStats());
  assert.doesNotThrow(() => saveStats(emptyStats(), throwing));
  assert.doesNotThrow(() => clearStats(throwing));
});
