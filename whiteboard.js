/* Whiteboard: draw from memory with a stylus, save as vector strokes + PNG, reopen later.
   Source of truth for the copy in the whiteboard-lab demo repo (localStorage store there).
   window.Whiteboard.open({ store, title, onInsert }) where
     store.list() -> Promise<[{name, updated}]>, store.load(name) -> Promise<{strokes}>,
     store.save(name, {strokes, png}) -> Promise<{saved}>. */
(function () {
  "use strict";
  var COLORS = [["#0f172a", "ink"], ["#4a90d9", "blue"], ["#c74b50", "red"], ["#2db87f", "green"]];
  var WIDTHS = [["thin", 2], ["medium", 4], ["thick", 8]];
  var PAD = 6, DUP_OFFSET = 24;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function open(opts) {
    var store = opts.store, strokes = [], history = [], current = null, tool = "pen", color = COLORS[0][0], width = 4, penSeen = false, dirty = false;
    var selected = [], sel = null;  /* sel: {mode: "marquee"|"move", id, x0, y0, x1, y1, dx, dy} while a select gesture is in progress */
    var draftKey = "wb-draft:" + (opts.draftKey || opts.title || location.pathname), draftTimer = null;
    var boardName = opts.name || "", overlay = el("div", "wb-overlay"), bar = el("div", "wb-bar"), canvas = el("canvas", "wb-canvas");
    var ctx = canvas.getContext("2d"), status = el("span", "wb-status"), ring = el("div", "wb-ring");  /* eraser footprint under the pointer */
    overlay.appendChild(bar); overlay.appendChild(canvas); overlay.appendChild(ring); document.body.appendChild(overlay);
    document.body.classList.add("wb-open");

    /* ---- toolbar ---- */
    function btn(label, title, onClick, cls) { var b = el("button", "wb-btn" + (cls ? " " + cls : ""), label); b.title = title || ""; b.onclick = onClick; bar.appendChild(b); return b; }
    var penBtn = btn("Pen", "Draw (P)", function () { setTool("pen"); }, "wb-active");
    var eraserBtn = btn("Eraser", "Erase (E)", function () { setTool("eraser"); });
    var selectBtn = btn("Select", "Drag a box around strokes, then drag them to move (S)", function () { setTool("select"); });
    var colorBtns = COLORS.map(function (c) { var b = btn("", c[1], function () { setColor(c[0]); }, "wb-swatch"); b.style.background = c[0]; if (c[0] === color) b.classList.add("wb-active"); return b; });
    var widthBtns = WIDTHS.map(function (w) { var b = btn(w[0], "Line width", function () { setWidth(w[1]); }); if (w[1] === width) b.classList.add("wb-active"); return b; });
    btn("Undo", "Undo (Ctrl+Z)", undo);
    var dupBtn = btn("Duplicate", "Copy the selected strokes (Ctrl+D)", duplicate);
    var delBtn = btn("Delete", "Delete the selected strokes (Del)", removeSelected);
    btn("Clear", "Clear the board", function () { if (strokes.length && !confirm("Clear the whole board?")) return; commit([]); setSelection([]); });
    var nameInput = el("input", "wb-name"); nameInput.placeholder = "board name"; nameInput.value = boardName; bar.appendChild(nameInput);
    btn("Save", "Save strokes + PNG (Ctrl+S)", save, "wb-primary");
    btn("Finish recall", "Keep this unaided attempt as its own board, then correct on a copy in red", finishRecall);
    var select = el("select", "wb-select"); bar.appendChild(select);
    select.onchange = function () { if (select.value) loadBoard(select.value); };
    if (opts.onInsert) btn("Insert", "Insert the saved PNG into the playbook", function () {
      if (!boardName || dirty) { status.textContent = "save first"; return; }
      opts.onInsert(boardName).then(function (m) { status.textContent = m; }).catch(function (e) { status.textContent = e.message; });
    });
    var touchBtn = btn("Touch: off", "Allow finger drawing (off = palm rejection while using a pen)", function () { penSeen = !penSeen; touchBtn.textContent = "Touch: " + (penSeen ? "off" : "on"); });
    bar.appendChild(status);
    btn("Close", "Close (Esc)", close, "wb-close");

    function setTool(t) {
      tool = t; if (t !== "select") setSelection([]);
      penBtn.classList.toggle("wb-active", t === "pen"); eraserBtn.classList.toggle("wb-active", t === "eraser"); selectBtn.classList.toggle("wb-active", t === "select");
      canvas.style.cursor = t === "select" ? "default" : t === "eraser" ? "none" : "crosshair";
      if (t !== "eraser") ring.style.display = "none";
    }
    function moveRing(e) {
      if (tool !== "eraser") return;
      var d = width * 4; ring.style.width = ring.style.height = d + "px"; ring.style.left = (e.clientX - d / 2) + "px"; ring.style.top = (e.clientY - d / 2) + "px"; ring.style.display = "block";
    }
    function setColor(c) { color = c; setTool("pen"); colorBtns.forEach(function (b, i) { b.classList.toggle("wb-active", COLORS[i][0] === c); }); }
    function setWidth(w) { width = w; widthBtns.forEach(function (b, i) { b.classList.toggle("wb-active", WIDTHS[i][1] === w); }); }
    function setSelection(list) { selected = list; dupBtn.disabled = delBtn.disabled = !list.length; redraw(); }

    /* ---- model: strokes are replaced, never mutated, so undo is a stack of previous arrays ---- */
    function commit(next) { history.push(strokes); if (history.length > 100) history.shift(); strokes = next; dirty = true; redraw(); scheduleDraft(); }
    /* iPad Safari suspends and reloads background tabs: the unsaved board lives in localStorage until Save clears it */
    function scheduleDraft() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(function () { try { localStorage.setItem(draftKey, JSON.stringify({ strokes: strokes, name: nameInput.value, ts: Date.now() })); } catch (e) { /* quota or private mode */ } }, 800);
    }
    function clearDraft() { clearTimeout(draftTimer); try { localStorage.removeItem(draftKey); } catch (e) { /* ignore */ } }
    function restoreDraft() {
      var d = null; try { d = JSON.parse(localStorage.getItem(draftKey) || "null"); } catch (e) { /* ignore */ }
      if (!d || !d.strokes || !d.strokes.length || strokes.length) return;
      strokes = d.strokes; dirty = true; if (d.name && !nameInput.value) nameInput.value = d.name; redraw();
      status.textContent = "unsaved draft from " + new Date(d.ts).toLocaleTimeString().slice(0, 5) + " restored";
    }
    function undo() { if (!history.length) return; strokes = history.pop(); dirty = true; setSelection([]); }
    function translate(s, dx, dy) { return { tool: s.tool, color: s.color, width: s.width, points: s.points.map(function (p) { return [p[0] + dx, p[1] + dy, p[2]]; }) }; }
    function box(list, dx, dy) {
      var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      list.forEach(function (s) { s.points.forEach(function (p) { b.x0 = Math.min(b.x0, p[0]); b.y0 = Math.min(b.y0, p[1]); b.x1 = Math.max(b.x1, p[0]); b.y1 = Math.max(b.y1, p[1]); }); });
      b.x0 += (dx || 0) - PAD; b.x1 += (dx || 0) + PAD; b.y0 += (dy || 0) - PAD; b.y1 += (dy || 0) + PAD; return b;
    }
    function inside(b, x, y) { return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; }
    function duplicate() {
      if (!selected.length) return;
      var copies = selected.map(function (s) { return translate(s, DUP_OFFSET, DUP_OFFSET); });
      commit(strokes.concat(copies)); setSelection(copies);
    }
    function removeSelected() {
      if (!selected.length) return;
      commit(strokes.filter(function (s) { return selected.indexOf(s) < 0; })); setSelection([]);
    }

    /* ---- canvas ---- */
    function resize() {
      var dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); redraw();
    }
    function drawStroke(s, dx, dy) {
      dx = dx || 0; dy = dy || 0;
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = s.color;
      var pts = s.points;
      for (var i = 1; i < pts.length; i++) {
        ctx.beginPath(); ctx.lineWidth = s.width * (0.4 + 1.2 * (pts[i][2] || 0.5));
        ctx.moveTo(pts[i - 1][0] + dx, pts[i - 1][1] + dy); ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy); ctx.stroke();
      }
      if (pts.length === 1) { ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(pts[0][0] + dx, pts[0][1] + dy, s.width / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    function dashedRect(b) { ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = "#4a90d9"; ctx.lineWidth = 1; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.restore(); }
    function redraw() {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
      var moving = sel && sel.mode === "move";
      strokes.forEach(function (s) { var m = moving && selected.indexOf(s) >= 0; drawStroke(s, m ? sel.dx : 0, m ? sel.dy : 0); });
      if (selected.length) dashedRect(box(selected, moving ? sel.dx : 0, moving ? sel.dy : 0));
      if (sel && sel.mode === "marquee") dashedRect({ x0: Math.min(sel.x0, sel.x1), y0: Math.min(sel.y0, sel.y1), x1: Math.max(sel.x0, sel.x1), y1: Math.max(sel.y0, sel.y1) });
    }
    function point(e) { var r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10, e.pointerType === "pen" ? e.pressure : 0.5]; }
    function accept(e) {
      if (e.pointerType === "pen") { penSeen = true; touchBtn.textContent = "Touch: off"; return true; }
      if (e.pointerType === "touch") return !penSeen;  /* palm rejection once a pen has been seen */
      return e.button === 0 || e.buttons === 1;
    }
    canvas.addEventListener("pointerdown", function (e) {
      if (!accept(e)) return;
      if (current && e.pointerType === "pen" && current.type === "touch") { current = null; redraw(); }  /* the pen evicts a palm stroke started before any pen was seen */
      if (current || sel) return;  /* one gesture at a time: a palm landing mid-stroke must not start or end anything */
      e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ }
      moveRing(e);
      var p = point(e);
      if (tool === "select") {
        if (selected.length && inside(box(selected), p[0], p[1])) sel = { mode: "move", id: e.pointerId, x0: p[0], y0: p[1], dx: 0, dy: 0 };
        else { selected = []; sel = { mode: "marquee", id: e.pointerId, x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; }
        redraw(); return;
      }
      current = { id: e.pointerId, type: e.pointerType, tool: tool, color: color, width: tool === "eraser" ? width * 4 : width, points: [p] };
    });
    canvas.addEventListener("pointermove", function (e) {
      moveRing(e);  /* also on hover (mouse, pencil hover), so the footprint is visible before touching down */
      if (sel && e.pointerId === sel.id) {
        var q = point(e);
        if (sel.mode === "move") { sel.dx = q[0] - sel.x0; sel.dy = q[1] - sel.y0; } else { sel.x1 = q[0]; sel.y1 = q[1]; }
        e.preventDefault(); redraw(); return;
      }
      if (!current || e.pointerId !== current.id) return;
      e.preventDefault();
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!evs.length) evs = [e];  /* no coalescing (older Safari) or an empty list: the event itself is the sample */
      evs.forEach(function (ev) { current.points.push(point(ev)); });
      var n = current.points.length, tail = { tool: current.tool, color: current.color, width: current.width, points: current.points.slice(Math.max(0, n - evs.length - 1)) };
      drawStroke(tail);
    });
    function endStroke(e) {
      if (sel && e.pointerId === sel.id) {
        if (sel.mode === "move") {
          var dx = sel.dx, dy = sel.dy, moved = [];
          sel = null;
          if (dx || dy) { commit(strokes.map(function (s) { if (selected.indexOf(s) < 0) return s; var t = translate(s, dx, dy); moved.push(t); return t; })); setSelection(moved); }
          else redraw();
        } else {
          var b = { x0: Math.min(sel.x0, sel.x1), y0: Math.min(sel.y0, sel.y1), x1: Math.max(sel.x0, sel.x1), y1: Math.max(sel.y0, sel.y1) };
          sel = null;
          setSelection(strokes.filter(function (s) { return s.points.some(function (p) { return inside(b, p[0], p[1]); }); }));
        }
        return;
      }
      if (!current || e.pointerId !== current.id) return;  /* the palm lifting must not end the pen's stroke */
      var done = { tool: current.tool, color: current.color, width: current.width, points: current.points }; current = null;
      commit(strokes.concat([done])); status.textContent = "";
    }
    canvas.addEventListener("pointerup", endStroke); canvas.addEventListener("pointercancel", endStroke); canvas.addEventListener("pointerleave", endStroke);
    canvas.addEventListener("pointerleave", function () { ring.style.display = "none"; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    /* ---- persistence ---- */
    function refreshList() {
      return store.list().then(function (boards) {
        select.innerHTML = ""; select.appendChild(el("option", null, boards.length ? "open board…" : "no saved boards")); select.firstChild.value = "";
        boards.forEach(function (b) { var o = el("option", null, b.name); o.value = b.name; if (b.name === boardName) o.selected = true; select.appendChild(o); });
      }).catch(function (e) { status.textContent = e.message; });
    }
    function loadBoard(name) {
      if (dirty && !confirm("Discard unsaved strokes?")) { select.value = boardName; return; }
      store.load(name).then(function (b) { strokes = b.strokes || []; history = []; boardName = name; nameInput.value = name; dirty = false; setSelection([]); status.textContent = "opened " + name; })
        .catch(function (e) { status.textContent = e.message; });
    }
    function boardSlug() {
      var name = (nameInput.value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
      if (!name) { name = "board-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"); nameInput.value = name; }
      return name;
    }
    function finishRecall() {
      /* the unaided attempt is the evidence; corrections go on a copy so the attempt is never rewritten */
      if (!strokes.length) { status.textContent = "draw first"; return; }
      var base = boardSlug().replace(/-(attempt|review)$/, "");
      nameInput.value = base + "-attempt";
      save(function () {
        nameInput.value = base + "-review"; boardName = ""; dirty = true; setColor(COLORS[2][0]); setTool("pen");
        status.textContent = "attempt kept as " + base + "-attempt. Open the Novak map, correct in red, then Save.";
      });
    }
    function save(then) {
      var name = boardSlug();
      var keep = selected; selected = []; sel = null; redraw();  /* the PNG must not carry the selection box */
      var off = document.createElement("canvas"); off.width = canvas.width; off.height = canvas.height;
      var octx = off.getContext("2d"); octx.fillStyle = "#fff"; octx.fillRect(0, 0, off.width, off.height); octx.drawImage(canvas, 0, 0);
      setSelection(keep);
      status.textContent = "saving…";
      store.save(name, { strokes: strokes, width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height, png: off.toDataURL("image/png") })
        .then(function (r) { boardName = name; dirty = false; clearDraft(); status.textContent = r.saved || "saved"; return refreshList(); })
        .then(function () { if (then) then(); })
        .catch(function (e) { status.textContent = e.message; });
    }
    function close() {
      if (dirty && !confirm("Close without saving?")) return;
      window.removeEventListener("resize", resize); document.removeEventListener("keydown", keys);
      overlay.remove(); document.body.classList.remove("wb-open");
    }
    function keys(e) {
      var typing = e.target !== document.body && e.target !== canvas;
      if (e.key === "Escape") { if (selected.length) setSelection([]); else close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); }
      else if (typing) return;
      else if (e.key === "Delete" || e.key === "Backspace") removeSelected();
      else if (e.key === "p") setTool("pen");
      else if (e.key === "e") setTool("eraser");
      else if (e.key === "s") setTool("select");
    }
    window.addEventListener("resize", resize); document.addEventListener("keydown", keys);
    setSelection([]); resize(); refreshList().then(function () { if (boardName) loadBoard(boardName); else restoreDraft(); });
    return { close: close };
  }

  window.Whiteboard = { open: open };
})();
