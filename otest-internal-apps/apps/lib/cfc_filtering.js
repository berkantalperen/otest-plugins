// -----------------------------------------------------------------------------
// SAE J211 CFC filters (zero-phase forward+reverse IIR) — JavaScript version
// Public API:
//   cfcFilter(samples, fs, cfcClass) -> Float64Array
//   cfc60Filter(samples, fs)
//   cfc180Filter(samples, fs)
//   cfc600Filter(samples, fs)
//   cfc1000Filter(samples, fs)  // back-compat
//
// Notes:
// - Uses two cascaded biquad LPFs with Qs commonly used for CFC realizations.
// - Cutoff: fc ≈ 1.65 × CFC class (Hz). Warn if fs < 10×fc.
// -----------------------------------------------------------------------------

export function cfcFilter(samples, fs, cfcClass) {
  if (!Array.isArray(samples) && !(samples instanceof Float64Array)) {
    throw new Error('cfcFilter: samples must be an array or Float64Array');
  }
  if (!(fs > 0)) throw new Error('cfcFilter: invalid sampling rate');
  if (!(cfcClass > 0)) throw new Error('cfcFilter: cfcClass must be a positive number');

  // SAE J211 practice: fc ≈ 1.65 × CFC (Hz)
  const fc = 1.65 * cfcClass;

  // Heuristic guidance
  const fsMin = 10 * fc;
  if (fs < fsMin) {
    console.warn(`CFC${cfcClass} expects fs ≥ ${Math.round(fsMin)} Hz; results may not meet spec.`);
  }

  // Widely used Q pair for CFC
  const Qs = [0.5411961, 1.306563];
  const biquads = Qs.map(Q => designBiquadLPF(fc, fs, Q));

  const xArr = Array.from(samples);
  const pad = Math.max(2, Math.min(24, Math.floor(xArr.length / 10)));
  const x = reflectPad(xArr, pad);

  let y = x.slice();
  for (const bq of biquads) y = biquadForward(y, bq);

  y = y.reverse();
  for (const bq of biquads) y = biquadForward(y, bq);
  y = y.reverse();

  return new Float64Array(y.slice(pad, y.length - pad));
}

// ------------------- Convenience wrappers for common classes ------------------

export function cfc60Filter(samples, fs)  { return cfcFilter(samples, fs, 60); }
export function cfc180Filter(samples, fs) { return cfcFilter(samples, fs, 180); }
export function cfc600Filter(samples, fs) { return cfcFilter(samples, fs, 600); }

// Back-compat: original signature
export function cfc1000Filter(samples, fs) { return cfcFilter(samples, fs, 1000); }

/* ---------------------- internal helpers (no TS types) ---------------------- */
function designBiquadLPF(fc, fs, Q) {
  const w0 = 2 * Math.PI * (fc / fs);
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0
  };
}

function biquadForward(x, c) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const xn = x[n];
    const yn = c.b0 * xn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[n] = yn;
    x2 = x1; x1 = xn;
    y2 = y1; y1 = yn;
  }
  return Array.from(y);
}

function reflectPad(arr, n) {
  const a = Array.from(arr);
  const m = Math.min(n, a.length);
  const pre = a.slice(0, m).reverse();
  const post = a.slice(-m).reverse();
  return [...pre, ...a, ...post];
}
