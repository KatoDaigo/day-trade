/**
 * Daytrade Journal (Simplified)
 * - 3 pages:
 *   - dashboard (index.html): overview + equity curve
 *   - daily input (new.html): per-day total PnL + screenshot + CSV upload/update
 *   - calendar (trades.html): calendar + day detail
 *
 * Data model (per day):
 * {
 *   id,
 *   date: "YYYY-MM-DD",
 *   pnl: number,               // total PnL for the day (JPY)
 *   memo?: string,
 *   shotDataUrl?: string,      // legacy single screenshot (data URL)
 *   shotDataUrls?: string[],   // new multi screenshots (data URL)
 *   createdAt,
 *   updatedAt
 * }
 *
 * CSV base (optional):
 * {
 *   name: string,
 *   text: string,
 *   updatedAt: number
 * }
 */
console.log("APPJS LOADED v5-zoom-modal", new Date().toISOString());

const STORAGE_DAYS_KEY = "dtj_days_v1";
const STORAGE_CSV_KEY  = "dtj_csv_base_v1";
// legacy trades (will migrate once if days is empty)
const LEGACY_TRADES_KEY = "dtj_trades_v3";

const $ = (sel) => document.querySelector(sel);

const state = {
  days: loadDays(),
  calendar: {
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0-11
    selectedDate: toISODate(new Date()),
  },
  dialogDate: null,
};

boot();

function boot(){
  // NOTE: 初回起動時に旧データを自動取り込みしない（常に新規入力スタート）
  // if(state.days.length === 0) migrateFromLegacyTrades();

  // common: image zoom dialog init
  initImageZoomDialog();

  const page = document.body.dataset.page;
  if(page === "dashboard") initDashboard();
  if(page === "new") initDaily();
  if(page === "trades") initCalendar();

  // common: clear all (only exists on dashboard)
  const clearBtn = $("#btnClearAll");
  if(clearBtn){
    clearBtn.addEventListener("click", () => {
      if(!confirm("全データ（損益・スクショ・CSV情報）を削除します。よろしいですか？")) return;
      localStorage.removeItem(STORAGE_DAYS_KEY);
      localStorage.removeItem(STORAGE_CSV_KEY);
      // 旧バージョンのデータも消して完全に空にする
      localStorage.removeItem(LEGACY_TRADES_KEY);
      state.days = [];
      location.reload();
    });
  }
}

/* ---------------- common: image zoom ---------------- */
function initImageZoomDialog(){
  const dialog = document.getElementById("imgZoomDialog");
  if(!dialog) return;

  // backdropクリックで閉じる（中身クリックは閉じない）
  if(!dialog.dataset.bound){
    dialog.addEventListener("click", (e) => {
      if(e.target === dialog) dialog.close();
    });
    dialog.dataset.bound = "1";
  }
}

function openImageZoom(url){
  const dialog = document.getElementById("imgZoomDialog");
  const img = document.getElementById("imgZoomTarget");
  if(!dialog || !img) return;

  img.src = url;
  dialog.showModal();
}

/* ---------------- storage ---------------- */
function loadDays(){
  try{
    const raw = localStorage.getItem(STORAGE_DAYS_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}
function saveDays(list){
  localStorage.setItem(STORAGE_DAYS_KEY, JSON.stringify(list));
}
function loadCsvBase(){
  try{
    const raw = localStorage.getItem(STORAGE_CSV_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed || typeof parsed !== "object") return null;
    if(typeof parsed.text !== "string") return null;
    return parsed;
  }catch{
    return null;
  }
}
function saveCsvBase(obj){
  localStorage.setItem(STORAGE_CSV_KEY, JSON.stringify(obj));
}

/* ---------------- helpers ---------------- */
function toISODate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function parseISODate(s){
  return new Date(s + "T00:00:00");
}
function num(v){
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function yen(n){
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}¥${abs.toLocaleString("ja-JP", {maximumFractionDigits:0})}`;
}
function shorten(s, n){
  if(!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function cryptoId(){
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// Convert pasted image to a smaller dataURL (JPEG) so it can be saved in localStorage.
async function imageFileToDataUrl(file, opts={}){
  const maxW = opts.maxW ?? 1100;
  const maxH = opts.maxH ?? 1100;
  const quality = opts.quality ?? 0.82; // jpeg

  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if(!iw || !ih) return dataUrl;

  const scale = Math.min(1, maxW / iw, maxH / ih);
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  return canvas.toDataURL("image/jpeg", quality);
}

function approxBytesFromDataUrl(dataUrl){
  if(!dataUrl) return 0;
  const idx = dataUrl.indexOf(",");
  const b64 = idx >= 0 ? dataUrl.slice(idx+1) : dataUrl;
  return Math.floor(b64.length * 0.75);
}

function normalizeShots(rec){
  // backward compatible:
  // - new: shotDataUrls: string[]
  // - old: shotDataUrl: string
  const arr = Array.isArray(rec?.shotDataUrls) ? rec.shotDataUrls.filter(Boolean) : [];
  if(arr.length) return arr;
  if(rec?.shotDataUrl && typeof rec.shotDataUrl === "string") return [rec.shotDataUrl];
  return [];
}

function renderShotGrid(container, shots, opts={}){
  if(!container) return;
  const editable = !!opts.editable;
  const onRemove = typeof opts.onRemove === "function" ? opts.onRemove : null;

  container.innerHTML = "";
  const list = Array.isArray(shots) ? shots : [];
  if(list.length === 0) return;

  list.forEach((url, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "shot-thumb";

    const img = document.createElement("img");
    img.src = url;
    img.alt = `screenshot ${idx+1}`;
    img.title = "クリックで拡大";
    img.addEventListener("click", () => {
      // same tab, fluffy zoom
      openImageZoom(url);
    });
    wrap.appendChild(img);

    if(editable){
      const x = document.createElement("button");
      x.type = "button";
      x.className = "shot-x";
      x.textContent = "×";
      x.title = "削除";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        onRemove && onRemove(idx);
      });
      wrap.appendChild(x);
    }

    container.appendChild(wrap);
  });
}

function showToast(node, message){
  if(!node) return;
  node.textContent = message || "OK";
  node.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { node.hidden = true; }, 1600);
}

function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfYear(d){ return new Date(d.getFullYear(), 0, 1); }

/* ---------------- legacy migration ---------------- */
function migrateFromLegacyTrades(){
  try{
    const raw = localStorage.getItem(LEGACY_TRADES_KEY);
    if(!raw) return;
    const trades = JSON.parse(raw);
    if(!Array.isArray(trades) || trades.length === 0) return;

    // build date -> pnl sum
    const map = new Map();
    for(const t of trades){
      const date = t?.date;
      if(!date || typeof date !== "string") continue;
      // legacy calc
      const side = t.side;
      const entry = num(t.entry), exit = num(t.exit), qty = num(t.qty), fee = num(t.fee);
      const gross = (side === "short") ? (entry - exit) * qty : (exit - entry) * qty;
      const pnl = gross - fee;

      map.set(date, (map.get(date) || 0) + pnl);
    }

    const days = [...map.entries()]
      .sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([date, pnl]) => ({
        id: cryptoId(),
        date,
        pnl: Math.round(pnl),
        memo: "（旧データから自動変換）",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

    if(days.length){
      state.days = days;
      saveDays(state.days);
      console.log("Migrated legacy trades -> days:", days.length);
    }
  }catch(err){
    console.warn("Legacy migration failed:", err);
  }
}

/* ---------------- dashboard page ---------------- */
function initDashboard(){
  const el = {
    pnlToday: $("#pnlToday"),
    pnlMonth: $("#pnlMonth"),
    pnlYear: $("#pnlYear"),
    cntToday: $("#cntToday"),
    cntMonth: $("#cntMonth"),
    cntYear: $("#cntYear"),
    pnlTotal: $("#pnlTotal"),
    dotHealth: $("#dotHealth"),
    healthText: $("#healthText"),
    canvas: $("#equityCanvas"),
  };

  const now = new Date();
  const todayStr = toISODate(now);
  const m0 = startOfMonth(now);
  const y0 = startOfYear(now);

  const today = state.days.filter(d => d.date === todayStr);
  const month = state.days.filter(d => parseISODate(d.date) >= m0);
  const year = state.days.filter(d => parseISODate(d.date) >= y0);

  const sum = (list) => list.reduce((acc,d)=> acc + num(d.pnl), 0);

  const sToday = sum(today);
  const sMonth = sum(month);
  const sYear  = sum(year);

  setMetric(el.pnlToday, sToday);
  setMetric(el.pnlMonth, sMonth);
  setMetric(el.pnlYear,  sYear);

  el.cntToday.textContent = `${today.length} days`;
  el.cntMonth.textContent = `${month.length} days`;
  el.cntYear.textContent = `${year.length} days`;

  // status
  el.dotHealth.classList.remove("good","bad");
  if(state.days.length === 0){
    el.healthText.textContent = "No data";
  }else{
    el.dotHealth.classList.add(sToday < 0 ? "bad" : "good");
    el.healthText.textContent = sToday < 0 ? "Be calm" : "Good pace";
  }

  // equity curve by date asc
  const sorted = [...state.days].sort((a,b)=> a.date.localeCompare(b.date));
  const points = [];
  let acc = 0;
  for(const d of sorted){
    acc += num(d.pnl);
    points.push({date:d.date, value:acc});
  }
  const total = points.length ? points[points.length-1].value : 0;
  el.pnlTotal.textContent = yen(total);

  drawEquity(el.canvas, points);
  window.addEventListener("resize", () => drawEquity(el.canvas, points));
}

function setMetric(node, pnl){
  node.textContent = yen(pnl);
  node.classList.toggle("good", pnl > 0);
  node.classList.toggle("bad", pnl < 0);
}

function drawEquity(canvas, points){
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const w = canvas.width = canvas.clientWidth * dpr;
  const h = canvas.height = canvas.clientHeight * dpr;

  ctx.clearRect(0,0,w,h);

  const pad = 14 * dpr;
  const gh = h - pad*2;
  const gw = w - pad*2;

  // grid
  ctx.lineWidth = 1 * dpr;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for(let i=0;i<=4;i++){
    const y = pad + gh*(i/4);
    ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke();
  }
  for(let i=0;i<=6;i++){
    const x = pad + gw*(i/6);
    ctx.beginPath(); ctx.moveTo(x,pad); ctx.lineTo(x,h-pad); ctx.stroke();
  }

  if(points.length < 2){
    ctx.fillStyle = "rgba(168,179,214,0.85)";
    ctx.font = `${12*dpr}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText("記録が増えると損益推移が表示されます", pad, pad + 18*dpr);
    return;
  }

  const vals = points.map(p=>p.value);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if(min === max){ min -= 1; max += 1; }

  const xOf = (i) => pad + (gw * (i/(points.length-1)));
  const yOf = (v) => {
    const t = (v - min) / (max - min);
    return (h - pad) - gh * t;
  };

  // line
  ctx.lineWidth = 2.2 * dpr;
  ctx.strokeStyle = "rgba(122,162,255,0.85)";
  ctx.beginPath();
  points.forEach((p,i)=>{
    const x = xOf(i);
    const y = yOf(p.value);
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // last point
  const last = points[points.length-1];
  const lx = xOf(points.length-1);
  const ly = yOf(last.value);

  ctx.fillStyle = last.value >= 0 ? "rgba(57,217,138,0.95)" : "rgba(255,92,122,0.95)";
  ctx.beginPath();
  ctx.arc(lx, ly, 3.2 * dpr, 0, Math.PI*2);
  ctx.fill();
}

/* ---------------- daily input page ---------------- */
function initDaily(){
  const el = {
    btnSave: $("#btnSave"),
    btnGoCal: $("#btnGoCal"),
    dotSave: $("#dotSave"),
    saveText: $("#saveText"),

    fDate: $("#fDate"),
    fPnl: $("#fPnl"),
    fMemo: $("#fMemo"),

    pasteArea: $("#pasteArea"),
    shotGrid: $("#shotGrid"),
    btnClearShot: $("#btnClearShot"),

    toast: $("#toast"),

    csvFile: $("#csvFile"),
    csvStatus: $("#csvStatus"),
    btnSaveCsv: $("#btnSaveCsv"),
    btnExportCsv: $("#btnExportCsv"),
  };

  // set date from query or today
  const qp = new URLSearchParams(location.search);
  const qdate = qp.get("date");
  const defaultDate = (qdate && /^\d{4}-\d{2}-\d{2}$/.test(qdate)) ? qdate : toISODate(new Date());
  el.fDate.value = defaultDate;

  let currentShots = [];

  // load existing day record by date
  const existing = findDayByDate(defaultDate);
  if(existing){
    el.fPnl.value = String(existing.pnl ?? "");
    el.fMemo.value = existing.memo || "";
    currentShots = normalizeShots(existing);
    if(currentShots.length){
      el.pasteArea.querySelector(".paste-text").style.display = "none";
    }
    el.saveText.textContent = "Edit";
  }else{
    el.saveText.textContent = "Ready";
  }

  const removeShot = (idx) => {
    currentShots.splice(idx, 1);
    renderShotGrid(el.shotGrid, currentShots, { editable:true, onRemove: removeShot });
    el.pasteArea.querySelector(".paste-text").style.display = currentShots.length ? "none" : "block";
  };

  renderShotGrid(el.shotGrid, currentShots, { editable:true, onRemove: removeShot });

  // CSV status
  refreshCsvStatus();

  el.btnGoCal?.addEventListener("click", () => {
    const d = el.fDate.value || toISODate(new Date());
    location.href = `./trades.html?date=${encodeURIComponent(d)}`;
  });

  // Save day record
  el.btnSave.addEventListener("click", () => {
    const date = el.fDate.value;
    const pnl = num(el.fPnl.value);
    if(!date){
      alert("日付は必須です。");
      return;
    }
    if(!Number.isFinite(pnl)){
      alert("合計損益（数値）を入力してください。");
      return;
    }

    const memo = (el.fMemo.value || "").trim();

    const next = {
      date,
      pnl: Math.round(pnl),
      memo,
      shotDataUrls: currentShots.length ? currentShots : undefined,
      updatedAt: Date.now(),
    };

    try{
      const idx = state.days.findIndex(d => d.date === date);
      if(idx >= 0){
        const prev = state.days[idx];
        state.days[idx] = {
          ...prev,
          ...next,
          createdAt: prev.createdAt || Date.now(),
        };
        // remove legacy single key if exists
        delete state.days[idx].shotDataUrl;
      }else{
        state.days.push({
          id: cryptoId(),
          createdAt: Date.now(),
          ...next,
        });
      }

      // keep sorted for stable display
      state.days.sort((a,b)=> a.date.localeCompare(b.date));
      saveDays(state.days);

      // warn if images too big
      if(currentShots.length){
        const bytes = currentShots.reduce((acc,u)=> acc + approxBytesFromDataUrl(u), 0);
        if(bytes > 1400 * 1024){
          console.warn("Screenshots total is large:", bytes, "bytes");
        }
      }
    }catch(err){
      console.error(err);
      alert("保存に失敗しました。スクショが大きすぎると保存できないことがあります。\n→ 画像を減らす/貼り直す/サイズを小さくして試してください。");
      return;
    }

    // badge + toast
    el.dotSave.classList.remove("bad");
    el.dotSave.classList.add("good");
    el.saveText.textContent = "Saved";
    showToast(el.toast, "保存されました");
    setTimeout(()=> {
      el.dotSave.classList.remove("good");
      el.saveText.textContent = "Ready";
    }, 900);
  });

  // Screenshot paste (multi, SAVED)
  el.pasteArea.addEventListener("paste", async (e) => {
    const item = [...(e.clipboardData?.items || [])].find(it => it.type.startsWith("image/"));
    if(!item) return;

    const file = item.getAsFile();
    if(!file) return;

    try{
      const dataUrl = await imageFileToDataUrl(file, {maxW: 1300, maxH: 1300, quality: 0.82});
      currentShots.push(dataUrl);
      el.pasteArea.querySelector(".paste-text").style.display = "none";
      renderShotGrid(el.shotGrid, currentShots, { editable:true, onRemove: removeShot });
      showToast(el.toast, `スクショを追加しました（${currentShots.length}枚）`);
    }catch(err){
      console.error(err);
      alert("スクショの取り込みに失敗しました。画像が大きすぎる可能性があります。");
    }
  });

  el.btnClearShot.addEventListener("click", () => {
    if(!currentShots.length) return;
    if(!confirm("スクショをすべて消しますか？")) return;
    currentShots = [];
    renderShotGrid(el.shotGrid, currentShots, { editable:true, onRemove:()=>{} });
    const t = el.pasteArea.querySelector(".paste-text");
    if(t) t.style.display = "block";
  });

  // CSV: save uploaded base
  el.btnSaveCsv.addEventListener("click", async () => {
    const f = el.csvFile.files?.[0];
    if(!f){
      alert("CSVファイルを選択してください。");
      return;
    }
    if(f.size > 2.5 * 1024 * 1024){
      alert("CSVが大きすぎます（目安 2.5MB 以内）。必要なら列を減らす/期間を分けてください。");
      return;
    }
    const text = await readFileAsText(f);
    saveCsvBase({ name: f.name, text, updatedAt: Date.now() });
    refreshCsvStatus();
    showToast(el.toast, "CSVを保存しました");
  });

  // CSV: update for current date + pnl and download
  el.btnExportCsv.addEventListener("click", async () => {
    const date = el.fDate.value;
    const pnl = num(el.fPnl.value);
    if(!date){
      alert("日付を入力してください。");
      return;
    }

    let base = loadCsvBase();
    // If no saved base, try current file input
    if(!base){
      const f = el.csvFile.files?.[0];
      if(f){
        if(f.size > 2.5 * 1024 * 1024){
          alert("CSVが大きすぎます（目安 2.5MB 以内）。必要なら列を減らす/期間を分けてください。");
          return;
        }
        const text = await readFileAsText(f);
        base = { name: f.name, text, updatedAt: Date.now() };
        saveCsvBase(base);
      }
    }

    const baseText = base?.text || "";
    const updatedText = updateCsvText(baseText, date, Math.round(pnl));
    const fileName = makeUpdatedCsvName(base?.name || "pnl.csv");

    downloadTextAsFile(updatedText, fileName, "text/csv;charset=utf-8");
    showToast(el.toast, "CSVを更新してダウンロードしました");
  });

  function refreshCsvStatus(){
    const base = loadCsvBase();
    if(!el.csvStatus) return;
    if(!base){
      el.csvStatus.textContent = "（未アップロード）";
      return;
    }
    const d = new Date(base.updatedAt || Date.now());
    el.csvStatus.textContent = `保存済み: ${base.name}（${d.toLocaleString("ja-JP")}）`;
  }
}

function findDayByDate(date){
  return state.days.find(d => d.date === date);
}

/* ---------------- calendar page ---------------- */
function initCalendar(){
  const el = {
    calTitle: $("#calTitle"),
    calGrid: $("#calGrid"),
    btnPrev: $("#btnPrev"),
    btnNext: $("#btnNext"),
    btnToday: $("#btnToday"),
    dayTitle: $("#dayTitle"),
    dayDot: $("#dayDot"),
    daySum: $("#daySum"),
    dayList: $("#dayList"),
    dayEmpty: $("#dayEmpty"),
    btnNewForDay: $("#btnNewForDay"),

    dialog: $("#detailDialog"),
    btnCloseDialog: $("#btnCloseDialog"),
    btnEdit: $("#btnEdit"),
    btnDelete: $("#btnDelete"),
    dTitle: $("#dTitle"),
    dSub: $("#dSub"),
    dPnl: $("#dPnl"),
    dMemo: $("#dMemo"),
    dShotWrap: $("#dShotWrap"),
    dShotGrid: $("#dShotGrid"),
    dCsvInfo: $("#dCsvInfo"),
    btnDownloadCsv: $("#btnDownloadCsv"),
  };

  // query param date
  const qp = new URLSearchParams(location.search);
  const qdate = qp.get("date");
  if(qdate && /^\d{4}-\d{2}-\d{2}$/.test(qdate)){
    state.calendar.selectedDate = qdate;
    const d = parseISODate(qdate);
    state.calendar.year = d.getFullYear();
    state.calendar.month = d.getMonth();
  }

  // calendar controls
  el.btnPrev.addEventListener("click", () => {
    state.calendar.month--;
    if(state.calendar.month < 0){ state.calendar.month = 11; state.calendar.year--; }
    renderCalendar(el);
  });
  el.btnNext.addEventListener("click", () => {
    state.calendar.month++;
    if(state.calendar.month > 11){ state.calendar.month = 0; state.calendar.year++; }
    renderCalendar(el);
  });
  el.btnToday.addEventListener("click", () => {
    const now = new Date();
    state.calendar.year = now.getFullYear();
    state.calendar.month = now.getMonth();
    state.calendar.selectedDate = toISODate(now);
    renderCalendar(el);

    const url = new URL(location.href);
    url.searchParams.set("date", state.calendar.selectedDate);
    history.replaceState(null, "", url.toString());
  });

  el.btnNewForDay.addEventListener("click", () => {
    location.href = `./new.html?date=${encodeURIComponent(state.calendar.selectedDate)}`;
  });

  el.btnCloseDialog.addEventListener("click", () => el.dialog.close());

  el.btnEdit.addEventListener("click", () => {
    if(!state.dialogDate) return;
    location.href = `./new.html?date=${encodeURIComponent(state.dialogDate)}`;
  });

  el.btnDelete.addEventListener("click", () => {
    const date = state.dialogDate;
    if(!date) return;
    if(!confirm(`${date} の記録を削除しますか？`)) return;

    state.days = state.days.filter(d => d.date !== date);
    saveDays(state.days);

    el.dialog.close();
    renderCalendar(el);
  });

  // CSV open (download the saved base)
  el.btnDownloadCsv?.addEventListener("click", () => {
    const base = loadCsvBase();
    if(!base?.text){
      alert("CSVが未アップロードです。日次入力ページでアップロードしてください。");
      return;
    }
    downloadTextAsFile(base.text, base.name || "base.csv", "text/csv;charset=utf-8");
  });

  renderCalendar(el);
}

function renderCalendar(el){
  state.days = loadDays();

  const y = state.calendar.year;
  const m = state.calendar.month;

  el.calTitle.textContent = `${y}-${String(m+1).padStart(2,"0")}`;

  // build month grid (start from Sunday)
  const first = new Date(y, m, 1);
  const startDow = first.getDay(); // 0 Sun
  const startDate = new Date(y, m, 1 - startDow);

  // header row (dow)
  el.calGrid.innerHTML = "";
  const dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for(const d of dows){
    const h = document.createElement("div");
    h.className = "cal-dow";
    h.textContent = d;
    el.calGrid.appendChild(h);
  }

  // map date -> day record
  const byDate = new Map(state.days.map(d => [d.date, d]));

  // 6 weeks * 7 = 42 cells
  for(let i=0;i<42;i++){
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const iso = toISODate(d);

    const inMonth = d.getMonth() === m;
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (inMonth ? "" : " muted");
    cell.dataset.date = iso;

    const day = document.createElement("div");
    day.className = "cal-day";
    day.textContent = String(d.getDate());
    cell.appendChild(day);

    const rec = byDate.get(iso);
    if(rec){
      const pnl = num(rec.pnl);
      const dot = document.createElement("div");
      dot.className = "cal-dot " + (pnl>0 ? "good" : pnl<0 ? "bad" : "");
      cell.appendChild(dot);
    }

    if(iso === state.calendar.selectedDate) cell.classList.add("selected");

    cell.addEventListener("click", () => {
      if(!inMonth){
        state.calendar.year = d.getFullYear();
        state.calendar.month = d.getMonth();
      }
      state.calendar.selectedDate = iso;

      const url = new URL(location.href);
      url.searchParams.set("date", iso);
      history.replaceState(null, "", url.toString());

      renderCalendar(el);
    });

    el.calGrid.appendChild(cell);
  }

  renderDayDetail(el);
}

function renderDayDetail(el){
  const date = state.calendar.selectedDate;
  const rec = state.days.find(d => d.date === date);

  el.dayTitle.textContent = `Day Detail: ${date}`;

  const pnl = rec ? num(rec.pnl) : 0;
  el.daySum.textContent = yen(pnl);
  el.dayDot.classList.remove("good","bad");
  if(rec){
    el.dayDot.classList.add(pnl < 0 ? "bad" : "good");
  }

  el.dayList.innerHTML = "";
  el.dayEmpty.style.display = rec ? "none" : "block";

  if(!rec) return;

  const item = document.createElement("div");
  item.className = "trade-item";
  item.dataset.date = rec.date;

  item.innerHTML = `
    <div class="trade-left">
      <div class="trade-top">
        <span class="pill mono">Daily</span>
        ${normalizeShots(rec).length ? `<span class="pill mono">📷${normalizeShots(rec).length}</span>` : ``}
        <span class="muted small mono">${escapeHtml(shorten(rec.memo || "（メモなし）", 60))}</span>
      </div>
      <div class="trade-note">${escapeHtml(rec.memo ? shorten(rec.memo, 80) : "（メモなし）")}</div>
    </div>
    <div class="trade-right">
      <div class="trade-pnl mono ${pnl>0?"good":pnl<0?"bad":""}">${yen(pnl)}</div>
      <div class="muted small">tap detail</div>
    </div>
  `;

  item.addEventListener("click", () => openDetail(el, rec.date));
  el.dayList.appendChild(item);
}

function openDetail(el, date){
  const rec = state.days.find(d => d.date === date);
  if(!rec) return;

  state.dialogDate = date;

  const pnl = num(rec.pnl);

  el.dTitle.textContent = "Daily";
  el.dSub.textContent = `${rec.date}`;

  el.dPnl.textContent = yen(pnl);
  el.dPnl.style.color = pnl > 0 ? "var(--good)" : pnl < 0 ? "var(--bad)" : "rgba(231,236,255,.92)";

  if(el.dMemo) el.dMemo.textContent = rec.memo ? rec.memo : "（メモなし）";

  // screenshots
  if(el.dShotWrap && el.dShotGrid){
    const shots = normalizeShots(rec);
    if(shots.length){
      el.dShotWrap.style.display = "block";
      renderShotGrid(el.dShotGrid, shots, { editable:false });
    }else{
      el.dShotGrid.innerHTML = "";
      el.dShotWrap.style.display = "none";
    }
  }

  // csv info
  const base = loadCsvBase();
  if(el.dCsvInfo){
    if(!base){
      el.dCsvInfo.textContent = "（未アップロード）";
      if(el.btnDownloadCsv) el.btnDownloadCsv.disabled = true;
    }else{
      const dt = new Date(base.updatedAt || Date.now()).toLocaleString("ja-JP");
      el.dCsvInfo.textContent = `保存済み: ${base.name}（${dt}）`;
      if(el.btnDownloadCsv) el.btnDownloadCsv.disabled = false;
    }
  }

  el.dialog.showModal();
}

function escapeHtml(s){
  return (s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ---------------- CSV helpers ---------------- */
function readFileAsText(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsText(file);
  });
}

function updateCsvText(baseText, date, pnl){
  // If empty: create new
  const trimmed = (baseText || "").trim();
  if(!trimmed){
    return `date,pnl\n${date},${pnl}\n`;
  }

  const lines = trimmed.split(/\r?\n/).filter(l => l.trim().length > 0);
  if(lines.length === 0){
    return `date,pnl\n${date},${pnl}\n`;
  }

  const first = lines[0].split(",");
  const hasHeader = first.some(c => c.trim().toLowerCase() === "date") && first.some(c => c.trim().toLowerCase() === "pnl");
  const header = hasHeader ? lines[0] : "date,pnl";
  const rows = hasHeader ? lines.slice(1) : lines;

  // Parse to map, keep only first 2 cols if extra (simple mode)
  const map = new Map();
  for(const row of rows){
    const cols = row.split(",");
    const d = (cols[0] || "").trim();
    if(!d) continue;
    const v = (cols[1] || "").trim();
    map.set(d, v);
  }

  map.set(date, String(pnl));

  const outRows = [...map.entries()]
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([d,v]) => `${d},${v}`);

  return header + "\n" + outRows.join("\n") + "\n";
}

function makeUpdatedCsvName(name){
  const safe = (name || "pnl.csv").trim() || "pnl.csv";
  const m = safe.match(/^(.*?)(\.[^.]+)?$/);
  const base = m ? m[1] : safe;
  const ext = (m && m[2]) ? m[2] : ".csv";
  return `${base}_updated${ext}`;
}

function downloadTextAsFile(text, filename, mime){
  const blob = new Blob([text], {type: mime || "text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1200);
}
