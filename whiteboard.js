/* Whiteboard: draw from memory with a stylus, save as vector strokes + PNG, reopen later.
   Source of truth for the copy in the whiteboard-lab demo repo (localStorage store there).
   window.Whiteboard.open({ store, title, onInsert }) where
     store.list() -> Promise<[{name, updated}]>, store.load(name) -> Promise<{strokes}>,
     store.save(name, {strokes, png}) -> Promise<{saved}>. */
(function () {
  "use strict";
  var COLORS = [["#0f172a", "ink"], ["#4a90d9", "blue"], ["#c74b50", "red"], ["#2db87f", "green"]];
  var WIDTHS = [["thin", 2], ["medium", 4], ["thick", 8]];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function open(opts) {
    var store = opts.store, strokes = [], current = null, tool = "pen", color = COLORS[0][0], width = 4, penSeen = false, dirty = false;
    var boardName = opts.name || "", overlay = el("div", "wb-overlay"), bar = el("div", "wb-bar"), canvas = el("canvas", "wb-canvas");
    var ctx = canvas.getContext("2d"), status = el("span", "wb-status");
    overlay.appendChild(bar); overlay.appendChild(canvas); document.body.appendChild(overlay);
    document.body.classList.add("wb-open");

    /* ---- toolbar ---- */
    function btn(label, title, onClick, cls) { var b = el("button", "wb-btn" + (cls ? " " + cls : ""), label); b.title = title || ""; b.onclick = onClick; bar.appendChild(b); return b; }
    var penBtn = btn("Pen", "Draw (P)", function () { setTool("pen"); }, "wb-active");
    var eraserBtn = btn("Eraser", "Erase (E)", function () { setTool("eraser"); });
    var colorBtns = COLORS.map(function (c) { var b = btn("", c[1], function () { setColor(c[0]); }, "wb-swatch"); b.style.background = c[0]; if (c[0] === color) b.classList.add("wb-active"); return b; });
    var widthBtns = WIDTHS.map(function (w) { var b = btn(w[0], "Line width", function () { setWidth(w[1]); }); if (w[1] === width) b.classList.add("wb-active"); return b; });
    btn("Undo", "Undo last stroke (Ctrl+Z)", undo);
    btn("Clear", "Clear the board", function () { if (strokes.length && !confirm("Clear the whole board?")) return; strokes = []; dirty = true; redraw(); });
    var nameInput = el("input", "wb-name"); nameInput.placeholder = "board name"; nameInput.value = boardName; bar.appendChild(nameInput);
    btn("Save", "Save strokes + PNG (Ctrl+S)", save, "wb-primary");
    var select = el("select", "wb-select"); bar.appendChild(select);
    select.onchange = function () { if (select.value) loadBoard(select.value); };
    if (opts.onInsert) btn("Insert", "Insert the saved PNG into the playbook", function () {
      if (!boardName || dirty) { status.textContent = "save first"; return; }
      opts.onInsert(boardName).then(function (m) { status.textContent = m; }).catch(function (e) { status.textContent = e.message; });
    });
    var touchBtn = btn("Touch: off", "Allow finger drawing (off = palm rejection while using a pen)", function () { penSeen = !penSeen; touchBtn.textContent = "Touch: " + (penSeen ? "off" : "on"); });
    bar.appendChild(status);
    btn("Close", "Close (Esc)", close, "wb-close");

    function setTool(t) { tool = t; penBtn.classList.toggle("wb-active", t === "pen"); eraserBtn.classList.toggle("wb-active", t === "eraser"); }
    function setColor(c) { color = c; setTool("pen"); colorBtns.forEach(function (b, i) { b.classList.toggle("wb-active", COLORS[i][0] === c); }); }
    function setWidth(w) { width = w; widthBtns.forEach(function (b, i) { b.classList.toggle("wb-active", WIDTHS[i][1] === w); }); }

    /* ---- canvas ---- */
    function resize() {
      var dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); redraw();
    }
    function drawStroke(s) {
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = s.color;
      var pts = s.points;
      for (var i = 1; i < pts.length; i++) {
        ctx.beginPath(); ctx.lineWidth = s.width * (0.4 + 1.2 * (pts[i][2] || 0.5));
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
      if (pts.length === 1) { ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(pts[0][0], pts[0][1], s.width / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    function redraw() {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
      strokes.forEach(drawStroke);
    }
    function point(e) { var r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10, e.pointerType === "pen" ? e.pressure : 0.5]; }
    function accept(e) {
      if (e.pointerType === "pen") { penSeen = true; touchBtn.textContent = "Touch: off"; return true; }
      if (e.pointerType === "touch") return !penSeen;  /* palm rejection once a pen has been seen */
      return e.button === 0 || e.buttons === 1;
    }
    canvas.addEventListener("pointerdown", function (e) {
      if (!accept(e)) return;
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      current = { tool: tool, color: color, width: tool === "eraser" ? width * 4 : width, points: [point(e)] };
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!current || !accept(e)) return;
      e.preventDefault();
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      evs.forEach(function (ev) { current.points.push(point(ev)); });
      var n = current.points.length, tail = { tool: current.tool, color: current.color, width: current.width, points: current.points.slice(Math.max(0, n - evs.length - 1)) };
      drawStroke(tail);
    });
    function endStroke(e) { if (!current) return; strokes.push(current); current = null; dirty = true; status.textContent = ""; }
    canvas.addEventListener("pointerup", endStroke); canvas.addEventListener("pointercancel", endStroke); canvas.addEventListener("pointerleave", endStroke);
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    function undo() { strokes.pop(); dirty = true; redraw(); }

    /* ---- persistence ---- */
    function refreshList() {
      return store.list().then(function (boards) {
        select.innerHTML = ""; select.appendChild(el("option", null, boards.length ? "open board…" : "no saved boards")); select.firstChild.value = "";
        boards.forEach(function (b) { var o = el("option", null, b.name); o.value = b.name; if (b.name === boardName) o.selected = true; select.appendChild(o); });
      }).catch(function (e) { status.textContent = e.message; });
    }
    function loadBoard(name) {
      if (dirty && !confirm("Discard unsaved strokes?")) { select.value = boardName; return; }
      store.load(name).then(function (b) { strokes = b.strokes || []; boardName = name; nameInput.value = name; dirty = false; redraw(); status.textContent = "opened " + name; })
        .catch(function (e) { status.textContent = e.message; });
    }
    function save() {
      var name = (nameInput.value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
      if (!name) { name = "board-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"); nameInput.value = name; }
      /* white background under the strokes for the PNG */
      var off = document.createElement("canvas"); off.width = canvas.width; off.height = canvas.height;
      var octx = off.getContext("2d"); octx.fillStyle = "#fff"; octx.fillRect(0, 0, off.width, off.height); octx.drawImage(canvas, 0, 0);
      status.textContent = "saving…";
      store.save(name, { strokes: strokes, width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height, png: off.toDataURL("image/png") })
        .then(function (r) { boardName = name; dirty = false; status.textContent = r.saved || "saved"; return refreshList(); })
        .catch(function (e) { status.textContent = e.message; });
    }
    function close() {
      if (dirty && !confirm("Close without saving?")) return;
      window.removeEventListener("resize", resize); document.removeEventListener("keydown", keys);
      overlay.remove(); document.body.classList.remove("wb-open");
    }
    function keys(e) {
      if (e.key === "Escape") close();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (e.key === "p" && e.target === document.body) setTool("pen");
      else if (e.key === "e" && e.target === document.body) setTool("eraser");
    }
    window.addEventListener("resize", resize); document.addEventListener("keydown", keys);
    resize(); refreshList().then(function () { if (boardName) loadBoard(boardName); });
    return { close: close };
  }

  window.Whiteboard = { open: open };
})();
