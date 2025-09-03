(() => {
  /* Inline Export Tool - v1.2
     - FIX: start in "idle" so attachInspect() actually attaches overlay/listeners
     - Phases: "inspect" -> "choose" -> "export" -> "idle"
  */

  if (window.InlineExport?.active) {
    console.warn(
      "[InlineExport] Already running. Call InlineExport.cleanup() first."
    );
    return;
  }

  const log = (...a) => console.log("[InlineExport]", ...a);
  const warn = (...a) => console.warn("[InlineExport]", ...a);
  const err = (...a) => console.error("[InlineExport]", ...a);

  const state = {
    active: true,
    phase: "idle", // <<< FIX: start idle
    hoverEl: null,
    pointer: { x: 0, y: 0 },
    overlay: null,
    chooser: null,
    exportView: null,
    defaultStyleCache: new Map(),
  };

  const UI_ATTR = "data-inline-export-ui";
  const css = (el, styles) => Object.assign(el.style, styles);
  const $ = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    el.setAttribute(UI_ATTR, "1");
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") el.className = v;
      else if (k === "style") css(el, v);
      else if (k.startsWith("on") && typeof v === "function")
        el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    for (const c of [].concat(children))
      if (c != null)
        el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return el;
  };
  const px = (n) => `${Math.round(n)}px`;
  const labelFor = (el) => {
    if (!el || el.nodeType !== 1) return String(el);
    const id = el.id ? `#${el.id}` : "";
    const cls =
      el.className && typeof el.className === "string"
        ? "." + el.className.trim().split(/\s+/).filter(Boolean).join(".")
        : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const shortPath = (el, max = 4) => {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < max) {
      parts.unshift(labelFor(cur));
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  const snapshotComputed = (el) => {
    const cs = getComputedStyle(el);
    const obj = {};
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      obj[p] = cs.getPropertyValue(p);
    }
    return obj;
  };
  const getDefaultStyle = (tagName) => {
    const key = tagName.toLowerCase();
    if (state.defaultStyleCache.has(key))
      return state.defaultStyleCache.get(key);
    let iframe, doc;
    try {
      iframe = document.createElement("iframe");
      css(iframe, {
        position: "absolute",
        width: "0",
        height: "0",
        border: "0",
        opacity: "0",
        pointerEvents: "none",
      });
      document.documentElement.appendChild(iframe);
      doc = iframe.contentDocument;
    } catch {
      doc = document.implementation.createHTMLDocument("");
    }
    const tmp = doc.createElement(key);
    (doc.body || doc.documentElement).appendChild(tmp);
    const defaults = snapshotComputed(tmp);
    if (iframe && iframe.parentNode) iframe.remove();
    state.defaultStyleCache.set(key, defaults);
    return defaults;
  };
  const shouldKeep = (prop, value) => {
    if (!value) return false;
    if (
      prop.startsWith("--") ||
      prop.startsWith("-webkit-") ||
      prop.startsWith("-moz-") ||
      prop.startsWith("-ms-")
    )
      return false;
    const skip = new Set([
      "transition-delay",
      "transition-duration",
      "transition-property",
      "transition-timing-function",
      "animation-delay",
      "animation-direction",
      "animation-duration",
      "animation-fill-mode",
      "animation-iteration-count",
      "animation-name",
      "animation-play-state",
      "animation-timing-function",
      "caret-color",
      "cursor",
      "pointer-events",
      "filter",
      "backdrop-filter",
      "will-change",
      "contain",
      "contain-intrinsic-size",
      "inset",
      "inset-block",
      "inset-inline",
      "block-size",
      "inline-size",
      "min-block-size",
      "min-inline-size",
      "max-block-size",
      "max-inline-size",
      "paint-order",
      "shape-outside",
      "shape-margin",
      "shape-image-threshold",
    ]);
    return !skip.has(prop);
  };
  const inlineIntoClone = (src, dst) => {
    if (src.nodeType !== 1 || dst.nodeType !== 1) return;
    const tag = src.tagName.toLowerCase();
    const computed = getComputedStyle(src);
    const defaults = getDefaultStyle(tag);
    const chunks = [];
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      const val = computed.getPropertyValue(prop);
      const def = defaults[prop];
      if (shouldKeep(prop, val) && val !== def) chunks.push(`${prop}: ${val};`);
    }
    if (chunks.length) dst.setAttribute("style", chunks.join(" "));
    const srcKids = src.children || [];
    const dstKids = dst.children || [];
    for (let i = 0; i < Math.min(srcKids.length, dstKids.length); i++)
      inlineIntoClone(srcKids[i], dstKids[i]);
  };
  const exportSubtree = (rootEl) => {
    const clone = rootEl.cloneNode(true);
    inlineIntoClone(rootEl, clone);
    return clone.outerHTML;
  };

  // ----- Formatting helpers -----
  const cleanupText = (s) =>
    s
      .replace(/[\t\r\f]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "");

  const formatHtml = (html, indent = 2) => {
    // Simple HTML formatter: line breaks between tags and indentation for nesting
    const indentUnit = " ".repeat(indent);
    // Insert line breaks between tags and around text
    const tokens = html
      .replace(/>\s*</g, ">\n<") // break between tags
      .split(/\n/);
    let depth = 0;
    const out = [];
    for (let raw of tokens) {
      let line = raw.trim();
      if (!line) continue;
      const isClosing = /^<\//.test(line);
      const isSelfClosing =
        /\/>$/.test(line) ||
        /^<!(?:--|DOCTYPE)/i.test(line) ||
        /^<meta|^<link|^<br|^<hr|^<img|^<input|^<source|^<col|^<area|^<base/i.test(
          line
        );

      if (isClosing) depth = Math.max(0, depth - 1);
      // For text nodes (not starting with <), clean up whitespace and keep at current depth
      if (!/^</.test(line)) line = cleanupText(line);
      out.push(`${indentUnit.repeat(depth)}${line}`);
      if (
        !isClosing &&
        !isSelfClosing &&
        /^</.test(line) &&
        !/^(?:<script|<style)/i.test(line)
      ) {
        depth++;
      }
    }
    return out.join("\n");
  };

  // ----- Overlay -----
  const makeOverlay = () => {
    const ol = document.createElement("div");
    ol.setAttribute(UI_ATTR, "1");
    css(ol, {
      position: "fixed",
      zIndex: 2147483646,
      pointerEvents: "none",
      border: "2px solid #4f80ff",
      background: "rgba(79,128,255,0.12)",
      borderRadius: "3px",
      boxShadow: "0 0 0 1px rgba(0,0,0,0.15), 0 0 0 99999px rgba(0,0,0,0.08)",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
    });
    document.documentElement.appendChild(ol);
    return ol;
  };
  const positionOverlay = (el) => {
    if (!state.overlay) {
      // Overlay not created yet, nothing to position
      return;
    }
    if (!el || el.nodeType !== 1) {
      css(state.overlay, {
        width: "0px",
        height: "0px",
        transform: "translate(-9999px, -9999px)",
      });
      return;
    }
    const r = el.getBoundingClientRect();
    css(state.overlay, {
      transform: `translate(${px(r.left)}, ${px(r.top)})`,
      width: px(r.width),
      height: px(r.height),
    });
  };

  // ----- Popups -----
  const popupShell = (title, contentNode) => {
    const container = $("div", { class: "inline-export-popup" });
    css(container, {
      position: "fixed",
      zIndex: 2147483647,
      right: "12px",
      bottom: "12px",
      width: "min(680px, 96vw)",
      maxHeight: "80vh",
      background: "#fff",
      border: "1px solid #d0d7de",
      borderRadius: "10px",
      boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    });
    const header = $("div", { class: "inline-export-header" }, [
      $("strong", {}, title),
      $("button", { class: "inline-export-close" }, "×"),
    ]);
    css(header, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 12px",
      borderBottom: "1px solid #eee",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      background: "#f6f8fa",
    });
    const body = $("div", { class: "inline-export-body" }, [contentNode]);
    css(body, { padding: "12px", overflow: "auto" });
    container.appendChild(header);
    container.appendChild(body);
    document.documentElement.appendChild(container);
    header
      .querySelector("button")
      .addEventListener("click", () => container.remove());
    return container;
  };

  // ----- DevTools helper -----
  const openInInspector = (el) => {
    // Try Chrome/Chromium's injected inspect() if available
    try {
      if (typeof window.inspect === "function") {
        log("Opening DevTools inspector for:", el);
        window.inspect(el);
        return true;
      }
    } catch (e) {
      err("inspect(el) failed:", e);
    }
    // Fallbacks: store a reference and guide the user
    try {
      // Expose a global so the user can run inspect(...) manually
      window.__INLINE_EXPORT_LAST_INSPECT__ = el;
      warn(
        "DevTools inspect() not found. Open DevTools and run: inspect(window.__INLINE_EXPORT_LAST_INSPECT__)"
      );
      // Pause execution if DevTools are open, giving user a breakpoint near target
      // eslint-disable-next-line no-debugger
      inspect(el);
    } catch {}
    return false;
  };

  // ----- Chooser -----
  const openChooser = (x, y) => {
    detachInspect();
    state.phase = "choose";
    let stack = (document.elementsFromPoint?.(x, y) || []).filter(
      (n) => n.nodeType === 1 && !n.hasAttribute(UI_ATTR)
    );
    // Include elements that are not normally hittable due to pointer-events: none
    // Mark these with a glyph in the list.
    const specialGlyph = "⚑"; // indicates pointer-events:none
    const withFlags = stack.map((el) => ({
      el,
      peNone: getComputedStyle(el).pointerEvents === "none",
    }));
    if (!stack.length) {
      alert("No elements found under pointer.");
      return;
    }
    const items = withFlags.slice(0, 20);
    const list = $(
      "div",
      {
        class: "inline-export-chooser-list",
        style: { maxHeight: "50vh", overflow: "auto" },
      },
      items.map(({ el, peNone }) => {
        const row = $("div", { class: "inline-export-chooser-row" });
        css(row, {
          display: "flex",
          alignItems: "stretch",
          gap: "8px",
          margin: "6px 0",
        });

        const selectBtn = $("button", { class: "inline-export-chooser-item" }, [
          document.createTextNode(labelFor(el) + " "),
          peNone
            ? $(
                "span",
                { style: { marginRight: "6px", color: "#b45309" } },
                specialGlyph
              )
            : null,
          $(
            "span",
            { style: { opacity: "0.7", marginLeft: "6px" } },
            shortPath(el)
          ),
        ]);
        css(selectBtn, {
          flex: "1 1 auto",
          textAlign: "left",
          padding: "8px 10px",
          border: "1px solid #ddd",
          borderRadius: "6px",
          background: "#fff",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          cursor: "pointer",
        });
        if (peNone) {
          css(selectBtn, { background: "#fff8eb", borderColor: "#f0c77a" });
          selectBtn.setAttribute(
            "title",
            "This element has pointer-events: none"
          );
        }
        selectBtn.addEventListener("mouseenter", () => positionOverlay(el));
        selectBtn.addEventListener("mouseleave", () =>
          positionOverlay(state.hoverEl)
        );
        selectBtn.addEventListener("click", () => {
          closeChooser();
          openExportView(el);
        });

        const inspectBtn = $("button", { class: "inline-export-inspect" }, [
          "Inspect",
        ]);
        css(inspectBtn, {
          flex: "0 0 auto",
          padding: "8px 10px",
          border: "1px solid #ccc",
          borderRadius: "6px",
          background: "#f7f7f7",
          cursor: "pointer",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          whiteSpace: "nowrap",
        });
        inspectBtn.setAttribute(
          "title",
          "Open this element in Chrome DevTools"
        );
        inspectBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          try {
            positionOverlay(el);
            openInInspector(el);
          } catch (e) {
            err("Inspector button failed:", e);
          }
        });

        row.appendChild(selectBtn);
        row.appendChild(inspectBtn);
        return row;
      })
    );
    const chooser = popupShell("Choose an element under pointer", list);
    // Add a tiny legend if any special items exist
    if (withFlags.some((i) => i.peNone)) {
      const legend = $("div", { class: "inline-export-legend" }, [
        $(
          "span",
          { style: { marginRight: "6px", color: "#b45309" } },
          specialGlyph
        ),
        $("span", { style: { opacity: "0.8" } }, "pointer-events: none"),
      ]);
      css(legend, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginTop: "6px",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        fontSize: "12px",
      });
      chooser.querySelector(".inline-export-body")?.appendChild(legend);
    }
    state.chooser = chooser;
    // Add a visible button to pick again
    const chooserBody = chooser.querySelector(".inline-export-body");
    const chooserControls = $(
      "div",
      { class: "inline-export-chooser-controls" },
      [
        $(
          "button",
          { class: "inline-export-pick-another" },
          "Pick another option"
        ),
      ]
    );
    css(chooserControls, {
      marginTop: "8px",
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
    });
    const pickAnotherBtn = chooserControls.querySelector("button");
    css(pickAnotherBtn, {
      padding: "6px 10px",
      borderRadius: "6px",
      border: "1px solid #ccc",
      background: "#f7f7f7",
      cursor: "pointer",
    });
    pickAnotherBtn.addEventListener("click", () => {
      closeChooser();
      restartInspect();
    });
    chooserBody?.appendChild(chooserControls);
  };
  const closeChooser = () => {
    state.chooser?.remove();
    state.chooser = null;
  };

  // ----- Export -----
  const openExportView = (el) => {
    state.phase = "export";
    log("Selected element:", el);
    let exported = "";
    try {
      console.time("[InlineExport] exportSubtree");
      exported = exportSubtree(el);
      console.timeEnd("[InlineExport] exportSubtree");
    } catch (e) {
      console.error("[InlineExport] export failed", e);
      exported = `<!-- Export failed: ${e?.message || e} -->`;
    }
    const ta = document.createElement("textarea");
    ta.setAttribute(UI_ATTR, "1");
    // Pretty-print and wrap
    ta.value = formatHtml(exported, 2);
    css(ta, {
      width: "100%",
      height: "50vh",
      boxSizing: "border-box",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: "12px",
      lineHeight: "1.5",
      padding: "10px",
      border: "1px solid #ddd",
      borderRadius: "8px",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      overflow: "auto",
    });
    const copyBtn = $("button", { class: "inline-export-copy" }, "Copy");
    css(copyBtn, {
      padding: "6px 10px",
      borderRadius: "6px",
      border: "1px solid #ccc",
      background: "#f7f7f7",
      cursor: "pointer",
      marginRight: "8px",
    });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        copyBtn.textContent = "Copied!";
      } catch {
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        copyBtn.textContent = ok ? "Copied!" : "Copy failed";
      }
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    });
    const restartBtn = $("button", {}, "Pick Another");
    css(restartBtn, {
      padding: "6px 10px",
      borderRadius: "6px",
      border: "1px solid #ccc",
      background: "#f7f7f7",
      cursor: "pointer",
    });
    restartBtn.addEventListener("click", () => {
      closeExportView();
      restartInspect();
    });

    const sizeInfo = document.createElement("span");
    sizeInfo.setAttribute(UI_ATTR, "1");
    sizeInfo.textContent = `Length: ${exported.length.toLocaleString()} chars`;
    css(sizeInfo, { opacity: "0.7" });

    const controls = document.createElement("div");
    controls.setAttribute(UI_ATTR, "1");
    css(controls, {
      margin: "8px 0 12px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    });
    controls.appendChild(copyBtn);
    controls.appendChild(restartBtn);
    controls.appendChild(sizeInfo);

    const head = document.createElement("div");
    head.setAttribute(UI_ATTR, "1");
    css(head, {
      marginBottom: "8px",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    });
    head.textContent = `Export of ${labelFor(el)} (${shortPath(el, 6)})`;

    const body = document.createElement("div");
    body.setAttribute(UI_ATTR, "1");
    body.appendChild(head);
    body.appendChild(controls);
    body.appendChild(ta);

    state.exportView = popupShell(
      "Inlined DOM (non-default styles only)",
      body
    );
  };
  const closeExportView = () => {
    state.exportView?.remove();
    state.exportView = null;
  };

  // ----- Events & phases -----
  const isClickInUI = (t) =>
    !!(t && (t.closest?.(`[${UI_ATTR}]`) || t.getAttribute?.(UI_ATTR)));
  const onPointerMove = (e) => {
    if (state.phase !== "inspect") return;
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    state.hoverEl =
      el && el.nodeType === 1 && !el.hasAttribute(UI_ATTR) ? el : null;
    positionOverlay(state.hoverEl);
  };
  const onClick = (e) => {
    if (state.phase !== "inspect") return;
    if (isClickInUI(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    positionOverlay(state.hoverEl);
    detachInspect();
    openChooser(state.pointer.x, state.pointer.y);
  };
  const onKey = (e) => {
    // Lightweight debug logging for function keys and our shortcuts
    const k = String(e.key);
    const c = String(e.code || "");
    if (/^F\d+$/i.test(k) || /^F\d+$/i.test(c) || k === "Escape") {
      log("keydown:", {
        key: k,
        code: c,
        keyCode: e.keyCode,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
      });
    }
    if (k === "Escape") {
      window.InlineExport?.cleanup();
      return;
    }
    // F16 key to (re)start inspect overlay from any phase
    const isF16 = k.toUpperCase() === "F16" || c.toUpperCase() === "F16";
    if (isF16) {
      e.preventDefault();
      e.stopPropagation();
      log("F16 detected -> restartInspect()");
      try {
        window.InlineExport?.restartInspect();
      } catch (err2) {
        err("restartInspect failed:", err2);
      }
    }
  };

  const attachGlobalKeys = () => {
    // Attach once for the lifecycle of this tool; do not tie to inspect mode
    if (!state._globalKeysAttached) {
      document.addEventListener("keydown", onKey, { capture: true });
      state._globalKeysAttached = true;
    }
  };

  const attachInspect = () => {
    if (state.phase === "inspect") return;
    state.phase = "inspect";
    state.overlay = state.overlay || makeOverlay();
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    log("Inspect mode ON. Move mouse and click to choose. ESC to exit.");
  };
  const detachInspect = () => {
    document.removeEventListener("mousemove", onPointerMove, true);
    document.removeEventListener("click", onClick, true);
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
  };
  const restartInspect = () => {
    closeChooser();
    closeExportView();
    attachInspect();
  };

  // Public API
  window.InlineExport = {
    active: true,
    restartInspect,
    cleanup() {
      if (!state.active) return;
      state.active = false;
      state.phase = "idle";
      detachInspect();
      closeChooser();
      closeExportView();
      if (state._globalKeysAttached) {
        document.removeEventListener("keydown", onKey, { capture: true });
        state._globalKeysAttached = false;
      }
      log("Cleaned up.");
      this.active = false;
    },
  };

  // Kickoff
  attachGlobalKeys();
  attachInspect(); // <<< now attaches because phase starts "idle"
})();
