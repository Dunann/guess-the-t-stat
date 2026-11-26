// The chart. It draws a round's cumulative return and, on reveal, a ruler at
// the right edge that measures the final return in standard errors
// (sd * sqrt(n)). The number of standard errors is the t-stat.

import { tween, ease, clamp01 } from './anim.js';
import { formatCompact } from './scoring.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const DRAW_MS = 1300;
const EXIT_MS = 320;
const RESCALE_MS = 650;
const PADDING_SHARE = 0.08; // empty space above and below the line
const MAX_ZOOM_OUT = 3; // the reveal may grow the y-range to at most 3x
const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

// When each part of the reveal plays, in ms. Everything after the optional
// rescale waits for it to finish.
function revealTimeline(rescaleMs) {
  const r = rescaleMs;
  return {
    rescale: [0, r],
    track: [r * 0.5, r * 0.5 + 400],
    bar: [r + 150, r + 1050],
    drift: [r + 150, r + 850],
    guess: [r + 600, r + 1200],
    error: [r + 1050, r + 1450],
    total: r + 1450,
  };
}

// Progress (0 to 1) of a [start, end] span at time `elapsed`, eased.
function phase([start, end], elapsed, easing = ease.outCubic) {
  if (end <= start) return elapsed >= end ? 1 : 0;
  return easing(clamp01((elapsed - start) / (end - start)));
}

function lerp(a, b, p) {
  return a + (b - a) * p;
}

function svgElement(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.appendChild(node);
  return node;
}

function setAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
}

function fixed(x) {
  return x.toFixed(1);
}

let chartCount = 0;

export class Chart {
  constructor(container) {
    this.container = container;
    this.uid = `chart${++chartCount}`;
    this.round = null;
    this.base = null; // y-range that fits the line
    this.view = null; // y-range currently shown (grows during a rescale)
    this.drawProgress = 0;
    this.revealState = null;
    this.drawAnimation = null;
    this.revealAnimation = null;
    this.size = { width: 0, height: 0 };
    this.box = null;
    this.seriesKey = '';

    this.build();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  // ---- Public API ----

  // Fades the current round out. Resolves when it is gone.
  exit() {
    this.finishAnimations();
    if (!this.round) return Promise.resolve();
    const animation = tween(EXIT_MS, (p) => {
      const e = ease.inOutCubic(p);
      this.content.style.opacity = String(1 - e);
      this.content.style.transform = `translateY(${fixed(10 * e)}px)`;
    });
    return animation.done.then(() => {
      this.round = null;
      this.revealState = null;
      this.seriesKey = '';
      this.renderAll();
      this.content.style.opacity = '';
      this.content.style.transform = '';
    });
  }

  // Draws a new round from left to right. Resolves when the line is complete.
  draw(round) {
    this.finishAnimations();
    this.round = round;

    let low = 0;
    let high = 0;
    for (const v of round.path) {
      if (v < low) low = v;
      if (v > high) high = v;
    }
    const padding = (high - low) * PADDING_SHARE;
    this.base = { min: low - padding, max: high + padding };
    this.view = { ...this.base };
    this.revealState = null;
    this.drawProgress = 0;
    this.seriesKey = '';
    this.renderAll();

    this.drawAnimation = tween(DRAW_MS, (p) => {
      this.drawProgress = ease.inOutCubic(p);
      this.renderDraw();
    });
    return this.drawAnimation.done;
  }

  finishDraw() {
    this.drawAnimation?.finish();
  }

  // Shows the answer: rescales if needed so the guess fits, grows the
  // standard-error ruler, then marks the guess and the gap between them.
  // onBar(fraction) is called every frame with the ruler's growth (0 to 1).
  reveal({ guess, color, onBar }) {
    this.finishDraw();
    const round = this.round;
    const unit = round.standardError;
    const to = this.revealRange(guess * unit, (round.t < 0 ? -1 : 1) * unit);
    const needsRescale = to.min !== this.base.min || to.max !== this.base.max;
    const timeline = revealTimeline(needsRescale ? RESCALE_MS : 0);
    const state = { guess, color, from: { ...this.view }, to, timeline, elapsed: 0 };
    this.revealState = state;

    this.revealAnimation = tween(timeline.total, (p) => {
      if (this.revealState !== state) return;
      state.elapsed = p * timeline.total;
      const k = phase(timeline.rescale, state.elapsed, ease.inOutCubic);
      this.view = { min: lerp(state.from.min, to.min, k), max: lerp(state.from.max, to.max, k) };
      this.renderSeries();
      this.renderDraw();
      this.renderReveal();
      onBar?.(phase(timeline.bar, state.elapsed));
    });
    return this.revealAnimation.done;
  }

  finishReveal() {
    this.revealAnimation?.finish();
  }

  // ---- Setup ----

  build() {
    const id = (name) => `${this.uid}-${name}`;
    this.ids = {
      line: id('line'),
      area: id('area'),
      glow: id('glow'),
      barGlow: id('bar-glow'),
      wipe: id('wipe'),
      halo: id('halo'),
    };

    const svg = svgElement('svg', {
      class: 'chart-svg',
      role: 'img',
      'aria-label': "Chart of a simulated trading strategy's cumulative return",
    });
    this.svg = svg;
    const defs = svgElement('defs', {}, svg);

    this.lineGradient = svgElement('linearGradient', { id: this.ids.line, gradientUnits: 'userSpaceOnUse' }, defs);
    for (const [offset, color] of [
      [0, '#22d3ee'],
      [0.55, '#818cf8'],
      [1, '#c084fc'],
    ]) {
      svgElement('stop', { offset, 'stop-color': color }, this.lineGradient);
    }

    // Area fill: cyan above zero, rose below, both fading toward the zero line.
    this.areaGradient = svgElement('linearGradient', { id: this.ids.area, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0 }, defs);
    this.areaStops = [
      ['#38bdf8', 0.22],
      ['#38bdf8', 0],
      ['#fb7185', 0],
      ['#fb7185', 0.16],
    ].map(([color, opacity]) =>
      svgElement('stop', { 'stop-color': color, 'stop-opacity': opacity }, this.areaGradient),
    );

    this.glowFilter = svgElement('filter', { id: this.ids.glow, filterUnits: 'userSpaceOnUse' }, defs);
    svgElement('feGaussianBlur', { stdDeviation: 5 }, this.glowFilter);
    this.barGlowFilter = svgElement('filter', { id: this.ids.barGlow, filterUnits: 'userSpaceOnUse' }, defs);
    svgElement('feGaussianBlur', { stdDeviation: 4 }, this.barGlowFilter);

    const halo = svgElement('radialGradient', { id: this.ids.halo }, defs);
    svgElement('stop', { offset: 0, 'stop-color': '#ffffff', 'stop-opacity': 0.95 }, halo);
    svgElement('stop', { offset: 0.3, 'stop-color': '#ddd6fe', 'stop-opacity': 0.5 }, halo);
    svgElement('stop', { offset: 1, 'stop-color': '#a78bfa', 'stop-opacity': 0 }, halo);

    const clip = svgElement('clipPath', { id: this.ids.wipe }, defs);
    this.wipeRect = svgElement('rect', { x: 0, y: 0, width: 0, height: 0 }, clip);

    this.grid = svgElement('g', { class: 'grid' }, svg);
    this.content = svgElement('g', { class: 'content' }, svg);
    this.zeroLine = svgElement('line', { class: 'zero-line' }, this.content);
    const series = svgElement('g', { 'clip-path': `url(#${this.ids.wipe})` }, this.content);
    this.areaPath = svgElement('path', { class: 'area', fill: `url(#${this.ids.area})` }, series);
    this.glowPath = svgElement('path', {
      class: 'line-glow',
      stroke: `url(#${this.ids.line})`,
      filter: `url(#${this.ids.glow})`,
    }, series);
    this.linePath = svgElement('path', { class: 'line', stroke: `url(#${this.ids.line})` }, series);
    this.revealLayer = svgElement('g', { class: 'reveal' }, this.content);
    this.headHalo = svgElement('circle', { class: 'head-halo', r: 14, fill: `url(#${this.ids.halo})` }, this.content);
    this.headDot = svgElement('circle', { class: 'head-dot', r: 3.5 }, this.content);

    this.container.appendChild(svg);
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (!width || !height) return;
    if (width === this.size.width && height === this.size.height) return;
    this.size = { width, height };
    setAttrs(this.svg, { width, height, viewBox: `0 0 ${width} ${height}` });
    this.box = this.layout();
    this.seriesKey = '';
    this.renderAll();
  }

  layout() {
    const { width, height } = this.size;
    const compact = width < 560;
    const left = compact ? 10 : 18;
    const gutter = compact ? 62 : 84;
    const top = 18;
    const bottom = height - 18;
    const right = width - gutter;
    return {
      width,
      height,
      compact,
      left,
      right,
      top,
      bottom,
      plotWidth: right - left,
      plotHeight: bottom - top,
      rulerX: right + (compact ? 14 : 20),
    };
  }

  finishAnimations() {
    this.drawAnimation?.finish();
    this.revealAnimation?.finish();
  }

  // ---- Rendering ----

  yOf(value) {
    const { top, plotHeight } = this.box;
    return top + ((this.view.max - value) / (this.view.max - this.view.min)) * plotHeight;
  }

  renderAll() {
    if (!this.box) return;
    this.renderStatic();
    this.renderSeries();
    this.renderDraw();
    this.renderReveal();
  }

  // Parts that only change with the chart's size.
  renderStatic() {
    const b = this.box;
    setAttrs(this.lineGradient, { x1: b.left, x2: b.right, y1: 0, y2: 0 });
    setAttrs(this.areaGradient, { y1: b.top, y2: b.bottom });
    const filterBox = { x: -30, y: -30, width: b.width + 60, height: b.height + 60 };
    setAttrs(this.glowFilter, filterBox);
    setAttrs(this.barGlowFilter, filterBox);
    setAttrs(this.wipeRect, { height: b.height });
    this.svg.classList.toggle('is-compact', b.compact);

    let grid = '';
    for (let i = 1; i < 6; i++) {
      const x = fixed(b.left + (b.plotWidth * i) / 6);
      grid += `<line x1="${x}" x2="${x}" y1="${b.top}" y2="${b.bottom}"/>`;
    }
    for (let i = 1; i < 4; i++) {
      const y = fixed(b.top + (b.plotHeight * i) / 4);
      grid += `<line x1="${b.left}" x2="${b.right}" y1="${y}" y2="${y}"/>`;
    }
    this.grid.innerHTML = grid;
  }

  // The line, its glow and the area fill. Rebuilt only when the size or
  // the y-range changes.
  renderSeries() {
    const b = this.box;
    if (!b) return;
    if (!this.round) {
      for (const node of [this.areaPath, this.glowPath, this.linePath]) node.removeAttribute('d');
      this.zeroLine.setAttribute('opacity', 0);
      return;
    }
    const key = `${b.width}x${b.height}:${this.view.min}:${this.view.max}`;
    if (key === this.seriesKey) return;
    this.seriesKey = key;

    const { path, n } = this.round;
    const xStep = b.plotWidth / n;
    const yScale = b.plotHeight / (this.view.max - this.view.min);
    const top = b.top;
    const max = this.view.max;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const x = b.left + i * xStep;
      const y = top + (max - path[i]) * yScale;
      d += `${i === 0 ? 'M' : 'L'}${fixed(x)} ${fixed(y)}`;
    }
    const y0 = this.yOf(0);
    this.linePath.setAttribute('d', d);
    this.glowPath.setAttribute('d', d);
    this.areaPath.setAttribute('d', `${d}L${fixed(b.right)} ${fixed(y0)}L${fixed(b.left)} ${fixed(y0)}Z`);
    setAttrs(this.zeroLine, { x1: b.left, x2: b.right, y1: fixed(y0), y2: fixed(y0), opacity: 1 });

    const zeroShare = String(clamp01((y0 - b.top) / b.plotHeight));
    const offsets = ['0', zeroShare, zeroShare, '1'];
    this.areaStops.forEach((stop, i) => stop.setAttribute('offset', offsets[i]));
  }

  // The left-to-right wipe and the glowing dot at its leading edge.
  renderDraw() {
    const b = this.box;
    if (!b) return;
    if (!this.round) {
      this.wipeRect.setAttribute('width', 0);
      this.headDot.setAttribute('opacity', 0);
      this.headHalo.setAttribute('opacity', 0);
      return;
    }
    const p = this.drawProgress;
    this.wipeRect.setAttribute('width', p >= 1 ? b.width : fixed(b.left + p * b.plotWidth + 1));

    const { path, n } = this.round;
    const position = p * n;
    const i = Math.min(n - 1, Math.floor(position));
    const value = lerp(path[i], path[i + 1], position - i);
    const cx = fixed(b.left + p * b.plotWidth);
    const cy = fixed(this.yOf(value));
    const visible = p > 0 ? 1 : 0;
    setAttrs(this.headDot, { cx, cy, opacity: visible });
    setAttrs(this.headHalo, { cx, cy, opacity: visible });
    this.headHalo.classList.toggle('is-pulsing', p >= 1 && !this.revealState);
  }

  // Everything that appears on reveal. Rebuilt each frame of the reveal;
  // it is a few dozen small elements.
  renderReveal() {
    const b = this.box;
    const state = this.revealState;
    if (!b || !state || !this.round) {
      this.revealLayer.innerHTML = '';
      this.grid.style.opacity = '';
      return;
    }

    const { timeline, elapsed, guess, color } = state;
    const track = phase(timeline.track, elapsed);
    const bar = phase(timeline.bar, elapsed);
    const drift = phase(timeline.drift, elapsed, ease.inOutCubic);
    const guessIn = phase(timeline.guess, elapsed);
    const gap = phase(timeline.error, elapsed);

    const { t, standardError: unit, path, n } = this.round;
    const x = b.rulerX;
    const y0 = this.yOf(0);
    const yEnd = this.yOf(path[n]);
    const barY = lerp(y0, yEnd, bar);

    // Guess position, held inside the plot if it is off the chart.
    const rawGuessY = this.yOf(guess * unit);
    const guessOffChart = rawGuessY < b.top ? -1 : rawGuessY > b.bottom ? 1 : 0;
    const guessY = Math.min(Math.max(rawGuessY, b.top + 4), b.bottom - 4);
    const markerY = lerp(y0, guessY, guessIn);

    // Value labels beside the ruler, pushed apart if they would overlap.
    const labelGap = 15;
    let actualLabelY = barY;
    let guessLabelY = markerY;
    if (guessIn > 0 && Math.abs(actualLabelY - guessLabelY) < labelGap) {
      const middle = (actualLabelY + guessLabelY) / 2;
      const direction = guessLabelY > actualLabelY || (guessLabelY === actualLabelY && guess < t) ? 1 : -1;
      actualLabelY = middle - (direction * labelGap) / 2;
      guessLabelY = middle + (direction * labelGap) / 2;
    }
    const labelTop = b.top + 6;
    const labelBottom = b.bottom - 6;
    const clampLabel = (y) => Math.min(Math.max(y, labelTop), labelBottom);
    actualLabelY = clampLabel(actualLabelY);
    guessLabelY = clampLabel(guessLabelY);
    if (guessIn > 0 && Math.abs(actualLabelY - guessLabelY) < labelGap) {
      // Clamping at an edge pushed them together again: move the other one.
      if (actualLabelY === labelTop || actualLabelY === labelBottom) {
        guessLabelY = actualLabelY + (actualLabelY === labelTop ? labelGap : -labelGap);
      } else {
        actualLabelY = guessLabelY + (guessLabelY === labelTop ? labelGap : -labelGap);
      }
    }

    // Ruler ticks: one per standard error, thinned out when they get tight.
    const pxPerUnit = (unit * b.plotHeight) / (this.view.max - this.view.min);
    const tickStep = TICK_STEPS.find((s) => s * pxPerUnit >= 7) ?? 2000;
    const labelStep = TICK_STEPS.find((s) => s * pxPerUnit >= 18 && s % tickStep === 0) ?? tickStep * 10;
    const firstTick = Math.ceil(this.view.min / unit / tickStep) * tickStep;
    const lastTick = Math.floor(this.view.max / unit / tickStep) * tickStep;
    const barUnits = bar * t;

    let unitLines = '';
    let ticks = '';
    let tickLabels = '';
    for (let k = firstTick; k <= lastTick; k += tickStep) {
      const y = this.yOf(k * unit);
      const ys = fixed(y);
      const passed = bar > 0 && k !== 0 && Math.sign(k) === Math.sign(t) && Math.abs(k) <= Math.abs(barUnits) + 1e-9;
      const labeled = k % labelStep === 0;
      const size = labeled ? 5 : 3;
      ticks += `<line class="tick${passed ? ' is-passed' : ''}" x1="${fixed(x - size)}" x2="${fixed(x + size)}" y1="${ys}" y2="${ys}"/>`;
      if (labeled && k !== 0) {
        unitLines += `<line class="unit-line" x1="${b.left}" x2="${b.right}" y1="${ys}" y2="${ys}"/>`;
      }
      const nearActual = bar > 0 && Math.abs(y - actualLabelY) < 12;
      const nearGuess = guessIn > 0 && Math.abs(y - guessLabelY) < 12;
      if (labeled && !nearActual && !nearGuess) {
        tickLabels += `<text class="tick-label${passed ? ' is-passed' : ''}" x="${fixed(x + 10)}" y="${ys}">${k}</text>`;
      }
    }

    let markup = `<g opacity="${track}">${unitLines}</g>`;

    if (guessIn > 0) {
      markup += `<line class="guess-guide" x1="${b.left}" x2="${fixed(lerp(b.left, b.right, guessIn))}" y1="${fixed(guessY)}" y2="${fixed(guessY)}"/>`;
    }
    if (drift > 0) {
      markup += `<line class="drift" x1="${b.left}" y1="${fixed(y0)}" x2="${fixed(lerp(b.left, b.right, drift))}" y2="${fixed(lerp(y0, yEnd, drift))}"/>`;
    }

    markup += `<g opacity="${track}"><line class="ruler-track" x1="${x}" x2="${x}" y1="${b.top}" y2="${b.bottom}"/>${ticks}${tickLabels}</g>`;

    if (gap > 0) {
      markup += `<line class="gap" stroke="${color}" opacity="${(0.38 * gap).toFixed(3)}" x1="${x}" x2="${x}" y1="${fixed(yEnd)}" y2="${fixed(guessY)}"/>`;
      markup += `<line class="connector" opacity="${gap}" x1="${b.right + 3}" x2="${x - 6}" y1="${fixed(yEnd)}" y2="${fixed(yEnd)}"/>`;
    }

    if (bar > 0) {
      const barLine = `x1="${x}" x2="${x}" y1="${fixed(y0)}" y2="${fixed(barY)}"`;
      markup += `<line class="bar-glow" ${barLine} filter="url(#${this.ids.barGlow})"/>`;
      markup += `<line class="bar" ${barLine}/>`;
      markup += `<circle class="bar-tip" cx="${x}" cy="${fixed(barY)}" r="3.5"/>`;
      markup += `<text class="value-label is-actual" x="${fixed(x + 10)}" y="${fixed(actualLabelY)}">${formatCompact(barUnits)}</text>`;
    }

    if (guessIn > 0) {
      markup += `<g opacity="${guessIn}">`;
      markup += `<circle class="guess-marker" cx="${x}" cy="${fixed(markerY)}" r="4.5"/>`;
      if (guessOffChart !== 0 && guessIn >= 1) {
        const tip = guessY + guessOffChart * 12;
        const back = tip - guessOffChart * 5;
        markup += `<path class="guess-arrow" d="M${x - 4} ${fixed(back)}L${x} ${fixed(tip)}L${x + 4} ${fixed(back)}"/>`;
      }
      markup += `<text class="value-label is-guess" x="${fixed(x + 10)}" y="${fixed(guessLabelY)}">${formatCompact(guess)}</text>`;
      markup += '</g>';
    }

    this.revealLayer.innerHTML = markup;
    this.grid.style.opacity = String(1 - 0.7 * track);
  }

  // The y-range to show on reveal: big enough to include the guess and one
  // standard error, but never more than MAX_ZOOM_OUT times the original.
  revealRange(guessLevel, unitLevel) {
    const { min, max } = this.base;
    const range = max - min;
    const margin = range * 0.06;
    const low = Math.min(guessLevel, unitLevel);
    const high = Math.max(guessLevel, unitLevel);
    let below = low < min ? min - low + margin : 0;
    let above = high > max ? high - max + margin : 0;
    const allowed = range * (MAX_ZOOM_OUT - 1);
    if (below + above > allowed) {
      const shrink = allowed / (below + above);
      below *= shrink;
      above *= shrink;
    }
    return { min: min - below, max: max + above };
  }
}
