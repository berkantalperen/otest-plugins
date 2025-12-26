// math_utils.js  (ES module)

/** Physical constants */
export const G_CONST = 9.80665; // 1 g = 9.80665 m/s^2

/** Clamp a number into [lo, hi] */
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* -------------------------------------------------------------------------- */
/*                               Core tiny utils                              */
/* -------------------------------------------------------------------------- */

/** Finite number check */
const isNum = (v) => Number.isFinite(v);

/** Safe round to fixed decimals without string churn */
export const roundN = (x, n = 12) => {
  const k = 10 ** n;
  return Math.round(x * k) / k;
};

/* -------------------------------------------------------------------------- */
/*                           Generic reduction helpers                        */
/* -------------------------------------------------------------------------- */

/** Min/Max of a single array (ignores non-finite) */
export function minMax(arr) {
  if (!arr?.length) return { min: 0, max: 0 };
  let min = +Infinity, max = -Infinity;
  for (const v of arr) {
    if (!isNum(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isNum(min) || !isNum(max)) return { min: 0, max: 0 };
  return { min, max };
}

/** Min/Max across multiple arrays */
export function minMaxMany(arrs) {
  let min = +Infinity, max = -Infinity;
  for (const a of arrs) {
    const mm = minMax(a);
    if (mm.min < min) min = mm.min;
    if (mm.max > max) max = mm.max;
  }
  if (!isNum(min) || !isNum(max)) return { min: 0, max: 0 };
  return { min, max };
}

/** RMS of an array (ignores non-finite) */
export function rms(arr) {
  if (!arr?.length) return 0;
  let s2 = 0, n = 0;
  for (const v of arr) if (isNum(v)) { s2 += v * v; n++; }
  return n ? Math.sqrt(s2 / n) : 0;
}

/* -------------------------------------------------------------------------- */
/*                             Array & search utils                           */
/* -------------------------------------------------------------------------- */

/** Locale-friendly numeric parse (handles comma and thin spaces) */
export function parseNumber(s) {
  if (s == null) return NaN;
  const t = String(s)
    .trim()
    .replace(/\s*[ \u00A0]\s*/g, '') // remove spaces / nbsp within numbers
    .replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/** Uniform time grid [0, (n-1)*dt] */
export const timeArray = (n, dt) => Array.from({ length: n }, (_, i) => i * dt);

/** Lower bound: first index i with arr[i] >= x. Returns arr.length if none. */
export function lowerBound(arr, x) {
  let lo = 0, hi = arr.length; // hi exclusive
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] >= x) hi = m;
    else lo = m + 1;
  }
  return lo; // in [0..arr.length]
}

/* -------------------------------------------------------------------------- */
/*                              Plotting helpers                              */
/* -------------------------------------------------------------------------- */

/** Min/Max across arrays with small padding for plotting */
export function calcYMinMax(arrs, padFrac = 0.05, fallbackPad = 1) {
  const { min, max } = minMaxMany(arrs);
  const span = max - min;
  const pad = (span > 0 ? span * padFrac : 0) || fallbackPad;
  return { min: min - pad, max: max + pad };
}

/* -------------------------------------------------------------------------- */
/*                           Vector / signal helpers                          */
/* -------------------------------------------------------------------------- */

/** Vector resultant: hypot of 2D or 3D components */
export function resultant(ax, ay, az = []) {
  const n = Math.min(ax.length, ay.length, az.length || ax.length);
  const r = new Array(n);
  for (let i = 0; i < n; i++) r[i] = Math.hypot(ax[i], ay[i], az[i] ?? 0);
  return r;
}

/** Throw if t is not strictly increasing */
export function assertStrictlyIncreasing(t) {
  for (let i = 1; i < t.length; i++) {
    if (!(t[i] > t[i - 1])) {
      throw new Error('Zamanlar sıkı artan olmalı (t0 < t1 < ... < tn).');
    }
  }
}

/**
 * Resample a (times, values) keyframe signal on a uniform grid with step dt.
 * shape: 'linear' | 'step'
 */
export function resample(times, values, dt, shape = 'linear') {
  if (times.length !== values.length) {
    throw new Error('Zaman ve ivme dizilerinin uzunluğu eşit olmalı.');
  }
  if (times.length < 2) {
    throw new Error('En az iki nokta gerekli (t0..tN, a0..aN).');
  }
  assertStrictlyIncreasing(times);
  if (!(dt > 0)) throw new Error('Δt pozitif olmalı.');

  const t0 = times[0], tEnd = times[times.length - 1];
  const t = [];
  for (let x = t0, EPS = 1e-12; x < tEnd - EPS; x += dt) t.push(roundN(x, 12));
  t.push(roundN(tEnd, 12));

  const y = new Array(t.length);
  let j = 0;
  for (let k = 0; k < t.length; k++) {
    const tk = t[k];
    while (j + 1 < times.length && tk >= times[j + 1]) j++;
    if (shape === 'linear') {
      if (j === times.length - 1) y[k] = values[j];
      else {
        const t0 = times[j], t1 = times[j + 1];
        const v0 = values[j], v1 = values[j + 1];
        const frac = (tk - t0) / (t1 - t0);
        y[k] = v0 + (v1 - v0) * frac;
      }
    } else {
      y[k] = values[j]; // step hold
    }
  }
  return { t, y };
}

/** Convert acceleration array to display/output units */
export function toAccelUnits(a_in_g, unit /* 'g' | 'mps2' */) {
  return unit === 'g' ? a_in_g : a_in_g.map(v => v * G_CONST);
}

/* -------------------------------------------------------------------------- */
/*                                 Integration                                */
/* -------------------------------------------------------------------------- */

/**
 * Generalized trapezoid integrator.
 *  - mode 'cumulative' → returns prefix array F where F[i] = y0 + ∫[t0→ti] y dτ
 *  - mode 'segment'    → returns scalar ∫[t[i0]→t[i1]] y dτ (uses prefix if provided)
 */
export function trapz(
  t, y,
  { mode = 'cumulative', y0 = 0, i0 = null, i1 = null, prefix = null } = {}
) {
  if (!Array.isArray(t) || !Array.isArray(y) || t.length !== y.length || t.length < 2) {
    throw new Error('trapz: t ve y uzunlukça eşit ve ≥2 olmalı.');
  }
  assertStrictlyIncreasing(t);

  if (mode === 'cumulative') {
    const F = new Array(y.length);
    F[0] = y0;
    for (let i = 1; i < y.length; i++) {
      const h = t[i] - t[i - 1];
      F[i] = F[i - 1] + 0.5 * (y[i] + y[i - 1]) * h;
    }
    return F;
  }

  if (mode === 'segment') {
    if (i0 == null || i1 == null || i1 <= i0) return 0;
    if (prefix) return prefix[i1] - prefix[i0];
    let s = 0;
    for (let i = i0 + 1; i <= i1; i++) {
      const h = t[i] - t[i - 1];
      s += 0.5 * (y[i] + y[i - 1]) * h;
    }
    return s;
  }

  throw new Error("trapz: mode 'cumulative' veya 'segment' olmalı.");
}

export const cumtrapz = (t, y, y0 = 0) => trapz(t, y, { mode: 'cumulative', y0 });
export const integrateRange = (t, y, i0, i1, prefix) =>
  trapz(t, y, { mode: 'segment', i0, i1, prefix });

/* -------------------------------------------------------------------------- */
/*                           Extrema & summaries                              */
/* -------------------------------------------------------------------------- */

/**
 * Find extreme (max or min) value with optional predicate.
 * Returns { idx, value, t } where t is from the optional time array.
 */
export function extreme(arr, { type = 'max', where = null, t = null } = {}) {
  if (!arr?.length) return null;
  let idx = -1, val = (type === 'min') ? +Infinity : -Infinity;

  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!isNum(v)) continue;
    if (where && !where(v, i)) continue;

    if (type === 'min' ? v < val : v > val) {
      val = v; idx = i;
    }
  }
  if (idx < 0) return null;
  return { idx, value: val, t: t ? t[idx] : null };
}

/**
 * One-call summary: max/min with indices & times, plus RMS.
 * Returns { idxMax, valueMax, tMax, idxMin, valueMin, tMin, rms }
 */
export function seriesSummary(arr, t = null) {
  if (!arr?.length) {
    return { idxMax: -1, valueMax: 0, tMax: null, idxMin: -1, valueMin: 0, tMin: null, rms: 0 };
  }
  const exMax = extreme(arr, { type: 'max', t });
  const exMin = extreme(arr, { type: 'min', t });
  return {
    idxMax: exMax?.idx ?? -1, valueMax: exMax?.value ?? 0, tMax: exMax?.t ?? null,
    idxMin: exMin?.idx ?? -1, valueMin: exMin?.value ?? 0, tMin: exMin?.t ?? null,
    rms: rms(arr),
  };
}

/** Min/Max in a closed index range [i0, i1] */
export function sliceMinMax(arr, i0, i1) {
  if (!arr?.length || i0 == null || i1 == null || i1 < i0) return { min: 0, max: 0 };
  return minMax(arr.slice(i0, i1 + 1));
}
