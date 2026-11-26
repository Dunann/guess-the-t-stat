// Parsing guesses, grading them, and keeping the running stats. All pure.

import { roundTo2 } from './series.js';

export const MAX_GUESS = 1000;
export const RECENT_LIMIT = 20;

// Turns the player's text into a number, or null if it isn't one.
// Accepts "2.5", "2,5", ".5", "-0.3", "+1" and a typographic minus sign.
export function parseGuess(text) {
  const cleaned = String(text)
    .trim()
    .replace(/−/g, '-')
    .replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || Math.abs(value) > MAX_GUESS) return null;
  return value === 0 ? 0 : value;
}

export const GRADES = [
  { max: 0.1, label: 'Bullseye', color: '#2dd4bf' },
  { max: 0.25, label: 'Excellent', color: '#4ade80' },
  { max: 0.5, label: 'Great', color: '#a3e635' },
  { max: 1, label: 'Good', color: '#facc15' },
  { max: 2, label: 'Off', color: '#fb923c' },
  { max: Infinity, label: 'Way off', color: '#f87171' },
];

// Grades an error that is already rounded to 2 decimals, so the grade always
// matches the number shown to the player.
export function grade(error) {
  return GRADES.find((g) => error <= g.max);
}

// The distance shown to the player, rounded to 2 decimals.
export function roundError(t, guess) {
  return roundTo2(Math.abs(guess - t));
}

export function emptyStats() {
  return { rounds: 0, sumError: 0, recent: [] };
}

export function averageError(stats) {
  return stats.rounds > 0 ? stats.sumError / stats.rounds : null;
}

// Returns new stats with one more round; the old object is not changed.
export function applyRound(stats, t, guess) {
  const error = roundError(t, guess);
  const recent = [...stats.recent, { t, guess, error }].slice(-RECENT_LIMIT);
  return {
    stats: {
      rounds: stats.rounds + 1,
      sumError: stats.sumError + error,
      recent,
    },
    error,
    grade: grade(error),
  };
}

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

export function isValidStats(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    Number.isInteger(data.rounds) &&
    data.rounds >= 0 &&
    isFiniteNumber(data.sumError) &&
    data.sumError >= 0 &&
    Array.isArray(data.recent) &&
    data.recent.length <= RECENT_LIMIT &&
    data.recent.length <= data.rounds &&
    data.recent.every(
      (r) =>
        r !== null &&
        typeof r === 'object' &&
        isFiniteNumber(r.t) &&
        isFiniteNumber(r.guess) &&
        isFiniteNumber(r.error) &&
        r.error >= 0,
    )
  );
}

// Formats a number with 2 decimals, never showing "-0.00".
export function format2(x) {
  const rounded = roundTo2(x);
  return rounded.toFixed(2);
}

// Shorter format for tight spaces (chart labels): fewer decimals for big values.
export function formatCompact(x) {
  const size = Math.abs(x);
  if (size >= 100) return String(Math.round(x));
  if (size >= 10) return (Math.round(x * 10) / 10 || 0).toFixed(1);
  return format2(x);
}
