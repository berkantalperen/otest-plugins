// hic.js (ES module) — HIC-specific utilities built on math_utils

import {
  cumtrapz,
  integrateRange,
  clamp,        // use shared clamp
  lowerBound,   // for fast window end search
} from './math_utils.js';

/** HIC over [i0, i1] using trapezoid integral; returns NaN if invalid. */
export function hicOfRange(t, a, i0, i1, prefix /* optional */) {
  if (!t?.length || !a?.length || i1 <= i0) return NaN;
  const dT = t[i1] - t[i0];
  if (!(dT > 0)) return NaN;
  const area = integrateRange(t, a, i0, i1, prefix);
  const aBar = area / dT;
  return dT * Math.pow(aBar, 2.5);
}

/** Cumulative integral I = ∫ a dt (useful as prefix for hicFromPrefix) */
export const buildCumulativeIntegral = (t, a) => cumtrapz(t, a, 0);

/** HIC computed from prefix integral I (fast for loops). Returns NaN if invalid. */
export function hicFromPrefix(I, t, i0, i1) {
  if (i1 <= i0) return NaN;
  const dT = t[i1] - t[i0];
  if (!(dT > 0)) return NaN;
  const area = I[i1] - I[i0];
  const aBar = area / dT;
  return dT * Math.pow(aBar, 2.5);
}

/**
 * Exact max HIC constrained to max window (seconds), e.g., 0.015 or 0.036.
 * Returns { bestH, bestI0, bestI1 } or null.
 */
export function exactMaxHICWindow(t, a, maxWindowSec) {
  const n = t.length;
  if (n < 2) return null;
  const I = buildCumulativeIntegral(t, a);

  let bestH = -Infinity, bestI0 = -1, bestI1 = -1;

  for (let i0 = 0; i0 < n - 1; i0++) {
    // Use lowerBound to jump directly to the last index within the window
    const tMax = t[i0] + maxWindowSec;
    const j = lowerBound(t, tMax);   // first idx with t[idx] >= tMax
    const i1Max = Math.max(i0 + 1, Math.min(j - 1, n - 1)); // ensure at least one step

    for (let i1 = i0 + 1; i1 <= i1Max; i1++) {
      const H = hicFromPrefix(I, t, i0, i1);
      if (H > bestH) { bestH = H; bestI0 = i0; bestI1 = i1; }
    }
  }
  return (bestI0 >= 0) ? { bestH, bestI0, bestI1 } : null;
}

/**
 * Max HIC over all windows (coarse-to-fine when n is large).
 * Returns { bestH, bestI0, bestI1 } or null.
 */
export function coarseToFineMaxHICAll(t, a) {
  const n = t.length;
  if (n < 2) return null;
  const I = buildCumulativeIntegral(t, a);

  // Small n: exhaustive O(n^2)
  if (n < 4000) {
    let bestH = -Infinity, bestI0 = -1, bestI1 = -1;
    for (let i0 = 0; i0 < n - 1; i0++) {
      for (let i1 = i0 + 1; i1 < n; i1++) {
        const H = hicFromPrefix(I, t, i0, i1);
        if (H > bestH) { bestH = H; bestI0 = i0; bestI1 = i1; }
      }
    }
    return (bestI0 >= 0) ? { bestH, bestI0, bestI1 } : null;
  }

  // Large n: coarse sampling + local refinement
  const stride = Math.max(1, Math.floor(n / 2000));
  const K = 24; // keep top-K coarse candidates
  let heap = [];

  for (let i0 = 0; i0 < n - 1; i0 += stride) {
    for (let i1 = i0 + 1; i1 < n; i1 += stride) {
      const H = hicFromPrefix(I, t, i0, i1);
      if (!Number.isFinite(H)) continue;
      if (heap.length < K) {
        heap.push([H, i0, i1]);
        heap.sort((a, b) => a[0] - b[0]); // min-heap via sorted array
      } else if (H > heap[0][0]) {
        heap[0] = [H, i0, i1];
        heap.sort((a, b) => a[0] - b[0]);
      }
    }
  }

  if (heap.length === 0) return null;

  // Refine around coarse candidates
  let bestH = -Infinity, bestI0 = -1, bestI1 = -1;
  const rad = stride * 2;
  for (const [, ci0, ci1] of heap) {
    const i0min = clamp(ci0 - rad, 0, n - 2), i0max = clamp(ci0 + rad, 0, n - 2);
    const i1min = clamp(ci1 - rad, 1, n - 1), i1max = clamp(ci1 + rad, 1, n - 1);
    for (let i0 = i0min; i0 <= i0max; i0++) {
      const jmin = Math.max(i1min, i0 + 1);
      for (let i1 = jmin; i1 <= i1max; i1++) {
        const H = hicFromPrefix(I, t, i0, i1);
        if (H > bestH) { bestH = H; bestI0 = i0; bestI1 = i1; }
      }
    }
  }
  return (bestI0 >= 0) ? { bestH, bestI0, bestI1 } : null;
}

/**
 * Common helper: suggest best HIC interval.
 *  - If `{ windowMs: number }` is given and > 0 → constrained exact search
 *  - Else → unconstrained (coarse-to-fine) search
 * Returns `{ i0, i1, hic }` or `null` if not found.
 */
export function suggestBestHICInterval(t, a, { windowMs = null } = {}) {
  if (!Array.isArray(t) || !Array.isArray(a) || t.length < 2 || a.length < 2 || t.length !== a.length) {
    return null;
  }
  const res = (Number.isFinite(windowMs) && windowMs > 0)
    ? exactMaxHICWindow(t, a, windowMs * 1e-3)
    : coarseToFineMaxHICAll(t, a);

  if (!res) return null;
  const { bestH, bestI0, bestI1 } = res;
  return { i0: bestI0, i1: bestI1, hic: bestH };
}
