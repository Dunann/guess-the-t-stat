// Small animation helpers built on requestAnimationFrame.

const reducedMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion() {
  return reducedMotion?.matches ?? false;
}

export const ease = {
  linear: (p) => p,
  outCubic: (p) => 1 - (1 - p) ** 3,
  outQuart: (p) => 1 - (1 - p) ** 4,
  inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  outBack: (p) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
  },
};

export function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// Calls onUpdate(progress) once per frame, with progress going from 0 to 1
// over `duration` ms. The last call is always onUpdate(1).
// Returns { done, finish } where `done` is a Promise that resolves at the
// end and finish() jumps straight to the end.
// With reduced motion turned on, it jumps to the end at once.
export function tween(duration, onUpdate) {
  let frame = null;
  let start = null;
  let finished = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    try {
      onUpdate(1);
    } finally {
      resolveDone(); // never leave the game waiting on a broken frame
    }
  };

  if (duration <= 0 || prefersReducedMotion()) {
    finish();
    return { done, finish };
  }

  const step = (now) => {
    if (start === null) start = now;
    const progress = (now - start) / duration;
    if (progress >= 1) {
      finish();
      return;
    }
    onUpdate(progress);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return { done, finish };
}
