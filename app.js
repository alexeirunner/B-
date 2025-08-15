/* ВЭФ 2025 — Инвентарь (PWA) */
(() => {
  'use strict';
  const APP_VERSION = '1.2.0';
  const idb = {
    _db: null,
    open() { return new Promise((res,rej)=>{ const r=indexedDB.open('vef2025-db',3);
      r.onupgradeneeded=e=>{const db=e.target.result;
        if(!db.objectStoreNames.contains('rows')) db.createObjectStore('rows',{keyPath:'id'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('comments')) db.createObjectStore('comments',{keyPath:'objectName'});
      };
      r.onsuccess=()=>{idb._db=r.result; res();}; r.onerror=()=>rej(r.error); });},
    put(s,v){return new Promise((res,rej)=>{const tx=idb._db.transaction(s,'readwrite');tx.objectStore(s).put(v);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});},
    getAll(s){return new Promise((res,rej)=>{const tx=idb._db.transaction(s,'readonly');const rq=tx.objectStore(s).getAll();rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});},
    get(s,k){return new Promise((res,rej)=>{const tx=idb._db.transaction(s,'readonly');const rq=tx.objectStore(s).get(k);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});},
    clear(s){return new Promise((res,rej)=>{const tx=idb._db.transaction(s,'readwrite');tx.objectStore(s).clear();tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
  };

  let DATA=null, HEADERS=[], OBJECT_COL=null, ROWS=[], FILTER_OBJ='', FILTER_TEXT='';
  let COL_GUESS = {qty:null, nameA:null, nameB:null};

  const $ = s=>document.querySelector(s);
  const objectsEl=$('#objects'), theadEl=$('#thead'), tbodyEl=$('#tbody');
  const searchEl=$('#search'), filterEl=$('#filter');
  const btnInstall=$('#btn-install'), btnExport=$('#btn-export'), fileImport=$('#file-import');
  const btnClearCache=$('#btn-clear-cache'), btnAddRow=$('#btn-add-row');
  const btnAddCol=$('#btn-add-col'), btnRenameCol=$('#btn-rename-col'), btnDelCol=$('#btn-del-col');
  const btnViewCards=$('#btn-view-cards'), btnViewTable=$('#btn-view-table'), btnViewTiles=$('#btn-view-tiles');
  const btnObjectCol=$('#btn-object-col');
  const cardsGrid=$('#cards-grid'), cardsToolbar=$('#cards-toolbar'), tableWrap=$('#table-wrap');
  const objectDetail=$('#object-detail'), objectTitle=$('#object-title'), objectItems=$('#object-items'), btnBackToTiles=$('#btn-back-to-tiles');

  function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
  function cssId(text){return String(text).replace(/[^\w\-]+/g,'_');}

  let deferredPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;btnInstall.classList.remove('hidden');});
  btnInstall.addEventListener('click',async()=>{ if(deferredPrompt){deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; btnInstall.classList.add('hidden');} else {alert('Кнопка скрыта: приложение уже установлено или не поддерживается.');}});

  async function loadInitialData(){
    await idb.open();
    const existingRows=await idb.getAll('rows');
    const metaVersion=await idb.get('meta','app_version');
    if(existingRows.length && metaVersion && metaVersion.value===APP_VERSION){
      const mh=await idb.get('meta','headers'); const moc=await idb.get('meta','object_col');
      HEADERS=mh?.value||[]; OBJECT_COL=moc?.value||HEADERS[0]; ROWS=existingRows.map(x=>x.payload);
      DATA={headers:HEADERS, rows:ROWS, objectColumn:OBJECT_COL};
    } else {
      const res=await fetch('data.json'); if(!res.ok) throw new Error('Не удалось загрузить data.json');
      DATA=await res.json(); HEADERS=DATA.headers; OBJECT_COL=(HEADERS.includes('Unnamed: 2')?'Unnamed: 2':(DATA.objectColumn||HEADERS[0]));
      ROWS=DATA.rows.map(r=>({id:crypto.randomUUID(),...r}));
      await idb.clear('rows'); for(const row of ROWS){ await idb.put('rows',{id:row.id,payload:row}); }
      await idb.put('meta',{key:'headers',value:HEADERS}); await idb.put('meta',{key:'object_col',value:OBJECT_COL}); await idb.put('meta',{key:'app_version',value:APP_VERSION});
    }
  }

  async function saveHeaders(){ await idb.put('meta',{key:'headers',value:HEADERS}); await idb.put('meta',{key:'object_col',value:OBJECT_COL}); }
  function ensureSerialColumn(){ const col='Серийный номер'; if(!HEADERS.includes(col)){ HEADERS.push(col); for(const r of ROWS){ r[col]=r[col]??''; } saveHeaders(); } }
  function guessColumns(){
    const ll=HEADERS.map(h=>String(h).toLowerCase());
    let qty=null; for(const mark of ['кол-во','количество','qty']){ const i=ll.findIndex(h=>h.includes(mark)); if(i!==-1){ qty=HEADERS[i]; break; } }
    let nameA=null, nameB=null;
    const iEq=ll.findIndex(h=>h.includes('оборуд')||h.includes('наимен')); if(iEq!==-1) nameA=HEADERS[iEq];
    const iMod=ll.findIndex(h=>h.includes('модель')||h.includes('model')); if(iMod!==-1) nameB=HEADERS[iMod];
    if(!nameA) nameA=HEADERS[1]||HEADERS[0];
    COL_GUESS={qty,nameA,nameB};
  }

  function uniqueObjects(){
    const map=new Map();
    for(const r of ROWS){ const key=String(r[OBJECT_COL]??'').trim()||'(без объекта)'; map.set(key,(map.get(key)||0)+1); }
    return [...map.entries()].map(([name,count])=>({name,count})).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  }

  function renderObjects(){
    objectDetail.classList.add('hidden'); // hide detail on tiles screen
    const q=(searchEl.value||'').toLowerCase(); objectsEl.innerHTML='';
    for(const obj of uniqueObjects()){
      if(q && !obj.name.toLowerCase().includes(q)) continue;
      const div=document.createElement('div'); div.className='card-object'; div.dataset.name=obj.name;
      div.innerHTML=`<div class="title">${escapeHtml(obj.name)}</div><div class="small">Позиций: <span class="badge">${obj.count}</span></div>`;
      div.addEventListener('click',()=>{ FILTER_OBJ=obj.name; renderObjectDetail(); });
      objectsEl.appendChild(div);
    }
  }

  async function saveRowChange(rowId,col,value){
    const idx=ROWS.findIndex(r=>r.id===rowId);
    if(idx>=0){ ROWS[idx]={...ROWS[idx],[col]:value}; await idb.put('rows',{id:rowId,payload:ROWS[idx]}); }
  }

  function renderObjectDetail(){
    objectDetail.classList.remove('hidden'); cardsGrid.classList.add('hidden'); cardsToolbar.classList.add('hidden'); tableWrap.classList.add('hidden');
    objectTitle.textContent=`Объект: ${FILTER_OBJ}`;
    const rows=ROWS.filter(r=>String(r[OBJECT_COL]??'').trim()===FILTER_OBJ);
    objectItems.innerHTML='';
    for(const r of rows){
      const nameMain=String(r[COL_GUESS.nameA]??'').trim();
      const nameSub=String(r[COL_GUESS.nameB]??'').trim();
      const qtyCol=COL_GUESS.qty; const serialCol='Серийный номер';
      const qtyVal=qtyCol ? (parseInt(r[qtyCol]||'0',10)||0) : 0;

      const card=document.createElement('div'); card.className='item-card';
      card.innerHTML=`
        <div class="item-head">
          <div class="item-title">${escapeHtml(nameMain||'(позиция)')}</div>
          <div class="qty-controls">
            <button class="btn-secondary" data-act="dec">-</button>
            <span class="badge" data-role="qty">${qtyVal}</span>
            <button class="btn-secondary" data-act="inc">+</button>
          </div>
        </div>
        ${nameSub?`<div class="small" style="margin-bottom:6px">${escapeHtml(nameSub)}</div>`:''}
        <div class="serial-wrap">
          <label class="small">Серийный номер</label>
          <input type="text" value="${escapeHtml(r[serialCol]??'')}" data-role="serial">
        </div>`;

      const decBtn=card.querySelector('[data-act="dec"]');
      const incBtn=card.querySelector('[data-act="inc"]');
      const qtySpan=card.querySelector('[data-role="qty"]');
      const serialInput=card.querySelector('[data-role="serial"]');

      decBtn.addEventListener('click',async()=>{ let q=parseInt(qtySpan.textContent,10)||0; if(q>0) q--; qtySpan.textContent=q; if(qtyCol) await saveRowChange(r.id, qtyCol, String(q)); });
      incBtn.addEventListener('click',async()=>{ let q=parseInt(qtySpan.textContent,10)||0; q++; qtySpan.textContent=q; if(qtyCol) await saveRowChange(r.id, qtyCol, String(q)); });
      serialInput.addEventListener('blur', async()=>{ await saveRowChange(r.id, serialCol, serialInput.value); });

      objectItems.appendChild(card);
    }
  }

  function renderTable(){
    objectDetail.classList.add('hidden'); cardsGrid.classList.add('hidden'); cardsToolbar.classList.add('hidden'); tableWrap.classList.remove('hidden');
    theadEl.innerHTML='<tr>'+HEADERS.map(h=>`<th>${escapeHtml(h)}</th>`).join('')+'</tr>';
    const filter=(filterEl.value||'').toLowerCase();
    const rows=ROWS.filter(r=>{
      if(FILTER_OBJ && String(r[OBJECT_COL]??'').trim()!==FILTER_OBJ) return false;
      if(!filter) return true;
      return HEADERS.some(h=>String(r[h]??'').toLowerCase().includes(filter));
    });
    tbodyEl.innerHTML='';
    for(const r of rows){
      const tr=document.createElement('tr');
      for(const h of HEADERS){
        const td=document.createElement('td'); td.textContent=r[h]??''; td.dataset.rowId=r.id; td.dataset.col=h;
        td.addEventListener('dblclick',()=>editCell(td)); tr.appendChild(td);
      }
      tbodyEl.appendChild(tr);
    }
  }

  function editCell(td){
    const rowId=td.dataset.rowId, col=td.dataset.col, oldValue=td.textContent;
    const input=document.createElement('input'); input.type='text'; input.value=oldValue; input.style.width='100%';
    td.textContent=''; td.appendChild(input); input.focus(); input.select();
    const commit=async()=>{ const v=input.value; td.removeChild(input); td.textContent=v; await saveRowChange(rowId,col,v); };
    input.addEventListener('keydown',e=>{ if(e.key==='Enter'){commit();} if(e.key==='Escape'){ td.removeChild(input); td.textContent=oldValue; } });
    input.addEventListener('blur',commit);
  }

  // Controls
  btnBackToTiles.addEventListener('click',()=>{ objectDetail.classList.add('hidden'); FILTER_OBJ=''; renderObjects(); });
  btnExport.addEventListener('click',()=>{ const out={headers:HEADERS,objectColumn:OBJECT_COL,rows:ROWS}; const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='vef2025_export.json'; a.click(); URL.revokeObjectURL(url); });
  fileImport.addEventListener('change', async e=>{ const f=e.target.files[0]; if(!f) return; const t=await f.text(); let j=null; try{ j=JSON.parse(t); if(!j.headers||!j.rows) throw new Error('Неверный формат'); }catch(err){ alert('Ошибка JSON: '+err.message); return; } HEADERS=j.headers; OBJECT_COL=j.objectColumn||HEADERS[0]; ROWS=j.rows.map(r=>r.id?r:{id:crypto.randomUUID(),...r}); await idb.clear('rows'); for(const r of ROWS){ await idb.put('rows',{id:r.id,payload:r}); } await saveHeaders(); guessColumns(); renderObjects(); renderTable(); alert('Импорт завершён.'); });
  btnClearCache.addEventListener('click', async()=>{ if(!confirm('Сбросить локальные изменения и кэш?')) return; await idb.clear('rows'); await idb.clear('meta'); await idb.clear('comments'); if('caches' in window){ const ks=await caches.keys(); for(const k of ks){ await caches.delete(k);} } location.reload(); });
  btnAddRow.addEventListener('click', async()=>{ const obj=FILTER_OBJ || prompt('Название объекта для новой строки:', '(без объекта)'); if(obj===null) return; const row={id:crypto.randomUUID()}; for(const h of HEADERS){ row[h]=(h===OBJECT_COL)?obj:''; } ROWS.unshift(row); await idb.put('rows',{id:row.id,payload:row}); renderObjects(); FILTER_OBJ=obj; renderObjectDetail(); });
  btnAddCol.addEventListener('click', async()=>{ const name=prompt('Название нового столбца:','Серийный номер'); if(!name) return; if(HEADERS.includes(name)){ alert('Такой столбец уже есть.'); return; } HEADERS.push(name); for(const r of ROWS){ r[name]=''; await idb.put('rows',{id:r.id,payload:r}); } await saveHeaders(); guessColumns(); renderTable(); });
  btnRenameCol.addEventListener('click', async()=>{ const from=prompt('Какой столбец переименовать? Укажите точное имя:', HEADERS[0]||''); if(!from||!HEADERS.includes(from)){ alert('Столбец не найден.'); return; } const to=prompt(`Новое имя для столбца "${from}":`, from); if(!to||to===from) return; if(HEADERS.includes(to)){ alert('Столбец с таким именем уже есть.'); return; } HEADERS=HEADERS.map(h=>h===from?to:h); if(OBJECT_COL===from) OBJECT_COL=to; for(const r of ROWS){ r[to]=r[from]; delete r[from]; await idb.put('rows',{id:r.id,payload:r}); } await saveHeaders(); guessColumns(); renderObjects(); renderTable(); });
  btnDelCol.addEventListener('click', async()=>{ const name=prompt('Какой столбец удалить? Укажите точное имя:'); if(!name||!HEADERS.includes(name)){ alert('Столбец не найден.'); return; } if(name===OBJECT_COL){ alert('Нельзя удалить столбец объектов.'); return; } if(!confirm(`Удалить столбец "${name}"?`)) return; HEADERS=HEADERS.filter(h=>h!==name); for(const r of ROWS){ delete r[name]; await idb.put('rows',{id:r.id,payload:r}); } await saveHeaders(); guessColumns(); renderTable(); });
  btnObjectCol.addEventListener('click', async()=>{ const name=prompt('Какой столбец считать столбцом объектов?', OBJECT_COL||HEADERS[0]); if(!name||!HEADERS.includes(name)){ alert('Такого столбца нет.'); return; } OBJECT_COL=name; await saveHeaders(); renderObjects(); });

  document.addEventListener('keydown', e=>{ if(e.ctrlKey && e.key.toLowerCase()==='s'){ e.preventDefault(); alert('Изменения сохраняются локально автоматически.'); } });
  searchEl.addEventListener('input', ()=>renderObjects());
  filterEl.addEventListener('input', ()=>renderTable());

  loadInitialData().then(()=>{ ensureSerialColumn(); guessColumns(); renderObjects(); }).catch(err=>{ console.error(err); alert('Ошибка загрузки данных: '+err.message); });
})();
