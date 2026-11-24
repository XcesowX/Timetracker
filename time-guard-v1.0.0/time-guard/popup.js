const $ = id => document.getElementById(id);
let toggleBusy = false;
let clock = null;  // { sec, startAt } giống bảng nổi: chỉ một số là giờ trên đồng hồ Emplanner
let currentLang = "vi";

const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, "0")).join(":");
function renderClock() {
  const sec = !clock ? null : clock.startAt ? Math.max(0, Math.floor((Date.now() - clock.startAt) / 1000)) : clock.sec;
  const t = sec == null ? "--:--:--" : hms(sec);
  if ($("tm").textContent !== t) $("tm").textContent = t;
}

async function refresh() {
  let s = null;
  try { s = await chrome.runtime.sendMessage({ type: "getStatus" }); } catch (e) { /* bỏ qua */ }
  if (!s) return;
  clock = s.clock;
  renderClock();
  $("clock").className = "clock " + s.tracker;
  $("state").textContent = s.tracker === "running" ? tgI18n("pop_running", currentLang)
    : s.tracker === "stopped" ? (s.sub === "finished" ? tgI18n("pop_finished", currentLang)
      : tgI18n("pop_stopped", currentLang))
    : tgI18n("pop_unknown", currentLang);
  $("tracked").textContent = s.tracker === "unknown" ? tgI18n("pop_tracked_note", currentLang) : "";
  $("tracked").hidden = s.tracker !== "unknown";

  // Bật / tạm dừng đồng hồ Emplanner ngay từ popup
  const tg = $("toggle");
  if (!toggleBusy) tg.textContent = s.tracker === "running" ? tgI18n("pop_btn_pause", currentLang) : tgI18n("pop_btn_start", currentLang);
  tg.className = "toggle" + (s.tracker === "running" ? " ghost" : "");
  tg.onclick = async () => {
    toggleBusy = true;
    tg.disabled = true;
    tg.textContent = tgI18n("pop_btn_clicking", currentLang);
    let r = null;
    try {
      r = await Promise.race([
        chrome.runtime.sendMessage({ type: "trackerToggle", action: s.tracker === "running" ? "pause" : "start" }),
        new Promise(ok => setTimeout(() => ok({ ok: false, error: currentLang === "en" ? "timeout after 45 seconds" : "quá 45 giây chưa có kết quả" }), 45000))
      ]);
    } catch (e) { /* bỏ qua */ }
    toggleBusy = false;
    tg.disabled = false;
    $("toggleErr").hidden = !!(r && r.ok);
    const errMsg = (r && r.error) || (currentLang === "en" ? "extension did not respond" : "extension không phản hồi");
    $("toggleErr").textContent = r && r.ok ? "" : tgI18n("pop_err_toggle", currentLang, { err: errMsg });
    refresh();
  };

  const sv = $("survey");
  if (s.survey) {
    sv.textContent = tgI18n("pop_btn_survey_end", currentLang);
    sv.className = "";
    $("surveyText").textContent = tgI18n("pop_survey_active", currentLang, { min: s.survey.min, left: s.survey.leftMin });
  } else {
    sv.textContent = tgI18n("pop_btn_survey_start", currentLang);
    sv.className = "ghost";
    $("surveyText").textContent = s.surveyMin
      ? tgI18n("pop_survey_done", currentLang, { min: s.surveyMin })
      : tgI18n("pop_survey_idle", currentLang);
  }
  // Không dùng confirm(): trong popup của extension, hộp confirm làm popup đóng hoặc trả về "không", nên bấm như không có tác dụng.
  // Đồng hồ chưa bật thì background vẫn nhắc bật trong lúc survey.
  sv.disabled = false;
  sv.onclick = async () => {
    sv.disabled = true;
    try { await chrome.runtime.sendMessage({ type: s.survey ? "surveyEnd" : "surveyStart" }); } catch (e) { /* bỏ qua */ }
    refresh();
  };

  const alerts = [];
  if (s.noOrder) alerts.push(`<div class="alert danger">${tgI18n("pop_alert_no_order", currentLang)}</div>`);
  if (s.idle) alerts.push(`<div class="alert danger">${tgI18n("pop_alert_idle", currentLang)}</div>`);
  if (s.multi) alerts.push(`<div class="alert">${tgI18n("pop_alert_multi", currentLang, { count: s.openOrders.length, orders: s.openOrders.map(i => "#" + tgEsc(i)).join(", ") })}</div>`);
  $("alerts").innerHTML = alerts.join("");

  $("orders").innerHTML = s.orders.length
    ? s.orders.map(o => {
        const tags = [];
        if (o.id === s.current) tags.push(tgI18n("pop_tag_working", currentLang));
        if (o.multiMin) tags.push(tgI18n("pop_tag_multi", currentLang, { min: o.multiMin }));
        if (o.untrackedMin) tags.push(tgI18n("pop_tag_untracked", currentLang, { min: o.untrackedMin }));
        return `<li class="${o.id === s.current ? "now" : ""}"><span>#${tgEsc(o.id)} <span class="tag">${tags.join(", ")}</span></span><span>${o.min} ${tgI18n("pop_unit_min", currentLang)}</span></li>`;
      }).join("")
    : `<li class="empty">${tgI18n("pop_orders_empty", currentLang)}</li>`;
}

$("openJournal").onclick = () => chrome.tabs.create({ url: "journal.html" });
$("openOptions").onclick = () => chrome.runtime.openOptionsPage();
$("check").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let r = null;
  try { r = await chrome.tabs.sendMessage(tab.id, { type: "diagnose" }, { frameId: 0 }); } catch (e) { /* trang không có content script */ }
  const pre = $("diag");
  pre.hidden = false;
  if (!r) {
    pre.textContent = tgI18n("pop_diag_not_running", currentLang);
    $("copyDiag").hidden = true;
    return;
  }
  const settings = await tgGetSettings();
  const oid = (r.pageOrder && r.pageOrder.id) || tgOrderId(r.url, settings);
  const yn = v => (v ? tgI18n("pop_yes", currentLang) : tgI18n("pop_no", currentLang));
  pre.textContent = [
    `${tgI18n("pop_diag_page", currentLang)}${r.host}`,
    `${tgI18n("pop_diag_order", currentLang)}${oid ? "#" + oid : tgI18n("pop_diag_none", currentLang)}${r.pageOrder && r.pageOrder.floor != null ? tgI18n("pop_diag_floor", currentLang) + r.pageOrder.floor : ""}`,
    `${tgI18n("pop_diag_clock", currentLang)}${r.timerSec != null ? Math.round(r.timerSec / 60) + " " + tgI18n("pop_unit_min", currentLang) : tgI18n("pop_diag_cant_read", currentLang)}`,
    ...(r.specialOrders ? [`${tgI18n("pop_diag_special", currentLang)}${r.specialOrders.length ? r.specialOrders.map(i => "#" + i).join(", ") : tgI18n("pop_diag_none", currentLang)}`] : []),
    `${tgI18n("pop_diag_tracker", currentLang)}${r.state === "running" ? tgI18n("pop_diag_running", currentLang) : r.state === "stopped" ? tgI18n("pop_diag_stopped", currentLang) : tgI18n("pop_diag_no_btn", currentLang)}`,
    tgI18n("pop_diag_btns", currentLang, { start: yn(r.found.start), pause: yn(r.found.pause), finish: yn(r.found.finish) }),
    `${tgI18n("pop_diag_btn_count", currentLang)}${r.buttons.length}`
  ].join("\n");
  $("copyDiag").hidden = false;
  $("copyDiag").onclick = async () => {
    await navigator.clipboard.writeText(JSON.stringify(Object.assign({ orderId: oid }, r), null, 2));
    $("copyDiag").textContent = tgI18n("pop_btn_copied", currentLang);
  };
};

tgGetSettings().then(s => {
  currentLang = (s && s.language) || "vi";
  tgApplyI18n(document, currentLang);
  refresh();
});

chrome.storage.onChanged.addListener(c => {
  if (c.settings) {
    const s = tgMerge(c.settings.newValue);
    currentLang = s.language || "vi";
    tgApplyI18n(document, currentLang);
    refresh();
  }
});

setInterval(refresh, 3000);
setInterval(renderClock, 200);
