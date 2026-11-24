/* Service worker: giữ trạng thái, tính thời gian theo order, ra cảnh báo, ghi nhật ký. */
importScripts("common.js");

const TICK_MS = 5000;
const UNTRACKED_ACTIVE_MS = 30000; // "đang làm khi đồng hồ tắt" = có thao tác trong 30 giây gần nhất
const MAX_DT = 45;                 // giây tối đa cộng cho một nhịp, tránh cộng dồn khi service worker ngủ
const BOOT = Date.now();

let S = null;
let settings = TG_DEFAULTS;
let loading = null;
let saveTimer = null;

function freshState() {
  return {
    day: tgDayKey(),
    orders: {},          // { [orderId]: { sec, multiSec, untrackedSec, segs } }
    timeline: [],        // dòng thời gian trong ngày: [{ k, id, from, to }]
    orderLogs: {},       // lịch sử log time theo order qua nhiều ngày: { [orderId]: [{ at, raw, min, src, paired }] }
    serverSkew: 0,       // độ lệch giờ máy so với giờ máy chủ (ms)
    dayBase: 0,          // mốc giờ đầu ngày khi phiên hôm trước chưa Finish (giây)
    trackedSec: 0,
    tracker: { state: "unknown", reportedAt: 0, tabId: null, changedAt: 0 },
    hiddenTabId: null,
    hiddenLoadedAt: 0,
    hiddenAwaitLoad: false,
    hiddenStale: false,
    lastActivityAt: 0,
    lastActivityTabId: null,
    lastActivityOrder: null,
    lastActiveOrder: null,
    lastSegOrder: null,
    timelineCut: false,
    lastSessionMin: 0,
    idle: { warnedAt: null, deadline: null, stopping: false },
    noOrder: { warnedAt: null, deadline: null },  // đồng hồ chạy mà không làm order/survey
    lastOrderActivityAt: 0,
    untracked: { sec: 0, lastWarnAt: 0 },
    multi: { active: false, ids: [], lastWarnAt: 0 },
    multiPeriod: null,   // thời gian trong lúc mở nhiều order: { startedAt, sec, perOrder, segments }
    tabs: {},            // { [tabId]: { url, orderId, floor, reported } }
    special: [],         // order "For log time" đọc từ trang Work
    session: null,       // phiên từ lúc bật đồng hồ tới lúc Finish: { startedAt, sec, orders, surveySec }
    survey: null,        // { startedAt, untilAt, sec } khi trainee đang làm survey
    surveySec: 0,        // tổng phút survey trong ngày (khi đồng hồ chạy)
    sched: null,         // lần đọc Schedule gần nhất: { day, at, savedMin, extAtCheck, error }
    banners: {},         // { [id]: { level, text } }
    lastTick: Date.now()
  };
}

function ensure() {
  if (!loading) {
    loading = (async () => {
      settings = await tgGetSettings();
      const r = await chrome.storage.local.get(["state", "settings", "migrations"]);
      S = Object.assign(freshState(), r.state || {});
      await migrate(r);
    })();
  }
  return loading.then(checkDay);
}

// Sang ngày mới: nhiều tin cùng gọi ensure() lúc vừa qua nửa đêm, rollover chờ ghi nhật ký nên S.day đổi muộn;
// chỉ chạy rollover một lần, các lần gọi khác chờ chung (trước đây dòng tổng kết ngày bị ghi 9 lần, 2026-11-02).
let rolling = null;
async function checkDay() {
  const now = Date.now();
  if (!S || tgDayKey(now) === S.day) return;
  if (!rolling) rolling = rollover(now).finally(() => { rolling = null; });
  await rolling;
}

// Chuyển dữ liệu của bản cũ, mỗi việc chỉ làm một lần (đánh dấu ở key "migrations")
async function migrate(r) {
  const done = r.migrations || {};
  if (!done.survey8h) {
    // Survey tối đa đổi từ 60 phút thành 8 tiếng (2026-10-29). Trang Cài đặt lưu mọi giá trị khi bấm Lưu,
    // nên số 60 cũ có thể đã nằm trong cài đặt: đổi sang 480. Đặt lại 60 sau đó thì giữ nguyên.
    if (r.settings && r.settings.surveyMaxMinutes === 60) {
      r.settings.surveyMaxMinutes = 480;
      await chrome.storage.local.set({ settings: r.settings });
      settings = tgMerge(r.settings);
    }
    // Survey đang chạy với giới hạn 60 phút cũ: nới theo giới hạn mới
    if (S.survey && S.survey.untilAt - S.survey.startedAt === 60 * 60000) S.survey.untilAt = S.survey.startedAt + settings.surveyMaxMinutes * 60000;
    done.survey8h = true;
    await chrome.storage.local.set({ migrations: done });
  }
  if (!done.untracked10s) {
    if (r.settings && (r.settings.untrackedSeconds === 120 || !r.settings.untrackedSeconds)) {
      r.settings.untrackedSeconds = 10;
      await chrome.storage.local.set({ settings: r.settings });
      settings = tgMerge(r.settings);
    }
    done.untracked10s = true;
    await chrome.storage.local.set({ migrations: done });
  }
}

let lastStateSave = 0;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; lastStateSave = Date.now(); chrome.storage.local.set({ state: S }); }, 400);
}

/* ---------- Nhật ký ---------- */
let jq = Promise.resolve();
function journal(type, msg, data, day) {
  const e = { t: Date.now(), day: day || tgDayKey(), type, msg, data: data || {} };
  jq = jq.then(async () => {
    const r = await chrome.storage.local.get("journal");
    const list = r.journal || [];
    list.push(e);
    const cut = Date.now() - 31 * 864e5;
    await chrome.storage.local.set({ journal: list.filter(x => x.t >= cut).slice(-6000) });
  }).catch(err => console.error(err));
  return jq;
}

/* ---------- Thông báo & banner ---------- */
function notify(id, title, message, buttons) {
  const opt = { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 2 };
  if (id === "idle" && buttons) { opt.requireInteraction = true; opt.buttons = buttons; }
  chrome.notifications.create(id, opt, () => void chrome.runtime.lastError);
}

function sendTab(tabId, msg) {
  if (Number(tabId) === HIDDEN_ID) return chrome.runtime.sendMessage({ target: "tg-offscreen", op: "send", msg }).catch(() => null);
  return chrome.tabs.sendMessage(Number(tabId), msg, { frameId: 0 }).catch(() => null);
}

function broadcast(msg) {
  for (const id of Object.keys(S.tabs)) sendTab(id, msg);
}

function setBanner(id, level, text, force, key, params) {
  const b = S.banners[id];
  if (!force && b && b.text === text && b.level === level) return;
  S.banners[id] = key ? { level, text, key, params } : { level, text };
  broadcast({ type: "banner", id, level, text });
  save();
}

function refreshBanners() {
  for (const [id, b] of Object.entries(S.banners || {})) {
    if (b && b.key) {
      const text = tgI18n(b.key, settings.language, b.params);
      if (text !== b.text) {
        b.text = text;
        broadcast({ type: "banner", id, level: b.level, text });
      }
    }
  }
  save();
}

function clearBanner(id) {
  if (!S.banners[id]) return;
  delete S.banners[id];
  broadcast({ type: "bannerClear", id });
  save();
}

const stopWord = () => (settings.stopAction === "finish" ? "kết thúc" : "tạm dừng");
const orderList = ids => ids.map(i => "#" + i).join(", ");

/* ---------- Theo dõi tab ---------- */
function isMonitored(url) {
  if (!url) return false;
  if (/^https:\/\/([^/]+\.)?emplanner\.team\//i.test(url)) return true;
  return (settings.extraSites || []).some(p => { const re = tgPatternToRegex(p); return re && re.test(url); });
}

function sameBasePath(a, b) {
  try {
    const ua = new URL(a), ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname.replace(/\/+$/, "") === ub.pathname.replace(/\/+$/, "");
  } catch (e) { return false; }
}

function nextTabEntry(prev, url) {
  const fromUrl = tgOrderId(url, settings);
  if (prev && (prev.url === url || (prev.reported && sameBasePath(prev.url, url) && (!fromUrl || fromUrl === prev.orderId)))) {
    return Object.assign({}, prev, { url });
  }
  return { url, orderId: fromUrl, reported: false };
}

// Số order do trang báo lên (tiêu đề / nội dung) được ưu tiên hơn số lấy từ URL
function setTab(tabId, url) {
  if (!isMonitored(url)) { delete S.tabs[tabId]; return; }
  const prev = S.tabs[tabId];
  if (prev && prev.url === url) return;
  S.tabs[tabId] = nextTabEntry(prev, url);
}

function onPage(tabId, url, msg) {
  if (tabId == null || !url || !isMonitored(url)) return;
  const orderId = msg.orderId || tgOrderId(url, settings);
  S.tabs[tabId] = { url, orderId, floor: msg.floor || null, reported: !!msg.orderId };
  if (Array.isArray(msg.special)) S.special = msg.special;
  evalMulti();
}

async function rebuildTabs() {
  const tabs = await chrome.tabs.query({});
  const t = {};
  for (const tab of tabs) {
    if (!tab.url || !isMonitored(tab.url)) continue;
    t[tab.id] = nextTabEntry(S.tabs[tab.id], tab.url);
  }
  S.tabs = t;
  evalMulti();
}

function multiText(ids) {
  return tgI18n("bg_multi_msg", settings.language, { count: ids.length, orders: orderList(ids) });
}

function warnMulti(ids) {
  const params = { count: ids.length, orders: orderList(ids) };
  const text = tgI18n("bg_multi_msg", settings.language, params);
  S.multi.lastWarnAt = Date.now();
  setBanner("multi", "warn", text, true, "bg_multi_msg", params);
  notify("multi", tgI18n("bg_multi_title", settings.language), text);
}

function evalMulti() {
  const ids = [...new Set(Object.values(S.tabs).map(x => x.orderId).filter(Boolean))].sort();
  const active = ids.length > 1;
  const was = S.multi.active;
  const changed = ids.join() !== (S.multi.ids || []).join();
  S.multi = { active, ids, lastWarnAt: S.multi.lastWarnAt || 0 };
  if (active && (!was || changed)) {
    if (!S.multiPeriod) {
      S.multiPeriod = { startedAt: Date.now(), sec: 0, perOrder: {}, segments: [] };
      S.timelineCut = true;
    }
    warnMulti(ids);
    journal("multi_order", `Mở cùng lúc ${ids.length} order: ${orderList(ids)}`, { ids });
  } else if (!active && was) {
    clearBanner("multi");
    chrome.notifications.clear("multi");
    resolveMulti(ids);
  }
  save();
}

function mergeOrderSegs(o, list) {
  if (!o || !list || !list.length) return;
  const segs = o.segs || (o.segs = []);
  for (const s of list) {
    const sec = s.sec != null ? s.sec : Math.max(0, (s.to - s.from) / 1000);
    if (sec > 0) segs.push({ from: s.from, to: s.to, sec });
  }
  segs.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    if (prev && s.from - prev.to <= SEG_GAP_MS) {
      prev.to = Math.max(prev.to, s.to);
      prev.sec += s.sec;
    } else if (merged.length < 100) {
      merged.push(s);
    }
  }
  o.segs = merged;
}

// Đã đóng bớt order: cộng toàn bộ thời gian lúc mở nhiều order cho order được giữ lại
function resolveMulti(ids) {
  const mp = S.multiPeriod;
  S.multiPeriod = null;
  const kept = ids.length === 1 ? ids[0] : null;
  if (!mp) {
    journal("multi_order_resolved", kept ? `Chỉ còn order #${kept}` : "Đã đóng hết order", { ids });
    return;
  }
  const hm = t => new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const seg = mp.segments.map(x => `${hm(x.from)}–${hm(x.to)} #${x.id}`).join(", ");
  const per = Object.entries(mp.perOrder).map(([id, sec]) => `#${id}: ${tgMin(sec)} phút`).join("; ");
  if (mp.segments.length) {
    journal("multi_order_detail", `Lúc mở nhiều order (${hm(mp.startedAt)}–${hm(Date.now())}) đã làm: ${seg}. Tổng theo order: ${per}`,
      { segments: mp.segments, perOrder: mp.perOrder });
  }
  const credit = (id, sec) => {
    const o = orderRec(id);
    o.sec += sec;
    o.multiSec += sec;
    if (S.session) S.session.orders[id] = (S.session.orders[id] || 0) + sec;
  };
  const creditSegs = (id, list) => {
    if (!id || !list || !list.length) return;
    mergeOrderSegs(orderRec(id), list);
    S.lastSegOrder = id;
  };
  if (kept) {
    if (mp.sec > 0) credit(kept, mp.sec);
    creditSegs(kept, mp.segments);
    // Cập nhật các khoảng trong timeline lúc mở nhiều order về order được giữ lại để tổng kết tour nhất quán
    if (S.timeline && S.timeline.length) {
      const out = [];
      for (const r of S.timeline) {
        if (r.k === "order" && r.to > mp.startedAt) {
          if (r.from >= mp.startedAt - 5000) { r.id = kept; out.push(r); }
          else if (r.id !== kept) {
            out.push({ k: "order", id: r.id, from: r.from, to: mp.startedAt });
            out.push({ k: "order", id: kept, from: mp.startedAt, to: r.to });
          } else out.push(r);
        } else out.push(r);
      }
      S.timeline = out;
    }
    journal("multi_order_resolved", `Chỉ còn order #${kept}. Đã tính ${tgMin(mp.sec)} phút lúc mở nhiều order cho #${kept}`, { ids, keptOrder: kept, creditedSec: mp.sec });
  } else {
    // Đóng hết order: tính theo đúng order đã thao tác
    for (const [id, sec] of Object.entries(mp.perOrder)) credit(id, sec);
    const byOrder = {};
    for (const s of mp.segments) (byOrder[s.id] || (byOrder[s.id] = [])).push(s);
    for (const [id, list] of Object.entries(byOrder)) creditSegs(id, list);
    journal("multi_order_resolved", `Đã đóng hết order. Thời gian lúc mở nhiều order được tính theo order đã làm: ${per || "không có"}`, { ids, perOrder: mp.perOrder });
  }
}

/* ---------- Đồng hồ & thao tác ---------- */
function orderRec(id) { return S.orders[id] || (S.orders[id] = { sec: 0, multiSec: 0, untrackedSec: 0 }); }

// Dòng thời gian trong ngày cho trang nhật ký (Start time | End time | Order | Time). Mỗi nhịp ghi đang làm gì:
// order (đồng hồ chạy, đang thao tác trên order), survey, pause (đồng hồ tạm dừng), none (đồng hồ chạy mà không làm order).
// Cùng loại và liền nhau (cách dưới 1 phút) thì nối vào dòng trước. Sau Finish hoặc chưa đọc được đồng hồ thì không ghi.
function timelineKind(running, stopped, oid) {
  if (running) return S.survey ? { k: "survey" } : oid ? { k: "order", id: oid } : { k: "none" };
  if (stopped && S.tracker.sub === "paused") return { k: "pause" };
  return null;
}
function addTimeline(cur, now, dt) {
  if (!cur || !(dt > 0)) return;
  const tl = S.timeline || (S.timeline = []);
  const last = tl[tl.length - 1];

  // Nếu khoảng No order (k: "none") < 2 phút (120 giây, hoặc theo activeWindowSeconds) và ngay sau đó mở một order (cur.k: "order"),
  // thì tính khoảng No order đó cho order mở ngay sau đó.
  const absorbMs = Math.max(120000, ((settings && settings.activeWindowSeconds) || 90) * 1000);
  if (last && last.k === "none" && cur.k === "order" && (last.to - last.from) < absorbMs && now - last.to <= 60000) {
    const noneSec = (last.to - last.from) / 1000;
    last.k = "order";
    last.id = cur.id;
    last.to = now;
    if (noneSec > 0) {
      if (S.multi.active && S.multiPeriod) {
        const mp = S.multiPeriod;
        mp.sec += noneSec;
        mp.perOrder[cur.id] = (mp.perOrder[cur.id] || 0) + noneSec;
        const lastMpSeg = mp.segments[mp.segments.length - 1];
        if (lastMpSeg && lastMpSeg.id === cur.id && Math.abs(lastMpSeg.to - now) <= 2000) {
          if (lastMpSeg.from > last.from) lastMpSeg.from = last.from;
          lastMpSeg.sec = (lastMpSeg.sec || 0) + noneSec;
        }
      } else {
        const o = orderRec(cur.id);
        o.sec += noneSec;
        if (S.session && S.session.orders) S.session.orders[cur.id] = (S.session.orders[cur.id] || 0) + noneSec;
        if (o.segs && o.segs.length) {
          const lastSeg = o.segs[o.segs.length - 1];
          if (lastSeg && Math.abs(lastSeg.to - now) <= 2000) {
            if (lastSeg.from > last.from) lastSeg.from = last.from;
            lastSeg.sec += noneSec;
          }
        }
      }
    }
    // Nếu dòng trước đó cũng là cùng order này và liền nhau, gộp lại
    const prev = tl[tl.length - 2];
    if (prev && !S.timelineCut && prev.k === "order" && prev.id === cur.id && last.from - prev.to <= 1000) {
      prev.to = last.to;
      tl.pop();
    }
    return;
  }

  // Vừa log time (timelineCut): bắt đầu dòng mới dù vẫn là order đó
  if (last && !S.timelineCut && last.k === cur.k && last.id === cur.id && now - last.to <= 60000) last.to = now;
  else if (tl.length < 1000) { tl.push({ k: cur.k, id: cur.id, from: now - dt * 1000, to: now }); S.timelineCut = false; }
}

// Các khoảng thời gian làm order trong ngày (đồng hồ chạy và đang thao tác trên order đó), để hiện trên trang order.
// Nối vào khoảng trước nếu vẫn là order đó và cách nhau dưới 2 phút; sang ngày mới thì mất cùng S.orders.
const SEG_GAP_MS = 120000;
function addSeg(oid, now, dt) {
  const o = orderRec(oid);
  const segs = o.segs || (o.segs = []);
  const last = segs[segs.length - 1];
  if (last && S.lastSegOrder === oid && now - last.to <= SEG_GAP_MS) { last.to = now; last.sec += dt; }
  else if (segs.length < 100) segs.push({ from: now - dt * 1000, to: now, sec: dt });
  S.lastSegOrder = oid;
}

// Trainee log time cho order: bấm gửi trong hộp log time ("submit"), hoặc đọc danh sách "You have earlier logged" trong hộp
// đó ("emplanner", chính xác tới phút; gồm cả lần log trước khi có bản này hoặc log ở máy khác). Lần log là mốc cắt: thẻ log
// time lần sau chỉ tính thời gian sau mốc này. Khi bấm gửi, khoảng đang làm kết thúc tại đây, làm tiếp là khoảng mới.
// Lưu theo order qua nhiều ngày (S.orderLogs, không xoá khi sang ngày mới; bỏ lần log quá 60 ngày), vì tour có thể làm nhiều ngày.
const ORDER_LOG_KEEP_MS = 60 * 86400000;
// Giờ Emplanner ghi lần log là giờ máy chủ, còn các khoảng làm order tính theo giờ máy tính; máy tính chạy nhanh/chậm
// vài phút thì một lần log thành 2 hàng. S.serverSkew (ms, giờ máy - giờ máy chủ) học được khi ghép lần bấm gửi với
// hàng Emplanner cùng số phút trong vòng 10 phút; giờ của Emplanner được đổi sang giờ máy trước khi so.
const LOG_PAIR_MS = 10 * 60000;
function logOrder(oid, at, min, src) {
  if (!oid || !(at > 0)) return;
  const raw = at;
  if (src === "emplanner") at += S.serverSkew || 0;
  if (at > Date.now() + (src === "emplanner" ? LOG_PAIR_MS : 60000) || at < Date.now() - ORDER_LOG_KEEP_MS) return;
  const all = S.orderLogs || (S.orderLogs = {});
  const logs = all[oid] || (all[oid] = []);
  // Đã biết lần log này (danh sách của Emplanner chỉ tới phút): chỉ bổ sung số phút nếu trước đó chưa có
  const known = logs.find(l => Math.abs(l.at - at) < 60000 && (!l.min || !min || l.min === min));
  if (known) {
    if (!known.min && min) { known.min = min; save(); }
    if (known.src !== src) {
      known.paired = true;
      if (src === "submit") { known.at = at; known.src = "submit"; save(); }
    }
  } else {
    logs.push(src === "emplanner" ? { at, raw, min: min || null, src } : { at, min: min || null, src });
    logs.sort((a, b) => a.at - b.at);
  }
  if (pairLogs(logs)) save();
  if (known && (src !== "submit" || known.cutDone)) return;
  if (src === "submit") {
    if (known) known.cutDone = true;
    S.lastSegOrder = null;
    S.timelineCut = true;
    journal("log_time", `Log time order #${oid}` + (min ? `: ${min} phút` : ""), { orderId: oid, minutes: min || null });
  }
  save();
}

// Hàng Emplanner trùng với một lần bấm gửi chưa ghép (cùng số phút, lệch < 10 phút): bỏ hàng Emplanner, giữ giờ bấm gửi
// (cùng giờ máy với các khoảng làm order) và học độ lệch giờ máy. Độ lệch đổi thì đổi lại giờ mọi hàng Emplanner đã lưu.
function pairLogs(logs) {
  let changed = false;
  for (const e of logs.slice()) {
    if (e.src !== "emplanner") continue;
    if (e.raw == null) e.raw = e.at;  // lưu trước khi có độ lệch giờ
    const sub = logs.find(l => l.src === "submit" && !l.paired && Math.abs(l.at - e.at) < LOG_PAIR_MS && (!l.min || !e.min || l.min === e.min));
    if (!sub) continue;
    sub.paired = true;
    if (!sub.min && e.min) sub.min = e.min;
    logs.splice(logs.indexOf(e), 1);
    changed = true;
    // Emplanner chỉ tới phút: giờ máy chủ thật nằm trong phút đó, lấy giữa phút
    const skew = sub.at - e.raw - 30000;
    if (Math.abs(skew - (S.serverSkew || 0)) > 30000) {
      S.serverSkew = Math.abs(skew) < 60000 ? 0 : skew;
      for (const list of Object.values(S.orderLogs || {}))
        for (const l of list) if (l.src === "emplanner" && l.raw != null) l.at = l.raw + S.serverSkew;
    }
  }
  return changed;
}

function currentOrder() {
  const o = S.lastActivityOrder;
  return o && Object.values(S.tabs).some(t => t.orderId === o) ? o : null;
}

// Đồng hồ của extension: đang chạy thì tự đếm từ mốc 0 (startAt, ms), đang dừng thì đứng ở timerSec.
// startAt chỉ đổi khi bắt đầu chạy, khi tab Work vừa tải xong, hoặc khi tab Work đang hiện đo được mốc chính xác hơn.
function onTracker(state, tabId, timerSec, startAt) {
  const now = Date.now();
  const prev = S.tracker.state;
  const prevClock = emplannerClock();
  const prevTimer = prevClock ? prevClock.sec : S.tracker.timerSec;  // giờ ngay trước khi bấm Finish
  if (state === "running") {
    if (typeof startAt === "number") S.tracker.startAt = startAt;
    else if ((prev !== "running" || typeof S.tracker.startAt !== "number") && typeof timerSec === "number") { S.tracker.startAt = now - timerSec * 1000; S.tracker.startSrc = "est"; }
    if (typeof S.tracker.startAt === "number") S.tracker.timerSec = Math.floor((now - S.tracker.startAt) / 1000);
  } else {
    // Vừa dừng mà không đọc được giờ: lấy giờ extension đang đếm
    if (typeof timerSec !== "number" && prev === "running" && prevClock) timerSec = prevClock.sec;
    if (typeof timerSec === "number") S.tracker.timerSec = timerSec;
    S.tracker.startAt = null;
  }
  S.tracker.reportedAt = now;
  if (tabId != null) S.tracker.tabId = tabId;

  // Đang dừng: giờ còn > 0 là tạm dừng, giờ về 0 là đã Finish
  const finished = state === "stopped" && timerSec === 0;
  const sub = state === "running" ? "running" : finished ? "finished" : "paused";
  const prevSub = S.tracker.sub || (prev === "running" ? "running" : "unknown");
  // Mốc đầu ngày hết tác dụng khi Finish hoặc giờ Emplanner nhỏ hơn mốc (đã sang phiên mới)
  if (S.dayBase && (finished || (typeof S.tracker.timerSec === "number" && S.tracker.timerSec < S.dayBase))) S.dayBase = 0;

  if (sub !== prevSub) {
    S.tracker.sub = sub;
    if (sub === "running") {
      if (!S.session) S.session = { startedAt: now, sec: 0, orders: {} };
      journal("tracker_on", "Đồng hồ bắt đầu chạy");
    } else if (sub === "finished") {
      if (S.session && S.session.sec > 0) endSession(prevTimer);
      S.session = null;
    } else if (prevSub !== "unknown") {
      S.lastSegOrder = null;
      journal("tracker_off", "Đồng hồ tạm dừng");
    }
  }

  if (state !== prev) {
    S.tracker.state = state;
    S.tracker.changedAt = now;
    if (state === "running") {
      S.lastActivityAt = Math.max(S.lastActivityAt, now);
      S.lastOrderActivityAt = Math.max(S.lastOrderActivityAt || 0, now);
      S.untracked.sec = 0;
      clearBanner("untracked");
      clearBanner("autostop");
      chrome.notifications.clear("untracked");
    } else if (!S.idle.stopping) {
      if (S.idle.warnedAt) clearIdle(false);
      if (S.noOrder.warnedAt) clearNoOrder(false);
    }
  }
  clearBanner("keepwork");
  // Chỉ đọc trang Schedule khi đồng hồ ở 0 và hôm nay chưa đọc được (không đọc lại ngay sau khi Finish phiên đang chạy)
  const checkedToday = S.sched && S.sched.day === S.day && !S.sched.error;
  if (state === "stopped" && timerSec === 0 && prev !== "running" && !checkedToday) checkSchedule();
  save();
}

/* ---------- Trang Schedule ---------- */
// Đọc lỗi thì thử lại cách nhau ít nhất 10 phút, tối đa 3 lần mỗi ngày
const SCHED_MAX_FAILS = 3;
let schedBusy = false;
async function checkSchedule() {
  if (schedBusy) return;
  const now = Date.now();
  const today = S.sched && S.sched.day === S.day ? S.sched : null;
  if (today && (!today.error || (today.fails || 0) >= SCHED_MAX_FAILS || now - today.at < 10 * 60000)) return;
  schedBusy = true;
  let tabId = null, res = null;
  try {
    const tab = await chrome.tabs.create({ url: settings.scheduleUrl, active: false });
    tabId = tab.id;
    await waitTabLoaded(tabId, 20000);
    for (let i = 0; i < 6 && (!res || !res.ok); i++) {
      await new Promise(r => setTimeout(r, 1500));
      res = await sendTab(tabId, { type: "readSchedule" });
    }
  } catch (e) {
    res = { ok: false, error: String(e) };
  } finally {
    if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
    schedBusy = false;
  }
  await ensure();
  if (!res || !res.ok) {
    const fails = (today ? today.fails || 0 : 0) + 1;
    S.sched = { day: S.day, at: now, error: true, fails };
    journal("schedule_check_failed", "Không đọc được thời gian tracked trên trang Schedule" + (res && res.error ? `: ${res.error}` : "") +
      (fails >= SCHED_MAX_FAILS ? `. Đã thử ${fails} lần, hôm nay không thử lại` : ""));
    save();
    return;
  }
  const saved = res.trackedMin;
  const ext = tgMin(S.trackedSec);
  let msg;
  if (saved === 0) {
    msg = "Hôm nay Emplanner chưa có thời gian tracked: bắt đầu ngày làm việc mới";
  } else {
    const missing = saved - ext;
    msg = `Hôm nay Emplanner đã lưu ${saved} phút từ các phiên đã Finish trước đó. Extension ghi tiếp thời gian từ bây giờ` +
      (missing > 3 ? ` (extension chỉ có dữ liệu ${ext} phút, ${missing} phút trước đó không có số liệu theo order)` : "");
  }
  if (!res.hasShift) msg += ". Lưu ý: hôm nay chưa có lịch làm việc (Schedule)";
  S.sched = { day: S.day, at: now, savedMin: saved, extAtCheck: ext, shift: res.shift || null, error: false };
  journal("schedule_check", msg, { savedMin: saved, extMin: ext, shift: res.shift || null });
  save();
}

/* ---------- Survey ---------- */
// Trong lúc survey: được để đồng hồ chạy mà không thao tác trên Emplanner,
// nên không cảnh báo/không tự dừng, và thời gian không tính vào order nào.
function surveyStart() {
  if (S.survey) return;
  const now = Date.now();
  S.survey = { startedAt: now, untilAt: now + settings.surveyMaxMinutes * 60000, sec: 0, fpSec: 0, fpWarnAt: 0, offWarnAt: 0 };
  if (S.idle.warnedAt && !S.idle.stopping) clearIdle(false);
  if (S.noOrder.warnedAt && !S.idle.stopping) clearNoOrder(false);
  const params = { max: settings.surveyMaxMinutes };
  const bannerText = tgI18n("bg_survey_banner", settings.language, params);
  setBanner("survey", "info", bannerText, true, "bg_survey_banner", params);
  journal("survey_start", `Bắt đầu survey (tối đa ${settings.surveyMaxMinutes} phút)`);
  save();
}

function surveyEnd(reason) {
  if (!S.survey) return;
  const m = tgMin(S.survey.sec);
  const total = tgMin((Date.now() - S.survey.startedAt) / 1000);
  const fp = tgMin(S.survey.fpSec);
  journal("survey_end", (reason === "timeout" ? `Hết ${settings.surveyMaxMinutes} phút, survey tự tắt. ` : "") + `Survey ${total} phút, trong đó đồng hồ chạy ${m} phút` + (fp ? `. Có ${fp} phút thao tác trên trang FP/order, đã tính là survey` : ""), { minutes: m, fpMinutes: fp, reason: reason || "user" });
  if (reason === "timeout") {
    const title = tgI18n("bg_survey_end_title", settings.language);
    const msg = tgI18n("bg_survey_end_msg", settings.language, { max: settings.surveyMaxMinutes });
    notify("survey", title, msg);
  }
  S.survey = null;
  clearBanner("surveyfp");
  clearBanner("surveyoff");
  S.lastActivityAt = Date.now(); // tính lại thời gian không thao tác từ lúc kết thúc survey
  S.lastOrderActivityAt = Date.now();
  clearBanner("survey");
  save();
}

// Bấm Finish: ghi lại phiên vừa rồi làm order nào, bao nhiêu phút
function sessionRows() {
  return Object.entries(S.session ? S.session.orders : {}).map(([id, sec]) => ({ id, min: tgMin(sec) })).sort((a, b) => b.min - a.min);
}

function endSession(emplannerSec) {
  const ss = S.session;
  S.lastSessionMin = tgMin(ss.sec);
  const rows = sessionRows();
  const onOrders = Object.values(ss.orders).reduce((a, x) => a + x, 0);
  const survey = ss.surveySec || 0;
  const mp = S.multiPeriod;
  const pending = mp ? mp.sec : 0;  // lúc mở nhiều order, chưa biết order nào được giữ lại
  const noOrder = Math.max(0, ss.sec - onOrders - survey - pending);
  const from = new Date(ss.startedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const to = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const parts = rows.map(r => `#${r.id}: ${r.min} phút`);
  if (tgMin(pending) > 0) {
    const per = Object.entries(mp.perOrder).map(([id, sec]) => `#${id} ${tgMin(sec)} phút`).join(", ");
    parts.push(`lúc mở nhiều order, chờ tính cho order được giữ lại: ${tgMin(pending)} phút (${per})`);
  }
  if (tgMin(survey) > 0) parts.push(`survey: ${tgMin(survey)} phút`);
  if (tgMin(noOrder) > 0) parts.push(`không gắn với order nào: ${tgMin(noOrder)} phút`);
  const emp = typeof emplannerSec === "number" && emplannerSec > 0 ? `Đồng hồ Emplanner ${tgMin(emplannerSec)} phút, extension đo ${tgMin(ss.sec)} phút. ` : `Extension đo ${tgMin(ss.sec)} phút. `;
  journal("tracker_finish", `Phiên ${from}–${to}. ${emp}${parts.join("; ") || "Không có order nào"}`,
    { startedAt: ss.startedAt, sec: ss.sec, emplannerSec, orders: ss.orders, surveySec: survey, noOrderSec: noOrder });
}

function onActivity(tabId) {
  S.lastActivityAt = Date.now();
  if (tabId != null) {
    S.lastActivityTabId = tabId;
    const oid = (S.tabs[tabId] && S.tabs[tabId].orderId) || null;
    S.lastActivityOrder = oid;
    if (oid) {
      S.lastActiveOrder = oid;
      S.lastOrderActivityAt = S.lastActivityAt;
      if (S.noOrder.warnedAt && !S.idle.stopping) clearNoOrder(true);
    }
  }
  if (S.idle.warnedAt && !S.idle.stopping) clearIdle(true);
  save();
}

function startIdle(now) {
  S.idle = { warnedAt: now, deadline: now + settings.graceSeconds * 1000, stopping: false };
  broadcast({ type: "idleWarn", kind: "idle", deadline: S.idle.deadline });
  const lang = settings.language;
  const mins = Math.round(settings.idleSeconds / 60);
  const title = tgI18n("bg_idle_title", lang);
  const word = settings.stopAction === "finish" ? tgI18n("cnt_finish_word", lang) : tgI18n("cnt_pause_word", lang);
  const msg = tgI18n("bg_idle_msg", lang, { min: mins, word, sec: settings.graceSeconds });
  const btnTitle = tgI18n("cnt_btn_still_working", lang);
  notify("idle", title, msg, [{ title: btnTitle }]);
  journal("idle_warning", `Không thao tác ${mins} phút khi đồng hồ đang chạy`);
  save();
}

function clearIdle(resumed) {
  if (!S.idle.warnedAt) return;
  if (resumed) journal("idle_resumed", "Trainee đã quay lại trước khi hết thời gian chờ");
  S.idle = { warnedAt: null, deadline: null, stopping: false };
  broadcast({ type: "idleClear", kind: "idle" });
  chrome.notifications.clear("idle");
  save();
}

function startNoOrder(now) {
  S.noOrder = { warnedAt: now, deadline: now + settings.noOrderGraceSeconds * 1000 };
  const lang = settings.language;
  const mins = Math.round(settings.noOrderSeconds / 60);
  const gSec = settings.noOrderGraceSeconds || 60;
  const gMin = gSec / 60;
  const gEn = gSec % 60 === 0 ? `${gMin} ${gMin === 1 ? "minute" : "minutes"}` : `${gSec} seconds`;
  const gVi = gSec % 60 === 0 ? `${gMin} phút` : `${gSec} giây`;
  const word = settings.stopAction === "finish" ? tgI18n("cnt_finish_word", lang) : tgI18n("cnt_pause_word", lang);
  const params = { min: mins, word, grace: lang === "en" ? gEn : gVi };
  const text = tgI18n("bg_noorder_msg", lang, params);
  broadcast({ type: "idleWarn", kind: "noorder", deadline: S.noOrder.deadline });
  setBanner("noorder", "danger", text, true, "bg_noorder_msg", params);
  notify("noorder", tgI18n("bg_noorder_title", lang), text, [{ title: tgI18n("cnt_btn_start_survey", lang) }]);
  journal("noorder_warning", `Đồng hồ chạy ${mins} phút mà không làm order và không bật survey`);
  save();
}

function clearNoOrder(resumed) {
  if (!S.noOrder.warnedAt) return;
  if (resumed) journal("noorder_resumed", `Đã quay lại làm order #${S.lastActivityOrder || S.lastActiveOrder || "?"}`);
  S.noOrder = { warnedAt: null, deadline: null };
  broadcast({ type: "idleClear", kind: "noorder" });
  clearBanner("noorder");
  chrome.notifications.clear("noorder");
  save();
}

function waitTabLoaded(tabId, ms) {
  return new Promise(resolve => {
    const done = () => { chrome.tabs.onUpdated.removeListener(f); clearTimeout(timer); resolve(); };
    const f = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const timer = setTimeout(done, ms);
    chrome.tabs.onUpdated.addListener(f);
  });
}

/* ---------- Trang Work chạy ẩn ---------- */
// Extension giữ trang Work trong một trang offscreen (offscreen.html, iframe): không có tab, người dùng không thấy,
// không đóng hay chỉnh được (người dùng chốt 2026-10-31). HIDDEN_ID là số tab giả của trang này.
// Trang Work chỉ hỏi máy chủ lúc tải, nên khi đồng hồ bị bấm ở tab Work khác thì trang ẩn bị cũ (S.hiddenStale):
// không tự tải lại ngay, chỉ tải lại trang ẩn ngay trước khi cần bấm đồng hồ trên nó (reloadHidden).
const HIDDEN_ID = -2;
let hiddenOpening = null;

async function hasOffscreen() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  const c = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return c.length > 0;
}

async function ensureHiddenTab() {
  if (hiddenOpening) return hiddenOpening;
  hiddenOpening = (async () => {
    // Bản cũ dùng tab Work ghim: đóng tab đó
    if (S.hiddenTabId != null && S.hiddenTabId !== HIDDEN_ID) { chrome.tabs.remove(S.hiddenTabId).catch(() => {}); S.hiddenTabId = HIDDEN_ID; save(); }
    if (!(await hasOffscreen())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html?u=" + encodeURIComponent(settings.workUrl),
        reasons: ["DOM_SCRAPING"],
        justification: "Đọc và bấm đồng hồ trên trang Emplanner Work"
      });
      S.hiddenTabId = HIDDEN_ID;
      S.hiddenLoadedAt = Date.now();
      S.hiddenAwaitLoad = true;
      S.hiddenStale = false;
      save();
    } else if (S.hiddenTabId !== HIDDEN_ID) {
      S.hiddenTabId = HIDDEN_ID;
      save();
    }
    return { id: HIDDEN_ID };
  })().catch(e => { console.error(e); return null; }).finally(() => { hiddenOpening = null; });
  return hiddenOpening;
}

// Tải lại trang Work ẩn (lấy giờ mới từ máy chủ) rồi chờ nó báo lần đầu, tối đa 15 giây
async function reloadHidden() {
  if (!(await ensureHiddenTab())) return;
  S.hiddenLoadedAt = Date.now();
  S.hiddenAwaitLoad = true;
  await chrome.runtime.sendMessage({ target: "tg-offscreen", op: "load", url: settings.workUrl }).catch(() => null);
  const end = Date.now() + 15000;
  for (let i = 0; i < 50 && Date.now() < end && S.hiddenAwaitLoad; i++) await new Promise(r => setTimeout(r, 300));
  S.hiddenAwaitLoad = false;
}

// Trang Work vừa tải (giờ mới lấy từ máy chủ): so với đồng hồ extension đang tự chạy. Lệch dưới 1 phút (kể cả khác
// trạng thái, vd bấm ở trình duyệt khác vài giây) thì im lặng cập nhật theo Emplanner. Lệch từ 1 phút trở lên: báo lỗi,
// ghi nhật ký; onWorkReport cập nhật theo Emplanner.
const MISMATCH_SEC = 60;
function checkMismatch(msg, now) {
  const t = S.tracker;
  if (!trackerKnown() || !t.sub || typeof msg.timerSec !== "number") return;  // chưa có gì để so
  const c = emplannerClock();
  if (!c) return;
  const sub = msg.state === "running" ? "running" : msg.timerSec === 0 ? "finished" : "paused";
  if (Math.abs(c.sec - msg.timerSec) < MISMATCH_SEC && (sub === t.sub || sub !== "finished" && t.sub !== "finished")) { clearBanner("mismatch"); return; }
  // Sang ngày mới: Emplanner đã Finish / về 00:00:00 thì phiên ngày cũ đã kết thúc, không coi là lệch do bấm ở nơi khác
  if (S.dayBase > 0 && msg.timerSec === 0) {
    clearBanner("mismatch");
    S.dayBase = 0;
    return;
  }
  const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, "0")).join(":");
  const word = (x, l) => l === "en"
    ? (x === "running" ? "running" : x === "finished" ? "finished" : "paused")
    : (x === "running" ? "đang chạy" : x === "finished" ? "đã Finish" : "đang dừng");
  const lang = settings.language;
  const params = { emp: `${hms(msg.timerSec)} ${word(sub, lang)}`, tg: `${hms(c.sec)} ${word(t.sub, lang)}` };
  const text = tgI18n("bg_mismatch_msg", lang, params);
  const textVi = tgI18n("bg_mismatch_msg", "vi", { emp: `${hms(msg.timerSec)} ${word(sub, "vi")}`, tg: `${hms(c.sec)} ${word(t.sub, "vi")}` });
  setBanner("mismatch", "danger", text, true, "bg_mismatch_msg", params);
  notify("mismatch", tgI18n("bg_mismatch_title", lang), text);
  journal("tracker_mismatch", textVi, { emplannerSec: msg.timerSec, emplannerState: sub, extensionSec: c.sec, extensionState: t.sub });
}

// Trang Work của chính trainee (settings.workUrl, vd https://app-ui.emplanner.team/ui/work), không phải /ui/profile/…
function isWorkPage(u) {
  const w = settings.workUrl.replace(/\/+$/, "");
  return !!u && u.startsWith(w) && /^([/?#]|$)/.test(u.slice(w.length));
}

// Chỉ giữ cho tab ẩn luôn mở (bị đóng thì mở lại), không tải lại
async function hiddenWatch() {
  await ensureHiddenTab();
}

// Tab Work báo đồng hồ. Tab ẩn của extension là nguồn chính. Tab Work khác chỉ được tin khi nó vừa tải
// (giờ mới lấy từ máy chủ) hoặc thấy đồng hồ đổi ngay trên trang đó (trainee bấm ở đó); khi đó tab ẩn bị cũ:
// bỏ qua báo cáo của tab ẩn tới khi nó tải lại hoặc thấy đồng hồ đổi ngay trên nó.
function onWorkReport(msg, tabId) {
  const now = Date.now(), t = S.tracker;
  const mine = tabId != null && tabId === S.hiddenTabId;
  const sub = msg.state === "running" ? "running" : msg.timerSec === 0 ? "finished" : "paused";
  const changed = sub !== t.sub || msg.state !== t.state;
  if (mine) {
    if (S.hiddenAwaitLoad && !msg.loaded && now - (S.hiddenLoadedAt || 0) < 30000) return;
    S.hiddenAwaitLoad = false;
    if (S.hiddenStale && !msg.loaded && !msg.flip) return;
    S.hiddenStale = false;
  }
  if (msg.loaded) checkMismatch(msg, now);
  const sure = mine || msg.loaded || msg.flip;
  let startAt, measured = false;
  // Mốc 0 đo lúc số giây nhảy chỉ có thể muộn hơn thực tế, nên chỉ dời mốc sớm hơn, mỗi lần tối đa 1,5 giây.
  // Riêng khi mốc đang là ước tính (vừa bật, vừa tải trang: Emplanner nhảy số đầu tiên khoảng 1,2 giây sau khi bấm Start,
  // nên ước tính có thể sớm hơn thực tế), lần đo đầu tiên từ tab đang hiện được chỉnh cả hai chiều (đo trên Chrome thật 2026-10-29).
  const refine = msg.state === "running" && !changed && typeof msg.timerEpoch === "number" && (mine || !msg.hidden);
  const fromEstimate = typeof t.startAt === "number" && t.startSrc !== "measured" && !msg.hidden && Math.abs(msg.timerEpoch - t.startAt) < 1500;
  if (refine && (typeof t.startAt !== "number" || fromEstimate || (msg.timerEpoch < t.startAt && t.startAt - msg.timerEpoch < 1500))) {
    startAt = msg.timerEpoch;
    measured = true;
  } else if (refine && mine) {
    startAt = undefined;  // tab ẩn đo muộn hơn mốc đang có: giữ mốc cũ
  } else if (!sure) {
    return;  // tab Work khác không vừa tải và không thấy đổi trạng thái: số có thể đã cũ
  } else if (msg.state === "running" && (changed || msg.loaded || typeof t.startAt !== "number") && typeof msg.timerSec === "number") {
    const est = now - msg.timerSec * 1000;
    // Trang vừa tải mà vẫn đang chạy: lệch dưới 1,5 giây là sai số làm tròn, giữ mốc sớm hơn; lệch nhiều là đồng hồ đã bị bấm ở nơi khác
    const keep = !changed && typeof t.startAt === "number" && est >= t.startAt && est - t.startAt <= 1500;
    if (!keep) startAt = est;
  }
  onTracker(msg.state, mine ? tabId : null, msg.state === "running" ? undefined : msg.timerSec, startAt);
  if (measured) t.startSrc = "measured";
  // Trang Work vừa tải và đang hiện: giờ vừa lấy từ máy chủ, là số trainee đang nhìn. Cho lần đo đầu trên trang đó chỉnh
  // mốc cả hai chiều, vì các tab Emplanner tự tính giờ riêng nên lệch nhau dưới 1 giây (đo 2026-10-29: lệch 0,57 giây)
  else if (startAt !== undefined || (msg.loaded && msg.state === "running" && !msg.hidden)) t.startSrc = "est";
  if (changed && !mine) S.hiddenStale = true;
}

// Gửi tin cho tab, quá ms thì coi như không phản hồi (tab bị trình duyệt cho ngủ hẳn thì tin chờ mãi).
// Đếm giờ bằng setInterval để test (setInterval giả không chạy) không bị hết giờ ngay.
function sendTabWithin(tabId, msg, ms) {
  return new Promise(resolve => {
    const end = Date.now() + ms;
    const iv = setInterval(() => { if (Date.now() > end) { clearInterval(iv); resolve(null); } }, 500);
    sendTab(tabId, msg).then(r => { clearInterval(iv); resolve(r); });
  });
}

// Bấm nút giờ trên trang Work ẩn. Trang ẩn bị cũ (đồng hồ vừa bấm ở tab Work khác), hoặc trang hiện trạng thái khác
// extension (bấm ở trình duyệt khác): tải lại trang ẩn rồi mới bấm, để không bấm ngược.
// Không phản hồi trong 15 giây thì báo lỗi.
async function clickHidden(action) {
  if (S.hiddenStale) await reloadHidden();
  let tabId = await findTrackerTab();
  let res = await sendTabWithin(tabId, { type: "clickTracker", action, expect: S.tracker.state }, 15000);
  // Bấm mà đồng hồ không đổi, hoặc không phản hồi: trang ẩn đã mở quá lâu nên cũ (gặp 2026-11-02: trang tải từ 31/10,
  // bấm Start không ăn, trang Work mới tải thì bấm được ngay). Tải lại rồi bấm thêm 1 lần.
  if (!res || res.mismatch || !res.ok) {
    await reloadHidden();
    tabId = await findTrackerTab();
    res = await sendTabWithin(tabId, { type: "clickTracker", action }, 15000);
  }
  if (res && !res.ok && /tracker button|nút đồng hồ/i.test(res.error || ""))
    res.error += settings.language === "en" ? " (are you still logged in to Emplanner?)" : " (bạn còn đăng nhập Emplanner không?)";
  return { tabId, res: res || { ok: false, error: settings.language === "en" ? "hidden Emplanner Work page did not respond" : "trang Emplanner Work ẩn không phản hồi" } };
}

// Trainee bấm từ một tab Work đang mở: bấm luôn trên tab đó (phản hồi ngay). Tab đó chỉ bấm khi trạng thái trên trang
// khớp với extension (expect), để không bấm ngược trên trang cũ. Bấm xong thì trang ẩn bị cũ (onWorkReport đánh dấu).
async function clickOnTab(fromTabId, action) {
  const t = fromTabId != null && fromTabId !== HIDDEN_ID ? S.tabs[fromTabId] : null;
  if (!t || !isWorkPage(t.url)) return null;
  const res = await sendTabWithin(fromTabId, { type: "clickTracker", action, expect: S.tracker.state }, 15000);
  if (!res || !res.ok) return null;  // trang cũ hoặc không phản hồi: thử trang ẩn
  S.hiddenStale = true;
  save();
  return { tabId: fromTabId, res };
}

// Trang để bấm đồng hồ: trang Work ẩn. Đang tải thì chờ tới khi nó báo lần đầu (tối đa 15 giây tính từ lúc tải).
async function findTrackerTab() {
  const t = await ensureHiddenTab();
  if (!t) throw new Error(settings.language === "en" ? "could not open the hidden Emplanner Work page" : "chưa mở được trang Emplanner Work ẩn");
  const end = Math.min(Date.now() + 15000, (S.hiddenLoadedAt || Date.now()) + 15000);
  for (let i = 0; i < 50 && Date.now() < end && S.hiddenAwaitLoad && Date.now() - (S.hiddenLoadedAt || 0) < 30000; i++) await new Promise(r => setTimeout(r, 300));
  return HIDDEN_ID;
}

// Mở (hoặc chuyển tới) một tab Work cho trainee xem
async function openWorkTab() {
  const id = Object.keys(S.tabs).find(k => isWorkPage(S.tabs[k].url));
  const tab = id ? await chrome.tabs.update(Number(id), { active: true }) : await chrome.tabs.create({ url: settings.workUrl, active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

let clickBusy = false;  // tránh autoStop và trackerToggle bấm đè lên nhau trên trang Work ẩn
async function autoStop(reason) {
  if (S.idle.stopping || clickBusy) return;
  reason = reason || "idle";
  S.idle.stopping = true;
  clickBusy = true;
  save();
  broadcast({ type: "idleStopping" });
  let tabId = null, res = null;
  try {
    ({ tabId, res } = await clickHidden(settings.stopAction));
  } catch (e) {
    res = { ok: false, error: String(e) };
  } finally {
    clickBusy = false;
  }
  const lang = settings.language;
  const isEn = lang === "en";
  const actionWord = isEn ? (settings.stopAction === "finish" ? "finish" : "pause") : stopWord();
  const actionPast = isEn ? (settings.stopAction === "finish" ? "finished" : "paused") : stopWord();
  const elapsedMin = reason === "noorder"
    ? tgMin((Date.now() - S.lastOrderActivityAt) / 1000)
    : tgMin((Date.now() - S.lastActivityAt) / 1000);
  const whyVi = reason === "noorder" ? `${elapsedMin} phút không mở order/survey` : `${elapsedMin} phút không thao tác`;
  const whyEn = reason === "noorder" ? `${elapsedMin} min without order/survey` : `${elapsedMin} min inactive`;
  const why = isEn ? whyEn : whyVi;
  const key = res.ok ? "bg_autostop_msg" : "bg_autostop_fail_msg";
  const params = { word: actionWord, past: actionPast, why };
  const text = tgI18n(key, lang, params);
  const textVi = tgI18n(key, "vi", { word: stopWord(), past: stopWord(), why: whyVi });
  if (res.ok) {
    S.idle.stopping = false;
    const stopSec = settings.stopAction === "finish" ? 0 : (typeof res.timerSec === "number" ? res.timerSec : undefined);
    onTracker("stopped", tabId, stopSec);
    notify("idle", tgI18n("bg_autostop_title", lang, { word: stopWord(), past: actionPast }), text);
    setBanner("autostop", "warn", text, true, key, params);
    journal("auto_stop", textVi, { action: settings.stopAction, reason, minutes: elapsedMin });
  } else {
    // Tránh lặp lại cảnh báo ngay ở nhịp tick 5 giây kế tiếp khi tự dừng thất bại
    if (reason === "noorder") S.lastOrderActivityAt = Date.now();
    else S.lastActivityAt = Date.now();
    notify("idle", tgI18n("bg_autostop_fail_title", lang), text);
    setBanner("autostop", "danger", text, true, key, params);
    journal("auto_stop_failed", textVi, { error: res.error, reason, minutes: elapsedMin });
  }
  S.idle = { warnedAt: null, deadline: null, stopping: false };
  S.noOrder = { warnedAt: null, deadline: null };
  clearBanner("noorder");
  chrome.notifications.clear("noorder");
  broadcast({ type: "idleClear" });
  save();
}

// Trainee bấm Bật / Tạm dừng trên bảng nổi hoặc popup: extension bấm nút giờ trên tab Work ẩn
let toggling = false;
async function trackerToggle(action, fromTabId) {
  if (toggling || clickBusy || S.idle.stopping) return { ok: false, error: settings.language === "en" ? "clock toggle in progress, please wait" : "đang bấm, hãy chờ" };
  toggling = true;
  clickBusy = true;
  let tabId = null, res = null;
  const act = action === "start" ? "start" : "pause";
  try {
    ({ tabId, res } = (await clickOnTab(fromTabId, act)) || await clickHidden(act));
  } catch (e) {
    res = { ok: false, error: String(e && e.message || e) };
  } finally {
    toggling = false;
    clickBusy = false;
  }
  await ensure();
  if (res.ok) {
    // Bật: đếm tiếp từ giờ đang dừng. Tạm dừng: đứng ở giờ extension đang đếm, tab ẩn báo lại giờ của Emplanner sau.
    onTracker(res.state, tabId, res.state === "running" ? res.timerSec : undefined);
    journal("tracker_remote", action === "start" ? "Bật đồng hồ từ Time Guard" : "Tạm dừng đồng hồ từ Time Guard");
  }
  return res;
}

/* ---------- Sang ngày mới ---------- */
async function rollover(now) {
  const prev = S.day;
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const cutoff = midnight.getTime();
  // Nếu vẫn đang mở nhiều order qua nửa đêm: chốt phần của ngày cũ trước khi lưu days[prev], không để tràn sang ngày mới
  if (S.multiPeriod) {
    const mp = S.multiPeriod;
    for (const [id, sec] of Object.entries(mp.perOrder || {})) {
      if (!(sec > 0)) continue;
      const o = orderRec(id);
      o.sec += sec;
      o.multiSec += sec;
      if (S.session && S.session.orders) S.session.orders[id] = (S.session.orders[id] || 0) + sec;
    }
    const byOrder = {};
    for (const s of mp.segments || []) {
      const to = Math.min(s.to, cutoff);
      if (!(to > s.from)) continue;
      const sec = s.sec != null ? s.sec * (to - s.from) / (s.to - s.from || 1) : (to - s.from) / 1000;
      if (sec > 0) (byOrder[s.id] || (byOrder[s.id] = [])).push({ from: s.from, to, sec });
    }
    for (const [id, list] of Object.entries(byOrder)) mergeOrderSegs(orderRec(id), list);
    S.multiPeriod = S.multi && S.multi.active ? { startedAt: now, sec: 0, perOrder: {}, segments: [] } : null;
  }
  const orders = S.orders;
  if (S.trackedSec > 0 || Object.keys(orders).length || (S.timeline || []).length) {
    const parts = Object.entries(orders).map(([id, o]) => `#${id}: ${tgMin(o.sec)} phút`);
    if (tgMin(S.surveySec) > 0) parts.push(`survey: ${tgMin(S.surveySec)} phút`);
    await journal("day_summary", `Đồng hồ chạy ${tgMin(S.trackedSec)} phút. ${parts.join("; ")}`, { orders, trackedSec: S.trackedSec }, prev);
    const r = await chrome.storage.local.get("days");
    const days = r.days || {};
    days[prev] = { orders, trackedSec: S.trackedSec, surveySec: S.surveySec || 0, timeline: S.timeline || [] };
    const keys = Object.keys(days).sort();
    while (keys.length > 31) delete days[keys.shift()];
    await chrome.storage.local.set({ days });
    daysCache = null;
  }
  S.day = tgDayKey(now);
  S.orders = {};
  S.timeline = [];
  // Lần log theo order giữ qua ngày, chỉ bỏ những lần quá 60 ngày
  for (const [id, logs] of Object.entries(S.orderLogs || {})) {
    const keep = logs.filter(l => l.at > now - ORDER_LOG_KEEP_MS);
    if (keep.length) S.orderLogs[id] = keep; else delete S.orderLogs[id];
  }
  S.trackedSec = 0;
  S.surveySec = 0;
  // Nếu đồng hồ đang chạy và trainee vừa mới thao tác trước nửa đêm (< idleSeconds), giữ lại mốc thao tác và order
  // để không bắn nhầm cảnh báo không thao tác ngay giây đầu tiên của ngày mới; ngược lại thì dọn sạch.
  const activeAcrossMidnight = S.tracker.state === "running" && S.lastActivityAt > 0 && (now - S.lastActivityAt) < settings.idleSeconds * 1000;
  if (!activeAcrossMidnight) {
    S.lastActivityOrder = null;
    S.lastActiveOrder = null;
    S.lastActivityAt = S.tracker.state === "running" ? now : 0;
    S.lastOrderActivityAt = S.tracker.state === "running" ? now : 0;
    S.lastActivityTabId = null;
  }
  S.lastSegOrder = null;
  S.untracked = { sec: 0, lastWarnAt: 0 };
  S.noOrder = { warnedAt: null, deadline: null };
  S.idle = { warnedAt: null, deadline: null, stopping: false };
  clearBanner("untracked");
  clearBanner("noorder");
  clearBanner("mismatch");
  clearBanner("autostop");
  try {
    chrome.notifications.clear("untracked");
    chrome.notifications.clear("noorder");
    chrome.notifications.clear("mismatch");
    chrome.notifications.clear("autostop");
  } catch (_) {}
  // Mốc đầu ngày (người dùng đã chốt): phiên đồng hồ Emplanner hôm trước chưa Finish thì hôm nay không tính phần giờ của
  // ngày cũ. Đang chạy qua nửa đêm: mốc = giờ đồng hồ lúc 00:00; đang dừng: mốc = giờ đang dừng. Các cửa sổ hiện giờ trừ mốc này
  // (todayClock); bên trong vẫn giữ đúng giờ Emplanner để so khi mở trang Work.
  const t = S.tracker;
  let base = 0;
  if (t.state === "running" && typeof t.startAt === "number") base = Math.max(0, Math.floor((midnight.getTime() - t.startAt) / 1000));
  else if (t.state === "stopped" && typeof t.timerSec === "number") base = t.timerSec;
  S.dayBase = base;
  // Trang Work ẩn mở từ hôm trước có thể đã cũ: lần bấm đầu của ngày mới sẽ tải lại nó trước
  S.hiddenStale = true;
  if (base > 0) journal("day_carry", `Sang ngày mới khi phiên đồng hồ chưa Finish: không tính ${tgMin(base)} phút của ngày cũ`, { baseSec: base });
  clearTimeout(saveTimer); saveTimer = null;
  lastStateSave = Date.now();
  await chrome.storage.local.set({ state: S }).catch(() => {});
}

// Giờ hiển thị cho trainee: giờ Emplanner trừ mốc đầu ngày (phần của ngày cũ khi phiên chưa Finish)
function todayClock() {
  const c = emplannerClock();
  const b = S.dayBase || 0;
  if (!c || !b) return c;
  return { sec: Math.max(0, c.sec - b), startAt: c.startAt != null ? c.startAt + b * 1000 : null, base: b };
}

/* ---------- Nhịp chính ---------- */
async function tick() {
  await ensure();
  const now = Date.now();
  let dt = (now - (S.lastTick || now)) / 1000;
  S.lastTick = now;
  if (!(dt > 0)) dt = 0;
  if (dt > MAX_DT) dt = MAX_DT;
  await checkDay();
  hiddenWatch(now).catch(console.error);

  const fresh = trackerKnown();
  const running = S.tracker.state === "running";
  const stopped = S.tracker.state === "stopped";
  const oid = currentOrder();
  const sinceAct = now - S.lastActivityAt;

  // 1) Cộng thời gian
  if (running) {
    S.trackedSec += dt;
    if (!S.session) S.session = { startedAt: now, sec: 0, orders: {} };
    S.session.sec += dt;
  }
  if (S.survey) {
    const sv = S.survey;
    if (now >= sv.untilAt) surveyEnd("timeout");
    else {
      if (running) { sv.sec += dt; S.surveySec = (S.surveySec || 0) + dt; S.session.surveySec = (S.session.surveySec || 0) + dt; }
      // Đang survey mà thao tác trên trang FP/order: cảnh báo, thời gian vẫn tính là survey
      if (oid && sinceAct <= UNTRACKED_ACTIVE_MS) {
        sv.fpSec += dt;
        if (now - sv.fpWarnAt > 180000) {
          sv.fpWarnAt = now;
          const params = { id: oid };
          const text = tgI18n("bg_surveyfp_msg", settings.language, params);
          setBanner("surveyfp", "warn", text, true, "bg_surveyfp_msg", params);
          notify("surveyfp", tgI18n("bg_surveyfp_title", settings.language), text);
          journal("survey_fp", `Thao tác trên order #${oid} trong lúc survey, tính là survey`, { orderId: oid });
        }
      } else if (S.banners.surveyfp) {
        // Không còn thao tác trên order: tắt cảnh báo
        clearBanner("surveyfp");
        chrome.notifications.clear("surveyfp");
      }
      // Cảnh báo đồng hồ vẫn hoạt động: survey phải bật đồng hồ
      if (stopped && now - sv.offWarnAt > 120000 && now - sv.startedAt > 60000) {
        sv.offWarnAt = now;
        const text = tgI18n("bg_surveyoff_msg", settings.language);
        setBanner("surveyoff", "danger", text, true, "bg_surveyoff_msg");
        notify("surveyoff", tgI18n("bg_clock_off_title", settings.language), text);
        journal("survey_untracked", "Đang survey nhưng đồng hồ chưa bật");
      } else if (running) clearBanner("surveyoff");
    }
  }
  if (running && !S.survey && oid) {
    orderRec(oid);
    if (S.multi.active && S.multiPeriod) {
      // Chưa biết order nào được giữ lại: để riêng, ghi lại lúc nào làm order nào
      const mp = S.multiPeriod;
      mp.sec += dt;
      mp.perOrder[oid] = (mp.perOrder[oid] || 0) + dt;
      const last = mp.segments[mp.segments.length - 1];
      if (last && last.id === oid && now - last.to < 120000) { last.to = now; last.sec = (last.sec || 0) + dt; }
      else if (mp.segments.length < 60) mp.segments.push({ id: oid, from: now - dt * 1000, to: now, sec: dt });
    } else {
      orderRec(oid).sec += dt;
      S.session.orders[oid] = (S.session.orders[oid] || 0) + dt;
      addSeg(oid, now, dt);
    }
  }
  addTimeline(timelineKind(running, stopped, oid), now, dt);
  // Còn mở nhiều order: nhắc lại mỗi 2 phút
  if (S.multi.active && now - (S.multi.lastWarnAt || 0) >= 120000) warnMulti(S.multi.ids);

  // 2) Làm order khi đồng hồ chưa bật
  const hadUntracked = S.untracked.sec > 0;
  if (stopped && !S.survey && oid && sinceAct <= UNTRACKED_ACTIVE_MS) {
    S.untracked.sec += dt;
    orderRec(oid).untrackedSec += dt;
    if (S.untracked.sec >= settings.untrackedSeconds && now - S.untracked.lastWarnAt >= 60000) {
      S.untracked.lastWarnAt = now;
      const params = { id: oid };
      const text = tgI18n("bg_untracked_msg", settings.language, params);
      setBanner("untracked", "danger", text, true, "bg_untracked_msg", params);
      notify("untracked", tgI18n("bg_clock_off_title", settings.language), text);
      const durText = S.untracked.sec < 60 ? `${Math.round(S.untracked.sec)} giây` : `${tgMin(S.untracked.sec)} phút`;
      journal("untracked_work", `Làm order #${oid} khoảng ${durText} khi đồng hồ chưa bật`, { orderId: oid });
    }
  } else {
    S.untracked.sec = 0;
    // Hết lý do cảnh báo (đã bật đồng hồ, đóng tab order, ngừng thao tác trên order, hoặc đang survey): tắt cảnh báo
    if (S.banners.untracked) {
      clearBanner("untracked");
      chrome.notifications.clear("untracked");
    }
  }

  // 3) Không đọc được đồng hồ
  const hasOrderTab = Object.values(S.tabs).some(t => t.orderId);
  if (hasOrderTab && !fresh && now - BOOT > 20000) {
    const text = tgI18n("bg_keepwork_msg", settings.language);
    setBanner("keepwork", "info", text, false, "bg_keepwork_msg");
  } else if (fresh || !hasOrderTab) {
    clearBanner("keepwork");
  }
  // Tự dừng thất bại: đồng hồ đã dừng (trainee tự bấm) thì tắt cảnh báo
  const as = S.banners.autostop;
  if (as && as.level === "danger" && stopped) clearBanner("autostop");

  // 4) Đồng hồ chạy mà không làm order nào và không bật survey
  // (không thao tác gì cả thì để bước 5 cảnh báo)
  if (running && !S.survey && !S.idle.stopping) {
    if (!S.noOrder.warnedAt) {
      if (now - (S.lastOrderActivityAt || 0) >= settings.noOrderSeconds * 1000 &&
          !S.idle.warnedAt && sinceAct < settings.idleSeconds * 1000) startNoOrder(now);
    } else if (now >= S.noOrder.deadline) {
      autoStop("noorder");
    }
  } else if ((!running || S.survey) && S.noOrder.warnedAt && !S.idle.stopping) {
    clearNoOrder(false);
  }

  // 5) Không thao tác (không chồng lên cảnh báo ở bước 4)
  if (running && !S.survey && !S.idle.stopping && !S.noOrder.warnedAt) {
    if (!S.idle.warnedAt) {
      if (sinceAct >= settings.idleSeconds * 1000) startIdle(now);
    } else if (now >= S.idle.deadline) {
      autoStop("idle");
    }
  } else if ((!running || S.survey) && S.idle.warnedAt && !S.idle.stopping) {
    clearIdle(false);
  }
  const paused = stopped && S.tracker.sub === "paused";
  if (running || paused || S.survey || hadUntracked || S.untracked.sec > 0 || S.idle.warnedAt || S.noOrder.warnedAt || now - lastStateSave >= 60000) save();
}

/* ---------- Dữ liệu cho giao diện ---------- */
function orderRows() {
  return Object.entries(S.orders)
    .map(([id, r]) => ({ id, min: tgMin(r.sec), multiMin: tgMin(r.multiSec), untrackedMin: tgMin(r.untrackedSec) }))
    .sort((a, b) => b.min - a.min);
}

// Bấm Just log time hoặc Finish drawing & log time (kind "finish") trên trang order: mọi khoảng giờ đã làm order đó
// (cả các ngày trước, lấy từ "days"), xen các lần log vào đúng chỗ, và số phút cần log = phần sau lần log gần nhất.
// loggedTimes: các lần log đọc từ trang (số = giờ, từ hộp log time; { at, min } = lịch sử log trên trang order);
// again: gọi lại sau khi đọc hộp, không ghi nhật ký.
// Dữ liệu các ngày trước ("days"), giữ trong bộ nhớ vì bảng nổi trang order hỏi 3 giây một lần; sang ngày mới thì đọc lại
let daysCache = null;
async function daysData() {
  if (!daysCache) daysCache = (await chrome.storage.local.get("days")).days || {};
  return daysCache;
}
function addLoggedTimes(oid, loggedTimes) {
  for (const t of loggedTimes || []) logOrder(oid, Number(t && typeof t === "object" ? t.at : t), t && typeof t === "object" ? t.min : null, "emplanner");
}

async function justLogInfo(tabId, kind, loggedTimes, again) {
  const fromTab = (S.tabs[tabId] && S.tabs[tabId].orderId) || null;
  const oid = fromTab || S.lastActiveOrder;
  addLoggedTimes(oid, loggedTimes);
  const o = oid ? S.orders[oid] : null;
  const info = Object.assign(await orderLogView(oid), {
    kind: kind === "finish" ? "finish" : "justlog",
    orderId: oid, guessed: !fromTab,
    min: o ? tgMin(o.sec) : 0, multiMin: o ? tgMin(o.multiSec) : 0, untrackedMin: o ? tgMin(o.untrackedSec) : 0,
    trackedMin: tgMin(S.trackedSec), orders: orderRows(), multiNow: S.multi.active,
    pendingMin: S.multiPeriod ? tgMin(S.multiPeriod.sec) : 0, openOrders: S.multi.ids,
    special: !!oid && (S.special || []).includes(oid),
    savedMin: S.sched && S.sched.day === S.day && !S.sched.error ? S.sched.savedMin : null,
    emplannerMin: emplannerMin()
  });
  if (again) return info;
  const btn = kind === "finish" ? "Finish drawing & log time" : "Just log time";
  journal("just_log_view", oid ? `${btn}, order #${oid}: extension tính ${info.min} phút hôm nay, cần log ${info.needMin} phút` + (info.cutAt ? " (từ lần log trước)" : "") : `Bấm ${btn} nhưng chưa xác định được order`,
    { orderId: oid, minutes: info.min, needMin: info.needMin });
  return info;
}

// Bảng log của một order, dùng chung cho thẻ log time và bảng nổi trang order: { rows, multiDay, pastDays, cutAt, needMin, unloggedMin }
// Tour làm nhiều ngày: mỗi ngày chỉ tổng hợp ngày đó (bảng chỉ hiện hôm nay, không cộng sang ngày sau).
// Các ngày trước: xong ngày nào hiện ở dưới đã log bao lâu (và báo nếu còn chưa log).
async function orderLogView(oid) {
  const o = oid ? S.orders[oid] : null;
  const days = await daysData();
  const all = [];
  for (const [d, v] of Object.entries(days)) if (d !== S.day && oid) all.push(...((((v || {}).orders || {})[oid] || {}).segs || []));
  all.push(...((o && o.segs) || []));
  all.sort((a, b) => a.from - b.from);
  const logs = ((S.orderLogs || {})[oid] || []).slice().sort((a, b) => a.at - b.at);

  // Khoảng vắt qua nửa đêm thì tách ra, mỗi ngày một phần
  const pieces = [];
  for (const s of all) {
    let a = s.from;
    while (a < s.to) {
      const m = new Date(a); m.setHours(24, 0, 0, 0);
      const b = Math.min(s.to, m.getTime());
      pieces.push({ s, a, b, day: tgDayKey(a) });
      a = b;
    }
  }

  const dayCut = {};
  for (const l of logs) { const d = tgDayKey(l.at); dayCut[d] = Math.max(dayCut[d] || 0, l.at); }

  // 1) Các ngày trước: xong ngày nào thì chỉ tổng hợp ngày đó ở dưới (đã log bao lâu, chưa log bao lâu)
  const pastDays = [];
  const pastDayKeys = [...new Set(pieces.map(p => p.day).concat(logs.map(l => tgDayKey(l.at))))].filter(d => d !== S.day).sort();
  let totalUnloggedMin = 0;
  for (const d of pastDayKeys) {
    const dayPieces = pieces.filter(p => p.day === d);
    const dayLogs = logs.filter(l => tgDayKey(l.at) === d);
    const loggedMin = dayLogs.reduce((sum, l) => sum + (l.min || 0), 0);
    const cut = dayCut[d] || 0;
    let unloggedSec = 0;
    for (const p of dayPieces) {
      if (p.b > cut) {
        const start = Math.max(p.a, cut);
        unloggedSec += p.s.to > p.s.from ? p.s.sec * (p.b - start) / (p.s.to - p.s.from) : p.s.sec;
      }
    }
    const unlogged = unloggedSec < 60 ? 0 : tgMin(unloggedSec);
    if (loggedMin > 0 || unlogged > 0) {
      pastDays.push({ day: d, loggedMin, unloggedMin: unlogged });
      totalUnloggedMin += unlogged;
    }
  }

  // 2) Hôm nay: bảng chỉ hiển thị các khoảng của ngày hôm nay, không cộng ngày cũ sang
  const todayPieces = pieces.filter(p => p.day === S.day);
  const todayLogs = logs.filter(l => tgDayKey(l.at) === S.day);
  let todayCut = 0;
  for (const l of todayLogs) todayCut = Math.max(todayCut, l.at);

  const rows = [];
  let li = 0;
  const part = (s, a, b) => {
    if (b > a) rows.push({
      t: "seg",
      from: a,
      to: b,
      sec: s.to > s.from ? s.sec * (b - a) / (s.to - s.from) : s.sec,
      now: b === s.to && S.lastSegOrder === oid && Date.now() - s.to < 15000
    });
  };

  for (const p of todayPieces) {
    while (li < todayLogs.length && todayLogs[li].at <= p.a) rows.push(Object.assign({ t: "log" }, todayLogs[li++]));
    let a = p.a;
    while (li < todayLogs.length && todayLogs[li].at < p.b) {
      part(p.s, a, todayLogs[li].at);
      a = todayLogs[li].at;
      rows.push(Object.assign({ t: "log" }, todayLogs[li++]));
    }
    part(p.s, a, p.b);
  }
  while (li < todayLogs.length) rows.push(Object.assign({ t: "log" }, todayLogs[li++]));

  let needSec = 0;
  for (const r of rows) if (r.t === "seg" && r.from >= todayCut) needSec += r.sec;

  return {
    rows,
    multiDay: false,
    pastDays,
    cutAt: todayCut || null,
    needMin: tgMin(needSec),
    unloggedMin: totalUnloggedMin
  };
}

// Đã biết trạng thái đồng hồ chưa. Không có hạn dùng (người dùng đã chốt): đồng hồ extension cứ chạy/đứng theo
// lần báo gần nhất, chỉ đổi khi trang Work vừa tải hoặc thấy đồng hồ đổi trạng thái.
function trackerKnown() { return S.tracker.state === "running" || S.tracker.state === "stopped"; }

// Giờ đồng hồ Emplanner hiện tại (cộng thêm thời gian từ lần đọc cuối nếu đang chạy)
// Đang chạy thì trả thêm startAt (mốc 0, ms) để giao diện tự đếm từng giây khớp với Emplanner
function emplannerClock() {
  const t = S.tracker, now = Date.now();
  if (t.state === "running" && typeof t.startAt === "number") return { sec: Math.max(0, Math.floor((now - t.startAt) / 1000)), startAt: t.startAt };
  if (t.state === "stopped" && typeof t.timerSec === "number") return { sec: t.timerSec, startAt: null };
  return null;
}
function emplannerSec() {
  const c = emplannerClock();
  return c ? c.sec : null;
}
function emplannerMin() {
  const s = emplannerSec();
  return s == null ? null : tgMin(s);
}

// Bảng thông tin nổi trên các trang Emplanner. Trang order (/ui/order/…) có thêm bảng log của order giống thẻ log time
// (cột Ngày, hàng Đã log, hàng Cần log); loggedTimes là lịch sử log đọc từ chính trang đó.
async function panelInfo(tabId, loggedTimes) {
  const fresh = trackerKnown();
  const fromTab = (S.tabs[tabId] && S.tabs[tabId].orderId) || null;
  const onOrderPage = !!fromTab && /\/ui\/order(\/|$)/.test(S.tabs[tabId].url || "");
  if (onOrderPage) addLoggedTimes(fromTab, loggedTimes);
  const oid = fromTab || currentOrder() || S.lastActiveOrder || null;
  const o = oid ? S.orders[oid] : null;
  const clock = todayClock();
  return {
    dayBase: S.dayBase || 0,
    tracker: fresh ? S.tracker.state : "unknown",
    sub: fresh ? (S.tracker.sub || null) : null,
    timerSec: clock ? clock.sec : null,
    startAt: clock ? clock.startAt : null,
    orderId: oid,
    orderMin: o ? tgMin(o.sec) : 0,
    multi: S.multi.active,
    pendingMin: S.multiPeriod ? tgMin(S.multiPeriod.sec) : 0,
    survey: S.survey ? { leftMin: Math.max(0, Math.ceil((S.survey.untilAt - Date.now()) / 60000)) } : null,
    hiddenStale: !!S.hiddenStale,
    log: onOrderPage ? await orderLogView(fromTab) : null
  };
}

function status() {
  const fresh = trackerKnown();
  return {
    day: S.day,
    tracker: fresh ? S.tracker.state : "unknown",
    sub: fresh ? (S.tracker.sub || null) : null,
    session: S.session ? { min: tgMin(S.session.sec), orders: sessionRows() } : null,
    survey: S.survey ? { min: tgMin((Date.now() - S.survey.startedAt) / 1000), leftMin: Math.max(0, Math.ceil((S.survey.untilAt - Date.now()) / 60000)) } : null,
    surveyMin: tgMin(S.surveySec),
    savedMin: S.sched && S.sched.day === S.day && !S.sched.error ? S.sched.savedMin : null,
    trackedMin: tgMin(S.trackedSec),
    emplannerMin: emplannerMin(),
    clock: todayClock(),
    current: currentOrder(),
    openOrders: [...new Set(Object.values(S.tabs).map(t => t.orderId).filter(Boolean))],
    multi: S.multi.active,
    orders: orderRows(),
    idle: S.idle.warnedAt ? { deadline: S.idle.deadline } : null,
    noOrder: S.noOrder.warnedAt ? { deadline: S.noOrder.deadline } : null,
    workUrl: settings.workUrl
  };
}

/* ---------- Trang tour khác ---------- */
async function registerExtra() {
  try { await chrome.scripting.unregisterContentScripts({ ids: ["tg-extra"] }); } catch (e) { /* chưa đăng ký */ }
  const sites = (settings.extraSites || []).filter(Boolean);
  if (!sites.length) return;
  if (!(await chrome.permissions.contains({ origins: sites }))) return;
  await chrome.scripting.registerContentScripts([{
    id: "tg-extra", matches: sites, js: ["common.js", "content.js"], allFrames: true, runAt: "document_idle", persistAcrossSessions: true
  }]);
}

/* ---------- Sự kiện ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ensure();
    // Trang Work ẩn trong offscreen.html: không thuộc tab nào, chỉ được báo đồng hồ
    const hiddenFrame = !sender.tab && sender.url && /^https:\/\/[^/]*emplanner\.team\//.test(sender.url);
    if (hiddenFrame && msg.type !== "tracker" && msg.type !== "hello") return { ok: false };
    const tabId = sender.tab ? sender.tab.id : hiddenFrame ? HIDDEN_ID : null;
    const url = sender.tab ? sender.tab.url : null;
    if (tabId != null && url && !S.tabs[tabId] && isMonitored(url)) { setTab(tabId, url); evalMulti(); }
    if (msg.orderId && tabId != null && S.tabs[tabId] && S.tabs[tabId].orderId !== msg.orderId) {
      S.tabs[tabId].orderId = msg.orderId;
      if (msg.floor) S.tabs[tabId].floor = msg.floor;
      S.tabs[tabId].reported = true;
      evalMulti();
    }
    switch (msg.type) {
      case "activity": onActivity(tabId); return { ok: true };
      case "tracker":
        // Chỉ nhận đồng hồ từ trang Work của chính trainee; trang hồ sơ người khác cũng có khối TIME-TRACKING
        if ((sender.frameId === 0 || hiddenFrame) && isWorkPage(sender.url || url)) onWorkReport(msg, tabId);
        return { ok: true };
      case "page": if (sender.frameId === 0) onPage(tabId, url, msg); return { ok: true };
      case "hello":
        return {
          isHiddenTab: tabId != null && tabId === S.hiddenTabId,
          banners: S.banners,
          idleDeadline: S.idle.warnedAt && !S.idle.stopping ? S.idle.deadline : null,
          noOrderDeadline: S.noOrder.warnedAt && !S.idle.stopping ? S.noOrder.deadline : null
        };
      case "imWorking": onActivity(tabId != null ? tabId : S.lastActivityTabId); return { ok: true };
      case "idleExpired":
        if (msg.kind === "noorder") { if (S.noOrder.warnedAt && Date.now() >= S.noOrder.deadline - 1000) autoStop("noorder"); }
        else if (S.idle.warnedAt && Date.now() >= S.idle.deadline - 1000) autoStop("idle");
        return { ok: true };
      case "justLogClicked": return justLogInfo(tabId, msg.kind, msg.loggedTimes, msg.again);
      case "logSubmitted":
        logOrder((S.tabs[tabId] && S.tabs[tabId].orderId) || S.lastActiveOrder, Date.now(), Number(msg.min) || null, "submit");
        return { ok: true };
      case "getStatus": return status();
      case "panel": return panelInfo(tabId, msg.loggedTimes);
      case "trackerToggle": return trackerToggle(msg.action, tabId);
      case "surveyStart": surveyStart(); return status();
      case "surveyEnd": surveyEnd("user"); return status();
      case "openJournal": await openJournal(); return { ok: true };
      default: return { ok: false };
    }
  })().then(sendResponse, err => { console.error(err); sendResponse({ ok: false, error: (settings.language === "en" ? "extension error: " : "lỗi trong extension: ") + (err && err.message || err) }); });
  return true;
});

chrome.tabs.onUpdated.addListener((id, info) => {
  if (!info.url) return;
  ensure().then(() => { setTab(id, info.url); evalMulti(); });
});

chrome.tabs.onRemoved.addListener(id => {
  ensure().then(() => {
    delete S.tabs[id];
    if (S.tracker.tabId === id) S.tracker.tabId = null;
    if (S.hiddenTabId === id) S.hiddenTabId = null;  // nhịp sau sẽ mở lại tab ẩn
    evalMulti();
  });
});

chrome.notifications.onButtonClicked.addListener((id, i) => {
  if (id === "idle" && i === 0) ensure().then(() => onActivity(null));
  if (id === "noorder" && i === 0) ensure().then(() => surveyStart());
});

chrome.notifications.onClicked.addListener(id => {
  ensure().then(async () => {
    try {
      if ((id === "multi" || id === "untracked") && S.lastActivityTabId != null) {
        const tab = await chrome.tabs.update(S.lastActivityTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } else await openWorkTab();
    } catch (e) { /* bỏ qua */ }
  });
});

chrome.storage.onChanged.addListener(c => {
  if (!c.settings) return;
  ensure().then(async () => {
    settings = tgMerge(c.settings.newValue);
    refreshBanners();
    await registerExtra().catch(console.error);
    await rebuildTabs();
  });
});

// Bấm biểu tượng extension hoặc nút Nhật ký trên bảng nổi: mở trang nhật ký (đã mở thì chuyển tới tab đó)
let journalTabId = null;
async function openJournal() {
  try {
    if (journalTabId != null) {
      const tab = await chrome.tabs.update(journalTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch (e) { journalTabId = null; }
  try {
    const jUrl = chrome.runtime.getURL ? chrome.runtime.getURL("journal.html") : "journal.html";
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(t => t.url && (t.url === jUrl || t.url.endsWith("/journal.html")));
    if (existing) {
      journalTabId = existing.id;
      const tab = await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch (e) { /* bỏ qua */ }
  const tab = await chrome.tabs.create({ url: "journal.html" });
  journalTabId = tab.id;
}
if (typeof chrome !== "undefined" && chrome.action && chrome.action.onClicked) chrome.action.onClicked.addListener(() => { openJournal().catch(console.error); });

chrome.alarms.onAlarm.addListener(a => { if (a.name === "tick") tick().catch(console.error); });
// Tải lại trang Work ẩn mỗi khi extension được tải lại / cập nhật / cài, và khi mở trình duyệt (người dùng yêu cầu
// 2026-11-02). Không làm khi service worker chỉ thức dậy (xảy ra liên tục), vì trang ẩn vẫn còn mở.
async function freshHidden() {
  await ensure();
  try { if (await hasOffscreen()) await chrome.offscreen.closeDocument(); } catch (e) { /* đã đóng */ }
  await ensureHiddenTab();
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  freshHidden().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => { freshHidden().catch(console.error); });

ensure().then(async () => {
  await registerExtra().catch(console.error);
  await rebuildTabs().catch(console.error);
  const a = await chrome.alarms.get("tick");
  if (!a) chrome.alarms.create("tick", { periodInMinutes: 0.5 });
});
setInterval(() => tick().catch(console.error), TICK_MS);
