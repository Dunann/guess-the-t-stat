// Seeded random numbers and the samplers the game needs.
// Everything here is pure: the same seed always gives the same numbers.

// splitmix32 turns one 32-bit seed into well-mixed 32-bit values.
// Used only to set up the main generator's state.
function splitmix32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

// Creates a random number generator (sfc32) from a 32-bit integer seed.
// Calling the returned function gives a float in [0, 1).
export function createRng(seed) {
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();

  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Discard the first few outputs so nearby seeds diverge fully.
  for (let i = 0; i < 12; i++) next();
  return next;
}

// A random 32-bit integer, for example to seed another generator.
export function randomInt32(rng) {
  return Math.floor(rng() * 4294967296) >>> 0;
}

export function uniform(rng, low, high) {
  return low + (high - low) * rng();
}

// Standard normal draw (polar Box-Muller method).
export function normal(rng) {
  let u;
  let v;
  let s;
  do {
    u = 2 * rng() - 1;
    v = 2 * rng() - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

// Gamma draw with the given shape and scale (Marsaglia-Tsang method).
export function gamma(rng, shape, scale = 1) {
  if (shape < 1) {
    // Draw with shape + 1, then scale down by U^(1/shape).
    return gamma(rng, shape + 1, scale) * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rng);
    const base = 1 + c * x;
    if (base <= 0) continue;
    const v = base * base * base;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

// Student-t draw rescaled to have variance 1 (requires df > 2).
export function studentTUnitVariance(rng, df) {
  const chiSquare = gamma(rng, df / 2, 2);
  const t = normal(rng) / Math.sqrt(chiSquare / df);
  return t * Math.sqrt((df - 2) / df);
}
