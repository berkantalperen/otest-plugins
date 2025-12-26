
  import { PROJE_NO, MUSTERI_KODU, IS_GELIS_KODU, DIREKTIF_KODU, DUZENEK_KODU, UYGULAMA_KODU } from '../../src/barcode_data.js';
  
  const $ = (id) => document.getElementById(id);
  const yil=$('yil'), proje=$('proje'), musteri=$('musteri'), gelis=$('gelis'),
        direktif=$('direktif'), duzenek=$('duzenek'), uygulama=$('uygulama'),
        detay=$('detay'), tekrar=$('tekrar'),
        genelOut=$('genel'), testOut=$('test'), barcodeStatus=$('barcodeStatus');

  function pad2(n){return String(n).padStart(2,'0')}
  const trCompare=(a,b)=>a.localeCompare(b,'tr-TR',{sensitivity:'base',numeric:true});

  const DATA={
    proje: PROJE_NO.slice().sort((a,b)=>trCompare(a.code,b.code))
      .map(p=>({value:p.code,label:`${p.code} — ${p.name}`})),
    musteri:Object.entries(MUSTERI_KODU)
      .map(([code,name])=>({code,name:name||'(tanımsız)'}))
      .sort((a,b)=>trCompare(a.code,b.code))
      .map(({code,name})=>({value:code,label:`${code} — ${name}`})),
    gelis:Object.entries(IS_GELIS_KODU)
      .sort((a,b)=>trCompare(a[0],b[0]))
      .map(([code,name])=>({value:code,label:`${code} — ${name}`})),
    direktif:Object.entries(DIREKTIF_KODU)
      .sort((a,b)=>Number(a[0])-Number(b[0]))
      .map(([code,name])=>({value:code,label:`${code} — ${name}`})),
    duzenek:Object.entries(DUZENEK_KODU)
      .sort((a,b)=>trCompare(a[0],b[0]))
      .map(([code,name])=>({value:code,label:`${code} — ${name}`})),
    uygulama:Object.entries(UYGULAMA_KODU)
      .sort((a,b)=>trCompare(a[0],b[0]))
      .map(([code,name])=>({value:code,label:`${code} — ${name}`})),
    detay:Array.from({length:26},(_,i)=>{const c=String.fromCharCode(65+i);return {value:c,label:c}}), // A–Z
    tekrar:Array.from({length:99},(_,i)=>{const n=pad2(i+1); return {value:n,label:n}})
  };

  function populateYears(){
    const now=new Date(),current=now.getFullYear();
    const frag=document.createDocumentFragment();
    for(let y=current;y>current-10;y--){
      const opt=document.createElement('option');
      opt.value=String(y).slice(-2); opt.textContent=y;
      frag.appendChild(opt);
    }
    yil.replaceChildren(frag); yil.selectedIndex=0;
  }
  function populateSelect(selectEl,items){
    const frag=document.createDocumentFragment();
    items.forEach(({value,label})=>{
      const opt=document.createElement('option');
      opt.value=value; opt.textContent=label;
      frag.appendChild(opt);
    });
    selectEl.replaceChildren(frag);
  }
  function populate(){
    populateYears();
    populateSelect(proje,DATA.proje);
    populateSelect(musteri,DATA.musteri);
    populateSelect(gelis,DATA.gelis);
    populateSelect(direktif,DATA.direktif);
    populateSelect(duzenek,DATA.duzenek);
    populateSelect(uygulama,DATA.uygulama);
    populateSelect(detay,DATA.detay);
    populateSelect(tekrar,DATA.tekrar);
    detay.value='A'; tekrar.value='01';
  }

  function buildCodes(){
    const genel=`${yil.value}${proje.value}${musteri.value}${gelis.value}`;
    const test =`${genel}${direktif.value}${duzenek.value}${uygulama.value}${(detay.value||'A')}${(tekrar.value||'01')}`;
    genelOut.textContent=genel;
    testOut.textContent=test;
    drawBarcodes(genel,test);
  }

  async function ensureBarcodeLib(){
    if(window.JsBarcode) return true;
    try{await import('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js'); return !!window.JsBarcode;}
    catch{return false;}
  }
  async function drawBarcodes(genel,test){
    const ok=await ensureBarcodeLib();
    if(!ok){barcodeStatus.textContent='Barkod kütüphanesi yüklenemedi. Kodlar metin olarak gösteriliyor.'; return;}
    try{
      JsBarcode('#genelBarcode',genel,{format:'CODE128',displayValue:true,fontSize:14,height:60,margin:8});
      JsBarcode('#testBarcode', test,{format:'CODE128',displayValue:true,fontSize:14,height:60,margin:8});
      barcodeStatus.textContent='';
    }catch(e){ barcodeStatus.textContent='Barkod oluşturulamadı.'; }
  }

  function showToast(msg){
    const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1500);
  }

  // SVG -> PNG indir (a[download])
  async function downloadSvgPng(svgId, filenameBase){
    const svg=document.querySelector(svgId);
    const xml=new XMLSerializer().serializeToString(svg);
    const svg64=btoa(unescape(encodeURIComponent(xml)));
    const img=new Image(); img.src='data:image/svg+xml;base64,'+svg64;
    await new Promise(res=>img.onload=res);
    const canvas=document.createElement('canvas');
    canvas.width=img.width||600; canvas.height=img.height||120;
    const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
    const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filenameBase+'.png';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function bindEvents(){
    // metin tıklayınca kopyala
    genelOut.addEventListener('click', async ()=>{ await navigator.clipboard.writeText(genelOut.textContent); showToast('Genel kod kopyalandı'); });
    testOut .addEventListener('click', async ()=>{ await navigator.clipboard.writeText(testOut .textContent); showToast('Test kodu kopyalandı'); });
    // SVG tıklayınca indir
    $('genelBarcode').addEventListener('click', ()=>{ downloadSvgPng('#genelBarcode', genelOut.textContent); });
    $('testBarcode') .addEventListener('click', ()=>{ downloadSvgPng('#testBarcode',  testOut .textContent);  });
  }

  function enhanceWithChoices(){
    const baseOptions={searchEnabled:true,searchFields:['label','value'],shouldSort:false,position:'auto',removeItemButton:false,placeholder:true,searchPlaceholderValue:'Ara…',loadingText:'Yükleniyor…',noResultsText:'Sonuç bulunamadı',noChoicesText:'Seçenek yok',itemSelectText:'',allowHTML:false};
    ['#proje','#musteri','#direktif','#yil','#gelis','#duzenek','#uygulama','#detay','#tekrar']
      .forEach(sel=>new Choices(sel,baseOptions));
  }

  populate();
  enhanceWithChoices();
  bindEvents();
  ['change','input'].forEach(evt=>{ document.addEventListener(evt,e=>{ if(['SELECT','INPUT'].includes(e.target.tagName)) buildCodes(); }); });
  buildCodes();