// The embeddable device-nudge widget — a self-contained JS snippet served per
// org widget key. A customer adds:
//   <script src="https://app.example.com/api/widget/<key>/script" async></script>
// to their intranet; it fetches the org's active nudges and shows them as toast
// reminders, deduping already-shown nudges via localStorage. Public + CORS-open;
// nudge text is rendered with textContent (no HTML injection).

import type { NextRequest } from "next/server";

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const dataUrl = `${req.nextUrl.origin}/api/widget/${encodeURIComponent(key)}/nudges`;

  const js = `(function () {
  var DATA_URL = ${JSON.stringify(dataUrl)};
  var STORE = "jericho-nudges-shown";
  function shown() { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch (e) { return []; } }
  function markShown(id) { var s = shown(); if (s.indexOf(id) < 0) { s.push(id); try { localStorage.setItem(STORE, JSON.stringify(s.slice(-200))); } catch (e) {} } }
  function styles() {
    if (document.getElementById("jericho-nudge-style")) return;
    var st = document.createElement("style");
    st.id = "jericho-nudge-style";
    st.textContent = ".jn-wrap{position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;max-width:340px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.jn-card{background:#121a30;color:#e6ebf5;border:1px solid #233152;border-radius:12px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.35);animation:jn-in .25s ease}.jn-row{display:flex;gap:10px;align-items:flex-start}.jn-icon{font-size:18px;line-height:1.2}.jn-title{font-weight:600;font-size:14px;margin:0 0 2px}.jn-msg{font-size:13px;color:#93a0bd;margin:0}.jn-x{margin-left:auto;background:none;border:none;color:#93a0bd;cursor:pointer;font-size:16px;line-height:1}@keyframes jn-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}";
    document.head.appendChild(st);
  }
  function wrap() {
    var w = document.querySelector(".jn-wrap");
    if (!w) { w = document.createElement("div"); w.className = "jn-wrap"; document.body.appendChild(w); }
    return w;
  }
  function toast(n) {
    styles();
    var card = document.createElement("div"); card.className = "jn-card";
    var row = document.createElement("div"); row.className = "jn-row";
    var icon = document.createElement("div"); icon.className = "jn-icon"; icon.textContent = n.icon || "\\u2139\\ufe0f";
    var body = document.createElement("div");
    var t = document.createElement("p"); t.className = "jn-title"; t.textContent = n.title || "Reminder";
    var m = document.createElement("p"); m.className = "jn-msg"; m.textContent = n.message || "";
    body.appendChild(t); body.appendChild(m);
    var x = document.createElement("button"); x.className = "jn-x"; x.textContent = "\\u00d7";
    x.onclick = function () { card.remove(); };
    row.appendChild(icon); row.appendChild(body); row.appendChild(x);
    card.appendChild(row);
    wrap().appendChild(card);
    markShown(n.id);
  }
  function render(list) {
    var seen = shown();
    var fresh = list.filter(function (n) { return seen.indexOf(n.id) < 0; });
    fresh.forEach(function (n, i) {
      var delay = (typeof n.delayMs === "number" && n.delayMs >= 0) ? n.delayMs : (i + 1) * 1200;
      setTimeout(function () { toast(n); }, delay);
    });
  }
  function start() {
    fetch(DATA_URL).then(function (r) { return r.json(); }).then(function (d) { render((d && d.nudges) || []); }).catch(function () {});
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); } else { start(); }
})();`;

  return new Response(js, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}
