const $ = id => document.getElementById(id);
const LABELS = ["start", "pause", "finish", "finishConfirm", "justLog"];
const SELECTORS = ["widget", "start", "pause", "finish"];  // bộ chọn Schedule giữ mặc định
const NUMS = ["idleSeconds", "graceSeconds", "untrackedSeconds", "activeWindowSeconds", "surveyMaxMinutes", "noOrderSeconds", "noOrderGraceSeconds"];
const lines = v => v.split("\n").map(s => s.trim()).filter(Boolean);
const csv = v => v.split(",").map(s => s.trim()).filter(Boolean);

function fill(s) {
  $("language").value = s.language || "vi";
  $("workUrl").value = s.workUrl;
  $("scheduleUrl").value = s.scheduleUrl;
  $("orderUrlPatterns").value = s.orderUrlPatterns.join("\n");
  $("extraSites").value = (s.extraSites || []).join("\n");
  for (const k of NUMS) $(k).value = s[k];
  $("stopAction").value = s.stopAction;
  for (const k of LABELS) $("l_" + k).value = (s.labels[k] || []).join(", ");
  for (const k of SELECTORS) $("s_" + k).value = s.selectors[k] || "";
  tgApplyI18n(document, s.language || "vi");
  testUrl();
}

function read() {
  const s = {
    language: $("language").value || "vi",
    workUrl: $("workUrl").value.trim() || TG_DEFAULTS.workUrl,
    scheduleUrl: $("scheduleUrl").value.trim() || TG_DEFAULTS.scheduleUrl,
    orderUrlPatterns: lines($("orderUrlPatterns").value),
    extraSites: lines($("extraSites").value),
    stopAction: $("stopAction").value,
    labels: {}, selectors: {}
  };
  for (const k of NUMS) s[k] = Math.max(Number($(k).min) || 0, Number($(k).value) || TG_DEFAULTS[k]);
  for (const k of LABELS) s.labels[k] = csv($("l_" + k).value);
  for (const k of SELECTORS) s.selectors[k] = $("s_" + k).value.trim();
  return s;
}

function show(text, ok) {
  $("msg").textContent = text;
  $("msg").className = ok ? "saved" : "";
}

function testUrl() {
  const url = $("testUrl").value.trim();
  const lang = $("language") ? $("language").value : "vi";
  if (!url) { $("testOut").textContent = ""; return; }
  const bad = lines($("orderUrlPatterns").value).filter(p => { try { new RegExp(p); return false; } catch (e) { return true; } });
  if (bad.length) { $("testOut").textContent = tgI18n("opt_pattern_err", lang) + bad.join(" | "); return; }
  const id = tgOrderId(url, { orderUrlPatterns: lines($("orderUrlPatterns").value) });
  $("testOut").textContent = id ? `${tgI18n("opt_order_id", lang)}${id}` : tgI18n("opt_no_order_id", lang);
}

$("language").addEventListener("change", () => {
  const lang = $("language").value || "vi";
  tgApplyI18n(document, lang);
  testUrl();
});

$("testUrl").addEventListener("input", testUrl);
$("orderUrlPatterns").addEventListener("input", testUrl);

$("save").onclick = async () => {
  const s = read();
  const lang = s.language;
  const invalid = s.extraSites.filter(p => !tgPatternToRegex(p));
  if (invalid.length) { show(tgI18n("opt_extra_sites_err", lang) + invalid.join(", ")); return; }
  if (s.extraSites.length) {
    const granted = await chrome.permissions.request({ origins: s.extraSites });
    if (!granted) { show(tgI18n("opt_perm_err", lang)); return; }
  }
  await chrome.storage.local.set({ settings: s });
  show(tgI18n("opt_saved", lang), true);
};

$("reset").onclick = () => {
  const lang = ($("language") && $("language").value) || TG_DEFAULTS.language;
  fill(Object.assign({}, TG_DEFAULTS, { language: lang }));
  show(tgI18n("opt_reset_done", lang));
};

tgGetSettings().then(fill);
