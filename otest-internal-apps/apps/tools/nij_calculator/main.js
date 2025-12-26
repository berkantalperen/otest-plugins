// main.js
import { cfcFilter, cfc60Filter, cfc180Filter, cfc600Filter, cfc1000Filter } from '../../lib/cfc_filtering.js';
import { upsertXYChart, enableDblClickZoomReset } from '../../lib/charts.js';
import { timeArray, calcYMinMax, parseNumber, extreme } from '../../lib/math_utils.js';
import { nijSeries, getNijConstants, STANDARDS } from '../../lib/nij.js';
import { parseFile } from '../../lib/sensor_data_parser.js';

let chartNij, chartLoads;
const $ = (s) => document.querySelector(s);

const COLORS = ['#60a5fa', '#34d399', '#f472b6', '#eab308'];

// dominant mode per sample: 0..3 = [NTF, NTE, NCF, NCE]
function computeActiveMode(series) {
  const { NijTF, NijTE, NijCF, NijCE } = series;
  const n = Math.min(NijTF.length, NijTE.length, NijCF.length, NijCE.length);
  const active = new Array(n);
  for (let i = 0; i < n; i++) {
    let idx = 0, max = NijTF[i];
    if (NijTE[i] > max) { max = NijTE[i]; idx = 1; }
    if (NijCF[i] > max) { max = NijCF[i]; idx = 2; }
    if (NijCE[i] > max) { max = NijCE[i]; idx = 3; }
    active[i] = idx;
  }
  return active;
}

// Build 2 datasets per mode (solid where dominant, dashed elsewhere)
function buildDominanceDatasets(t_ms, series, activeMode, colors) {
  const LABELS = [
    'NTF (gerilim+fleksiyon)',
    'NTE (gerilim+ekstansiyon)',
    'NCF (bası+fleksiyon)',
    'NCE (bası+ekstansiyon)'
  ];
  const MODES = [series.NijTF, series.NijTE, series.NijCF, series.NijCE];

  const datasets = [];
  for (let m = 0; m < 4; m++) {
    const ys = MODES[m];
    const solid = new Array(ys.length);
    const dash = new Array(ys.length);

    for (let i = 0; i < ys.length; i++) {
      if (activeMode[i] === m) { solid[i] = { x: t_ms[i], y: ys[i] }; dash[i] = { x: t_ms[i], y: NaN }; }
      else { solid[i] = { x: t_ms[i], y: NaN }; dash[i] = { x: t_ms[i], y: ys[i] }; }
    }

    datasets.push({
      label: LABELS[m] + ' (dominant)',
      data: solid,
      borderColor: colors[m], backgroundColor: colors[m],
      borderWidth: 2.25, pointRadius: 0, spanGaps: false,
      parsing: false, order: 2
    });

    datasets.push({
      label: LABELS[m] + ' (other)',
      data: dash,
      borderColor: colors[m], backgroundColor: colors[m],
      borderWidth: 1.1, borderDash: [6, 4], pointRadius: 0, spanGaps: false,
      parsing: false, order: 1
    });
  }
  return datasets;
}

// Parse "1000", "1000 Hz", "12.5 kHz" → Hz
function parseSamplingRateHz(s) {
  if (s == null) return NaN;
  const str = String(s).trim().toLowerCase();
  let v = Number(str.replace(',', '.'));
  if (Number.isFinite(v)) return v;
  const m = str.match(/([\d.,]+)\s*(k)?\s*hz/);
  if (!m) return NaN;
  v = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(v)) return NaN;
  return m[2] ? v * 1000 : v;
}

function renderMetaTable(parsed) {
  $('#col1').textContent = parsed[0].name;
  $('#col2').textContent = parsed[1].name;
  $('#col3').textContent = parsed[2].name;
  const tbody = $('#metaBody'); tbody.innerHTML = '';
  const keys = (() => {
    const order = [], seen = new Set();
    const prefer = ['Number of samples', 'Sampling interval', 'Sampling rate', 'Name of the channel'];
    for (const p of parsed) for (const [k] of p.metaPairs) if (!seen.has(k)) { seen.add(k); order.push(k); }
    for (let i = prefer.length - 1; i >= 0; i--) {
      const k = prefer[i]; const idx = order.indexOf(k);
      if (idx > 0) { order.splice(idx, 1); order.unshift(k); }
    }
    return order;
  })();
  const val = (p, k) => (k in p.metaObj) ? p.metaObj[k] : '';
  const eqCheck = new Set(['Number of samples', 'Sampling interval', 'Sampling rate']);
  for (const k of keys) {
    const v1 = val(parsed[0], k), v2 = val(parsed[1], k), v3 = val(parsed[2], k);
    const mismatch = (eqCheck.has(k) && !(v1 === v2 && v2 === v3));
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${k}</td><td class="${mismatch ? 'bad' : ''}">${v1}</td><td class="${mismatch ? 'bad' : ''}">${v2}</td><td class="${mismatch ? 'bad' : ''}">${v3}</td>`;
    tbody.appendChild(tr);
  }
}

function guessChannelRole(p) {
  const raw = p.metaObj['Name of the channel'] ?? p.metaObj['Channel name'] ?? p.name ?? '';
  const s = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  if (s.includes('force x')) return 'Fx';
  if (s.includes('force z')) return 'Fz';
  if (s.includes('moment y')) return 'My';
  return 'Unknown';
}

function ensureRoles(parsed) {
  const roles = parsed.map(guessChannelRole);
  const idxFx = roles.indexOf('Fx'); const idxMy = roles.indexOf('My'); const idxFz = roles.indexOf('Fz');
  if (idxFx < 0 || idxMy < 0 || idxFz < 0) {
    throw new Error(`Kanal eşleştirme başarısız. Bulunan roller: ${roles.join(', ') || '—'}.
Üstbilgide şu adları kullanın: “Upper Neck  Force X”, “Upper Neck  Force Z”, “Upper Neck Moment Y”.`);
  }
  return { idxFx, idxMy, idxFz };
}

function pickFilter(sel, FS) {
  switch ((sel || 'cfc600').toLowerCase()) {
    case 'none':    return (arr) => arr;
    case 'cfc60':   return (arr) => Array.from(cfc60Filter(arr, FS));
    case 'cfc180':  return (arr) => Array.from(cfc180Filter(arr, FS));
    case 'cfc600':  return (arr) => Array.from(cfc600Filter(arr, FS));
    case 'cfc1000': return (arr) => Array.from(cfc1000Filter(arr, FS));
    default: {
      const m = (sel || '').match(/^cfc(\d{2,4})$/);
      if (m) { const c = Number(m[1]); return (arr) => Array.from(cfcFilter(arr, FS, c)); }
      return (arr) => Array.from(cfc600Filter(arr, FS));
    }
  }
}

function mkCharts(t_sec, series, activeMode, Fz, MyCorr) {
  const t_ms = t_sec.map(v => v * 1000);

  const nijDatasets = buildDominanceDatasets(t_ms, series, activeMode, COLORS);
  const { min: yMin, max: yMax } = calcYMinMax([series.NijTF, series.NijTE, series.NijCF, series.NijCE]);

  chartNij = upsertXYChart('chartNij', nijDatasets, {
    xType: 'linear',
    xLabel: 'Zaman (ms)',
    yLabel: 'NIJ',
    yMin, yMax,
    gridColor: '#202a47',
    lockZoomToData: true,
    animation: false,
    interactionMode: 'index',
    interactionAxis: 'x',
    parsing: false,
    normalized: true,
    plugins: { decimation: { enabled: true, algorithm: 'min-max', samples: 1200 } }
  });

  const tms = (ys) => t_ms.map((x, i) => ({ x, y: ys[i] }));
  // Loads chart (Fx removed as requested)
  chartLoads = upsertXYChart(
    'chartLoads',
    [
      { label: 'Fz [N]',           data: tms(Fz),     borderColor: COLORS[1], backgroundColor: COLORS[1], borderWidth: 1.25, pointRadius: 0, parsing: false },
      { label: 'My (corr) [N·m]',  data: tms(MyCorr), borderColor: COLORS[2], backgroundColor: COLORS[2], borderWidth: 1.25, pointRadius: 0, parsing: false }
    ],
    {
      xType: 'linear', xLabel: 'Zaman (ms)', yLabel: 'Yük',
      ...calcYMinMax([Fz, MyCorr]),
      gridColor: '#202a47',
      lockZoomToData: true,
      animation: false,
      interactionMode: 'index',
      interactionAxis: 'x',
      parsing: false,
      normalized: true,
      plugins: { decimation: { enabled: true, algorithm: 'min-max', samples: 1200 } }
    }
  );

  enableDblClickZoomReset(document);
}

function renderPeakStats(t, Fz, MyCorr, series, lever, trimStartMs, trimEndMs) {
  const box = $('#peakStats'); if (!box) return;
  const fmt = (v, n=3) => Number(v).toFixed(n);

  const fzT = extreme(Fz,     { type:'max', where:(v)=>v>0, t });
  const fzC = extreme(Fz,     { type:'min', where:(v)=>v<0, t });
  const myF = extreme(MyCorr, { type:'max', where:(v)=>v>0, t });
  const myE = extreme(MyCorr, { type:'min', where:(v)=>v<0, t });

  const pTF = extreme(series.NijTF, { type:'max', t });
  const pTE = extreme(series.NijTE, { type:'max', t });
  const pCF = extreme(series.NijCF, { type:'max', t });
  const pCE = extreme(series.NijCE, { type:'max', t });

  box.innerHTML = `
  <div class="grid cols-2">
    <div>
      <h3 style="margin-top:6px;">Yük Tepeleri</h3>
      <ul class="statlist">
        <li><b>Fz tension (max +)</b>: ${fzT? fmt(fzT.value,2):'—'} N @ ${fzT? fmt(fzT.t*1000):'—'} ms</li>
        <li><b>Fz compression (min −)</b>: ${fzC? fmt(fzC.value,2):'—'} N @ ${fzC? fmt(fzC.t*1000):'—'} ms</li>
        <li><b>My (corr) flexion (max +)</b>: ${myF? fmt(myF.value,2):'—'} N·m @ ${myF? fmt(myF.t*1000):'—'} ms</li>
        <li><b>My (corr) extension (min −)</b>: ${myE? fmt(myE.value,2):'—'} N·m @ ${myE? fmt(myE.t*1000):'—'} ms</li>
      </ul>
    </div>
    <div>
      <h3>NIJ Tepeleri</h3>
      <ul class="statlist nij">
        <li class="nij-item"><span class="pill pill-tf">NTF</span> ${pTF? fmt(pTF.value,3):'—'} @ ${pTF? fmt(pTF.t*1000):'—'} ms</li>
        <li class="nij-item"><span class="pill pill-te">NTE</span> ${pTE? fmt(pTE.value,3):'—'} @ ${pTE? fmt(pTE.t*1000):'—'} ms</li>
        <li class="nij-item"><span class="pill pill-cf">NCF</span> ${pCF? fmt(pCF.value,3):'—'} @ ${pCF? fmt(pCF.t*1000):'—'} ms</li>
        <li class="nij-item"><span class="pill pill-ce">NCE</span> ${pCE? fmt(pCE.value,3):'—'} @ ${pCE? fmt(pCE.t*1000):'—'} ms</li>
      </ul>
    </div>
  </div>`;
}

async function loadAndPlot() {
  try {
    const files = Array.from($('#fileInput').files || []);
    if (files.length !== 3) throw new Error('Lütfen tam olarak 3 dosya seçin.');
    $('#fileList').innerHTML = files.map(f => `<span class="pill">${f.name}</span>`).join('');

    const parsed = await Promise.all(files.map(f => parseFile(f, { format: 'standard' })));
    renderMetaTable(parsed);

    const ns = parsed.map(p => parseInt(parseNumber(p.metaObj['Number of samples'])));
    const dt = parsed.map(p => {
      const dtFromInterval = parseNumber(p.metaObj['Sampling interval']);
      if (Number.isFinite(dtFromInterval)) return dtFromInterval;
      const rateHz = parseSamplingRateHz(p.metaObj['Sampling rate']);
      return (Number.isFinite(rateHz) && rateHz > 0) ? 1 / rateHz : NaN;
    });

    if (ns.some(n => !Number.isFinite(n)) || dt.some(x => !Number.isFinite(x))) {
      throw new Error('Üstbilgilerde “Number of samples” veya “Sampling interval / Sampling rate” eksik/geçersiz.');
    }
    if (!ns.every(n => n === ns[0]) || !dt.every(x => Math.abs(x - dt[0]) < 1e-15)) {
      throw new Error('Dosyaların “Number of samples” ve/veya “Sampling interval / Sampling rate” eşleşmiyor (tabloya bakın).');
    }
    console.log("+");

    const Nfull = ns[0], DT = dt[0], FS = 1 / DT;
    const totalMs = (Nfull - 1) * DT * 1000;
    // trims → index window
    const trimStartMs = Math.max(0, parseNumber($('#trimStartMs').value) || 214);
    const trimEndMs   = Math.max(0, parseNumber($('#trimEndMs').value)   || 0);

    let i0 = Math.ceil(trimStartMs / (DT * 1000));
    let i1 = Math.floor((totalMs - trimEndMs) / (DT * 1000));
    if (i0 < 0) i0 = 0;
    if (i1 > Nfull - 1) i1 = Nfull - 1;
    if (i1 < i0) throw new Error('Kırpma sonucu veri kalmadı. Başlangıç/bitiş ms değerlerini azaltın.');

    const N = i1 - i0 + 1;
    const t = timeArray(N, DT); // 0..(N-1)*DT

    const { idxFx, idxMy, idxFz } = ensureRoles(parsed);
    const rawFx_full = parsed[idxFx].values, rawMy_full = parsed[idxMy].values, rawFz_full = parsed[idxFz].values;

    // Slice first, then filter the trimmed region
    const rawFx = rawFx_full.slice(i0, i1 + 1);
    const rawMy = rawMy_full.slice(i0, i1 + 1);
    const rawFz = rawFz_full.slice(i0, i1 + 1);

    const sel = $('#filterOption')?.value || 'cfc600';
    const filt = pickFilter(sel, FS);

    const Fx = filt(rawFx);
    const My = filt(rawMy);
    const Fz = filt(rawFz);

    // Lever arm (Fx effect) and corrected My
    const lever = parseNumber($('#leverArm')?.value);
    const L = Number.isFinite(lever) ? lever : 0.017780;
    const My_corr = new Array(N);
    for (let i = 0; i < N; i++) My_corr[i] = My[i] - Fx[i] * L;

    // NIJ constants by selected standard
    const stdId = ($('#nijStandard')?.value || 'hiii50').toLowerCase();
    const C = getNijConstants(stdId);

    // NIJ and dominance
    const series = nijSeries(Fz, My_corr, C);
    const activeMode = computeActiveMode(series);

    // Save for charts / export
    window.__Fz = Fz; window.__MyCorr = My_corr;

    const matrix = new Array(N);
    for (let i = 0; i < N; i++) {
      matrix[i] = [t[i], Fz[i], My_corr[i], series.NijTF[i], series.NijTE[i], series.NijCF[i], series.NijCE[i]];
    }
    window.__matrix = matrix; window.__t = t; window.__t_ms = t.map(v => v * 1000);

    mkCharts(t, series, activeMode, Fz, My_corr);
    renderPeakStats(t, Fz, My_corr, series, L, trimStartMs, trimEndMs);
  } catch (err) {
    alert(err.message || String(err));
  }
}

function resetAll() {
  $('#fileInput').value = '';
  $('#fileList').innerHTML = '';
  $('#peakStats').innerHTML = '';
  const tbody = $('#metaBody'); if (tbody) tbody.innerHTML = '';
  if (chartNij) { chartNij.destroy(); chartNij = undefined; }
  if (chartLoads) { chartLoads.destroy(); chartLoads = undefined; }
  window.__t = window.__t_ms = window.__Fz = window.__MyCorr = window.__matrix = undefined;
}

function resetZoom() { chartNij?.resetZoom?.(); chartLoads?.resetZoom?.(); }

function downloadMatrixTSV() {
  const M = window.__matrix; if (!M?.length) { alert('Önce veriyi yükleyin.'); return; }
  const header = 'time_s\tFz\tMy_corr\tNTF\tNTE\tNCF\tNCE';
  const lines = [header, ...M.map(r => r.map(v => Number(v).toString()).join('\t'))];
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/tab-separated-values;charset=utf-8' });
  const a = document.createElement('a'); const url = URL.createObjectURL(blob);
  a.href = url; a.download = 'nij_matrix.tsv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 800);
}

// Bind
$('#btnLoad').addEventListener('click', loadAndPlot);
$('#btnReset').addEventListener('click', resetAll);
$('#btnResetZoom').addEventListener('click', resetZoom);
$('#btnDownload').addEventListener('click', downloadMatrixTSV);
window.addEventListener('resize', ()=>{ chartNij?.resize?.(); chartLoads?.resize?.(); });
