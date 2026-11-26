// Saves the player's stats in the browser. If storage is unavailable
// (private mode, blocked cookies), the game still works for the session.

import { emptyStats, isValidStats } from './scoring.js';

export const STORAGE_KEY = 'guess-the-t-stat/v1';

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadStats(storage = browserStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return emptyStats();
    const data = JSON.parse(raw);
    return isValidStats(data) ? data : emptyStats();
  } catch {
    return emptyStats();
  }
}

export function saveStats(stats, storage = browserStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Storage full or blocked: keep playing without saving.
  }
}

export function clearStats(storage = browserStorage()) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
