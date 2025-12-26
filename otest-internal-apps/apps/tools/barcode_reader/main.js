    import { PROJE_NO, MUSTERI_KODU, IS_GELIS_KODU, DIREKTIF_KODU, DUZENEK_KODU, UYGULAMA_KODU } from '../../src/barcode_data.js';

    const $ = (id) => document.getElementById(id);
    const codeEl = $('code'), out = $('out'), status = $('status');

    const projeMap = Object.fromEntries(PROJE_NO.map(p => [p.code, p.name]));
    const nameOf = (obj, key, fallback = '(tanımsız)') => obj[key] || fallback;

    function decode(code) {
      const clean = code.trim().toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9]{10}$/.test(clean) && !/^[A-Z0-9]{18}$/.test(clean)) {
        return { error: 'Kod 10 veya 18 haneden oluşmalı ve yalnızca A–Z/0–9 içermeli.' };
      }
      const base = {
        yy: clean.slice(0, 2),
        proje: clean.slice(2, 5),
        musteri: clean.slice(5, 9),
        gelis: clean.slice(9, 10),
      };
      if (clean.length === 10) {
        return { ...base, len: 10 };
      }
      return {
        ...base,
        direktif: clean.slice(10, 13),
        duzenek: clean.slice(13, 14),
        uygulama: clean.slice(14, 15),
        detay: clean.slice(15, 16),
        tekrar: clean.slice(16, 18),
        len: 18
      };
    }

    function render(info) {
      out.innerHTML = '';
      if (info.error) { status.textContent = info.error; return; }
      status.textContent = info.len === 10 ? 'Genel kod (10 hane) algılandı.' : 'Test kodu (18 hane) algılandı.';

      const rows = [];
      const yearFull = '20' + info.yy;
      rows.push(['Yıl', yearFull + ' (YY=' + info.yy + ')']);
      rows.push(['Proje', `${info.proje} — ${nameOf(projeMap, info.proje)}`]);
      rows.push(['Müşteri', `${info.musteri} — ${nameOf(MUSTERI_KODU, info.musteri)}`]);
      rows.push(['İşin Geliş', `${info.gelis} — ${nameOf(IS_GELIS_KODU, info.gelis)}`]);

      if (info.len === 18) {
        rows.push(['Yönetmelik/Direktif', `${info.direktif} — ${nameOf(DIREKTIF_KODU, info.direktif)}`]);
        rows.push(['Düzeneği', `${info.duzenek} — ${nameOf(DUZENEK_KODU, info.duzenek)}`]);
        rows.push(['Uygulama', `${info.uygulama} — ${nameOf(UYGULAMA_KODU, info.uygulama)}`]);
        rows.push(['Detay', info.detay]);
        rows.push(['Tekrar', info.tekrar]);
      }

      for (const [k, v] of rows) {
        const div = document.createElement('div'); div.className = 'item';
        div.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div>`;
        out.appendChild(div);
      }
    }

    // canlı çözümleme
    codeEl.addEventListener('input', () => render(decode(codeEl.value)));
    // ilk yükleme
    render({ error: 'Kod bekleniyor…' });