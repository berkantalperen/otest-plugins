// ../../lib/parser.js

// Public API:
// - parseFile(file, { format }?)  -> auto-detect by default, or force a format
// - detectFormat(text)            -> 'slashHeader' | 'standard'
// - FORMATS                       -> exported presets if callers want them

const FORMATS = {
  slashHeader: {
    name: 'slashHeader',
    headerLen: 21,           // original code used 21
    commentPrefix: '/',      // header lines often start with '/'
    valuesUnit: 'mps2',      // data lines -> m/s^2 (to be converted to g by caller)
    headerNormalizer: defaultHeaderNormalizer
  },
  standard: {
    name: 'standard',
    headerLen: 30,           // original code used 30
    commentPrefix: null,     // not required
    valuesUnit: 'g',         // data lines already in g
    headerNormalizer: defaultHeaderNormalizer
  }
};

// Basic helpers
const linesOf = (t) => t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
const normalizeKey = (k) => k.replace(/\s+/g, ' ').trim();

// Keep this flexible in case some formats want to mutate key/val later.
function defaultHeaderNormalizer(key, val) {
  // Remove leading slashes from keys (for slash-header) and trim
  const nk = normalizeKey(String(key || '').replace(/^\/+/, ''));
  const nv = String(val ?? '').trim();
  return [nk, nv];
}

function firstNonWhitespaceChar(text) {
  const m = text.match(/^\s*([^\s])/m);
  return m ? m[1] : '';
}

function detectFormat(text) {
  const ch = firstNonWhitespaceChar(text);
  // If header lines begin with '/', this is the "slash header" flavor
  return ch === '/' ? 'slashHeader' : 'standard';
}

function getConfigFor(format) {
  if (typeof format === 'string' && FORMATS[format]) return FORMATS[format];
  if (format && FORMATS[format.name]) return format;
  return FORMATS.standard;
}

function readText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error(`Dosya okunamadı: ${file?.name || '(bilinmiyor)'}`));
    fr.onload = () => res(String(fr.result || ''));
    fr.readAsText(file);
  });
}

/**
 * Parse a single file with optional explicit format.
 * If format is omitted, we auto-detect based on first non-whitespace char.
 *
 * Returns:
 * {
 *   name: string,
 *   metaPairs: Array<[key, val]>,
 *   metaObj: Record<string,string>,
 *   values: number[],
 *   format: 'slashHeader' | 'standard',
 *   valuesUnit: 'g' | 'mps2'
 * }
 */
async function parseFile(file, opts = {}) {
  const text = await readText(file);
  const format = opts.format || detectFormat(text);
  const cfg = getConfigFor(format);
  const L = linesOf(text);

  // Split header/data by configured header length
  const headerLines = L.slice(0, cfg.headerLen);
  const dataLines = L.slice(cfg.headerLen);

  const metaPairs = [];
  const metaObj = {};

  for (const raw of headerLines) {
    const idx = raw.indexOf(':');
    if (idx === -1) continue;
    const rawKey = raw.slice(0, idx);
    const rawVal = raw.slice(idx + 1);
    const [key, val] = cfg.headerNormalizer(rawKey, rawVal);
    metaPairs.push([key, val]);
    metaObj[key] = val;
  }

  // Some files use "Sampling rate" instead of "Sampling interval". Original logic
  // treated them as the same field, so we mirror that behavior.
  if (metaObj['Sampling interval'] == null && metaObj['Sampling rate'] != null) {
    metaObj['Sampling interval'] = metaObj['Sampling rate'];
  }

  const values = [];
  for (const row of dataLines) {
    const s = String(row).trim();
    if (!s) continue;
    const v = parseNumber(s);
    if (Number.isFinite(v)) values.push(v);
  }

  return {
    name: file.name,
    metaPairs,
    metaObj,
    values,
    format,
    valuesUnit: cfg.valuesUnit
  };
}

/** Simple numeric parser that tolerates commas, spaces, etc. */
function parseNumber(s) {
  // Remove locale separators except a single dot or comma as decimal
  // Replace comma decimal with dot
  const t = String(s)
    .replace(/[^0-9eE\+\-.,]/g, '')
    .replace(/,/g, '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

export {
  parseFile,
  detectFormat,
  FORMATS,
  parseNumber
};
