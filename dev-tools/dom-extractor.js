(() => {
  if (window.__domExtractorActive) {
    console.log("[DOM Extractor] Deactivating existing session.");
    if (typeof window.__domExtractorCleanup === "function") {
      window.__domExtractorCleanup();
    }
    return;
  }

  console.log(
    "[DOM Extractor] Activating (filtered styles + CSS vars). Move mouse to highlight, click to extract, Esc to cancel."
  );

  window.__domExtractorActive = true;

  let currentElement = null;

  // Global collection of CSS variable usages during style copy.
  // Map name -> first encountered fallback (if any).
  const __collectedVarUsages = new Map();

  // ==== Style helpers (filtering + CSS vars) ==============================

  let defaultStyleIframe = null;
  const defaultStyleCache = new Map(); // tagName -> CSSStyleDeclaration

  function getDefaultStyleDoc() {
    if (defaultStyleIframe && defaultStyleIframe.contentDocument) {
      return defaultStyleIframe.contentDocument;
    }

    defaultStyleIframe = document.createElement("iframe");
    defaultStyleIframe.style.position = "fixed";
    defaultStyleIframe.style.width = "0";
    defaultStyleIframe.style.height = "0";
    defaultStyleIframe.style.border = "0";
    defaultStyleIframe.style.visibility = "hidden";
    defaultStyleIframe.style.pointerEvents = "none";
    defaultStyleIframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(defaultStyleIframe);

    const doc = defaultStyleIframe.contentDocument;
    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();
    return doc;
  }

  function getDefaultComputedStyleForTag(tagName) {
    const key = tagName.toLowerCase();
    if (defaultStyleCache.has(key)) {
      return defaultStyleCache.get(key);
    }
    const doc = getDefaultStyleDoc();
    const el = doc.createElement(tagName);
    doc.body.appendChild(el);
    const cs = doc.defaultView.getComputedStyle(el);
    defaultStyleCache.set(key, cs);
    return cs;
  }

  // Conservative list of inherited properties (non-custom).
  const INHERITED_PROPS = new Set([
    "border-collapse",
    "border-spacing",
    "caption-side",
    "color",
    "cursor",
    "direction",
    "empty-cells",
    "font",
    "font-family",
    "font-feature-settings",
    "font-kerning",
    "font-language-override",
    "font-size",
    "font-size-adjust",
    "font-stretch",
    "font-style",
    "font-synthesis",
    "font-variant",
    "font-variant-alternates",
    "font-variant-caps",
    "font-variant-east-asian",
    "font-variant-ligatures",
    "font-variant-numeric",
    "font-variant-position",
    "font-weight",
    "letter-spacing",
    "line-height",
    "list-style",
    "list-style-image",
    "list-style-position",
    "list-style-type",
    "orphans",
    "quotes",
    "tab-size",
    "text-align",
    "text-align-last",
    "text-decoration",
    "text-decoration-color",
    "text-indent",
    "text-justify",
    "text-shadow",
    "text-transform",
    "visibility",
    "white-space",
    "widows",
    "word-break",
    "word-spacing",
    "writing-mode",
    "text-rendering",
    "text-overflow",
  ]);

  function copyAttributes(src, dst) {
    for (const attr of src.attributes) {
      if (attr.name.toLowerCase() === "style") continue;
      dst.setAttribute(attr.name, attr.value);
    }
  }

  function copyComputedStyleFiltered(src, dst) {
    const computed = window.getComputedStyle(src);
    const parentComputed = src.parentElement
      ? window.getComputedStyle(src.parentElement)
      : null;
    const defaultComputed = getDefaultComputedStyleForTag(src.tagName);

    const props = Array.from(computed);

    // Helper: collect var() usages from any CSS value string into global map.
    function collectVarUsages(value) {
      if (!value || value.indexOf("var(") === -1) return;
      const varUsageRegex = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^\)]+))?\)/g;
      let match;
      while ((match = varUsageRegex.exec(value))) {
        const name = match[1];
        const fallback = match[2] ? match[2].trim() : "";
        if (!__collectedVarUsages.has(name)) {
          __collectedVarUsages.set(name, fallback);
        }
      }
    }

    // Gather all custom properties on this element with non-empty value.
    const customProps = [];
    for (const prop of props) {
      if (!prop.startsWith("--")) continue;
      const value = computed.getPropertyValue(prop);
      if (!value) continue;
      customProps.push([prop, value]);
      // ALSO collect var() usages appearing inside custom property definitions.
      collectVarUsages(value);
    }

    const cssPieces = [];

    for (const prop of props) {
      const value = computed.getPropertyValue(prop);
      const priority = computed.getPropertyPriority(prop);
      if (!value) continue;

      const isCustomProp = prop.startsWith("--");

      // --- Custom properties: inherit-aware + minimal duplicates ---------
      if (isCustomProp) {
        // Only define this var if it actually changes vs parent chain.
        if (parentComputed) {
          const parentValue = parentComputed.getPropertyValue(prop);
          if (parentValue === value) {
            // Parent (or an ancestor) already provides the same var value.
            // Rely on cascade; don't duplicate.
            continue;
          }
        }

        cssPieces.push(`${prop}: ${value}${priority ? " !" + priority : ""};`);
        // Collect any nested var() usages inside the custom prop value.
        collectVarUsages(value);
        continue;
      }

      // --- Non-custom properties -----------------------------------------
      // 1) Skip anything equal to browser default for this tag.
      const defaultValue = defaultComputed.getPropertyValue(prop);
      if (value === defaultValue) {
        continue;
      }

      // 2) If inheritable and same as parent, rely on cascade.
      if (parentComputed && INHERITED_PROPS.has(prop)) {
        const parentValue = parentComputed.getPropertyValue(prop);
        if (parentValue === value) {
          continue;
        }
      }

      // 3) Try to express this property via a custom property (var()).
      let usedValue = value;
      let varName = null;
      for (const [cpName, cpValue] of customProps) {
        if (cpValue === value) {
          varName = cpName;
          break;
        }
      }

      if (varName) {
        usedValue = `var(${varName})`;
      }

      cssPieces.push(
        `${prop}: ${usedValue}${priority ? " !" + priority : ""};`
      );
      // Track var() usages: use both original computed value (rarely contains var())
      // and the rewritten usedValue (which may introduce a var reference).
      collectVarUsages(value);
      if (usedValue !== value) collectVarUsages(usedValue);
    }

    dst.style.cssText = cssPieces.join(" ");
  }

  // Create simple placeholder elements for ::before and ::after pseudo elements.
  // We cannot clone actual pseudo elements, so we inject span[data-pseudo] nodes.
  // Only create when the pseudo has a non-'none' content value.
  function createPseudoPlaceholder(srcEl, targetDoc, which) {
    let pseudoStyle;
    try {
      pseudoStyle = window.getComputedStyle(srcEl, "::" + which);
    } catch (e) {
      return null;
    }
    if (!pseudoStyle) return null;
    const content = pseudoStyle.getPropertyValue("content");
    if (!content || content === "none") return null;
    // Strip surrounding quotes if present.
    const text = content.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    const span = targetDoc.createElement("span");
    span.setAttribute("data-pseudo", which);
    span.textContent = text;
    // Minimal hint styles that may matter for visibility; not attempting full fidelity.
    // We purposely do NOT copy all computed pseudo styles to stay lightweight.
    const display = pseudoStyle.getPropertyValue("display");
    if (display && display !== "inline") span.style.display = display;
    const color = pseudoStyle.getPropertyValue("color");
    if (color) span.style.color = color;
    const font = pseudoStyle.getPropertyValue("font");
    if (font) span.style.font = font;
    return span;
  }

  function cloneTreeWithStyles(srcNode, targetDoc) {
    if (srcNode.nodeType === Node.TEXT_NODE) {
      return targetDoc.createTextNode(srcNode.textContent);
    }

    if (srcNode.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const clone = targetDoc.createElement(srcNode.tagName);
    copyAttributes(srcNode, clone);
    copyComputedStyleFiltered(srcNode, clone);

    // Inject ::before placeholder before children
    const beforePlaceholder = createPseudoPlaceholder(
      srcNode,
      targetDoc,
      "before"
    );
    if (beforePlaceholder) {
      clone.appendChild(beforePlaceholder);
    }

    for (const child of srcNode.childNodes) {
      const childClone = cloneTreeWithStyles(child, targetDoc);
      if (childClone) clone.appendChild(childClone);
    }

    // Inject ::after placeholder after children
    const afterPlaceholder = createPseudoPlaceholder(
      srcNode,
      targetDoc,
      "after"
    );
    if (afterPlaceholder) {
      clone.appendChild(afterPlaceholder);
    }

    return clone;
  }

  function buildAncestorChain(el) {
    const chain = [];
    let current = el;
    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      chain.unshift(current);
      current = current.parentElement;
    }
    return chain;
  }

  // ==== CSS Variable root definition helper =============================
  // Scans the cloned document for var(--x[, fallback]) usages and ensures
  // every referenced custom property is defined at least on body.
  function ensureBodyHasAllUsedCSSVars(doc, sourceDocument, varUsages) {
    const body = doc.body;
    if (!body) return;
    if (!varUsages || !varUsages.size) return;

    // Build a set of already declared custom props in cloned doc.
    const declared = new Set();
    doc.querySelectorAll("*").forEach((el) => {
      const style = el.style;
      if (!style) return;
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (prop.startsWith("--")) declared.add(prop);
      }
    });

    const missing = [];
    for (const [name, fallback] of varUsages.entries()) {
      if (!declared.has(name)) {
        // Resolve value from original document (body-first; ignore :root per instruction).
        let resolved = "";
        if (sourceDocument.body) {
          resolved = window
            .getComputedStyle(sourceDocument.body)
            .getPropertyValue(name)
            .trim();
        }
        // If still empty, attempt to find any element providing the variable.
        if (!resolved) {
          const found = sourceDocument.querySelector(`[style*="${name}"]`);
          if (found) {
            resolved = window
              .getComputedStyle(found)
              .getPropertyValue(name)
              .trim();
          }
        }
        if (!resolved) {
          // Fall back to recorded fallback if unresolved.
          resolved = fallback || "";
        }
        missing.push([name, resolved]);
      }
    }
    if (!missing.length) {
      console.log("[DOM Extractor] All used CSS vars are already declared.");
      return;
    }
    // Inline missing custom properties directly on body style attribute.
    // This spreads them into the body element itself instead of a separate <style> block.
    for (const [name, value] of missing) {
      try {
        body.style.setProperty(name, value);
        console.log("[DOM Extractor] Set body var", name, "to", value);
      } catch (e) {
        console.warn("[DOM Extractor] Failed to set body var", name, e);
      }
    }
  }

  // ==== Overlay UI ========================================================

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.zIndex = "2147483647";
  overlay.style.pointerEvents = "none";
  overlay.style.border = "2px solid rgba(0, 140, 255, 0.9)";
  overlay.style.background = "rgba(0, 140, 255, 0.15)";
  overlay.style.boxSizing = "border-box";
  overlay.style.transition = "all 0.02s ease-out";

  const label = document.createElement("div");
  label.style.position = "fixed";
  label.style.zIndex = "2147483647";
  label.style.pointerEvents = "none";
  label.style.background = "rgba(0, 0, 0, 0.8)";
  label.style.color = "#fff";
  label.style.fontFamily = "monospace";
  label.style.fontSize = "11px";
  label.style.padding = "2px 4px";
  label.style.borderRadius = "3px";
  label.style.whiteSpace = "nowrap";

  document.body.appendChild(overlay);
  document.body.appendChild(label);

  function describeElement(el) {
    if (!el) return "<none>";
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push("#" + el.id);
    if (el.classList && el.classList.length) {
      parts.push("." + Array.from(el.classList).join("."));
    }
    return parts.join("");
  }

  function updateOverlay(target) {
    if (!target || target === document.documentElement || target === document) {
      overlay.style.width = "0px";
      overlay.style.height = "0px";
      label.textContent = "";
      return;
    }

    const rect = target.getBoundingClientRect();
    overlay.style.left = rect.left + "px";
    overlay.style.top = rect.top + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";

    label.textContent = describeElement(target);
    let labelX = rect.left;
    let labelY = rect.top - 18;
    if (labelY < 0) {
      labelY = rect.top + rect.height + 4;
    }
    label.style.left = labelX + "px";
    label.style.top = labelY + "px";
  }

  // ==== Extraction logic ==================================================

  function extractElement(el) {
    console.log(
      "[DOM Extractor] Extracting element with filtered styles + CSS vars:",
      describeElement(el)
    );

    const win = window.open("", "_blank");
    if (!win) {
      console.warn(
        "[DOM Extractor] Failed to open new window (popup blocker?)."
      );
      return;
    }

    const doc = win.document;
    doc.open();
    doc.write(
      "<!doctype html><html><head><title>Extracted DOM</title></head><body></body></html>"
    );
    doc.close();

    const html = doc.documentElement;
    const body = doc.body;

    html.style.height = "100%";
    body.style.margin = "0";
    body.style.minHeight = "100%";
    body.style.boxSizing = "border-box";
    body.style.display = "block";

    const base = doc.createElement("base");
    base.setAttribute("href", window.location.href);
    doc.head.appendChild(base);

    const chain = buildAncestorChain(el);
    let parentForSubtree = body;
    // Track ancestor placeholders that need ::after inserted after subtree content.
    const ancestorAfterPlaceholders = [];

    if (chain.length > 1) {
      for (let i = 0; i < chain.length - 1; i++) {
        const srcAncestor = chain[i];
        const placeholder = doc.createElement(srcAncestor.tagName);
        copyAttributes(srcAncestor, placeholder);
        copyComputedStyleFiltered(srcAncestor, placeholder);
        // ::before pseudo placeholder before descendant content
        const beforePh = createPseudoPlaceholder(srcAncestor, doc, "before");
        if (beforePh) placeholder.appendChild(beforePh);
        parentForSubtree.appendChild(placeholder);
        parentForSubtree = placeholder;
        // Defer ::after until after subtree is appended so ordering matches real DOM
        const afterPh = createPseudoPlaceholder(srcAncestor, doc, "after");
        if (afterPh) ancestorAfterPlaceholders.push([placeholder, afterPh]);
      }
    }

    const subtreeClone = cloneTreeWithStyles(el, doc);
    if (subtreeClone) {
      parentForSubtree.appendChild(subtreeClone);
    }
    // Append deferred ::after pseudo placeholders for ancestors now that their content exists.
    for (const [placeholder, afterPh] of ancestorAfterPlaceholders) {
      placeholder.appendChild(afterPh);
    }

    // After cloning, ensure body has definitions for all used CSS variables.
    try {
      console.log("[DOM Extractor] Ensuring body has all used CSS vars...");
      console.log(
        "[DOM Extractor] Collected var usages:",
        __collectedVarUsages
      );
      ensureBodyHasAllUsedCSSVars(doc, document, __collectedVarUsages);
    } catch (err) {
      console.warn("[DOM Extractor] Failed to ensure root CSS vars:", err);
    }

    console.log(
      "[DOM Extractor] Extraction complete with filtered styles + CSS vars. Check the new window."
    );
  }

  // ==== Event handling / lifecycle ========================================

  function cleanup() {
    console.log("[DOM Extractor] Cleaning up.");
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    label.remove();
    window.__domExtractorActive = false;
    window.__domExtractorCleanup = null;
  }

  function pickCurrent() {
    if (!currentElement) {
      console.warn("[DOM Extractor] No element under cursor to extract.");
      return;
    }
    cleanup();
    extractElement(currentElement);
  }

  function onMouseMove(e) {
    const target = e.target;
    if (!(target instanceof Element)) return;
    currentElement = target;
    updateOverlay(target);
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    console.log(
      "[DOM Extractor] Click detected, extracting current element (filtered styles + CSS vars)."
    );
    pickCurrent();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      console.log("[DOM Extractor] Cancelled with Esc.");
      cleanup();
      return;
    }
    if (e.key === "Enter") {
      console.log(
        "[DOM Extractor] Enter pressed, extracting current element (filtered styles + CSS vars)."
      );
      e.preventDefault();
      pickCurrent();
    }
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  window.__domExtractorCleanup = cleanup;
})();
