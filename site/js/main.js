// Game flow: draw a chart, take a guess, reveal the answer, repeat.

import { createRng, randomInt32 } from './random.js';
import { makeRound } from './series.js';
import { parseGuess, applyRound, averageError, emptyStats, grade, format2 } from './scoring.js';
import { loadStats, saveStats, clearStats } from './storage.js';
import { Chart } from './chart.js';
import { tween, ease } from './anim.js';

const $ = (id) => document.getElementById(id);

const ui = {
  chart: $('chart'),
  panel: $('panel'),
  form: $('guess-form'),
  inputWrap: $('input-wrap'),
  input: $('guess'),
  hint: $('hint'),
  result: $('result'),
  answer: $('answer'),
  yourGuess: $('your-guess'),
  offBy: $('off-by'),
  grade: $('grade'),
  next: $('next'),
  rounds: $('rounds'),
  average: $('average'),
  dots: $('dots'),
  announcer: $('announcer'),
  reset: $('reset'),
};

// Game states:
//   leaving   - the previous chart is fading out
//   drawing   - the new chart is drawing in (a guess is already allowed)
//   guessing  - waiting for a guess
//   revealing - the answer is animating in (Enter skips to the end)
//   revealed  - the answer is shown (Enter starts the next round)
let state = 'leaving';
let round = null;
let stats = loadStats();
let averageAnimation = null;
let resetTimer = null;

const chart = new Chart(ui.chart);
const seeds = createRng(initialSeed());

// A fixed starting seed can be given as ?seed=123 to replay the same rounds.
function initialSeed() {
  const param = new URLSearchParams(window.location.search).get('seed');
  if (param !== null && /^\d{1,10}$/.test(param)) return Number(param) >>> 0;
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0];
}

// ---- Rounds ----

async function startRound() {
  state = 'leaving';
  showGuessPanel();
  await chart.exit();
  round = makeRound(randomInt32(seeds));
  state = 'drawing';
  await chart.draw(round);
  if (state === 'drawing') state = 'guessing';
}

function submitGuess(event) {
  event.preventDefault();
  if (state !== 'drawing' && state !== 'guessing') return;

  const guess = parseGuess(ui.input.value);
  if (guess === null) {
    rejectInput();
    return;
  }

  state = 'revealing';
  const previousAverage = averageError(stats);
  const result = applyRound(stats, round.t, guess);
  stats = result.stats;
  saveStats(stats);

  showResultPanel(guess, result);
  ui.announcer.textContent =
    `The t-stat was ${format2(round.t)}. Your guess was ${format2(guess)}, ` +
    `off by ${format2(result.error)}: ${result.grade.label}.`;

  const t = round.t;
  let scored = false;
  chart
    .reveal({
      guess,
      color: result.grade.color,
      onBar: (fraction) => {
        // The big number counts up with the ruler.
        ui.answer.textContent = format2(t * fraction);
        if (fraction >= 1 && !scored) {
          scored = true;
          showScore(previousAverage);
        }
      },
    })
    .then(() => {
      if (state === 'revealing') state = 'revealed';
    });
}

// Enter or the Next button: skip the reveal animation, or go to the next round.
function advance() {
  if (state === 'revealing') chart.finishReveal();
  else if (state === 'revealed') startRound();
}

// ---- Panels ----

function showGuessPanel() {
  ui.input.value = '';
  setHint('');
  ui.form.inert = false;
  ui.panel.classList.remove('is-result');
  ui.result.classList.remove('is-scored');
  ui.input.focus({ preventScroll: true });
  ui.result.inert = true;
}

function showResultPanel(guess, result) {
  ui.answer.textContent = format2(0);
  ui.yourGuess.textContent = format2(guess);
  ui.offBy.textContent = format2(result.error);
  ui.grade.textContent = result.grade.label;
  ui.grade.style.setProperty('--grade-color', result.grade.color);

  ui.result.inert = false;
  ui.panel.classList.add('is-result');
  ui.next.focus({ preventScroll: true });
  ui.form.inert = true;
}

function showScore(previousAverage) {
  ui.result.classList.add('is-scored');
  renderStats({ animate: true, previousAverage });
}

function setHint(text) {
  ui.hint.textContent = text;
}

function rejectInput() {
  const empty = ui.input.value.trim() === '';
  setHint(empty ? 'Type your guess first, like 2.4' : 'Enter a number, like 2.4');
  restartAnimation(ui.inputWrap, 'is-shaking');
  ui.input.focus();
}

// Re-adds a class so its CSS animation plays again from the start.
function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

// ---- Stats ----

function renderStats({ animate = false, previousAverage = null } = {}) {
  ui.rounds.textContent = String(stats.rounds);

  const average = averageError(stats);
  averageAnimation?.finish();
  averageAnimation = null;
  if (average === null) {
    ui.average.textContent = '—';
  } else if (animate && previousAverage !== null) {
    averageAnimation = tween(700, (p) => {
      const value = previousAverage + (average - previousAverage) * ease.outCubic(p);
      ui.average.textContent = format2(value);
    });
  } else {
    ui.average.textContent = format2(average);
  }

  if (animate) {
    restartAnimation(ui.rounds, 'is-bumped');
    restartAnimation(ui.average, 'is-bumped');
  }
  renderDots(animate);
}

function renderDots(animateNewest) {
  const last = stats.recent.length - 1;
  const items = stats.recent.map((entry, i) => {
    const entryGrade = grade(entry.error);
    const tip = `t ${format2(entry.t)} · you ${format2(entry.guess)}`;
    const item = document.createElement('li');
    item.className = animateNewest && i === last ? 'dot is-new' : 'dot';
    item.style.setProperty('--dot-color', entryGrade.color);
    item.dataset.tip = tip;
    item.setAttribute('aria-label', `${tip}, ${entryGrade.label}`);
    return item;
  });
  ui.dots.replaceChildren(...items);
}

function disarmReset() {
  clearTimeout(resetTimer);
  ui.reset.classList.remove('is-armed');
  ui.reset.textContent = 'Reset stats';
}

function handleReset() {
  if (!ui.reset.classList.contains('is-armed')) {
    ui.reset.classList.add('is-armed');
    ui.reset.textContent = 'Click again to reset';
    resetTimer = setTimeout(disarmReset, 3000);
    return;
  }
  disarmReset();
  stats = emptyStats();
  clearStats();
  renderStats();
  ui.announcer.textContent = 'Stats reset.';
}

// ---- Keyboard ----

function handleKeydown(event) {
  if (event.key === 'Enter') {
    // Holding Enter must not skip through results.
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    if (state === 'revealing' || state === 'revealed') {
      if (event.target instanceof Element && event.target.closest('.footer')) return;
      event.preventDefault();
      advance();
    }
    return;
  }

  // Typing a number anywhere puts it in the guess box.
  const typingNumber = event.key.length === 1 && /[0-9.,+\-]/.test(event.key);
  const canGuess = state === 'leaving' || state === 'drawing' || state === 'guessing';
  const modifier = event.ctrlKey || event.metaKey || event.altKey;
  if (typingNumber && canGuess && !modifier && document.activeElement !== ui.input) {
    ui.input.focus();
  }
}

// ---- Start ----

ui.form.addEventListener('submit', submitGuess);
ui.input.addEventListener('input', () => setHint(''));
ui.inputWrap.addEventListener('animationend', () => ui.inputWrap.classList.remove('is-shaking'));
ui.next.addEventListener('click', advance);
ui.reset.addEventListener('click', handleReset);
document.addEventListener('keydown', handleKeydown);

renderStats();
startRound();
