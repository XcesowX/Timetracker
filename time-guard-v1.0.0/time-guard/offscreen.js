/* Trang offscreen của extension: giữ trang Emplanner Work trong iframe, người dùng không thấy và không đóng được.
   content.js chạy trong iframe đó tự báo đồng hồ cho background. background gửi lệnh (bấm đồng hồ, tải lại) tới đây,
   trang này chuyển vào iframe bằng postMessage rồi trả kết quả về. */
const frame = document.getElementById("work");
const pending = new Map();
let seq = 0;

function load(url) {
  for (const respond of pending.values()) respond(null);
  pending.clear();
  frame.src = url;
}
load(new URLSearchParams(location.search).get("u"));

window.addEventListener("message", e => {
  const d = e.data;
  if (e.source !== frame.contentWindow || !d || d.tg !== "res") return;
  const respond = pending.get(d.id);
  if (respond) { pending.delete(d.id); respond(d.res); }
});

chrome.runtime.onMessage.addListener((m, _s, respond) => {
  if (!m || m.target !== "tg-offscreen") return;
  if (m.op === "load") { load(m.url); respond({ ok: true }); return; }
  if (m.op === "send") {
    let origin;
    try { origin = new URL(frame.src).origin; } catch (e) { respond(null); return; }
    const id = ++seq;
    pending.set(id, respond);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); respond(null); } }, 60000);
    frame.contentWindow.postMessage({ tg: "cmd", id, msg: m.msg }, origin);
    return true;
  }
});
