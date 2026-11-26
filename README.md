# Guess the t-stat

A small browser game. Each chart is the cumulative return of a simulated trading strategy, with no axis labels. Type your guess for the t-stat of its returns and press Enter.

**Play:** https://aidanduncan.me/guess-the-t-stat/

## How to play

- Look at the chart, type a number, and press **Enter**.
- The answer is revealed with a scale on the right edge that counts how far the line ended above zero in standard errors. That count is the t-stat.
- Press **Enter** again for the next round. Pressing Enter during the reveal skips to the end.
- The header shows the number of rounds, your average distance from the answer, and a dot for each recent round (green is close, red is far off). Stats are saved in your browser.

## How the charts work

For returns r₁ … rₙ with mean m and sample standard deviation s:

```
t = m / (s / √n) = (final cumulative return) / (s · √n)
```

So the t-stat is how high the line ends, measured in units of s·√n. That unit is how far luck alone typically carries a strategy whose true mean return is zero. Because of this, the chart's shape alone determines the answer, and no axis labels are needed.

Each round (`site/js/series.js`):

1. **Target t-stat:** Gamma(shape 1.6, scale 1.5) − 0.25, rounded to 2 decimals.
   - About 68% of values fall between 0.5 and 4, and about 15% above 4.
   - About 0.4% exceed 10. There is no upper cap.
   - About 3.6% are slightly negative (never below −0.25).
2. **Length:** 150 to 2,500 returns, drawn evenly on a log scale.
3. **Noise:** one of three models, each with zero correlation over time.
   - 40%: normal returns.
   - 30%: fat-tailed returns (Student-t with 3–6 degrees of freedom).
   - 30%: volatility clustering (GARCH(1,1)).
4. **Exact answer:** the noise is demeaned, then shifted by `t* · s / √n`. Adding a constant does not change the standard deviation, so the returns' t-stat equals the target exactly. The answer shown is computed from the returns themselves.

## Development

There is no build step and there are no dependencies. You need Node 22 or newer for the tests, and Python for the local server.

```
npm test      # unit tests (node:test)
npm start     # serves site/ at http://localhost:8000
```

Add `?seed=123` to the URL to replay the same sequence of rounds.

## Deployment

Every push to `main` runs the tests, then publishes `site/` to GitHub Pages (`.github/workflows/pages.yml`). A failing test stops the deploy.

## Credits

Fonts: [Inter](https://github.com/rsms/inter) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), both under the SIL Open Font License (see `site/fonts/OFL.txt`).
