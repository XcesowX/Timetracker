/* Chạy trên Emplanner và các trang tour đã khai báo.
   Mọi khung (frame) đều báo thao tác; chỉ khung chính hiển thị giao diện và đọc đồng hồ. */
(() => {
  if (window.__tgTimeGuard) return;
  window.__tgTimeGuard = true;

  const TOP = window.top === window;
  const IS_EMP = /(^|\.)emplanner\.team$/i.test(location.hostname);
  // Trang Work chạy ẩn trong trang offscreen của extension (người dùng không thấy, không đóng được): chỉ đọc và bấm
  // đồng hồ, không hiện giao diện. Nhận lệnh qua postMessage từ offscreen.js vì khung này không thuộc tab nào.
  const EXT_ORIGIN = (() => { try { return new URL(chrome.runtime.getURL("")).origin; } catch (e) { return ""; } })();
  const HIDDEN_FRAME = !TOP && IS_EMP && (() => { try { const a = location.ancestorOrigins; return !!a && a.length === 1 && a[0] === EXT_ORIGIN; } catch (e) { return false; } })();
  let settings = TG_DEFAULTS;
  tgGetSettings().then(s => { settings = s; renderPanel(); }).catch(() => {});
  chrome.storage.onChanged.addListener(c => {
    if (c.settings) {
      settings = tgMerge(c.settings.newValue);
      renderPanel();
      updateIdleLang();
      if (cardEl && cardInfo) showLogCard(cardInfo, true);
    }
  });

  // Extension vừa được tải lại thì script cũ trên trang mất kết nối: bảng vẫn hiện nhưng không gửi được gì, cần tải lại trang
  const staleMsg = () => tgI18n("cnt_stale", settings.language);
  const stale = () => { try { return !chrome.runtime || !chrome.runtime.id; } catch (e) { return true; } };
  function send(msg) {
    if (stale()) return Promise.resolve(null);
    try { return chrome.runtime.sendMessage(msg).catch(() => null); }
    catch (e) { return Promise.resolve(null); }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- Báo thao tác ---------- */
  let lastSent = 0;
  function onAct(e) {
    if (e && e.isTrusted === false) return;
    const n = Date.now();
    if (n - lastSent < 3000) return;
    lastSent = n;
    const o = TOP && !HIDDEN_FRAME ? pageOrder() : null;
    send(o && o.id ? { type: "activity", orderId: o.id, floor: o.floor } : { type: "activity" });
  }
  if (!HIDDEN_FRAME) {
    for (const ev of ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"]) {
      window.addEventListener(ev, onAct, { capture: true, passive: true });
    }
  }
  if (!TOP && !HIDDEN_FRAME) return;

  /* ---------- Giao diện (Shadow DOM để không ảnh hưởng trang) ---------- */
  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif}
  .stack{position:fixed;top:12px;right:12px;width:360px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;gap:8px;z-index:2147483647}
  .banner{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:6px;border-left:4px solid #2457C5;background:#EEF3FC;color:#1B2433;font-size:13px;line-height:1.45;box-shadow:0 2px 10px rgba(27,36,51,.2)}
  .banner.warn{border-color:#B7791F;background:#FFF6E5}
  .banner.danger{border-color:#B42318;background:#FDEDEB}
  .banner .txt{flex:1}
  .src{display:block;font-size:11px;font-weight:600;color:#5B6576;margin-bottom:2px}
  .x{border:0;background:transparent;cursor:pointer;font-size:18px;line-height:1;color:#5B6576;padding:0 2px}
  .overlay{position:fixed;inset:0;background:rgba(27,36,51,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647}
  .modal{background:#fff;border-radius:10px;padding:22px 26px;width:380px;max-width:calc(100vw - 32px);text-align:center;color:#1B2433;box-shadow:0 12px 40px rgba(0,0,0,.3)}
  .modal h3{margin:0 0 6px;font-size:17px}
  .modal p{margin:6px 0;font-size:14px;line-height:1.5}
  .count{font-size:60px;font-weight:700;font-variant-numeric:tabular-nums;color:#B42318;line-height:1;margin:12px 0 2px}
  .btn{margin-top:14px;padding:10px 20px;border:0;border-radius:6px;background:#1F8A5B;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  .btn.ghost{background:#fff;color:#1B2433;border:1px solid #C5CCD8}
  .btn:focus-visible,.x:focus-visible{outline:2px solid #2457C5;outline-offset:2px}
  .card{position:fixed;right:16px;bottom:16px;width:320px;max-width:calc(100vw - 32px);background:#fff;color:#1B2433;border-radius:10px;border-top:5px solid #2457C5;padding:14px 16px 12px;box-shadow:0 8px 30px rgba(27,36,51,.3);z-index:2147483647}
  .card .head{display:flex;justify-content:space-between;align-items:flex-start}
  .card .order{font-size:14px;font-weight:600}
  .big{font-size:44px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.05;margin:6px 0 2px}
  .big small{font-size:16px;font-weight:600;color:#5B6576}
  .hint{font-size:13px;line-height:1.45;margin:4px 0}
  .note{font-size:12px;line-height:1.45;padding:6px 8px;border-radius:5px;margin-top:6px;background:#FFF6E5}
  .note.danger{background:#FDEDEB}
  .rows{margin-top:8px}
  .rows div{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-top:1px solid #E4E8EE;font-variant-numeric:tabular-nums}
  .rows div.me{font-weight:600}
  .total{font-size:12px;color:#5B6576;margin-top:6px}
  .lt{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;font-variant-numeric:tabular-nums}
  .lt th{text-align:left;font-size:11px;font-weight:600;color:#5B6576;padding:4px 6px;background:#F3F5F9;border-bottom:1px solid #E4E8EE}
  .lt td{padding:4px 6px;border-bottom:1px solid #EEF0F4}
  .lt tr.now td{font-weight:600;color:#17714A}
  .lt td.empty{color:#8A93A3;font-size:12px}
  .lt tfoot td{font-weight:700;border-top:2px solid #C5CCD8;border-bottom:0}
  .lt tr.log td{font-size:12px;font-weight:600;color:#2457C5;background:#EEF3FC}
  .lt tr.unlogged td{font-size:12px;font-weight:600;color:#B42318;background:#FDEDEB}
  .ltw{max-height:45vh;overflow:auto;margin-top:8px}
  .ltw .lt{margin-top:0}
  @media (prefers-reduced-motion:no-preference){.card,.banner{animation:tgIn .18s ease-out}@keyframes tgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}
  .panel{position:fixed;left:16px;bottom:16px;width:240px;min-width:190px;min-height:44px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);display:flex;flex-direction:column;background:#fff;color:#1B2433;border:1px solid #D5DAE2;border-radius:10px;box-shadow:0 6px 24px rgba(27,36,51,.25);overflow:hidden;resize:both;container-type:inline-size;z-index:2147483646}
  .panel .bar{display:flex;align-items:center;gap:6px;padding:5px 6px 5px 10px;background:#F3F5F9;border-bottom:1px solid #E4E8EE;cursor:move;user-select:none;touch-action:none}
  .panel .ttl{flex:1;font-size:12px;font-weight:600;color:#5B6576;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .panel .jbtn{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:transparent;color:#5B6576;cursor:pointer}
  .panel .jbtn:hover{background:#E4E8EE;color:#1B2433}
  .panel .jbtn:focus-visible{outline:2px solid #2457C5;outline-offset:1px}
  .panel .jbtn svg{width:14px;height:14px;fill:currentColor}
  .panel .body{flex:1;padding:8px 12px 10px;overflow:auto}
  .panel .clock{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 4px;padding:4px 6px;border:0;border-radius:8px;background:transparent;color:#393939;cursor:pointer;text-align:left}
  .panel .clock:hover{background:#F3F5F9}
  .panel .clock:focus-visible{outline:2px solid #2457C5;outline-offset:1px}
  .panel .clock:disabled{opacity:.6;cursor:wait}
  .panel .clock .ic{flex:none;display:flex;width:clamp(14px,8cqw,30px)}
  .panel .clock .ic svg{width:100%;height:auto;fill:currentColor}
  .panel .clock .ic.play{color:rgb(88,212,115)}
  .panel .clock .ic.pause{color:rgb(254,173,58)}
  .panel .clock .ic.none{color:#A9B1BE}
  .panel .clock .tm{font-family:"Roboto Mono",ui-monospace,Consolas,monospace;font-weight:400;font-size:clamp(22px,14cqw,64px);line-height:1.1;white-space:nowrap}
  .panel .st{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;background:#EEF0F4;color:#5B6576}
  .panel .st::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
  .panel .st[hidden]{display:none}
  .panel .st.run{background:#E6F4EC;color:#17714A}
  .panel .st.pause{background:#FFF6E5;color:#8A5A00}
  .panel .kv{display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-top:8px;padding-top:6px;border-top:1px solid #E4E8EE}
  .panel .kv b{font-variant-numeric:tabular-nums;white-space:nowrap}
  .panel .pnote{font-size:11px;line-height:1.4;color:#8A5A00;margin-top:4px}
  .panel .segs{margin-top:8px;padding-top:6px;border-top:1px solid #E4E8EE;font-size:12px}
  .panel .segs .sh{font-weight:600;color:#5B6576;margin-bottom:2px}
  .panel .segs table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
  .panel .segs th{text-align:left;font-size:11px;font-weight:600;color:#5B6576;padding:3px 4px;background:#F3F5F9;border-bottom:1px solid #E4E8EE}
  .panel .segs td{padding:3px 4px;border-bottom:1px solid #EEF0F4}
  .panel .segs tr.now td{font-weight:600;color:#17714A}
  .panel .segs .none{color:#8A93A3}
  .panel .sbtn{width:100%;margin-top:8px;padding:7px 10px;border:1px solid #2457C5;border-radius:6px;background:#2457C5;color:#fff;font-size:13px;font-weight:600;cursor:pointer}
  .panel .sbtn.on{background:#fff;color:#2457C5}
  .panel .sbtn:focus-visible{outline:2px solid #2457C5;outline-offset:2px}
  .panel.autoh{resize:horizontal}
  .panel.min{width:auto!important;height:auto!important;min-width:0;min-height:0;resize:none;container-type:normal}
  .panel.min .body{display:none}
  .panel.min .bar{border-bottom:0;gap:10px}
  .panel.min .ttl{flex:none;overflow:visible;font-size:13px;color:#1B2433}
  .panel.min .ttl.err{color:#B42318;cursor:help}
  .panel .mclk{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:2px 6px;margin-left:-4px;border-radius:5px;cursor:pointer;font-family:"Roboto Mono",ui-monospace,Consolas,monospace;font-size:14px;color:#393939;font-variant-numeric:tabular-nums}
  .panel .mclk[hidden]{display:none}
  .panel .mclk:hover{background:#E4E8EE}
  .panel .mclk:focus-visible{outline:2px solid #2457C5;outline-offset:1px}
  .panel .mclk:disabled{opacity:.6;cursor:wait}
  .panel .mclk .mic{display:flex;width:11px}
  .panel .mclk .mic svg{width:100%;height:auto;fill:currentColor}
  .panel .mclk .mic.play{color:rgb(88,212,115)}
  .panel .mclk .mic.pause{color:rgb(254,173,58)}
  .panel .mclk .mic.none{color:#A9B1BE}
  .panel .jbtn.on{background:#DCE6FA;color:#2457C5}
  .jside{position:fixed;max-height:min(70vh,560px);display:flex;flex-direction:column;background:#fff;color:#1B2433;border:1px solid #D5DAE2;border-radius:10px;box-shadow:0 6px 24px rgba(27,36,51,.25);overflow:hidden;z-index:2147483646;font-size:13px}
  .jside .jh{display:flex;align-items:center;gap:6px;padding:5px 8px 5px 12px;background:#F3F5F9;border-bottom:1px solid #E4E8EE}
  .jside .jh b{flex:1;font-size:12px;font-weight:600;color:#5B6576;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .jside .jb{flex:1;overflow:auto;padding:2px 12px 6px}
  .jside .jt{padding:8px 0;border-bottom:1px solid #EEF0F4}
  .jside .jt:last-child{border-bottom:0}
  .jside .jtt{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .jside .jid{font-weight:700}
  .jside .jt.cur .jid{color:#17714A}
  .jside .jtot{font-size:12px;color:#5B6576;font-variant-numeric:tabular-nums;white-space:nowrap}
  .jside .jtot b{color:#1B2433}
  .jside .jtags{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
  .jside .pill{font-size:11px;padding:1px 7px;border-radius:999px;background:#FFF6E5;color:#8A5A00}
  .jside .pill.danger{background:#FDEDEB;color:#B42318}
  .jside .jiv{margin-top:4px;font-family:"Roboto Mono",ui-monospace,Consolas,monospace;font-size:12px;color:#393939}
  .jside .jiv div{display:flex;justify-content:space-between;gap:8px;padding:1px 0}
  .jside .jiv .d{color:#5B6576}
  .jside .empty{color:#8A93A3;font-size:12px;padding:10px 0}
  .jside .jf{padding:5px 12px;border-top:1px solid #E4E8EE;text-align:right}
  .jside .lnk{border:0;background:transparent;color:#2457C5;font-size:12px;cursor:pointer;padding:0}
  .jside .lnk:hover{text-decoration:underline}
  .jside .lnk:focus-visible{outline:2px solid #2457C5;outline-offset:2px}
  `;
  let root = null;
  function ui() {
    if (root) return root;
    const host = document.createElement("div");
    host.id = "tg-time-guard";
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647";
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style><div class="stack"></div>`;
    return root;
  }

  function setBanner(id, level, text) {
    const stack = ui().querySelector(".stack");
    let el = stack.querySelector(`[data-id="${id}"]`);
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = id;
      el.setAttribute("role", "status");
      el.innerHTML = `<div class="txt"><span class="src">Time Guard</span><span class="msg"></span></div><button class="x" aria-label="${tgI18n("cnt_hide_notify", settings.language)}">×</button>`;
      el.querySelector(".x").addEventListener("click", () => el.remove());
      stack.appendChild(el);
    }
    el.className = "banner " + level;
    el.querySelector(".msg").textContent = text;
  }
  function clearBanner(id) {
    if (!root) return;
    const el = root.querySelector(`[data-id="${id}"]`);
    if (el) el.remove();
  }

  /* ---------- Cảnh báo đếm ngược (không thao tác / không làm order) ---------- */
  let idleEl = null, idleTimer = null, expiredSent = false, idleKind = null;
  function updateIdleLang() {
    if (!idleEl) return;
    const lang = settings.language || "vi";
    const word = settings.stopAction === "finish" ? tgI18n("cnt_finish_word", lang) : tgI18n("cnt_pause_word", lang);
    if (idleKind === "noorder") {
      idleEl.querySelector("h3").textContent = tgI18n("cnt_no_order_title", lang);
      idleEl.querySelector(".msg").textContent = tgI18n("cnt_no_order_msg", lang, { min: Math.round(settings.noOrderSeconds / 60) });
      const bSurvey = idleEl.querySelector('[data-a="survey"]');
      if (bSurvey) bSurvey.textContent = tgI18n("cnt_btn_start_survey", lang);
      const bClose = idleEl.querySelector('[data-a="close"]');
      if (bClose) bClose.textContent = tgI18n("cnt_btn_close", lang);
    } else {
      idleEl.querySelector("h3").textContent = tgI18n("cnt_idle_title", lang);
      idleEl.querySelector(".msg").textContent = tgI18n("cnt_idle_msg", lang, { min: Math.round(settings.idleSeconds / 60) });
      const bWorking = idleEl.querySelector('[data-a="working"]');
      if (bWorking) bWorking.textContent = tgI18n("cnt_btn_still_working", lang);
    }
    idleEl.querySelector(".after").textContent = tgI18n("cnt_after_sec", lang, { word });
  }
  function showIdle(deadline, kind) {
    kind = kind || "idle";
    const r = ui();
    if (idleEl && idleKind !== kind) hideIdle();
    idleKind = kind;
    const lang = settings.language || "vi";
    const word = settings.stopAction === "finish" ? tgI18n("cnt_finish_word", lang) : tgI18n("cnt_pause_word", lang);
    if (!idleEl) {
      idleEl = document.createElement("div");
      idleEl.className = "overlay";
      const buttons = kind === "noorder"
        ? `<button class="btn" data-a="survey">${tgI18n("cnt_btn_start_survey", lang)}</button> <button class="btn ghost" data-a="close">${tgI18n("cnt_btn_close", lang)}</button>`
        : `<button class="btn" data-a="working">${tgI18n("cnt_btn_still_working", lang)}</button>`;
      idleEl.innerHTML = `<div class="modal" role="alertdialog" aria-labelledby="tg-idle-h">
        <h3 id="tg-idle-h"></h3><p class="msg"></p><div class="count" aria-live="polite"></div><p class="after"></p>${buttons}</div>`;
      idleEl.addEventListener("click", e => {
        const a = e.target.dataset && e.target.dataset.a;
        if (a === "working") { send({ type: "imWorking" }); hideIdle(); }
        if (a === "survey") { send({ type: "surveyStart" }); hideIdle(); }
        if (a === "close") hideIdle();
      });
      r.appendChild(idleEl);
      const b = idleEl.querySelector(".btn");
      if (b) b.focus();
    }
    if (kind === "noorder") {
      idleEl.querySelector("h3").textContent = tgI18n("cnt_no_order_title", lang);
      idleEl.querySelector(".msg").textContent = tgI18n("cnt_no_order_msg", lang, { min: Math.round(settings.noOrderSeconds / 60) });
    } else {
      idleEl.querySelector("h3").textContent = tgI18n("cnt_idle_title", lang);
      idleEl.querySelector(".msg").textContent = tgI18n("cnt_idle_msg", lang, { min: Math.round(settings.idleSeconds / 60) });
    }
    idleEl.querySelector(".after").textContent = tgI18n("cnt_after_sec", lang, { word });
    expiredSent = false;
    const upd = () => {
      if (!idleEl) return;
      const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      idleEl.querySelector(".count").textContent = s;
      if (s === 0 && !expiredSent) { expiredSent = true; send({ type: "idleExpired", kind }); }
    };
    clearInterval(idleTimer);
    upd();
    idleTimer = setInterval(upd, 500);
  }
  function idleStopping() {
    if (!idleEl) return;
    clearInterval(idleTimer);
    idleEl.querySelector(".count").textContent = "…";
    idleEl.querySelector(".after").textContent = tgI18n("cnt_stopping", settings.language);
  }
  function hideIdle(kind) {
    if (kind && idleKind && kind !== idleKind) return;
    clearInterval(idleTimer);
    if (idleEl) idleEl.remove();
    idleEl = null;
    idleKind = null;
  }

  /* ---------- Thẻ thời gian khi bấm Just log time ---------- */
  let cardEl = null;
  // Bảng log của order, dùng chung cho thẻ log time và bảng nổi trang order. v = { rows, multiDay, cutAt, needMin }.
  // Mọi khoảng đã làm order (cả các ngày trước): [Ngày] | Start time | End time. Sau phần đã log có hàng
  // "Đã log … phút lúc …". Hàng cuối: số phút cần log lần này (phần sau lần log gần nhất)
  function logTableHtml(v, lang) {
    const two = n => String(n).padStart(2, "0");
    const hms = t => { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(two).join(":"); };
    const hm = t => hms(t).slice(0, 5);
    const dm = t => { const d = new Date(t); return two(d.getDate()) + "/" + two(d.getMonth() + 1); };
    const rows = v.rows || [];
    const cols = v.multiDay ? 3 : 2;
    const day = t => v.multiDay ? `<td>${dm(t)}</td>` : "";
    // Hàng "unlogged": ngày cũ còn phần chưa log, cần report (không cộng vào số cần log hôm nay)
    const row = x => x.t === "log"
      ? `<tr class="log"><td colspan="${cols}">${tgEsc(tgI18n(x.min ? "cnt_card_log_row" : "cnt_card_log_row_nomin", lang, { min: x.min, at: (v.multiDay ? dm(x.at) + " " : "") + hm(x.at) }))}</td></tr>`
      : x.t === "unlogged"
      ? `<tr class="unlogged"><td colspan="${cols}">${tgEsc(tgI18n("cnt_card_unlogged", lang, { min: x.min, day: dm(x.at) }))}</td></tr>`
      : `<tr${x.now ? ` class="now"` : ""}>${day(x.from)}<td>${hms(x.from)}</td><td>${x.now ? tgEsc(tgI18n("cnt_card_now", lang)) : hms(x.to)}</td></tr>`;
    const need = v.cutAt ? tgI18n("cnt_card_since", lang, { at: hm(v.cutAt) }) : tgI18n("cnt_card_need", lang);
    return `<div class="ltw"><table class="lt"><thead><tr>${v.multiDay ? `<th>${tgEsc(tgI18n("cnt_card_day", lang))}</th>` : ""}` +
      `<th>${tgEsc(tgI18n("jrn_th_start", lang))}</th><th>${tgEsc(tgI18n("jrn_th_end", lang))}</th></tr></thead><tbody>` +
      (rows.length ? rows.map(row).join("") : `<tr><td colspan="${cols}" class="empty">${tgEsc(tgI18n("cnt_card_no_segs", lang))}</td></tr>`) +
      `</tbody><tfoot><tr><td colspan="${cols - 1}">${tgEsc(need)}</td><td>${v.needMin} ${tgI18n("pop_unit_min", lang)}</td></tr></tfoot></table></div>`;
  }
  function formatPastDaysHtml(pastDays, lang) {
    const two = n => String(n).padStart(2, "0");
    const dm = t => {
      if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
        const parts = t.split("-");
        return parts[2] + "/" + parts[1];
      }
      const d = new Date(t);
      return two(d.getDate()) + "/" + two(d.getMonth() + 1);
    };
    let html = "";
    for (const p of pastDays || []) {
      const dStr = dm(p.day);
      if (p.loggedMin > 0) {
        html += `<div class="note">${tgEsc(tgI18n("cnt_card_past_logged", lang, { day: dStr, min: p.loggedMin }))}</div>`;
      }
      if (p.unloggedMin > 0) {
        html += `<div class="note danger">${tgEsc(tgI18n("cnt_card_unlogged", lang, { day: dStr, min: p.unloggedMin }))}</div>`;
      }
    }
    return html;
  }

  // keep: chỉ vẽ lại nội dung (sau khi đọc danh sách log trong hộp), không theo dõi hộp lại từ đầu
  function showLogCard(info, keep) {
    const r = ui();
    if (cardEl) cardEl.remove();
    const lang = settings.language || "vi";
    cardEl = document.createElement("div");
    cardEl.className = "card";
    cardEl.setAttribute("role", "dialog");
    cardEl.setAttribute("aria-label", tgI18n("cnt_card_aria", lang));
    const title = info.orderId ? `Order #${tgEsc(info.orderId)}` : tgI18n("cnt_card_unidentified", lang);
    let html = `<div class="head"><div class="order">${title}</div><button class="x" aria-label="${tgI18n("cnt_close", lang)}">×</button></div>`;
    if (info.orderId) {
      html += logTableHtml(info, lang);
      html += formatPastDaysHtml(info.pastDays, lang);
      if (info.special) html += `<div class="note">${tgI18n("cnt_card_special", lang)}</div>`;
      if (info.guessed) html += `<div class="note">${tgI18n("cnt_card_guessed", lang)}</div>`;
      if (info.multiNow) html += `<div class="note danger">${tgI18n("cnt_card_multi_now", lang, { orders: (info.openOrders || []).map(i => "#" + tgEsc(i)).join(", "), pending: info.pendingMin })}</div>`;
      else if (info.multiMin > 0) html += `<div class="note">${tgI18n("cnt_card_multi_prev", lang, { min: info.multiMin })}</div>`;
      if (info.untrackedMin > 0) html += `<div class="note danger">${tgI18n("cnt_card_untracked", lang, { min: info.untrackedMin })}</div>`;
    } else {
      html += `<p class="hint">${tgI18n("cnt_card_reopen", lang)}</p>`;
    }
    cardEl.innerHTML = html;
    cardEl.querySelector(".x").addEventListener("click", closeLogCard);
    r.appendChild(cardEl);
    cardInfo = info;
    if (!keep) watchLogDialog(info.kind);
  }
  let cardInfo = null;  // dữ liệu thẻ đang hiện, để tự điền ô Time (min) của hộp log time
  function closeLogCard() {
    if (cardEl) { cardEl.remove(); cardEl = null; }
    clearInterval(dlgWatch);
  }

  // Thẻ tự đóng khi hộp log time / Finish của Emplanner đóng. Emplanner dùng ng-bootstrap nên hộp là ngb-modal-window.
  // Không thấy hộp nào hiện trong 5 giây thì giữ thẻ, trainee tự đóng bằng ×.
  let dlgWatch = null;
  // Khi hộp hiện, đọc danh sách "You have earlier logged" của Emplanner (vd "29 Oct 2026, 21:09") để biết các lần đã log,
  // rồi hỏi lại extension và vẽ lại thẻ chỉ tính từ sau lần log gần nhất.
  const MODAL_SEL = "ngb-modal-window, .modal.show, [role=dialog]";
  function earlierLogged() {
    const m = [...document.querySelectorAll(MODAL_SEL)].find(visible);
    const txt = m ? m.innerText || "" : "";
    const i = txt.search(/earlier logged/i);
    if (i < 0) return [];
    const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const out = [];
    for (const x of txt.slice(i).matchAll(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?:\s*\(UTC([+-])(\d{1,2}):(\d{2})\))?/gi)) {
      const yr = +x[3], mo = MON[x[2].slice(0, 3).toLowerCase()], dy = +x[1], hr = +x[4], mi = +x[5];
      const at = x[6] ? Date.UTC(yr, mo, dy, hr, mi) - (x[6] === "-" ? -1 : 1) * (+x[7] * 60 + +x[8]) * 60000
        : new Date(yr, mo, dy, hr, mi).getTime();
      out.push(at);
    }
    return out;
  }
  // Trang order: lịch sử log time hiện sẵn ở dưới trang, mỗi lần là một ô .time-log ("00h 20m", tên người log,
  // "29.10.2026, 21:09 (UTC+05:30)"; đọc trên trang thật 2026-10-29). Chỉ lấy ô của chính trainee: tên là link trỏ tới
  // /ui/profile/<mã người dùng>, mã lấy từ localStorage "emp_time-tracker" của Emplanner. Bỏ ô Feedback (không có số phút).
  function myUserId() {
    const pick = raw => {
      try { return Object.keys((JSON.parse(raw || "{}")["time-tracker"] || {}).entities || {})[0] || null; }
      catch (e) { return null; }
    };
    let id = null;
    try { id = pick(localStorage.getItem("emp_time-tracker")); } catch (e) { /* storage bị chặn */ }
    if (id) return id;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /time[-_]?tracker/i.test(k)) { id = pick(localStorage.getItem(k)); if (id) return id; }
      }
    } catch (e) { /* bỏ qua */ }
    return null;
  }
  function pageLogs() {
    const my = myUserId();
    if (!my) return [];
    const idRe = new RegExp("/" + my.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:/|$)");
    const out = [];
    for (const t of document.querySelectorAll(".time-log")) {
      const a = t.querySelector("a[href*='/ui/profile/']");
      if (!a || !idRe.test(a.getAttribute("href") || "")) continue;
      const h = /(\d{1,3})h\s*(\d{1,2})m/.exec((t.querySelector(".time-log__headline") || {}).textContent || "");
      const d = /(\d{1,2})\.(\d{1,2})\.(\d{4}),\s*(\d{1,2}):(\d{2})(?:\s*\(UTC([+-])(\d{1,2}):(\d{2})\))?/.exec((t.querySelector(".time-log__date-value") || {}).textContent || "");
      if (!h || !d) continue;
      // Có múi giờ thì đổi đúng sang giờ thật, không thì coi là giờ máy
      const at = d[6] ? Date.UTC(+d[3], +d[2] - 1, +d[1], +d[4], +d[5]) - (d[6] === "-" ? -1 : 1) * (+d[7] * 60 + +d[8]) * 60000
        : new Date(+d[3], +d[2] - 1, +d[1], +d[4], +d[5]).getTime();
      out.push({ at, min: +h[1] * 60 + +h[2] });
    }
    return out;
  }

  // Tìm ô "Time (min)" theo đúng nhãn ở bước 2 của hộp log time để không nhầm với ô chọn ở bước 1.
  function findLabeledLogTimeInput(m) {
    if (!m) return null;
    // Nhãn có thể chứa dấu * đỏ trong thẻ con, nên so theo toàn bộ chữ của phần tử
    const label = [...m.querySelectorAll("label, .form-label, .control-label, span, div")]
      .find(e => /^\s*time\s*\(min\)\s*\*?\s*$/i.test(e.textContent || ""));
    let box = label, input = null;
    for (let k = 0; k < 4 && box && !input; k++) { input = box.querySelector("input"); box = box.parentElement; }
    return input && visible(input) ? input : null;
  }
  function findLogTimeInput(m) {
    if (!m) return null;
    return findLabeledLogTimeInput(m) || m.querySelector("input[type=number], input[type=text], input:not([type])");
  }

  // Tự điền ô "Time (min)" ở bước 2 của hộp log time bằng số phút cần log lần này (người dùng đã chốt).
  // Chỉ điền một lần cho mỗi ô, và chỉ khi ô đang trống (trainee đã gõ thì không đè). Trainee vẫn tự bấm gửi.
  // Chỉ nhận ô có nhãn "Time (min)" để không điền nhầm ô chọn ở bước 1. Angular nhận giá trị qua sự kiện input.
  function fillLogTime() {
    const min = cardInfo && cardInfo.needMin;
    if (!(min > 0)) return;
    const m = [...document.querySelectorAll(MODAL_SEL)].find(visible);
    const input = findLabeledLogTimeInput(m);
    if (!input || input.dataset.tgFilled || input.value) return;
    input.dataset.tgFilled = "1";
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(min));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function watchLogDialog(kind) {
    clearInterval(dlgWatch);
    const start = Date.now();
    let seen = false, logsKey = "";
    const open = () => [...document.querySelectorAll(MODAL_SEL)].some(visible);
    dlgWatch = setInterval(async () => {
      if (!cardEl) return clearInterval(dlgWatch);
      if (open()) {
        seen = true;
        // Danh sách log chỉ hiện ở bước "2. LOG TIME" của hộp (hộp mở ở bước "1. RESULTS"), có thể sau nhiều giây:
        // đọc suốt lúc hộp mở, danh sách đổi thì hỏi lại extension và vẽ lại thẻ
        const times = earlierLogged();
        const key = times.join(",");
        if (times.length && key !== logsKey) {
          logsKey = key;
          const info = await send({ type: "justLogClicked", kind, loggedTimes: times, again: true });
          if (info && cardEl) showLogCard(info, true);
        }
        fillLogTime();
      } else if (seen) closeLogCard();
      else if (Date.now() - start > 5000) clearInterval(dlgWatch);
    }, 400);
  }

  /* ---------- Bảng thông tin nổi (mọi trang Emplanner): thu nhỏ, kéo, chỉnh cỡ ---------- */
  // Vị trí, cỡ và trạng thái thu nhỏ lưu ở chrome.storage.local key "panel", dùng chung cho mọi tab
  let panelEl = null, pp = {}, pinfo = null, pdrag = null, presizing = false, psaveT = null, pbusy = false, perr = "", perrShort = "";  // perrShort: chữ ngắn trên dải thu nhỏ khi lỗi không phải bấm đồng hồ
  const pad2 = n => String(n).padStart(2, "0");
  const hms = s => `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
  const pq = s => panelEl.querySelector(s);
  const PLAY_SVG = `<svg viewBox="0 0 384 512" aria-hidden="true"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>`;
  const PAUSE_SVG = `<svg viewBox="0 0 320 512" aria-hidden="true"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>`;

  function savePanel() {
    clearTimeout(psaveT);
    psaveT = setTimeout(() => { try { chrome.storage.local.set({ panel: pp }); } catch (e) { /* extension vừa được tải lại */ } }, 300);
  }
  // Thu nhỏ hay mở rộng nhớ riêng theo loại trang (người dùng đã chốt, lưu ở pp.minBy):
  // Trang FP Editor (/fp/...) và trang order (/ui/order/...): tự động thu nhỏ sau 3 giây (người dùng chốt 2026-11-07).
  // Cả khi vừa vào trang lẫn khi bấm mở rộng đều chỉ hiện tạm đúng 3 giây rồi tự thu nhỏ.
  const pageKind = () => {
    const p = location.pathname;
    return /^\/fp(\/|$)/.test(p) ? "fp" : /^\/ui\/order(\/|$)/.test(p) ? "order" : /^\/ui\/work(\/|$)/.test(p) ? "work" : "other";
  };
  const navKey = () => {
    if (pageKind() === "fp") {
      const m = /[?&](?:orderId|order)=([^&]+)/i.exec(location.search);
      return location.pathname + (m ? "#" + m[1] : "");
    }
    return location.pathname;
  };
  const AUTO_COLLAPSE_MS = 3000;
  let tempOpen = false, collapseT = null, lastPath = navKey();
  const isAutoCollapse = k => k === "fp" || k === "order";
  const collapseLater = () => {
    clearTimeout(collapseT);
    collapseT = setTimeout(() => {
      if (!tempOpen) return;
      if (pdrag || presizing || pbusy) { collapseLater(); return; }
      tempOpen = false;
      placePanel();
      renderPanel();
    }, AUTO_COLLAPSE_MS);
  };
  const isMin = () => {
    const k = pageKind(), m = pp.minBy || {};
    if (isAutoCollapse(k)) return !tempOpen;
    return k in m ? !!m[k] : false;
  };
  function placePanel() {
    panelEl.classList.toggle("min", isMin());
    if (pp.w) panelEl.style.width = pp.w + "px";
    // Trang order: nội dung đổi theo tour (bảng log dài ngắn khác nhau) nên chiều cao tự theo nội dung, chỉ kéo chỉnh chiều ngang
    const autoH = pageKind() === "order";
    panelEl.classList.toggle("autoh", autoH);
    panelEl.style.height = !autoH && pp.h ? pp.h + "px" : "";
    const r = panelEl.getBoundingClientRect();
    const x = pp.x == null ? 16 : pp.x, y = pp.y == null ? innerHeight - r.height - 16 : pp.y;
    panelEl.style.bottom = "auto";
    panelEl.style.left = Math.max(0, Math.min(x, innerWidth - r.width)) + "px";
    panelEl.style.top = Math.max(0, Math.min(y, innerHeight - r.height)) + "px";
    placeJside();
  }
  function togglePanel() {
    const k = pageKind();
    if (isAutoCollapse(k)) {
      tempOpen = !tempOpen;
      if (tempOpen) collapseLater(); else clearTimeout(collapseT);
      placePanel(); renderPanel();
      return;
    }
    pp.minBy = Object.assign({}, pp.minBy, { [pageKind()]: !isMin() });
    delete pp.min;  // kiểu lưu cũ (dùng chung mọi trang)
    placePanel(); renderPanel(); savePanel();
  }

  function buildPanel(saved) {
    pp = saved || {};
    panelEl = document.createElement("div");
    panelEl.className = "panel";
    panelEl.setAttribute("role", "region");
    panelEl.setAttribute("aria-label", "Time Guard");
    panelEl.innerHTML = `<div class="bar" title="${tgI18n("cnt_panel_bar_title", settings.language)}"><button class="mclk" data-a="mtoggle" hidden><span class="mic"></span><span class="mtm"></span></button><span class="ttl">Time Guard</span><button class="jbtn" data-a="journal"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 1.5A1.5 1.5 0 0 1 4.5 0H13v13H4.5a.5.5 0 0 0 0 1H13v2H4.5A2.5 2.5 0 0 1 2 13.5v-11A1.5 1.5 0 0 1 3 1.5zM5 3v1.5h6V3H5zm0 3v1.5h6V6H5z"/></svg></button><button class="x" data-a="min"></button></div>
      <div class="body"><button class="clock" data-a="toggle"><span class="ic"></span><span class="tm">--:--:--</span></button><span class="st"></span>
      <div class="kv"><span class="oid"></span><b class="omin"></b></div><div class="pnote" hidden></div>
      <button class="sbtn" data-a="survey"></button><div class="segs" hidden></div></div>`;
    ui().appendChild(panelEl);
    if (isAutoCollapse(pageKind())) {
      tempOpen = true;
      collapseLater();
    }
    placePanel();

    pq("[data-a=min]").addEventListener("click", togglePanel);
    // Nút Nhật ký: mở / đóng khung nhật ký theo tour ngay cạnh bảng (người dùng chốt 2026-11-10), có cả khi bảng thu nhỏ.
    // Trang nhật ký đầy đủ vẫn mở được từ link cuối khung.
    pq("[data-a=journal]").addEventListener("click", toggleJside);
    pq("[data-a=survey]").addEventListener("click", async () => {
      await send({ type: pinfo && pinfo.survey ? "surveyEnd" : "surveyStart" });
      pollPanel();
    });
    // Bật / tạm dừng đồng hồ Emplanner (extension bấm nút giờ trên tab Work). Bấm được cả trên bảng lớn lẫn dải thu nhỏ
    const doToggle = async () => {
      if (pbusy) return;
      pbusy = true; perr = ""; perrShort = ""; renderPanel();
      // Quá 75 giây không có kết quả thì thôi chờ, để bảng không kẹt ở "Đang bấm đồng hồ…"
      const r = await Promise.race([
        send({ type: "trackerToggle", action: pinfo && pinfo.tracker === "running" ? "pause" : "start" }),
        sleep(75000).then(() => ({ ok: false, error: tgI18n("cnt_panel_stale_err", settings.language) }))
      ]);
      pbusy = false;
      perr = r && r.ok ? "" : stale() ? staleMsg() : tgI18n("cnt_panel_err_toggle", settings.language, { err: (r && r.error) || (settings.language === "en" ? "extension did not respond" : "extension không phản hồi") });
      if (perr) setTimeout(() => { perr = ""; }, 15000);
      if (tempOpen && isAutoCollapse(pageKind())) collapseLater();
      pollPanel();
    };
    pq("[data-a=toggle]").addEventListener("click", doToggle);
    pq("[data-a=mtoggle]").addEventListener("click", doToggle);
    const bar = pq(".bar");
    bar.addEventListener("dblclick", e => { if (!e.target.closest("button")) togglePanel(); });
    bar.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const r = panelEl.getBoundingClientRect();
      pdrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener("pointermove", e => {
      if (!pdrag) return;
      pp.x = e.clientX - pdrag.dx; pp.y = e.clientY - pdrag.dy;
      placePanel();
    });
    const endDrag = () => {
      if (!pdrag) return;
      pdrag = null;
      const r = panelEl.getBoundingClientRect();
      pp.x = r.left; pp.y = r.top;
      savePanel();
      if (tempOpen && isAutoCollapse(pageKind())) collapseLater();
    };
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);
    // Kéo góc dưới phải để chỉnh cỡ (CSS resize), chỉ lưu cỡ khi người dùng tự kéo
    presizing = false;
    panelEl.addEventListener("pointerdown", e => {
      const r = panelEl.getBoundingClientRect();
      presizing = !isMin() && e.clientX > r.right - 18 && e.clientY > r.bottom - 18;
    });
    const endResize = () => {
      if (!presizing) return;
      presizing = false;
      if (tempOpen && isAutoCollapse(pageKind())) collapseLater();
    };
    addEventListener("pointerup", endResize, true);
    addEventListener("pointercancel", endResize, true);
    new ResizeObserver(() => {
      if (isMin() || !presizing) return;
      // Trang order tự chỉnh chiều cao: chỉ lưu chiều ngang, giữ chiều cao đã chỉnh cho các trang khác
      const w = panelEl.offsetWidth, h = pageKind() === "order" ? pp.h : panelEl.offsetHeight;
      if (Math.abs(w - (pp.w || 0)) < 2 && Math.abs((h || 0) - (pp.h || 0)) < 2) return;
      pp.w = w; pp.h = h;
      savePanel();
    }).observe(panelEl);
    addEventListener("resize", placePanel);
    chrome.storage.onChanged.addListener(c => {
      if (!c.panel || pdrag) return;
      pp = c.panel.newValue || {};
      placePanel(); renderPanel();
    });
    renderPanel();
  }

  function renderPanel() {
    if (!panelEl) return;
    // Emplanner chuyển trang không tải lại (SPA): đường dẫn đổi thì cập nhật thu nhỏ / mở rộng
    const curPath = navKey();
    if (curPath !== lastPath) {
      lastPath = curPath;
      clearTimeout(collapseT);
      const curKind = pageKind();
      if (isAutoCollapse(curKind)) {
        tempOpen = true;
        collapseLater();
      } else {
        tempOpen = false;
      }
      placePanel();
    }
    if (panelEl.classList.contains("min") !== isMin() || panelEl.classList.contains("autoh") !== (pageKind() === "order")) placePanel();
    const dead = stale();
    const lang = settings.language || "vi";
    const i = dead ? {} : pinfo || {};  // mất kết nối thì không hiện số cũ như thể vẫn đúng
    // Đang chạy: tự đếm từ mốc 0 của Emplanner nên số giây đổi cùng lúc với trang Work
    const sec = i.startAt ? Math.max(0, Math.floor((Date.now() - i.startAt) / 1000)) : i.timerSec;
    const PST = { running: ["run", tgI18n("cnt_panel_running", lang)], paused: ["pause", tgI18n("cnt_panel_paused", lang)], finished: ["", tgI18n("cnt_panel_finished", lang)] };
    const st = dead ? ["pause", tgI18n("cnt_panel_f5_page", lang)]
      : !i.tracker || i.tracker === "unknown" ? ["", tgI18n("cnt_panel_cant_read", lang)]
      : PST[i.sub] || (i.tracker === "running" ? PST.running : PST.paused);
    const clock = sec == null ? "--:--:--" : hms(sec);
    if (pq(".tm").textContent !== clock) pq(".tm").textContent = clock;
    // Đang chạy / tạm dừng thì icon ⏸ / ▶ đã cho thấy, không ghi chữ; chỉ ghi khi có điều icon không nói được
    const stText = pbusy ? tgI18n("cnt_panel_clicking", lang) : !dead && (st[0] === "run" || st[0] === "pause") ? "" : st[1];
    pq(".st").className = "st " + (pbusy ? "" : st[0]);
    pq(".st").textContent = stText;
    pq(".st").hidden = !stText;
    // Giống nút giờ của Emplanner: đang chạy hiện ⏸ cam (bấm để dừng), đang dừng hiện ▶ xanh (bấm để bật)
    const tb = pq("[data-a=toggle]");
    const ic = i.tracker === "running" ? "pause" : i.tracker === "stopped" ? "play" : "none";
    if (tb.dataset.ic !== ic || tb.dataset.lang !== lang) {
      tb.dataset.ic = ic;
      tb.dataset.lang = lang;
      pq(".ic").className = "ic " + ic;
      pq(".ic").innerHTML = ic === "pause" ? PAUSE_SVG : PLAY_SVG;
      const tip = tgI18n(ic === "pause" ? "cnt_panel_tip_pause" : "cnt_panel_tip_start", lang);
      tb.title = tip;
      tb.setAttribute("aria-label", tip);
    }
    tb.disabled = pbusy;
    // Dải thu nhỏ: icon ⏸ / ▶ + giờ là một nút, bấm để bật / tạm dừng như trên bảng lớn; bên cạnh là trạng thái nếu có
    const mb2 = pq("[data-a=mtoggle]");
    mb2.hidden = !isMin();
    if (isMin()) {
      const mic = pq(".mic");
      if (mic.dataset.ic !== ic) { mic.dataset.ic = ic; mic.className = "mic " + ic; mic.innerHTML = ic === "pause" ? PAUSE_SVG : PLAY_SVG; }
      if (pq(".mtm").textContent !== clock) pq(".mtm").textContent = clock;
      mb2.title = tb.title;
      mb2.setAttribute("aria-label", tb.title);
      mb2.disabled = pbusy;
    }
    // Thu nhỏ thì phần ghi chú bị ẩn: lỗi bấm đồng hồ ghi ngắn trên dải (màu đỏ), rê chuột để xem đầy đủ
    const minErr = isMin() && perr && !pbusy;
    pq(".ttl").textContent = !isMin() ? "Time Guard" : minErr ? (perrShort || tgI18n("cnt_panel_click_failed", lang)) : stText;
    pq(".ttl").classList.toggle("err", !!minErr);
    pq(".ttl").title = minErr ? perr : "";
    pq(".bar").title = tgI18n("cnt_panel_bar_title", lang);
    const jb = pq("[data-a=journal]");
    if (jb.title !== tgI18n("cnt_panel_journal", lang)) { jb.title = tgI18n("cnt_panel_journal", lang); jb.setAttribute("aria-label", jb.title); }
    const mb = pq("[data-a=min]");
    mb.textContent = isMin() ? "+" : "–";
    mb.setAttribute("aria-label", tgI18n(isMin() ? "cnt_panel_expand" : "cnt_panel_minimize", lang));
    pq(".oid").textContent = i.orderId ? `Order #${i.orderId}` : tgI18n("cnt_panel_no_order", lang);
    pq(".omin").textContent = i.orderId ? `${i.orderMin} ${tgI18n("pop_unit_min", lang)}` : "";
    const note = dead ? staleMsg() : perr ? perr
      : i.survey ? tgI18n("cnt_panel_survey_note", lang)
      : i.multi ? tgI18n("cnt_panel_multi_note", lang, { min: i.pendingMin })
      : st[0] === "" && st[1] !== tgI18n("cnt_panel_finished", lang) ? tgI18n("cnt_panel_loading_note", lang)
      // Sang ngày mới khi phiên chưa Finish: giờ trên bảng đã trừ phần của ngày cũ, nói rõ để không thấy lệch với Emplanner
      : i.dayBase ? tgI18n("cnt_panel_daybase", lang, { time: hms(i.dayBase) }) : "";
    pq(".pnote").textContent = note;
    pq(".pnote").hidden = !note;
    const sb = pq("[data-a=survey]");
    sb.textContent = i.survey ? tgI18n("cnt_panel_end_survey_left", lang, { min: i.survey.leftMin }) : tgI18n("cnt_panel_start_survey", lang);
    sb.classList.toggle("on", !!i.survey);
    // Trang order: bảng log của order giống thẻ log time (cột Ngày, hàng Đã log, hàng Cần log); chỉ vẽ lại khi dữ liệu đổi
    const sg = pq(".segs");
    // Rời trang order thì ẩn ngay, không chờ lần hỏi kế tiếp (3 giây)
    const showLog = !!i.log && pageKind() === "order";
    const segKey = JSON.stringify(showLog ? i.log : null) + ":" + lang;
    if (sg.dataset.k !== segKey) {
      sg.dataset.k = segKey;
      sg.hidden = !showLog;
      if (showLog) sg.innerHTML = `<div class="sh">${tgEsc(tgI18n("cnt_panel_order_time", lang))}</div>` + logTableHtml(i.log, lang) + formatPastDaysHtml(i.log && i.log.pastDays, lang);
    }
    // Nội dung dài ra (thêm ghi chú) thì giữ bảng trong màn hình
    const r = panelEl.getBoundingClientRect();
    if (r.bottom > innerHeight || r.right > innerWidth) placePanel();
    if (jsideEl && jsideKey !== ((dead ? "stale" : i.orderId ? String(i.orderId) : "") + ":" + lang)) renderJside();
  }

  /* ---------- Nhật ký theo tour ngay cạnh bảng nổi (người dùng chốt 2026-11-10) ---------- */
  // Bấm nút sách trên thanh tiêu đề: mở / đóng khung bên cạnh bảng, hiện tổng kết theo tour của hôm nay
  // (giống mục "Tổng kết theo tour" của trang nhật ký, cùng hàm tgTourSummary). Dữ liệu đọc thẳng từ
  // chrome.storage.local key "state" (background lưu S ở đó), cập nhật khi state đổi; không gửi gì lên Emplanner.
  let jsideEl = null, jrec = null, jsideKey = "";
  const JSIDE_W = 320;
  function placeJside() {
    if (!jsideEl || !panelEl) return;
    const r = panelEl.getBoundingClientRect();
    const w = Math.min(JSIDE_W, innerWidth - 16);
    // Ưu tiên bên phải bảng; không đủ chỗ thì sang bên trái; vẫn không đủ thì sát mép phải màn hình
    let left = r.right + 8;
    if (left + w > innerWidth - 8) left = r.left - 8 - w;
    if (left < 8) left = Math.max(8, innerWidth - w - 8);
    jsideEl.style.width = w + "px";
    jsideEl.style.left = left + "px";
    const h = jsideEl.offsetHeight;
    jsideEl.style.top = Math.max(8, Math.min(r.top, innerHeight - h - 8)) + "px";
  }
  function renderJside() {
    if (!jsideEl) return;
    const lang = settings.language || "vi";
    const two = n => String(n).padStart(2, "0");
    const clk = t => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
    const dur = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`; };
    jsideEl.querySelector(".jh b").textContent = tgI18n("cnt_jside_title", lang);
    const x = jsideEl.querySelector("[data-j=close]");
    x.title = tgI18n("cnt_jside_close", lang); x.setAttribute("aria-label", x.title);
    jsideEl.querySelector("[data-j=full]").textContent = tgI18n("cnt_jside_full", lang);
    let html;
    if (stale()) {
      jsideKey = "stale:" + lang;
      html = `<div class="empty">${tgEsc(staleMsg())}</div>`;
    } else {
      // Chỉ lấy hôm nay: state của ngày cũ (chưa sang ngày) thì coi như chưa có tour
      const tours = jrec && jrec.day === tgDayKey() ? tgTourSummary(jrec) : [];
      const cur = pinfo && pinfo.orderId ? String(pinfo.orderId) : null;
      jsideKey = (cur || "") + ":" + lang;
      html = !tours.length ? `<div class="empty">${tgEsc(tgI18n("jrn_tours_empty", lang))}</div>`
        : tours.map(t => {
          const tags = [];
          if (t.multiMin) tags.push(`<span class="pill">${tgEsc(tgI18n("pop_tag_multi", lang, { min: t.multiMin }))}</span>`);
          if (t.untrackedMin) tags.push(`<span class="pill danger">${tgEsc(tgI18n("pop_tag_untracked", lang, { min: t.untrackedMin }))}</span>`);
          const iv = t.intervals.length
            ? t.intervals.map(v => `<div><span>${clk(v.from)} – ${clk(v.to)}</span><span class="d">${dur(v.to - v.from)}</span></div>`).join("")
            : `<div class="empty" style="padding:0">${tgEsc(tgI18n("jrn_no_intervals", lang))}</div>`;
          return `<div class="jt${t.id === cur ? " cur" : ""}"><div class="jtt"><span class="jid">#${tgEsc(t.id)}</span>` +
            `<span class="jtot">${tgEsc(tgI18n("jrn_tour_total", lang))}: <b>${dur(t.totalMs)}</b> (${t.min} ${tgEsc(tgI18n("pop_unit_min", lang))})</span></div>` +
            (tags.length ? `<div class="jtags">${tags.join("")}</div>` : "") + `<div class="jiv">${iv}</div></div>`;
        }).join("");
    }
    const body = jsideEl.querySelector(".jb");
    if (body.innerHTML !== html) body.innerHTML = html;  // không vẽ lại khi không đổi, giữ vị trí cuộn
    placeJside();
  }
  async function loadJrec() {
    try { jrec = (await chrome.storage.local.get("state")).state || null; } catch (e) { jrec = null; /* extension vừa được tải lại */ }
    renderJside();
  }
  function closeJside() {
    if (jsideEl) { jsideEl.remove(); jsideEl = null; }
    if (panelEl) pq("[data-a=journal]").classList.remove("on");
  }
  function toggleJside() {
    if (jsideEl) return closeJside();
    jsideEl = document.createElement("div");
    jsideEl.className = "jside";
    jsideEl.setAttribute("role", "dialog");
    jsideEl.setAttribute("aria-label", tgI18n("cnt_jside_title", settings.language));
    jsideEl.innerHTML = `<div class="jh"><b></b><button class="x" data-j="close">×</button></div><div class="jb"></div>` +
      `<div class="jf"><button class="lnk" data-j="full"></button></div>`;
    jsideEl.querySelector("[data-j=close]").addEventListener("click", closeJside);
    // Link cuối khung: mở trang nhật ký đầy đủ (đã mở thì chuyển tới tab đó)
    jsideEl.querySelector("[data-j=full]").addEventListener("click", async () => {
      const r = await send({ type: "openJournal" });
      if (!r || !r.ok) {
        perr = stale() ? staleMsg() : tgI18n("cnt_panel_journal_err", settings.language);
        perrShort = tgI18n("cnt_panel_journal_failed", settings.language);
        setTimeout(() => { perr = ""; perrShort = ""; }, 15000);
        renderPanel();
      }
    });
    ui().appendChild(jsideEl);
    pq("[data-a=journal]").classList.add("on");
    renderJside();
    loadJrec();
  }
  if (IS_EMP && !HIDDEN_FRAME) {
    chrome.storage.onChanged.addListener(c => {
      if (!jsideEl) return;
      if (c.state) { jrec = c.state.newValue || null; renderJside(); }
      else if (c.settings) renderJside();
    });
  }

  async function pollPanel() {
    if (!panelEl || document.hidden) return;
    // Trang order: gửi kèm lịch sử log time có sẵn trên trang để bảng log của order đúng ngay
    const o = pageOrder();
    const r = await send({ type: "panel", orderId: o ? o.id : undefined, floor: o ? o.floor : undefined, loggedTimes: pageKind() === "order" ? pageLogs() : undefined });
    if (r) pinfo = r;
    renderPanel();
  }

  if (IS_EMP && !HIDDEN_FRAME) {
    chrome.storage.local.get("panel").then(r => { buildPanel(r.panel); pollPanel(); }).catch(() => {});
    setInterval(pollPanel, 3000);
    setInterval(renderPanel, 200);
    document.addEventListener("visibilitychange", pollPanel);
  }

  /* ---------- Nút bị chặn (người dùng đã chốt): làm mờ, không bấm được, không ghi lý do ---------- */
  // Danh sách ở settings.labels.blocked, so khớp đúng nguyên chữ trên nút (vd "Skip", "Log time and unassign from me").
  // Emplanner vẽ lại trang và mở menu liên tục nên đánh dấu lại mỗi khi trang đổi.
  const BLOCK_SEL = "button, a, [role=button], [role=menuitem], .dropdown-item";
  const isBlocked = el => {
    const t = tgNorm(el.textContent);
    return !!t && (settings.labels.blocked || []).some(l => t === tgNorm(l));
  };
  function markBlocked() {
    for (const el of document.querySelectorAll(BLOCK_SEL)) {
      const b = isBlocked(el);
      if (b === (el.dataset.tgBlocked === "1")) continue;
      if (b) {
        el.dataset.tgBlocked = "1";
        el.style.setProperty("opacity", ".4", "important");
        el.style.setProperty("pointer-events", "none", "important");
        el.style.setProperty("cursor", "default", "important");
        el.setAttribute("aria-disabled", "true");
        el.setAttribute("tabindex", "-1");
      } else {
        // Angular dùng lại phần tử cho nút khác: trả lại như cũ
        delete el.dataset.tgBlocked;
        for (const p of ["opacity", "pointer-events", "cursor"]) el.style.removeProperty(p);
        el.removeAttribute("aria-disabled");
        el.removeAttribute("tabindex");
      }
    }
  }
  // Chặn thêm ở tầng sự kiện (bấm bằng bàn phím, hoặc lúc chưa kịp đánh dấu)
  const stopBlocked = e => {
    const el = e.target && e.target.closest && e.target.closest(BLOCK_SEL);
    if (!el || !isBlocked(el)) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  if (IS_EMP) {
    for (const ev of ["click", "mousedown", "pointerdown", "keydown"]) addEventListener(ev, stopBlocked, true);
    let blockT = null;
    new MutationObserver(ms => {
      const hit = ms.some(m => {
        if (m.type === "childList") return true;
        const n = m.target && (m.target.nodeType === 3 ? m.target.parentElement : m.target);
        return !!(n && n.closest && n.closest(BLOCK_SEL));
      });
      if (hit && !blockT) blockT = setTimeout(() => { blockT = null; markBlocked(); }, 150);
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    markBlocked();
  }

  document.addEventListener("click", e => {
    if (!e.isTrusted || !e.target.closest) return;
    const el = e.target.closest("button,[role=button],[role=menuitem],[role=option],[role=radio],[role=tab],input[type=submit],label,a,li");
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true" || el.classList.contains("disabled")) return;
    const t = tgNorm(el.innerText || (el.matches("input") ? el.value : "") || el.getAttribute("aria-label"));
    if (!t || t.length > 40) return;
    // Just log time hoặc Finish drawing & log time (trang order): hiện thẻ các khoảng giờ làm order
    const kind = (settings.labels.justLog || []).some(l => t.includes(tgNorm(l))) ? "justlog"
      : (settings.labels.finishLog || []).some(l => t.includes(tgNorm(l))) ? "finish" : null;
    const modal = el.closest(MODAL_SEL);
    if (modal) {
      // Nút gửi trong hộp log time (Just log time / Finish…): ghi lại lần log để lần sau chỉ tính từ đây.
      // Ô phút để trống hoặc 0 thì Emplanner chưa nhận, không tính là đã log
      const isBtn = el.matches("button, [role=button], input[type=submit]");
      if (isBtn && (kind || t === "finish" || t === "submit")) {
        const input = findLogTimeInput(modal);
        const min = input ? Number(String(input.value).replace(",", ".")) : 0;
        if (min > 0) send({ type: "logSubmitted", min });
      }
      return;
    }
    if (kind) {
      // Gửi kèm lịch sử log time có sẵn trên trang order, để thẻ tính từ lần log gần nhất ngay khi hiện
      setTimeout(async () => { const info = await send({ type: "justLogClicked", kind, loggedTimes: pageLogs() }); if (info) showLogCard(info); }, 300);
    }
  }, true);

  /* ---------- Đọc và bấm nút đồng hồ ---------- */
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }
  function findBtn(kind, scope) {
    const sel = (settings.selectors || {})[kind];
    if (sel && !scope) {
      try { const el = [...document.querySelectorAll(sel)].find(visible); if (el) return el; } catch (e) { /* selector sai */ }
    }
    const labels = (settings.labels[kind] || []).map(tgNorm);
    for (const el of (scope || document).querySelectorAll("button,[role=button]")) {
      if (!visible(el)) continue;
      const parts = [tgNorm(el.getAttribute("aria-label")), tgNorm(el.getAttribute("title")), tgNorm(el.innerText)];
      if (parts.some(p => p && labels.includes(p))) return el;
    }
    return null;
  }
  function detectTracker() {
    if (findBtn("pause")) return "running";
    if (findBtn("start")) return "stopped";
    // Có khối đồng hồ nhưng không có nút Pause: đồng hồ đang dừng hoặc tạm dừng
    const w = (settings.selectors || {}).widget;
    try { if (w && [...document.querySelectorAll(w)].some(visible)) return "stopped"; } catch (e) { /* selector sai */ }
    return null;
  }
  // Đọc giờ trên đồng hồ Emplanner, vd "00:44:03" -> 2643 giây
  function readTimer() {
    const w = (settings.selectors || {}).widget;
    let els = [];
    try { els = w ? [...document.querySelectorAll(w)].filter(visible) : []; } catch (e) { /* selector sai */ }
    for (const el of els) {
      const m = /(\d{1,3}):(\d{2}):(\d{2})/.exec(el.innerText || "");
      if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    }
    return null;
  }

  /* ---------- Nhận diện order của tab ---------- */
  // FP Editor: tiêu đề "1566383 DS - 2 FP Editor"; trang order: "Floor plan orderID 1566383"
  function pageOrder() {
    const t = /^\s*(\d{5,})\b/.exec(document.title || "");
    if (t) return { id: t[1], floor: (/-\s*(\d+)\s+FP Editor/i.exec(document.title) || [])[1] || null };
    if (/\/ui\/order(\/|$)/.test(location.pathname)) {
      for (const el of document.querySelectorAll("h1,h2,h3,h4,[class*=title]")) {
        const m = /order\s*id\s*#?\s*(\d{5,})/i.exec(el.innerText || "");
        if (m) return { id: m[1], floor: null };
      }
    }
    return null;
  }
  // Trang Work: các order có nhãn "For log time"
  function specialOrders() {
    const ids = [];
    for (const b of document.querySelectorAll(".copy-order-uid-btn")) {
      const id = (b.innerText || "").trim();
      const row = b.closest("tr") || b.parentElement && b.parentElement.parentElement;
      if (/^\d{5,}$/.test(id) && row && /for log time/i.test(row.innerText || "")) ids.push(id);
    }
    return ids;
  }
  // Chờ điều kiện trên trang. Không chỉ dựa vào hẹn giờ: tab nền (như tab Work ẩn) bị trình duyệt làm chậm
  // hẹn giờ tới 1 lần/phút, còn MutationObserver vẫn chạy ngay khi trang đổi.
  function waitFor(fn, ms) {
    return new Promise(resolve => {
      const v = fn();
      if (v) return resolve(v);
      let done = false, iv = null, to = null;
      const mo = new MutationObserver(() => { const x = fn(); if (x) finish(x); });
      const finish = x => { if (done) return; done = true; mo.disconnect(); clearInterval(iv); clearTimeout(to); resolve(x); };
      mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
      const end = Date.now() + ms;
      iv = setInterval(() => { const x = fn(); if (x || Date.now() > end) finish(x || fn()); }, 300);
      to = setTimeout(() => finish(fn()), ms);
    });
  }
  // expect: trạng thái extension đang biết. Có expect mà trang hiện khác (trang cũ, chưa biết đồng hồ đã bị bấm ở nơi khác)
  // thì không bấm, để không bấm ngược; extension sẽ thử tab Work ẩn.
  async function clickTracker(action, expect) {
    const isEn = settings.language === "en";
    const kind = action === "finish" ? "finish" : "pause";
    const st = await waitFor(detectTracker, 8000);
    if (!st) return { ok: false, error: isEn ? "Cannot find tracker button on page" : "Không thấy nút đồng hồ trên trang" };
    if (expect && st !== expect) return { ok: false, mismatch: true, error: isEn ? "Page shows a different clock state" : "Trang hiện trạng thái đồng hồ khác" };
    // Bật đồng hồ: bấm nút giờ đang ở dạng ▶ (btn-action--start)
    if (action === "start") {
      if (st === "running") return { ok: true, state: st, timerSec: readTimer() };
      const b = findBtn("start");
      if (!b) return { ok: false, error: isEn ? "Cannot find Start button" : "Không thấy nút Start" };
      b.click();
      const on = await waitFor(() => (detectTracker() === "running" ? "running" : null), 8000);
      return on ? { ok: true, state: on, timerSec: readTimer() } : { ok: false, error: isEn ? "Clicked Start but tracker is not running" : "Đã bấm Start nhưng đồng hồ chưa chạy" };
    }
    if (st !== "running") return { ok: true, state: st };
    const btn = findBtn(kind);
    if (!btn) return { ok: false, error: isEn ? `Cannot find ${kind} button` : `Không thấy nút ${kind}` };
    btn.click();
    if (kind === "finish") {
      const ok = await waitFor(() => {
        const dlg = document.querySelector("ngb-modal-window,[role=dialog],[role=alertdialog],.modal");
        return dlg && findBtn("finishConfirm", dlg);
      }, 3000);
      if (ok) ok.click();
    }
    const after = await waitFor(() => { const s = detectTracker(); return s && s !== "running" ? s : null; }, 5000);
    return after ? { ok: true, state: after, timerSec: readTimer() } : { ok: false, error: isEn ? "Clicked button but tracker is still running" : "Đã bấm nút nhưng đồng hồ vẫn chạy" };
  }

  if (IS_EMP) {
    let last = null, mo = null;
    // Mốc 0 của đồng hồ: đo ngay lúc số giây trên nút giờ đổi (Date.now() - giây * 1000).
    // Số đổi chỉ có thể hiện đúng lúc hoặc muộn hơn thực tế (tab nền bị làm chậm thì muộn nhiều), nên mỗi lần đo
    // là một mốc "muộn nhất có thể"; giữ mốc sớm nhất là chính xác nhất. Đo cả khi tab ẩn. Đổi trạng thái thì đo lại.
    // Không gọi máy chủ: chỉ nhìn số trên trang.
    let tSec = null, tEpoch = null, tSent = null;
    // Tab ẩn bị trình duyệt làm chậm hoặc cho ngủ, số trên nút giờ có thể đứng: báo kèm hidden.
    // loaded = lần báo đầu tiên sau khi trang tải (giờ vừa lấy từ máy chủ); flip = thấy đồng hồ đổi ngay trên trang này.
    let loaded = true;
    const report = (s, sec) => {
      if (!/^\/ui\/work(\/|$)/.test(location.pathname)) return;  // chỉ trang Work của chính trainee
      const flip = last != null && s !== last;
      last = s; tSent = tEpoch;
      send({ type: "tracker", state: s, timerSec: sec, timerEpoch: s === "running" ? tEpoch : null, hidden: document.hidden, loaded, flip });
      loaded = false;
    };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    let seenAt = 0, lastStopSec = null;
    // Chỉ đọc đồng hồ trên trang Work (/ui/work) của chính trainee. Trang hồ sơ người khác (/ui/profile/…) cũng có khối
    // TIME-TRACKING của người đó; đọc nhầm sẽ tưởng là đồng hồ của mình (đã gặp 2026-10-29). Emplanner chuyển trang không
    // tải lại (SPA), nên rời trang Work thì quên hết, quay lại thì coi như trang vừa tải.
    const onWork = () => /^\/ui\/work(\/|$)/.test(location.pathname);
    let wasWork = onWork();
    const notWork = () => {
      const w = onWork();
      if (w !== wasWork) { wasWork = w; last = null; loaded = true; seenAt = 0; lastStopSec = null; tSec = null; tEpoch = null; tSent = null; }
      return !w;
    };
    const check = () => {
      if (notWork()) return;
      const s = detectTracker();
      if (!s) return;
      // Nút giờ vừa hiện có thể chưa có giờ từ máy chủ (00:00:00 tạm): chờ 2,5 giây rồi mới báo lần đầu
      if (!seenAt) seenAt = Date.now();
      if (Date.now() - seenAt < 2500) { clearTimeout(mo); mo = setTimeout(check, 2600); return; }
      if (s !== "running") tEpoch = null;
      // Chỉ báo khi có thay đổi (người dùng đã chốt, không báo định kỳ): đổi trạng thái, hoặc đang dừng mà số đổi
      // (Finish về 00:00:00, Emplanner lùi 1 giây sau khi tạm dừng)
      const sec = readTimer();
      if (s !== last || (s !== "running" && sec !== lastStopSec)) { lastStopSec = s !== "running" ? sec : null; report(s, sec); }
    };
    const syncTimer = () => {
      if (notWork()) return;
      if (!seenAt || Date.now() - seenAt < 2500) return;
      const sec = readTimer();
      if (sec == null || sec === tSec) return;
      const first = tSec == null;
      tSec = sec;
      if (first || detectTracker() !== "running") return;  // lần đầu chưa biết lúc số đổi
      const e = Date.now() - sec * 1000;
      if (tEpoch == null || e < tEpoch) tEpoch = e;
      if (tSent == null || Math.abs(tEpoch - tSent) > 150) report("running", sec);
    };
    setInterval(check, 2000);
    new MutationObserver(ms => {
      const widgetSel = (settings.selectors || {}).widget || "[class*='btn-action--']";
      // Nút giờ đổi: đo và báo ngay, không chờ hẹn giờ (tab nền bị làm chậm hẹn giờ tới 1 lần/phút)
      const inWidget = ms.some(m => {
        const n = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        try { return !!(n && n.closest && n.closest(widgetSel)); } catch (e) { return false; }
      });
      if (inWidget) {
        syncTimer();
        if (detectTracker() !== last) check();
      }
      clearTimeout(mo); mo = setTimeout(check, 300);
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    check();
  }


  // Báo order của tab (trang là SPA nên kiểm tra lại định kỳ)
  let lastPage = "";
  const reportPage = () => {
    const o = pageOrder();
    const sp = /\/ui\/work/.test(location.pathname) ? specialOrders() : null;
    const key = location.href + "|" + (o ? o.id : "") + "|" + (sp ? sp.join() : "");
    if (key === lastPage) return;
    lastPage = key;
    send({ type: "page", orderId: o ? o.id : null, floor: o ? o.floor : null, special: sp });
  };
  if (!HIDDEN_FRAME) {
    setInterval(reportPage, 2000);
    setTimeout(reportPage, 800);
  }

  /* ---------- Đọc trang Schedule ---------- */
  async function readSchedule() {
    const sel = settings.selectors || {};
    const isEn = settings.language === "en";
    const today = await waitFor(() => document.querySelector(sel.scheduleToday || ".today-circle"), 15000);
    if (!today) return { ok: false, error: isEn ? "Cannot find today on schedule" : "Không tìm thấy ngày hôm nay trên lịch" };
    await sleep(800); // chờ số liệu hiện đủ
    const cell = today.closest(".col-value") || (today.parentElement && today.parentElement.parentElement);
    if (!cell) return { ok: false, error: isEn ? "Cannot find today's cell on schedule" : "Không tìm thấy ô ngày hôm nay" };
    const tEl = cell.querySelector(sel.scheduleTracked || ".c-secondary");
    const trackedMin = tEl ? tgHm(tEl.textContent) : 0;  // không có phần sau "·" nghĩa là chưa có thời gian tracked
    const leaves = [...cell.querySelectorAll("*")].filter(e => !e.childElementCount).map(e => e.textContent.trim());
    const shift = leaves.find(t => /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(t)) || null;
    return { ok: true, day: today.textContent.trim(), trackedMin: trackedMin == null ? 0 : trackedMin, shift, hasShift: !!shift };
  }

  function diagnose() {
    return {
      host: location.host, url: location.href, state: detectTracker(), timerSec: readTimer(),
      pageOrder: pageOrder(), specialOrders: /\/ui\/work/.test(location.pathname) ? specialOrders() : null,
      found: { start: !!findBtn("start"), pause: !!findBtn("pause"), finish: !!findBtn("finish") },
      buttons: [...document.querySelectorAll("button,[role=button]")].filter(visible).slice(0, 40).map(b => ({
        text: tgNorm(b.innerText).slice(0, 40), aria: b.getAttribute("aria-label") || "", title: b.getAttribute("title") || "",
        cls: String(b.className || "").slice(0, 80)
      }))
    };
  }

  chrome.runtime.onMessage.addListener((m, _s, respond) => {
    switch (m.type) {
      case "banner": setBanner(m.id, m.level, m.text); break;
      case "bannerClear": clearBanner(m.id); break;
      case "idleWarn": showIdle(m.deadline, m.kind); break;
      case "idleStopping": idleStopping(); break;
      case "idleClear": hideIdle(m.kind); break;
      case "clickTracker": clickTracker(m.action, m.expect).then(respond); return true;
      case "readSchedule": readSchedule().then(respond); return true;
      case "diagnose": respond(diagnose()); break;
    }
  });

  if (HIDDEN_FRAME) {
    // Lệnh từ offscreen.js (chỉ nhận từ đúng trang cha của extension), trả kết quả về bằng postMessage
    window.addEventListener("message", e => {
      const d = e.data;
      if (e.source !== window.parent || e.origin !== EXT_ORIGIN || !d || d.tg !== "cmd" || !d.msg) return;
      const m = d.msg;
      const p = m.type === "clickTracker" ? clickTracker(m.action, m.expect)
        : m.type === "diagnose" ? Promise.resolve(diagnose()) : null;
      if (p) p.then(res => window.parent.postMessage({ tg: "res", id: d.id, res }, EXT_ORIGIN));
    });
    // Chặn hộp "Leave site?" của Emplanner khi extension tải lại trang ẩn
    addEventListener("beforeunload", e => e.stopImmediatePropagation(), true);
  }

  send({ type: "hello" }).then(snap => {
    if (!snap || HIDDEN_FRAME) return;
    // Tab Work ẩn của extension: chặn hộp "Leave site?" của Emplanner, vì hộp đó làm tab treo khi extension tải lại tab.
    // Chỉ chặn ở tab này; tab Work trainee tự mở vẫn được Emplanner hỏi như bình thường.
    if (snap.isHiddenTab) addEventListener("beforeunload", e => e.stopImmediatePropagation(), true);
    for (const [id, b] of Object.entries(snap.banners || {})) setBanner(id, b.level, b.text);
    if (snap.noOrderDeadline) showIdle(snap.noOrderDeadline, "noorder");
    else if (snap.idleDeadline) showIdle(snap.idleDeadline, "idle");
  });
})();
