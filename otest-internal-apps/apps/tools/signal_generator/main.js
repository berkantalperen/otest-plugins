// main.js (ES module)
import {
  resample, toAccelUnits, cumtrapz, integrateRange,
  minMax, rms, sliceMinMax, parseNumber
} from '../../lib/math_utils.js';

import {
  upsertXYChart, enableDblClickZoomReset, SelectionManager, pngFromChart
} from '../../lib/charts.js';

// DOM helpers
const $ = sel => document.querySelector(sel);
const fmt5 = x => Number(x).toFixed(5);
const fmt3 = x => Number(x).toFixed(3);

// Table helpers
function addPairRow(t = '', a = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="cell-input t" inputmode="decimal" placeholder="0.0" value="${t}" /></td>
    <td><input class="cell-input a" inputmode="decimal" placeholder="0.0" value="${a}" /></td>
    <td class="col-actions"><button class="btn btn-sm" type="button">Sil</button></td>
  `;
  tr.querySelector('button').addEventListener('click', () => tr.remove());
  $('#pairsBody').appendChild(tr);
}
function clearPairs() { $('#pairsBody').innerHTML = ''; }
function readPairsFromTable() {
  const rows = Array.from(document.querySelectorAll('#pairsBody tr'));
  const times = [], accels = [];
  rows.forEach((tr, i) => {
    const tStr = tr.querySelector('.t').value;
    const aStr = tr.querySelector('.a').value;
    if (String(tStr).trim() === '' && String(aStr).trim() === '') return;
    const t = parseNumber(tStr);
    const a = parseNumber(aStr);
    if (!Number.isFinite(t) || !Number.isFinite(a)) throw new Error(`Satır ${i+1}: Geçersiz sayı.`);
    times.push(t); accels.push(a);
  });
  if (times.length < 2) throw new Error('En az iki satır gerekli (t, a).');
  return { times, accels };
}

// Downloads
function downloadTXT(ts, aOut, unit, v, x) {
  if (!ts?.length) { alert('Önce grafikleri oluşturun.'); return; }
  const header = `time_s\taccel_${unit==='g'?'g':'mps2'}\tvel_mps\tpos_m`;
  const lines = [header, ...ts.map((t,i) => `${fmt5(t)}\t${fmt3(aOut[i])}\t${fmt5(v[i])}\t${fmt5(x[i])}`)];
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); const url = URL.createObjectURL(blob);
  a.href = url; a.download = 'signal.txt';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// State
let chartAcc, chartVel, chartPos;

// Selection manager
const selBox = document.getElementById('selStats');
const selMgr = new SelectionManager(({ i0, i1, t0, t1, phase }) => {
  if (i0 === null && i1 === null) { selBox.innerHTML = ''; return; }

  const t       = window.__last_ts || [];
  const unit    = window.__last_unit || 'g';
  const a_disp  = window.__last_a_display || [];
  const a_g     = chartAcc?.$a_g || [];
  const a_mps2  = window.__last_a_mps2 || toAccelUnits(a_g, 'mps2');
  const v_mps   = window.__last_v || [];
  const x_m     = window.__last_x || [];

  if (phase === 'start' && i0 != null) {
    const tStart = t0 ?? t[i0];
    selBox.innerHTML = `<div><span class="badge">Başlangıç: t=${tStart.toFixed(5)} s</span></div>`;
    return;
  }

  if (phase === 'range' && i0 != null && i1 != null) {
    const tStart = t0 ?? t[i0];
    const tEnd   = t1 ?? t[i1];
    const dT     = tEnd - tStart;

    const dV = integrateRange(t, a_mps2, i0, i1, window.__cumV);
    const dX = integrateRange(t, v_mps,  i0, i1, window.__cumX);

    const { min: amin, max: amax } = sliceMinMax(a_disp, i0, i1);
    const { min: vmin, max: vmax } = sliceMinMax(v_mps,  i0, i1);
    const { min: xmin, max: xmax } = sliceMinMax(x_m,    i0, i1);

    selBox.innerHTML = `
      <div><span class="badge">Seçim: t₁=${tStart.toFixed(5)} s, t₂=${tEnd.toFixed(5)} s</span>
           <span class="badge">Δt=${dT.toFixed(5)} s</span></div>
      <div><span class="badge">∫ a dt = Δv = ${fmt5(dV)} m/s</span>
           <span class="badge">∫ v dt = Δx = ${fmt5(dX)} m</span></div>
      <div class="sep"></div>
      <div><span class="badge">İvme Min/Max (seçim): ${fmt3(amin)} / ${fmt3(amax)} ${unit === 'g' ? 'g' : 'm/s²'}</span></div>
      <div><span class="badge">Hız Min/Max (seçim): ${fmt5(vmin)} / ${fmt5(vmax)} m/s</span></div>
      <div><span class="badge">Konum Min/Max (seçim): ${fmt5(xmin)} / ${fmt5(xmax)} m</span></div>
    `;
  }
});

// Build
function build() {
  try {
    const dt = parseNumber(document.getElementById('dtInput').value);
    if (!(dt > 0)) throw new Error('Δt (sampling step) pozitif bir sayı olmalı.');

    const shape = document.getElementById('shapeSel').value;
    const unit = document.getElementById('unitSel').value;
    const { times, accels } = readPairsFromTable();

    const { t, y: a_g } = resample(times, accels, dt, shape);
    const a_display = toAccelUnits(a_g, unit);
    const a_mps2 = toAccelUnits(a_g, 'mps2');

    const v_mps = cumtrapz(t, a_mps2, 0);
    const x_m   = cumtrapz(t, v_mps,  0);

    window.__cumV = v_mps;
    window.__cumX = x_m;

    const xy = (ts, ys) => ts.map((x, i) => ({ x, y: ys[i] }));
    const anim = { duration: 520 }; // <— enable chart animation

    chartAcc = upsertXYChart('chartAcc', [
      { label: unit === 'g' ? 'İvme (g)' : 'İvme (m/s²)', data: xy(t, a_display) }
    ], {
      xType: 'linear', xLabel: 'Zaman (s)', yLabel: unit === 'g' ? 'İvme (g)' : 'İvme (m/s²)',
      gridColor: '#202a47', lockZoomToData: true, animation: anim
    });

    chartVel = upsertXYChart('chartVel', [
      { label: 'Hız (m/s)', data: xy(t, v_mps) }
    ], {
      xType: 'linear', xLabel: 'Zaman (s)', yLabel: 'Hız (m/s)',
      gridColor: '#202a47', lockZoomToData: true, animation: anim
    });

    chartPos = upsertXYChart('chartPos', [
      { label: 'Konum (m)', data: xy(t, x_m) }
    ], {
      xType: 'linear', xLabel: 'Zaman (s)', yLabel: 'Konum (m)',
      gridColor: '#202a47', lockZoomToData: true, animation: anim
    });

    chartAcc.$a_g = a_g;

    [chartAcc, chartVel, chartPos].forEach(ch => selMgr.bindChart(ch));

    // ——— Replaced `stats` with `minMax` + `rms`
    const { min: amin, max: amax } = minMax(a_display);
    const a_rms = rms(a_display);
    const { min: vmin, max: vmax } = minMax(v_mps);
    const { min: xmin, max: xmax } = minMax(x_m);
    const dur = t.length ? (t[t.length - 1] - t[0]) : 0;

    document.getElementById('stats').innerHTML = `
      <div><span class="badge">Örnek sayısı: ${t.length}</span>
           <span class="badge">Toplam süre: ${dur.toFixed(6)} s</span></div>
      <div><span class="badge">İvme Min/Max: ${fmt3(amin)} / ${fmt3(amax)} ${unit === 'g' ? 'g' : 'm/s²'}</span>
           <span class="badge">İvme RMS: ${fmt3(a_rms)} ${unit === 'g' ? 'g' : 'm/s²'}</span></div>
      <div><span class="badge">Hız Min/Max: ${fmt5(vmin)} / ${fmt5(vmax)} m/s</span>
           <span class="badge">Konum Min/Max: ${fmt5(xmin)} / ${fmt5(xmax)} m</span></div>
    `;

    // cache last results for interactions
    window.__last_ts = t;
    window.__last_a_display = a_display;
    window.__last_unit = unit;
    window.__last_v = v_mps;
    window.__last_x = x_m;
    window.__last_a_mps2 = a_mps2;

    enableDblClickZoomReset();
  } catch (err) {
    alert(err.message || String(err));
    console.error(err);
  }
}

// Presets / clear
function fillExample() {
  clearPairs();
  [[0.0, 0.0], [0.5, 1.0], [0.8, -0.5], [1.0, 0.0]].forEach(([t, a]) => addPairRow(t, a));
}
function clearAll() {
  clearPairs(); addPairRow('','');
  document.getElementById('stats').innerHTML = '';
  document.getElementById('selStats').innerHTML = '';
  for (const ch of [chartAcc, chartVel, chartPos]) { if (ch) ch.destroy(); }
  chartAcc = chartVel = chartPos = undefined;
  selMgr.clear();
}

// Wire UI
document.getElementById('btnBuild').addEventListener('click', build);
document.getElementById('btnExample').addEventListener('click', fillExample);
document.getElementById('btnClear').addEventListener('click', clearAll);
document.getElementById('btnTXT').addEventListener('click', () =>
  downloadTXT(window.__last_ts, window.__last_a_display, window.__last_unit, window.__last_v, window.__last_x)
);
document.getElementById('btnPNG_acc').addEventListener('click', () => pngFromChart(chartAcc, 'acceleration.png'));
document.getElementById('btnPNG_vel').addEventListener('click', () => pngFromChart(chartVel, 'velocity.png'));
document.getElementById('btnPNG_pos').addEventListener('click', () => pngFromChart(chartPos, 'position.png'));
document.getElementById('btnAddRow').addEventListener('click', () => addPairRow('',''));
document.getElementById('btnClearRows').addEventListener('click', () => { clearPairs(); addPairRow('',''); });

// Init
fillExample();
setTimeout(build, 0);

// Resize
window.addEventListener('resize', () => {
  for (const ch of [chartAcc, chartVel, chartPos]) { if (ch?.resize) ch.resize(); }
});
