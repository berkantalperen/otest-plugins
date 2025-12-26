// .lib/charts.js
import Chart from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/auto/+esm';
import zoomPlugin from 'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/+esm';
import { getRelativePosition } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/helpers/+esm';

if (zoomPlugin) Chart.register(zoomPlugin);

/* ---------- constants & utils ---------- */
const GRID_COLOR = '#202a47';
const ACCENT = 'rgba(99,102,241,0.95)';
const ACCENT_FILL = 'rgba(99,102,241,0.18)';

function getXDomain(chart) {
  const labels = chart?.data?.labels;
  if (Array.isArray(labels) && labels.length) return { values: labels, mode: 'labels' };
  const ds = chart?.data?.datasets?.[0]?.data;
  if (Array.isArray(ds) && ds.length && typeof ds[0] === 'object' && ('x' in ds[0])) {
    return { values: ds.map(p => p.x), mode: 'values' };
  }
  return { values: [], mode: 'labels' };
}

function pixelForIndex(xScale, chart, idx, N) {
  const { values, mode } = getXDomain(chart);
  if (mode === 'labels') {
    const px = xScale.getPixelForValue(undefined, idx);
    if (Number.isFinite(px)) return px;
  } else if (mode === 'values') {
    const px = xScale.getPixelForValue(values[idx]);
    if (Number.isFinite(px)) return px;
  }
  const count = Number.isFinite(N) ? N : (values?.length ?? 0);
  const dec = (count <= 1) ? 0 : (idx / (count - 1));
  return xScale.getPixelForDecimal(Math.min(1, Math.max(0, dec)));
}

function computeXMinMaxFromDatasets(datasets, xType) {
  if (xType === 'category') {
    const N = datasets?.[0]?.data?.length ?? 0;
    return { xMin: 0, xMax: Math.max(0, N - 1) };
  }
  let xMin = +Infinity, xMax = -Infinity;
  for (const d of (datasets || [])) {
    for (const p of (d.data || [])) {
      const x = typeof p === 'object' ? p.x : p;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return { xMin: 0, xMax: 1 };
  if (xMax === xMin) xMax = xMin + 1;
  return { xMin, xMax };
}

function applyZoomLimits(inst, { lockZoomToData, xType }, datasets) {
  if (!lockZoomToData) return;
  const { xMin, xMax } = computeXMinMaxFromDatasets(datasets, xType || 'linear');
  const minRange = (xMax - xMin) / 1000 || 0.001;
  inst.options.plugins.zoom.limits = {
    ...(inst.options.plugins.zoom.limits || {}),
    x: { min: xMin, max: xMax, minRange }
  };
}

/* ---------- selection overlay plugins ---------- */
const RangeBandPlugin = {
  id: 'dtxRangeBand',
  beforeDatasetsDraw(chart) {
    const sel = chart.$dtxSel; if (!sel) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales?.x; if (!xScale) return;
    const N = getXDomain(chart).values.length; if (!N) return;

    const ok0 = Number.isInteger(sel.i0) && sel.i0 >= 0 && sel.i0 < N;
    const ok1 = Number.isInteger(sel.i1) && sel.i1 >= 0 && sel.i1 < N;
    if (!(ok0 && ok1)) return;

    const x0 = pixelForIndex(xScale, chart, sel.i0, N);
    const x1 = pixelForIndex(xScale, chart, sel.i1, N);
    const left = Math.min(x0, x1), width = Math.abs(x1 - x0);

    ctx.save();
    ctx.fillStyle = ACCENT_FILL;
    ctx.fillRect(left, chartArea.top, width, chartArea.bottom - chartArea.top);
    ctx.restore();
  }
};

const RangeCursorsPlugin = {
  id: 'dtxRangeCursors',
  afterDatasetsDraw(chart) {
    const sel = chart.$dtxSel; if (!sel) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales?.x; if (!xScale) return;
    const N = getXDomain(chart).values.length; if (!N) return;

    const ok0 = Number.isInteger(sel.i0) && sel.i0 >= 0 && sel.i0 < N;
    const ok1 = Number.isInteger(sel.i1) && sel.i1 >= 0 && sel.i1 < N;
    if (!ok0 && !ok1) return;

    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;

    if (ok0 && !ok1) {
      const x = pixelForIndex(xScale, chart, sel.i0, N);
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
    } else if (ok0 && ok1) {
      const x0 = pixelForIndex(xScale, chart, sel.i0, N);
      const x1 = pixelForIndex(xScale, chart, sel.i1, N);
      ctx.beginPath();
      ctx.moveTo(x0, chartArea.top); ctx.lineTo(x0, chartArea.bottom);
      ctx.moveTo(x1, chartArea.top); ctx.lineTo(x1, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  }
};

Chart.register(RangeBandPlugin, RangeCursorsPlugin);

/* ---------- public api ---------- */
/**
 * Upsert a multi-series XY line chart (no pan; wheel/pinch zoom on X).
 * datasets: [{ label, data:[{x,y}], borderColor?, borderWidth?, pointRadius? }, ...]
 * opts: {
 *   xType='linear', xLabel='Time', yLabel='Value', yMin, yMax,
 *   gridColor='#202a47',
 *   lockZoomToData=false,
 *   animation,
 *   // NEW (optional):
 *   interactionMode='nearest' | 'index' | ...,
 *   interactionAxis='x' | 'y' | 'xy',
 *   tooltip: Chart.js tooltip options (overrides defaults)
 * }
 */
export function upsertXYChart(canvasOrId, datasets, opts = {}) {
  const el = (typeof canvasOrId === 'string') ? document.getElementById(canvasOrId) : canvasOrId;
  if (!el) throw new Error('Canvas not found');

  const xType = opts.xType || 'linear';
  const gridColor = opts.gridColor || GRID_COLOR;

  const ds = (datasets || []).map(d => ({
    pointRadius: 0,
    borderWidth: 2,
    parsing: false,
    normalized: true,
    ...d
  }));
  const N = ds[0]?.data?.length ?? 0;

  // Resolve animation
  const resolvedAnimation =
    (opts.animation !== undefined)
      ? (opts.animation === true ? { duration: 200 } : opts.animation)
      : (N > 5000 ? false : { duration: 120 });

  const resolvedInteraction = {
    mode: opts.interactionMode ?? 'nearest',
    intersect: false,
    ...(opts.interactionAxis ? { axis: opts.interactionAxis } : {})
  };

  let inst = Chart.getChart(el);
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: resolvedInteraction,
    animation: resolvedAnimation,
    plugins: {
      decimation: N > 2000 ? { enabled: true, algorithm: 'lttb', samples: 1000 } : { enabled: false },
      zoom: { zoom: { mode: 'x', wheel: { enabled: true }, pinch: { enabled: true } }, limits: {} },
      tooltip: {
        enabled: true,
        mode: resolvedInteraction.mode,
        intersect: false,
        callbacks: {
          // reasonable defaults; can be overridden via opts.tooltip
          label(ctx) {
            const y = ctx.parsed?.y;
            return `${ctx.dataset?.label ?? 'series'}: ${Number(y).toFixed(3)}`;
          }
        },
        ...opts.tooltip
      }
    },
    scales: {
      x: { type: xType, title: { display: true, text: opts.xLabel ?? 'Time' }, grid: { color: gridColor } },
      y: {
        title: { display: true, text: opts.yLabel ?? 'Value' },
        ...(Number.isFinite(opts.yMin) ? { min: opts.yMin } : {}),
        ...(Number.isFinite(opts.yMax) ? { max: opts.yMax } : {}),
        grid: { color: gridColor }
      }
    },
    elements: { line: { tension: 0 } }
  };

  if (!inst) {
    inst = new Chart(el, { type: 'line', data: { datasets: ds }, options });
    applyZoomLimits(inst, { lockZoomToData: !!opts.lockZoomToData, xType }, ds);
  } else {
    inst.data.datasets = ds;
    inst.options.scales.x.type = xType;
    inst.options.scales.x.title.text = opts.xLabel ?? 'Time';
    inst.options.scales.x.grid.color = gridColor;
    inst.options.scales.y.title.text = opts.yLabel ?? 'Value';
    if (Number.isFinite(opts.yMin)) inst.options.scales.y.min = opts.yMin; else delete inst.options.scales.y.min;
    if (Number.isFinite(opts.yMax)) inst.options.scales.y.max = opts.yMax; else delete inst.options.scales.y.max;
    inst.options.scales.y.grid.color = gridColor;
    inst.options.animation = resolvedAnimation;
    inst.options.interaction = resolvedInteraction;
    // merge tooltip, respecting overrides
    inst.options.plugins.tooltip = {
      enabled: true,
      mode: resolvedInteraction.mode,
      intersect: false,
      callbacks: {
        label(ctx) {
          const y = ctx.parsed?.y;
          return `${ctx.dataset?.label ?? 'series'}: ${Number(y).toFixed(3)}`;
        }
      },
      ...opts.tooltip
    };
    applyZoomLimits(inst, { lockZoomToData: !!opts.lockZoomToData, xType }, ds);
    inst.update(opts.animation === false ? 'none' : undefined);
  }
  return inst;
}

/** Double-click to reset zoom; never leave a selection behind. */
export function enableDblClickZoomReset(root = document) {
  root.querySelectorAll('canvas').forEach(cv => {
    if (cv.__zoomResetBound) return;
    const ch = Chart.getChart(cv); if (!ch) return;
    cv.__zoomResetBound = true;
    cv.addEventListener('dblclick', () => {
      const chart = Chart.getChart(cv);
      if (chart) {
        chart.$dtxSel = { i0: null, i1: null };
        chart.update('none');
        chart.resetZoom?.();
      }
    }, { passive: true, capture: true });
  });
}

/* ---------- selection manager ---------- */
function nearestIndex(chart, evt) {
  // keep selection logic “x-only” already
  const els = chart.getElementsAtEventForMode(evt, 'nearest', { axis: 'x', intersect: false }, true);
  if (els && els.length) return els[0].index;
  const pos = getRelativePosition(evt, chart);
  const xScale = chart.scales?.x;
  const N = getXDomain(chart).values.length;
  const dec = xScale?.getDecimalForPixel ? xScale.getDecimalForPixel(pos.x) : 0;
  return Math.max(0, Math.min(Math.round(dec * (Math.max(0, N - 1))), Math.max(0, N - 1)));
}

export class SelectionManager {
  constructor(onChange = () => { }) {
    this.i0 = null;
    this.i1 = null;
    this._charts = new Set();
    this._onChange = onChange;
    this._handlers = new Map(); // canvas -> {click,dbl}
  }

  bindChart(chart) {
    if (!chart || this._charts.has(chart)) return;
    this._charts.add(chart);
    chart.$dtxSel = chart.$dtxSel || { i0: null, i1: null };

    const canvas = chart.canvas;
    if (!this._handlers.has(canvas)) {
      const clickHandler = (evt) => {
        const { chartArea } = chart;
        const pos = getRelativePosition(evt, chart);

        if (
          pos.x < chartArea.left ||
          pos.x > chartArea.right ||
          pos.y < chartArea.top ||
          pos.y > chartArea.bottom
        ) {
          return; // outside plot
        }

        if (evt.detail >= 2) { this.clear(); return; } // ignore double clicks
        const idx = nearestIndex(chart, evt);
        const N = getXDomain(chart).values.length;
        const k = Math.max(0, Math.min(idx, Math.max(0, N - 1)));
        if (this.i0 === null) { this.i0 = k; this.i1 = null; this._apply('start'); }
        else if (this.i1 === null) { this.setRange(this.i0, k); }
        else { this.clear(); }
      };
      const dblHandler = () => this.clear(); // ensure no selection after dblclick
      canvas.addEventListener('click', clickHandler, { passive: true });
      canvas.addEventListener('dblclick', dblHandler, { passive: true, capture: true });
      this._handlers.set(canvas, { clickHandler, dblHandler });
    }
  }

  unbindChart(chart) {
    if (!chart || !this._charts.has(chart)) return;
    this._charts.delete(chart);
    const canvas = chart.canvas;
    const h = this._handlers.get(canvas);
    if (h) {
      canvas.removeEventListener('click', h.clickHandler);
      canvas.removeEventListener('dblclick', h.dblHandler, { capture: true });
      this._handlers.delete(canvas);
    }
  }

  destroy() { for (const ch of [...this._charts]) this.unbindChart(ch); this.clear(); }

  setRange(a, b) {
    const xs = this._xValues(); if (!xs.length) return;
    this.i0 = Math.max(0, Math.min(a, b));
    this.i1 = Math.min(xs.length - 1, Math.max(a, b));
    this._apply('range');
  }

  clear() { this.i0 = this.i1 = null; this._apply('clear'); }

  getRange() {
    const xs = this._xValues();
    const val = (i) => (i != null && i >= 0 && i < xs.length) ? xs[i] : null;
    return { i0: this.i0, i1: this.i1, t0: val(this.i0), t1: val(this.i1) };
  }

  _xValues() { const first = [...this._charts][0]; return getXDomain(first).values; }

  _apply(phase) {
    for (const ch of this._charts) {
      const N = getXDomain(ch).values.length;
      const i0 = (Number.isInteger(this.i0) && this.i0 >= 0 && this.i0 < N) ? this.i0 : null;
      const i1 = (Number.isInteger(this.i1) && this.i1 >= 0 && this.i1 < N) ? this.i1 : null;
      ch.$dtxSel = { i0, i1 };
      ch.update('none');
    }
    this._onChange({ ...this.getRange(), phase });
  }
}

/* ---------- PNG export ---------- */
export function pngFromChart(chart, name, { pixelRatio, backgroundColor } = {}) {
  if (!chart) { alert('Önce grafikleri oluşturun.'); return; }
  const restore = {};
  let url;
  try {
    if (pixelRatio && Number.isFinite(pixelRatio) && pixelRatio > 0) {
      restore.devicePixelRatio = chart.options.devicePixelRatio;
      chart.options.devicePixelRatio = pixelRatio;
      chart.update('none');
    }
    const src = chart.canvas;
    const tmp = document.createElement('canvas');
    tmp.width = src.width; tmp.height = src.height;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(src, 0, 0);
    if (backgroundColor) {
      tctx.globalCompositeOperation = 'destination-over';
      tctx.fillStyle = backgroundColor;
      tctx.fillRect(0, 0, tmp.width, tmp.height);
      tctx.globalCompositeOperation = 'source-over';
    }
    url = tmp.toDataURL('image/png', 1);
  } finally {
    if ('devicePixelRatio' in restore) {
      chart.options.devicePixelRatio = restore.devicePixelRatio;
      chart.update('none');
    }
  }
  const a = document.createElement('a');
  a.href = url; a.download = name || 'chart.png';
  document.body.appendChild(a); a.click(); a.remove();
}
