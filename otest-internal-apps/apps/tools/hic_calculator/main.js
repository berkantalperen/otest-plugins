// main.js

// Import CFC filters directly (as requested)
import {
  cfcFilter,
  cfc60Filter,
  cfc180Filter,
  cfc600Filter,
  cfc1000Filter
} from '../../lib/cfc_filtering.js';

// Local libs
import { upsertXYChart, enableDblClickZoomReset, SelectionManager } from '../../lib/charts.js';
import {
  G_CONST,
  clamp, lowerBound, timeArray, calcYMinMax,
  resultant
} from '../../lib/math_utils.js';
import {
  hicOfRange,
  suggestBestHICInterval
} from '../../lib/hic.js';

// 🆕 Parser (extracted)
import { parseFile, parseNumber, FORMATS, detectFormat } from '../../lib/sensor_data_parser.js';

let chart;
let selIdx1 = null, selIdx2 = null;
const selMgr = new SelectionManager(onSelectionChange);

const $ = (s) => document.querySelector(s);
const fileInput = $('#fileInput');
const fileList  = $('#fileList');
const filterSelect = $('#filterOption');

const COLORS = ['#60a5fa', '#34d399', '#f472b6']; // X, Y, Z
const RESULTANT_COLOR = '#ef4444';

/* ---------- chart ---------- */
function mkChart(t_sec, ysList, labels, r) {
  const t_ms = t_sec.map(v => v * 1000);
  window.__t_ms = t_ms;

  const { min: yMin, max: yMax } = calcYMinMax([...ysList, r]);

  const compDatasets = ysList.map((ys, i) => ({
    label: labels[i],
    data: t_ms.map((x, k) => ({ x, y: ys[k] })),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: COLORS[i % COLORS.length],
    borderWidth: 1.5,
    pointRadius: 0,
    order: 1
  }));

  const resDataset = {
    label: 'Resultant |a|',
    data: t_ms.map((x, k) => ({ x, y: r[k] })),
    borderColor: RESULTANT_COLOR,
    backgroundColor: RESULTANT_COLOR,
    borderWidth: 3,
    pointRadius: 0,
    order: 99
  };

  chart = upsertXYChart('chart', [...compDatasets, resDataset], {
    xType: 'linear',
    xLabel: 'Zaman (ms)',
    yLabel: 'Değer (g)',
    yMin, yMax,
    gridColor: '#202a47',
    lockZoomToData: true,
    animation: false,
    interactionMode: 'index',
    interactionAxis: 'x',
    tooltip: {
      mode: 'index',
      intersect: false,
      displayColors: true,
      callbacks: {
        title(items) {
          if (!items?.length) return '';
          const x = items[0].parsed.x;
          return `t = ${Number(x).toFixed(3)} ms`;
        },
        label(ctx) {
          const y = ctx.parsed?.y;
          return `${ctx.dataset?.label ?? 'series'}: ${Number(y).toFixed(3)}`;
        }
      }
    }
  });

  selMgr.bindChart(chart);
  enableDblClickZoomReset(document);
}

/* ---------- selection (from SelectionManager) ---------- */
function onSelectionChange({ i0, i1, t0, t1, phase }) {
  selIdx1 = Number.isInteger(i0) ? i0 : null;
  selIdx2 = Number.isInteger(i1) ? i1 : null;

  const s = $('#selStartMs'), e = $('#selEndMs'), box = $('#selStats');
  const to3 = (v) => (Number.isFinite(v) ? Number(v).toFixed(3) : '');

  if (phase === 'start') {
    if (s) s.value = to3(t0);
    if (e) e.value = '';
    if (box) box.innerHTML = `<div class="badge">Başlangıç: t=${to3(t0)} ms</div>`;
  } else if (phase === 'range') {
    if (s) s.value = to3(t0);
    if (e) e.value = to3(t1);
    updateSelectionStats();
  } else if (phase === 'clear') {
    if (s) s.value = '';
    if (e) e.value = '';
    if (box) box.innerHTML = '';
  }
}

function setSelection(i0, i1) {
  const len = (window.__t_ms || []).length;
  const a = clamp(Math.min(i0, i1), 0, len - 1);
  const b = clamp(Math.max(i0, i1), 0, len - 1);
  selMgr.setRange(a, b);
}
function clearSelection() { selMgr.clear(); }

/* ---------- metadata table (non-math) ---------- */
function unionKeys(parsed) {
  const order = []; const seen = new Set();
  const prefer = [
    'Number of samples',
    'Sampling interval',
    'Sampling rate',
    'Name of the channel+ Direction',
    'Name of the channel'
  ];
  for (const p of parsed) for (const [k] of p.metaPairs) if (!seen.has(k)) { seen.add(k); order.push(k); }
  for (let i = prefer.length - 1; i >= 0; i--) {
    const k = prefer[i]; const idx = order.indexOf(k);
    if (idx > 0) { order.splice(idx, 1); order.unshift(k); }
  }
  return order;
}
function renderMetaTable(parsed) {
  $('#col1').textContent = parsed[0].name;
  $('#col2').textContent = parsed[1].name;
  $('#col3').textContent = parsed[2].name;
  const tbody = $('#metaBody'); tbody.innerHTML = '';
  const keys = unionKeys(parsed);
  const val = (p, k) => (k in p.metaObj) ? p.metaObj[k] : '';

  const eqCheck = new Set(['Number of samples', 'Sampling interval', 'Sampling rate']);

  for (const k of keys) {
    const v1 = val(parsed[0], k), v2 = val(parsed[1], k), v3 = val(parsed[2], k);
    const mismatch = (eqCheck.has(k) && !(v1 === v2 && v2 === v3));
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${k}</td><td class="${mismatch ? 'bad' : ''}">${v1}</td><td class="${mismatch ? 'bad' : ''}">${v2}</td><td class="${mismatch ? 'bad' : ''}">${v3}</td>`;
    tbody.appendChild(tr);
  }
}

/* ---------- main ---------- */
async function loadAndPlot() {
  try {
    clearSelection();
    const files = Array.from(fileInput.files || []);
    if (files.length !== 3) throw new Error('Lütfen tam olarak 3 dosya seçin.');
    fileList.innerHTML = files.map(f => `<span class="pill">${f.name}</span>`).join('');

    // Auto-detect format per file (you can force one via parseFile(file, { format: 'slashHeader' }))
    const parsed = await Promise.all(files.map(f => parseFile(f)));

    renderMetaTable(parsed);

    const ns = parsed.map(p => parseInt(parseNumber(p.metaObj['Number of samples'])));
    const dt = parsed.map(p => parseNumber(p.metaObj['Sampling interval']));

    if (ns.some(n => !Number.isFinite(n)) || dt.some(x => !Number.isFinite(x))) {
      renderMetaTable(parsed);
      throw new Error('Üstbilgilerde “Number of samples” veya “Sampling interval / Sampling rate” eksik/geçersiz.');
    }
    if (!ns.every(n => n === ns[0]) || !dt.every(x => Math.abs(x - dt[0]) < 1e-15)) {
      renderMetaTable(parsed);
      throw new Error('Dosyaların “Number of samples” ve/veya “Sampling interval / Sampling rate” değerleri eşleşmiyor (tabloya bakın).');
    }

    const Nfull = ns[0], DT = dt[0];
    const FS = 1 / DT;
    const tFull = timeArray(Nfull, DT);

    // trims
    const trimStart_ms = Number($('#trimMs').value);
    const trimEnd_ms = Number($('#trimEndMs').value);
    const trimStart_s = Number.isFinite(trimStart_ms) ? Math.max(0, trimStart_ms * 1e-3) : 0;
    const trimEnd_s = Number.isFinite(trimEnd_ms) ? Math.max(0, trimEnd_ms * 1e-3) : 0;

    const totalDuration = (tFull[tFull.length - 1] ?? 0) - (tFull[0] ?? 0);
    if (trimStart_s + trimEnd_s >= totalDuration) {
      throw new Error(`Kesme değerleri çok büyük: başlangıç (${trimStart_ms} ms) + son (${trimEnd_ms} ms) ≥ toplam süre ${(totalDuration * 1000).toFixed(3)} ms.`);
    }

    const iStart = lowerBound(tFull, trimStart_s);
    const endLimit = (tFull[tFull.length - 1] ?? 0) - trimEnd_s;

    // ✅ Use new lowerBound semantics: take the last index with t <= endLimit
    let iEnd = lowerBound(tFull, endLimit) - 1;
    iEnd = clamp(iEnd, iStart, tFull.length - 1);

    const tShift = tFull[iStart] ?? 0;
    const t = tFull.slice(iStart, iEnd + 1).map(v => (v - tShift)); // full precision

    // Build Y arrays; convert to g when parser says the values are m/s^2
    const rawY = parsed.map((p) => {
      if (p.values.length < Nfull) throw new Error(`${p.name}: Veri satırı sayısı ${p.values.length}, beklenen ${Nfull}.`);
      const segment = p.values.slice(iStart, iEnd + 1);
      if (p.valuesUnit === 'mps2') {
        for (let i = 0; i < segment.length; i++) segment[i] = segment[i] / G_CONST;
      }
      return segment;
    });

    // Apply selected filter (or none)
    const sel = (filterSelect?.value || 'cfc1000').toLowerCase();
    const filterLabel = (() => {
      switch (sel) {
        case 'none': return 'Unfiltered';
        case 'cfc60': return 'CFC60';
        case 'cfc180': return 'CFC180';
        case 'cfc600': return 'CFC600';
        case 'cfc1000': return 'CFC1000';
        default: return 'CFC1000';
      }
    })();

    let compY;
    if (sel === 'none') {
      compY = rawY.map(arr => Array.from(arr));
    } else if (sel === 'cfc60') {
      compY = rawY.map(arr => Array.from(cfc60Filter(arr, FS)));
    } else if (sel === 'cfc180') {
      compY = rawY.map(arr => Array.from(cfc180Filter(arr, FS)));
    } else if (sel === 'cfc600') {
      compY = rawY.map(arr => Array.from(cfc600Filter(arr, FS)));
    } else if (sel === 'cfc1000') {
      compY = rawY.map(arr => Array.from(cfc1000Filter(arr, FS)));
    } else {
      const m = sel.match(/^cfc(\d{2,4})$/);
      if (m) {
        const cfcClass = Number(m[1]);
        compY = rawY.map(arr => Array.from(cfcFilter(arr, FS, cfcClass)));
      } else {
        compY = rawY.map(arr => Array.from(cfc1000Filter(arr, FS)));
      }
    }

    const [y1, y2, y3] = compY;

    const chanLabel = (p) => {
      if (p.format === 'slashHeader') {
        const combo = p.metaObj['Name of the channel+ Direction']
          ?? p.metaObj['Name of the channel + Direction']
          ?? p.metaObj['Name of the channel +Direction']
          ?? p.metaObj['Name of the channel+Direction'];
        if (combo && String(combo).trim()) return String(combo).trim();
      }
      const name = p.metaObj['Name of the channel']
        ?? p.metaObj['Name of the channel ']
        ?? p.metaObj['Channel name']
        ?? p.name;
      return (name && String(name).trim()) ? String(name).trim() : p.name;
    };
    const labelsBase = parsed.map(chanLabel);
    const labels = labelsBase.map(l => `${l} (${filterLabel})`);

    const r = resultant(y1, y2, y3);
    const matrix = new Array(t.length); for (let i = 0; i < t.length; i++) matrix[i] = [t[i], y1[i], y2[i], y3[i], r[i]];

    mkChart(t, [y1, y2, y3], labels, r);
    window.__t = t; window.__t_ms = t.map(v => v * 1000); window.__y1 = y1; window.__y2 = y2; window.__y3 = y3; window.__r = r; window.__matrix = matrix;

    $('#selStartMs').value = ''; $('#selEndMs').value = ''; $('#selStats').innerHTML = '';
  } catch (err) { alert(err.message || String(err)); }
}

function resetAll() {
  fileInput.value = '';
  fileList.innerHTML = '';
  $('#selStats').innerHTML = '';
  const tbody = $('#metaBody'); if (tbody) tbody.innerHTML = '';
  if (chart) { selMgr.unbindChart(chart); chart.destroy(); chart = undefined; }
  selMgr.clear();
  selIdx1 = selIdx2 = null;
  window.__t = window.__t_ms = window.__y1 = window.__y2 = window.__y3 = window.__r = window.__matrix = undefined;
}
function resetZoom() { if (chart) chart.resetZoom?.(); }

function downloadMatrixTSV() {
  const M = window.__matrix;
  if (!M?.length) { alert('Önce veriyi yükleyin.'); return; }
  const header = 'time_s\ty1\ty2\ty3\tresultant';
  const lines = [header, ...M.map(r => r.map(v => Number(v).toString()).join('\t'))];
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/tab-separated-values;charset=utf-8' });
  const a = document.createElement('a'); const url = URL.createObjectURL(blob);
  a.href = url; a.download = 'matrix.tsv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 800);
}

/* ---------- HIC stats ---------- */
function updateSelectionStats() {
  const box = $('#selStats');
  if (!box || selIdx1 === null || selIdx2 === null) { box.innerHTML = ''; return; }
  const i0 = Math.min(selIdx1, selIdx2), i1 = Math.max(selIdx1, selIdx2);
  const t = window.__t || [], t_ms = window.__t_ms || [], r = window.__r || [];
  const t1ms = t_ms[i0] ?? 0, t2ms = t_ms[i1] ?? 0, dtt_ms = (t[i1] - t[i0]) * 1000;
  const H = hicOfRange(t, r, i0, i1), pass = Number.isFinite(H) && H <= 1000;

  const ok15 = dtt_ms <= 15.0;
  const ok36 = dtt_ms <= 36.0;

  box.innerHTML = `
<div>
  <span class="badge">Seçim: t₁=${t1ms.toFixed(3)} ms, t₂=${t2ms.toFixed(3)} ms</span>
  <span class="badge">Δt=${dtt_ms.toFixed(3)} ms</span>
  <span class="badge">HIC15: ${ok15 ? 'Uygun' : 'Uygun değil'}</span>
  <span class="badge">HIC36: ${ok36 ? 'Uygun' : 'Uygun değil'}</span>
</div>
<div class="result ${pass ? 'pass' : 'fail'}">
  HIC (resultant) = ${Number.isFinite(H) ? H.toFixed(2) : '—'} — ${pass ? 'GEÇTİ ( ≤ 1000 )' : 'GEÇMEDİ ( > 1000 )'}
</div>
<div class="muted" style="margin-top:6px;">HIC, baş CG ivmesinin <i>bileşke</i> (resultant) serisi ile hesaplandı; birimler g.</div>
`;
}

/* ---------- numeric range apply ---------- */
function applyNumericRange() {  
  const t_ms = window.__t_ms || [];
  if (!t_ms.length) { alert('Önce veriyi yükleyin.'); return; }
  const sMs = Number($('#selStartMs').value), eMs = Number($('#selEndMs').value);
  if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) { alert('Lütfen geçerli ms değerleri girin.'); return; }
  if (eMs <= sMs) { alert('Bitiş, başlangıçtan büyük olmalı.'); return; }
  const i0 = lowerBound(t_ms, sMs), i1 = lowerBound(t_ms, eMs);
  setSelection(i0, i1);
}

/* ---------- use common HIC suggestion helper ---------- */
function suggestAndApply({ windowMs = null } = {}) {
  const t = window.__t, r = window.__r;
  if (!Array.isArray(t) || !Array.isArray(r) || t.length < 2 || r.length < 2 || t.length !== r.length) {
    alert('Önce veriyi yükleyin (Yükle & Çiz).'); return;
  }
  const res = suggestBestHICInterval(t, r, { windowMs });
  if (!res) { alert('Geçerli bir HIC aralığı bulunamadı.'); return; }

  const { i0, i1, hic } = res;
  setSelection(i0, i1);

  const t_ms = window.__t_ms || t.map(v => v * 1000);
  $('#selStartMs').value = t_ms[i0].toFixed(3);
  $('#selEndMs').value = t_ms[i1].toFixed(3);

  const box = $('#selStats');
  if (box) {
    const t1 = (t[i0] * 1000).toFixed(3);
    const t2 = (t[i1] * 1000).toFixed(3);
    const dt = ((t[i1] - t[i0]) * 1000).toFixed(3);
    const note = document.createElement('div');
    note.innerHTML = `<span class="badge">Önerilen Aralık: t₁=${t1} ms, t₂=${t2} ms (Δt=${dt} ms), HIC=${hic.toFixed(2)}</span>`;
    box.prepend(note);
  }

  window.__hic_crit = { i0, i1, hic, t1_ms: t[i0] * 1000, t2_ms: t[i1] * 1000 };
}

/* ---------- events ---------- */
$('#btnLoad').addEventListener('click', loadAndPlot);
$('#btnReset').addEventListener('click', resetAll);
$('#btnResetZoom').addEventListener('click', resetZoom);
$('#btnDownload').addEventListener('click', downloadMatrixTSV);
$('#btnApplyRange').addEventListener('click', applyNumericRange);
$('#btnClearSel').addEventListener('click', clearSelection);

$('#btnSuggestMax').addEventListener('click', () => suggestAndApply({ windowMs: null }));
$('#btnSuggest36').addEventListener('click', () => suggestAndApply({ windowMs: 36 }));
$('#btnSuggest15').addEventListener('click', () => suggestAndApply({ windowMs: 15 }));

window.addEventListener('resize', () => { if (chart) chart.resize(); });
