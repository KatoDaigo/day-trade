/**
 * Daytrade Journal
 * - 3 pages: dashboard / new / trades(calendar)
 * - Trades stored in localStorage
 *
 * Trade model:
 * {
 *   id,
 *   date(YYYY-MM-DD),
 *   side('long'|'short'),
 *   symbol,
 *   entry,
 *   exit,
 *   qty,
 *   fee,
 *   review,
 *   tags[],
 *   shotDataUrl? (base64 data URL / resized & compressed),
 *   createdAt,
 *   updatedAt
 * }
 */
console.log("APPJS LOADED v3", new Date().toISOString());


const STORAGE_KEY = "dtj_trades_v3";
const $ = (sel) => document.querySelector(sel);

const state = {
  trades: loadTrades(),
  calendar: {
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0-11
    selectedDate: toISODate(new Date()),
  },
  dialogTradeId: null,
};

boot();

function boot(){
  const page = document.body.dataset.page;

  if(page === "dashboard") initDashboard();
  if(page === "new") initNew();
  if(page === "trades") initTrades();

  // common: clear all (only exists on dashboard)
  const clearBtn = $("#btnClearAll");
  if(clearBtn){
    clearBtn.addEventListener("click", () => {
      if(!confirm("全データを削除します。よろしいですか？")) return;
      state.trades = [];
      saveTrades(state.trades);
      // refresh current page view
      location.reload();
    });
  }
}

/* ---------------- storage ---------------- */
function loadTrades(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}
function saveTrades(list){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
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
function parseTags(s){
  return (s || "")
    .split(",")
    .map(t=>t.trim())
    .filter(Boolean)
    .slice(0, 30);
}
function calcPnl(t){
  const entry = num(t.entry), exit = num(t.exit), qty = num(t.qty), fee = num(t.fee);
  const gross = (t.side === "short") ? (entry - exit) * qty : (exit - entry) * qty;
  return gross - fee;
}
function fmtNum(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return "0";
  if(Number.isInteger(x)) return x.toLocaleString("ja-JP");
  return x.toLocaleString("ja-JP", {maximumFractionDigits:2});
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
// NOTE: localStorage has a small quota (often ~5MB). Keeping images small is important.
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

  // Use JPEG for better compression (charts / screenshots are usually fine at 0.82).
  return canvas.toDataURL("image/jpeg", quality);
}

function approxBytesFromDataUrl(dataUrl){
  // Rough estimate: base64 bytes = len * 3/4 (minus header)
  if(!dataUrl) return 0;
  const idx = dataUrl.indexOf(",");
  const b64 = idx >= 0 ? dataUrl.slice(idx+1) : dataUrl;
  return Math.floor(b64.length * 0.75);
}

function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfYear(d){ return new Date(d.getFullYear(), 0, 1); }

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

  const today = state.trades.filter(t => t.date === todayStr);
  const month = state.trades.filter(t => parseISODate(t.date) >= m0);
  const year = state.trades.filter(t => parseISODate(t.date) >= y0);

  const sum = (list) => list.reduce((acc,t)=> acc + calcPnl(t), 0);

  const sToday = sum(today);
  const sMonth = sum(month);
  const sYear = sum(year);

  setMetric(el.pnlToday, sToday);
  setMetric(el.pnlMonth, sMonth);
  setMetric(el.pnlYear, sYear);

  el.cntToday.textContent = `${today.length} trades`;
  el.cntMonth.textContent = `${month.length} trades`;
  el.cntYear.textContent = `${year.length} trades`;

  // status
  el.dotHealth.classList.remove("good","bad");
  if(state.trades.length === 0){
    el.healthText.textContent = "No data";
  }else{
    el.dotHealth.classList.add(sToday < 0 ? "bad" : "good");
    el.healthText.textContent = sToday < 0 ? "Be calm" : "Good pace";
  }

  // equity curve (all trades by date asc)
  const sorted = [...state.trades].sort((a,b)=> a.date.localeCompare(b.date) || (a.createdAt - b.createdAt));
  const points = [];
  let acc = 0;
  for(const t of sorted){
    acc += calcPnl(t);
    points.push({date:t.date, value:acc});
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

/* ---------------- new page ---------------- */
function initNew(){
  const el = {
    btnSave: $("#btnSave"),
    dotSave: $("#dotSave"),
    saveText: $("#saveText"),

    fDate: $("#fDate"),
    fSide: $("#fSide"),
    fSymbol: $("#fSymbol"),
    fFee: $("#fFee"),
    fEntry: $("#fEntry"),
    fExit: $("#fExit"),
    fQty: $("#fQty"),
    fReview: $("#fReview"),
    fTags: $("#fTags"),

    pnlPreview: $("#pnlPreview"),
    pnlExplain: $("#pnlExplain"),

    // screenshot paste (not saved)
    pasteArea: $("#pasteArea"),
    shotImg: $("#shotImg"),
    btnClearShot: $("#btnClearShot"),
  };

  // edit mode ?edit=<id>
  const qp = new URLSearchParams(location.search);
  const editId = qp.get("edit");
  let isEdit = false;
  let currentShotDataUrl = "";

  el.fDate.value = toISODate(new Date());
  el.fSide.value = "long";

  // if came from calendar day link ?date=YYYY-MM-DD
  const qdate = qp.get("date");
  if(qdate && /^\d{4}-\d{2}-\d{2}$/.test(qdate)){
    el.fDate.value = qdate;
  }

  // Load existing trade when editing
  if(editId){
    const t = findById(editId);
    if(t){
      isEdit = true;
      el.btnSave.textContent = "更新";
      el.saveText.textContent = "Edit";
      el.fDate.value = t.date;
      el.fSide.value = t.side;
      el.fSymbol.value = t.symbol || "";
      el.fFee.value = String(t.fee ?? "");
      el.fEntry.value = String(t.entry ?? "");
      el.fExit.value = String(t.exit ?? "");
      el.fQty.value = String(t.qty ?? "");
      el.fReview.value = t.review || "";
      el.fTags.value = (t.tags || []).join(", ");

      if(t.shotDataUrl){
        currentShotDataUrl = t.shotDataUrl;
        el.shotImg.src = currentShotDataUrl;
        el.shotImg.hidden = false;
        el.pasteArea.querySelector(".paste-text").style.display = "none";
      }
    }
  }

  const refreshPreview = () => {
    const t = {
      side: el.fSide.value,
      entry: num(el.fEntry.value),
      exit: num(el.fExit.value),
      qty: num(el.fQty.value),
      fee: num(el.fFee.value),
    };
    const pnl = calcPnl(t);

    el.pnlPreview.textContent = yen(pnl);
    el.pnlPreview.classList.toggle("good", pnl > 0);
    el.pnlPreview.classList.toggle("bad", pnl < 0);

    el.pnlExplain.textContent =
      (t.side === "short")
        ? `（${t.entry} − ${t.exit}）× ${t.qty} − ${t.fee}  ※ショート`
        : `（${t.exit} − ${t.entry}）× ${t.qty} − ${t.fee}  ※ロング`;
  };

  ["input","change"].forEach(evt=>{
    el.fSide.addEventListener(evt, refreshPreview);
    el.fEntry.addEventListener(evt, refreshPreview);
    el.fExit.addEventListener(evt, refreshPreview);
    el.fQty.addEventListener(evt, refreshPreview);
    el.fFee.addEventListener(evt, refreshPreview);
  });
  refreshPreview();

  // Save / Update
  el.btnSave.addEventListener("click", () => {
    const date = el.fDate.value;
    const side = el.fSide.value;
    const entry = num(el.fEntry.value);
    const exit = num(el.fExit.value);
    const qty = num(el.fQty.value);

    if(!date || !entry || !exit || !qty){
      alert("日付・建てた値段・返済した値段・株数は必須です。");
      return;
    }

    const next = {
      date,
      side,
      symbol: (el.fSymbol.value || "").trim(),
      entry,
      exit,
      qty,
      fee: num(el.fFee.value),
      review: (el.fReview.value || "").trim(),
      tags: parseTags(el.fTags.value),
      shotDataUrl: currentShotDataUrl || undefined,
      updatedAt: Date.now(),
    };

    try{
      if(isEdit){
        const idx = state.trades.findIndex(t => t.id === editId);
        if(idx === -1) throw new Error("not found");
        const prev = state.trades[idx];
        state.trades[idx] = {
          ...prev,
          ...next,
          // keep createdAt
          createdAt: prev.createdAt || Date.now(),
        };
      }else{
        const trade = {
          id: cryptoId(),
          createdAt: Date.now(),
          ...next,
        };
        state.trades.unshift(trade);
      }

      // warn if image too big
      if(currentShotDataUrl){
        const bytes = approxBytesFromDataUrl(currentShotDataUrl);
        if(bytes > 1200 * 1024){
          console.warn("Screenshot is large:", bytes, "bytes");
        }
      }

      saveTrades(state.trades);
    }catch(err){
      console.error(err);
      alert("保存に失敗しました。スクショが大きすぎると保存できないことがあります。\n→ 画像をもう一度貼り付けるか、サイズを小さくして試してください。");
      return;
    }

    el.dotSave.classList.remove("bad");
    el.dotSave.classList.add("good");
    el.saveText.textContent = "Saved";
    setTimeout(()=> {
      el.dotSave.classList.remove("good");
      el.saveText.textContent = "Ready";
    }, 900);

    if(isEdit){
      // back to trades page for quick review
      location.href = `./trades.html?date=${date}`;
      return;
    }

    // clear form except date (keep)
    el.fSymbol.value = "";
    el.fFee.value = "";
    el.fEntry.value = "";
    el.fExit.value = "";
    el.fQty.value = "";
    el.fReview.value = "";
    el.fTags.value = "";
    refreshPreview();

    // clear screenshot preview
    currentShotDataUrl = "";
    clearShot(el);

    // optional: move to calendar page
    // location.href = `./trades.html?date=${date}`;
  });

  // Screenshot paste (SAVED)
  el.pasteArea.addEventListener("paste", async (e) => {
    const item = [...(e.clipboardData?.items || [])].find(it => it.type.startsWith("image/"));
    if(!item) return;

    const file = item.getAsFile();
    if(!file) return;

    // convert to compressed dataURL and preview
    const dataUrl = await imageFileToDataUrl(file, {maxW: 1100, maxH: 1100, quality: 0.82});
    currentShotDataUrl = dataUrl;
    el.shotImg.src = dataUrl;
    el.shotImg.hidden = false;
    el.pasteArea.querySelector(".paste-text").style.display = "none";
  });

  el.btnClearShot.addEventListener("click", () => {
    currentShotDataUrl = "";
    clearShot(el);
  });
}

function clearShot(el){
  el.shotImg.hidden = true;
  el.shotImg.src = "";
  const t = el.pasteArea.querySelector(".paste-text");
  if(t) t.style.display = "block";
}

/* ---------------- trades(calendar) page ---------------- */
function initTrades(){
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
    dCalc: $("#dCalc"),
    dShotWrap: $("#dShotWrap"),
    dShotImg: $("#dShotImg"),
    dReview: $("#dReview"),
    dTags: $("#dTags"),
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
    // URLも今日に同期
    const url = new URL(location.href);
    url.searchParams.set("date", state.calendar.selectedDate);
    history.replaceState(null, "", url.toString());

  });

  el.btnNewForDay.addEventListener("click", () => {
    location.href = `./new.html?date=${state.calendar.selectedDate}`;
  });

  el.btnCloseDialog.addEventListener("click", () => el.dialog.close());

  el.btnEdit.addEventListener("click", () => {
    const t = findById(state.dialogTradeId);
    if(!t) return;
    location.href = `./new.html?edit=${t.id}`;
  });

  function syncTradesFromStorage(){
  state.trades = loadTrades(); // localStorageの最新で上書き
  }


  el.btnDelete.addEventListener("click", () => {
    const id = state.dialogTradeId;
    if(!id) return;
    if(!confirm("このトレードを削除しますか？")) return;

    state.trades = state.trades.filter(t => t.id !== id);
    saveTrades(state.trades);

    el.dialog.close();
    renderCalendar(el);
  });

  renderCalendar(el);
}

// ✅ ナビの「トレード一覧」クリックでも、現在選択中の日付を維持
const navTrades = document.querySelector("#navTrades");
if(navTrades){
  navTrades.addEventListener("click", (e) => {
    e.preventDefault();
    location.href = `./trades.html?date=${state.calendar.selectedDate}`;
  });
}

function renderCalendar(el){
  state.trades = loadTrades();

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

  // map date -> summary pnl sign
  const byDate = groupByDate(state.trades);

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

    const has = byDate.has(iso);
    if(has){
      const pnl = byDate.get(iso).reduce((acc,t)=> acc + calcPnl(t), 0);
      const dot = document.createElement("div");
      dot.className = "cal-dot " + (pnl>0 ? "good" : pnl<0 ? "bad" : "");
      cell.appendChild(dot);
    }

    // selected style
    if(iso === state.calendar.selectedDate) cell.classList.add("selected");

    // click
        // click（月外もクリックOK：前月/次月へ移動して選択）
    cell.addEventListener("click", () => {
      // mutedセル（別月）なら、その月へ移動
      if(!inMonth){
        state.calendar.year = d.getFullYear();
        state.calendar.month = d.getMonth();
      }

      state.calendar.selectedDate = iso;

      // URL同期（リロードしても同じ日付）
      const url = new URL(location.href);
      url.searchParams.set("date", iso);
      history.replaceState(null, "", url.toString());

      // カレンダー全再描画（確実性優先）
      renderCalendar(el);
    });


    el.calGrid.appendChild(cell);
  }

  renderDayDetail(el);
}

function renderDayDetail(el){
  const date = state.calendar.selectedDate;
  const list = state.trades
    .filter(t => t.date === date)
    .sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  el.dayTitle.textContent = `Day Detail: ${date}`;

  const sum = list.reduce((acc,t)=> acc + calcPnl(t), 0);
  el.daySum.textContent = yen(sum);
  el.dayDot.classList.remove("good","bad");
  if(list.length === 0){
    el.dayDot.classList.add("");
  }else{
    el.dayDot.classList.add(sum < 0 ? "bad" : "good");
  }

  el.dayList.innerHTML = "";
  el.dayEmpty.style.display = (list.length === 0) ? "block" : "none";

  for(const t of list){
    const pnl = calcPnl(t);
    const sideLabel = t.side === "short" ? "空売り" : "買い";

    const item = document.createElement("div");
    item.className = "trade-item";
    item.dataset.id = t.id;

    item.innerHTML = `
      <div class="trade-left">
        <div class="trade-top">
          <span class="pill mono">${escapeHtml(t.symbol || "NO_SYMBOL")}</span>
          <span class="pill mono">${sideLabel}</span>
          ${t.shotDataUrl ? `<span class="pill mono">📷</span>` : ``}
          <span class="muted small mono">E:${fmtNum(t.entry)} → X:${fmtNum(t.exit)} / Q:${fmtNum(t.qty)} / Fee:${fmtNum(t.fee)}</span>
        </div>
        <div class="trade-note">${escapeHtml(t.review ? shorten(t.review, 70) : "（反省なし）")}</div>
      </div>
      <div class="trade-right">
        <div class="trade-pnl mono ${pnl>0?"good":pnl<0?"bad":""}">${yen(pnl)}</div>
        <div class="muted small">tap detail</div>
      </div>
    `;

    item.addEventListener("click", () => openDetail(el, t.id));
    el.dayList.appendChild(item);
  }
}

function groupByDate(trades){
  const map = new Map();
  for(const t of trades){
    if(!map.has(t.date)) map.set(t.date, []);
    map.get(t.date).push(t);
  }
  return map;
}

function openDetail(el, id){
  const t = findById(id);
  if(!t) return;

  state.dialogTradeId = id;

  const pnl = calcPnl(t);
  const sideLabel = t.side === "short" ? "空売り" : "買い";

  el.dTitle.textContent = t.symbol ? t.symbol : "Trade";
  el.dSub.textContent =
    `${t.date} | ${sideLabel} | Entry ${fmtNum(t.entry)} → Exit ${fmtNum(t.exit)} | Qty ${fmtNum(t.qty)} | Fee ${fmtNum(t.fee)}`;

  el.dPnl.textContent = yen(pnl);
  el.dPnl.style.color = pnl > 0 ? "var(--good)" : pnl < 0 ? "var(--bad)" : "rgba(231,236,255,.92)";

  el.dCalc.textContent = (t.side === "short")
    ? `（${fmtNum(t.entry)} − ${fmtNum(t.exit)}）× ${fmtNum(t.qty)} − ${fmtNum(t.fee)}`
    : `（${fmtNum(t.exit)} − ${fmtNum(t.entry)}）× ${fmtNum(t.qty)} − ${fmtNum(t.fee)}`;

  // screenshot
  if(el.dShotWrap && el.dShotImg){
    if(t.shotDataUrl){
      el.dShotImg.src = t.shotDataUrl;
      el.dShotWrap.style.display = "block";
    }else{
      el.dShotImg.src = "";
      el.dShotWrap.style.display = "none";
    }
  }

  el.dReview.textContent = t.review || "（反省なし）";

  el.dTags.innerHTML = "";
  (t.tags || []).forEach(tag=>{
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = tag;
    el.dTags.appendChild(span);
  });

  el.dialog.showModal();
}

function findById(id){
  return state.trades.find(t => t.id === id);
}

function escapeHtml(s){
  return (s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
