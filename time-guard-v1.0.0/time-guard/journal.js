const $ = id => document.getElementById(id);
let data = { journal: [], days: {}, state: null };
let selected = tgDayKey();
let currentLang = "vi";
let lastDaysKey = "", lastLang = "";
const setBodyHtml = (el, html) => { if (el._tgHtml !== html || !el.innerHTML) { el._tgHtml = html; el.innerHTML = html; } };

async function load() {
  const r = await chrome.storage.local.get(["journal", "days", "state", "settings"]);
  if (r.settings && r.settings.language) currentLang = r.settings.language;
  if (lastLang !== currentLang) { lastLang = currentLang; tgApplyI18n(document, currentLang); }
  data = { journal: r.journal || [], days: r.days || {}, state: r.state || null };
  const today = tgDayKey();
  const set = new Set([today, ...Object.keys(data.days), ...data.journal.map(e => e.day)]);
  const days = [...set].sort().reverse();
  if (!set.has(selected)) selected = today;
  const daysKey = days.join(",") + ":" + currentLang;
  const dayEl = $("day");
  if (lastDaysKey !== daysKey) {
    lastDaysKey = daysKey;
    dayEl.innerHTML = days.map(d => `<option value="${d}" ${d === selected ? "selected" : ""}>${d === today ? d + " " + tgI18n("jrn_today", currentLang) : d}</option>`).join("");
  } else if (dayEl.value !== selected) {
    dayEl.value = selected;
  }
  render();
}

function summaryFor(day) {
  if (data.state && data.state.day === day) return { orders: data.state.orders || {}, trackedSec: data.state.trackedSec || 0, surveySec: data.state.surveySec || 0 };
  return data.days[day] || { orders: {}, trackedSec: 0, surveySec: 0 };
}

function rowsFor(day) {
  const s = summaryFor(day);
  const tl = timelineFor(day);
  const tlOrderSec = {};
  tl.forEach(r => {
    if (r.k === "order" && r.id) {
      tlOrderSec[r.id] = (tlOrderSec[r.id] || 0) + Math.round((r.to - r.from) / 1000);
    }
  });
  return {
    trackedMin: tgMin(s.trackedSec),
    surveyMin: tgMin(s.surveySec),
    rows: Object.entries(s.orders).map(([id, o]) => ({
      id,
      min: tgMin(Math.max(o.sec || 0, tlOrderSec[id] || 0)),
      multi: tgMin(o.multiSec),
      untracked: tgMin(o.untrackedSec)
    })).sort((a, b) => b.min - a.min)
  };
}

// Nếu khoảng No order (k: "none") < 2 phút (120 giây) và ngay sau đó mở một order (k: "order"),
// tính thời gian đó cho order mở ngay sau đó: gán thời gian bắt đầu của order lùi về mốc bắt đầu No order.
// (Logic dùng chung ở common.js: tgNormalizeTimeline / tgTourSummary, bảng nhật ký cạnh bảng nổi cũng dùng.)
const normalizeTimeline = raw => tgNormalizeTimeline(raw);

// Dòng thời gian của ngày (Start time | End time | Order | Time): order, Pause, Survey, không làm order
const dayRec = day => (data.state && data.state.day === day ? data.state : data.days[day] || {});
function timelineFor(day) {
  return normalizeTimeline(dayRec(day).timeline);
}
const two = n => String(n).padStart(2, "0");
const hms = t => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
const dur = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`; };
const tlLabel = r => r.k === "order" ? "#" + r.id : tgI18n(r.k === "pause" ? "jrn_pause" : r.k === "survey" ? "jrn_survey" : "jrn_none", currentLang);

function renderTimeline() {
  const tl = timelineFor(selected);
  const sum = k => tl.filter(r => r.k === k).reduce((a, r) => a + (r.to - r.from), 0);
  $("tlLead").textContent = tl.length ? tgI18n("jrn_tl_lead", currentLang, {
    order: dur(sum("order")), survey: dur(sum("survey")), pause: dur(sum("pause")),
    none: sum("none") ? tgI18n("jrn_tl_lead_none", currentLang, { none: dur(sum("none")) }) : ""
  }) : "";
  setBodyHtml($("tl").tBodies[0], tl.length
    ? tl.map(r => `<tr class="tl-${r.k}"><td class="time">${hms(r.from)}</td><td class="time">${hms(r.to)}</td>
        <td>${tgEsc(tlLabel(r))}</td><td class="num">${dur(r.to - r.from)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">${tgI18n("jrn_tl_empty", currentLang)}</td></tr>`);
}

function tourSummaryFor(day) {
  return tgTourSummary(dayRec(day));
}

function renderTourSummary() {
  const tours = tourSummaryFor(selected);
  const tbody = $("tourSum").tBodies[0];
  if (!tours.length) {
    setBodyHtml(tbody, `<tr><td colspan="2" class="empty">${tgI18n("jrn_tours_empty", currentLang)}</td></tr>`);
    return;
  }
  setBodyHtml(tbody, tours.map(t => {
    const tags = [];
    if (t.multiMin) tags.push(`<span class="pill warn">${tgI18n("pop_tag_multi", currentLang, { min: t.multiMin })}</span>`);
    if (t.untrackedMin) tags.push(`<span class="pill danger">${tgI18n("pop_tag_untracked", currentLang, { min: t.untrackedMin })}</span>`);
    const metaText = `${tgI18n("jrn_tour_total", currentLang)}: <b>${dur(t.totalMs)}</b> (${t.min} ${tgI18n("pop_unit_min", currentLang)})`;

    const ivHtml = t.intervals.length
      ? `<div class="tour-intervals">` + t.intervals.map(iv => `
          <div class="tour-iv">
            <span class="time">${hms(iv.from)} – ${hms(iv.to)}</span>
            <span class="dur">${dur(iv.to - iv.from)}</span>
          </div>`).join("") + `</div>`
      : `<span class="empty" style="padding:0;font-size:12px">${tgI18n("jrn_no_intervals", currentLang)}</span>`;

    return `<tr>
      <td class="tour-cell">
        <div class="tour-title">#${tgEsc(t.id)}</div>
        <div class="tour-meta">${metaText}</div>
        ${tags.length ? `<div class="tour-tags">${tags.join("")}</div>` : ""}
      </td>
      <td class="tour-cell">${ivHtml}</td>
    </tr>`;
  }).join(""));
}

function render() {
  renderTimeline();
  renderTourSummary();
  const { trackedMin, surveyMin, rows } = rowsFor(selected);
  const totalOrders = rows.reduce((a, r) => a + r.min, 0);
  const svText = surveyMin ? tgI18n("jrn_lead_survey", currentLang, { survey: surveyMin }) : "";
  const leadText = tgI18n("jrn_lead", currentLang, {
    tracked: trackedMin,
    orders: totalOrders,
    survey: svText
  });
  if ($("lead").textContent !== leadText) $("lead").textContent = leadText;
  setBodyHtml($("sum").tBodies[0], rows.length
    ? rows.map(r => `<tr><td>#${tgEsc(r.id)}</td><td class="num">${r.min}</td><td class="num">${r.multi || ""}</td><td class="num">${r.untracked || ""}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">${tgI18n("jrn_orders_empty", currentLang)}</td></tr>`);

  const evs = eventRows(selected);
  setBodyHtml($("ev").tBodies[0], evs.length
    ? evs.map(r => `<tr class="tl-${r.k}" title="${tgEsc(r.msg || "")}"><td class="time">${hms(r.from)}</td>
        <td class="time">${r.to ? hms(r.to) : r.open ? tgEsc(tgI18n("jrn_ongoing", currentLang)) : ""}</td>
        <td>${r.html}</td><td class="num">${r.to ? dur(r.to - r.from) : ""}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">${tgI18n("jrn_events_empty", currentLang)}</td></tr>`);
}

function formatEventMsg(e, lang) {
  if (!e || !e.msg || lang !== "en") return (e && e.msg) || "";
  const d = e.data || {};
  switch (e.type) {
    case "log_time": return `Log time order #${d.orderId || "?"}` + (d.minutes ? `: ${d.minutes} min` : "");
    case "survey_end": return (d.reason === "timeout" ? "Survey timed out. " : "") + `Survey: ${d.minutes || 0} min tracked` + (d.fpMinutes ? ` (${d.fpMinutes} min on FP/order counted as survey)` : "");
    case "survey_fp": return `Worked on order #${d.orderId || "?"} during survey (counted as survey)`;
    case "survey_untracked": return "In survey mode with clock off";
    case "untracked_work": return e.msg.replace(/^Làm order/, "Worked on order").replace(/khoảng (\d+) giây khi đồng hồ chưa bật/, "for ~$1s with clock off").replace(/khoảng (\d+) phút khi đồng hồ chưa bật/, "for ~$1 min with clock off");
    case "multi_order": return `Multiple orders open (${(d.ids || []).length}): ${(d.ids || []).map(i => "#" + i).join(", ")}`;
    case "multi_order_resolved": return d.keptOrder ? `Back to 1 order (#${d.keptOrder}): credited ${tgMin(d.creditedSec || 0)} min` : "All orders closed";
    case "day_carry": return `Carried over from previous day (not finished): excluded ${tgMin(d.baseSec || 0)} min`;
    case "day_summary": return `Clock ran ${tgMin(d.trackedSec || 0)} min`;
    case "just_log_view": return d.orderId ? `Order #${d.orderId}: ${d.minutes || 0} min today, ${d.needMin || 0} min to log` : "Order not identified";
    default:
      return e.msg
        .replace(/phút/g, "min").replace(/giây/g, "s")
        .replace(/Đồng hồ chạy/g, "Clock ran").replace(/Không thao tác/g, "No activity for")
        .replace(/khi đồng hồ đang chạy/g, "while clock was running")
        .replace(/Trainee đã quay lại trước khi hết thời gian chờ/g, "Resumed activity before timeout")
        .replace(/Đã quay lại làm order/g, "Resumed order")
        .replace(/mà không làm order và không bật survey/g, "without order or survey");
  }
}

// Sự kiện theo cùng dạng Start time | End time | Order | Time: ghép cặp thành khoảng (Đồng hồ chạy, Pause, Survey);
// sự kiện một thời điểm (cảnh báo, tự dừng, …) chỉ có Start time, cột Order ghi số order (nếu có) và tên sự kiện.
// Rê chuột vào dòng để xem nội dung đầy đủ.
function eventRows(day) {
  const evs = data.journal.filter(e => e.day === day).sort((a, b) => a.t - b.t);
  const rows = [], open = {};
  const text = k => tgEsc(tgI18n(k, currentLang));
  const label = { run: text("jrn_running"), pause: text("jrn_pause"), survey: text("jrn_survey") };
  const start = (k, e) => { if (!open[k]) open[k] = e; };
  const end = (k, e) => { const s = open[k]; if (s) rows.push({ k, from: s.t, to: e.t, html: label[k], msg: k === "survey" ? formatEventMsg(e, currentLang) : "" }); delete open[k]; };
  for (const e of evs) {
    switch (e.type) {
      case "tracker_on": end("pause", e); start("run", e); break;
      case "tracker_off": end("run", e); start("pause", e); break;
      case "survey_start": start("survey", e); break;
      case "survey_end": if (!open.survey && e.data && e.data.minutes != null) open.survey = { t: e.t - e.data.minutes * 60000 }; end("survey", e); break;
      case "tracker_remote": break;  // trùng với dòng Bật / Tạm dừng ngay cạnh
      case "tracker_finish": end("run", e); end("pause", e);  // vẫn hiện thêm một dòng Finish
      default: {
        const id = e.data && e.data.orderId;
        rows.push({ k: "event", from: e.t, to: null, msg: formatEventMsg(e, currentLang),
          html: (id ? `#${tgEsc(id)} ` : "") + `<span class="pill ${TG_EVENT_LEVEL[e.type] || ""}">${tgEsc(tgEventName(e.type, currentLang))}</span>` });
      }
    }
  }
  // Khoảng chưa kết thúc: hôm nay thì ghi "đang diễn ra"
  for (const [k, s] of Object.entries(open)) rows.push({ k, from: s.t, to: null, open: day === tgDayKey(), html: label[k], msg: "" });
  return rows.sort((a, b) => a.from - b.from);
}

function csvCell(v) { return `"${String(v == null ? "" : v).replace(/"/g, '""')}"`; }

$("day").onchange = e => { selected = e.target.value; render(); };
$("options").onclick = () => chrome.runtime.openOptionsPage();

// CSV giống bảng chính: Start time, End time, Order, Time
$("csv").onclick = () => {
  const lines = [
    [tgI18n("jrn_th_start", currentLang), tgI18n("jrn_th_end", currentLang), tgI18n("jrn_th_order", currentLang), tgI18n("jrn_th_duration", currentLang)],
    ...timelineFor(selected).map(r => [hms(r.from), hms(r.to), tlLabel(r), dur(r.to - r.from)])
  ];
  const csv = "\ufeff" + lines.map(l => l.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `time-guard-${selected}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$("clear").onclick = async () => {
  if (!confirm(tgI18n("jrn_clear_confirm", currentLang, { day: selected }))) return;
  const r = await chrome.storage.local.get("journal");
  await chrome.storage.local.set({ journal: (r.journal || []).filter(e => e.day !== selected) });
  load();
};

chrome.storage.onChanged.addListener(c => {
  if (c.journal || c.state || c.days || c.settings) load();
});
load();
