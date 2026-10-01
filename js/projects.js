// ========================================================
// PROJECTS — microprocessor board + Bellatrix arrival intro
//
// The project cards are static HTML (build/build.js renders them from
// assets/projects.json); this file enhances them and draws the board.
//
//   Board:  one square package (pins on all four sides, die visible through
//           the lid), one module per project, octilinear buses (top layer ->
//           via -> inner layer -> via -> top layer), constant-speed packets.
//   Layers: mask, traces, pads, silkscreen and package are drawn once per
//           resize into an offscreen canvas. Only packets, glow and the core
//           pulse are redrawn per frame (idle: <= IDLE_FPS, paused when hidden).
//   Intro:  window.playIntro(mode, arrival), mode = 'arrival' | 'first' | 'skip'.
//           A camera starts zoomed in on the die (dark, then the core powers on),
//           the traces draw outward along their routed paths bus by bus, the camera
//           pulls back to the whole board, then idle takes over. The intro redraws the
//           board from geometry every frame (vector, so the zoom stays crisp); idle
//           blits the offscreen layer.
//   QA:     window.__board exposes the computed geometry; window.__QA.static
//           freezes ambient animation so screenshots are deterministic.
// ========================================================
(function () {
  "use strict";

  // ---- Intro timing (ms) — tune here ----
  // The owner asked for the cinematic version back, so first <= 5.0 s, arrival <= 3.0 s.
  // collapse: arrival colour shrinks to the core; core: [start, end] of the core power-on;
  // cells: [first, last] die cell lit; draw: traces start leaving at draw.start, one module
  // every draw.stagger (nearest first), the longest trace takes draw.travel;
  // zoom: [start, end] of the pull-back from INTRO_ZOOM to 1.
  const INTRO_ZOOM = 2.8;
  const INTRO_EDGE_FADE_PX = 120;  // zoomed scene fades out over this width at the board's right edge
  const INTRO_FIRST = { total: 4600, core: [450, 1250], cells: [600, 1500], draw: { start: 1200, stagger: 90, travel: 900 }, zoom: [1100, 3900] };
  const INTRO_ARRIVAL = { total: 2800, collapse: 420, core: [250, 650], cells: [350, 900], draw: { start: 650, stagger: 45, travel: 650 }, zoom: [450, 2300] };
  const TRACE_STAGGER_MS = 12;    // per trace inside one bus
  const CELL_RISE_MS = 80;
  const CELL_DECAY_MS = 500;      // lit die cell settles to its idle glow
  const MODULE_RISE_MS = 60;
  const MODULE_DECAY_MS = 500;    // module flash after a packet lands
  const CARD_FADE_MS = 300;       // card fades up as its module lights
  const CARD_LEAD_MS = 0;         // a card never shows before its module lights
  const VIA_POP_MS = 140;         // via grows in once the trace reaches it
  const REDUCED_FADE_MS = 150;    // reduced motion: arrival colour fades, nothing else moves
  const CORE_BUMP_MS = 420;

  // ---- Idle / interaction ----
  const IDLE_FPS = 30;
  const DPR_CAP = 2;
  const AMBIENT_PACKETS_PER_S = 2.4;
  const MAX_PACKETS = 90;
  const BURST_STAGGER_MS = 45;    // per trace when a card is hovered
  const BURST_REPEAT_MS = 1500;   // re-send while the card stays hovered
  const HOVER_EASE_PER_S = 9;
  const FLASH_DECAY_PER_S = 2.2;
  const IDLE_CELL_ALPHA = 0.07;
  const PEAK_CELL_ALPHA = 0.5;

  // ---- Layout ----
  const MOBILE_MAX_W = 900;       // below this the board is a backdrop behind one card column
  const LABEL_MIN_PX = 9;         // desktop silkscreen label floor (the label font never scales below this)
  const PKG_MARGIN_PINS = 12;     // package edge = (pins on the busiest side + this) * pitch
  const CHIP_KEEPOUT = { x: 16, w: 244, h: 60, bottom: 18 };   // desktop: the pinned ENG MODE chip's corner, kept free of modules
  const EDGE_PX = 18;             // min gap between a module and the board edge
  const BUS_PITCH_MIN = 4.4, BUS_PITCH_MAX = 12;
  // module i -> side of the package, walking clockwise from the top-left
  const SIDE_PATTERN = {
    desktop: ["T", "T", "T", "T", "T", "R", "R", "R", "R", "R", "B", "B", "B", "B", "B", "L", "L", "L", "L", "L"],
    mobile: ["T", "T", "T", "T", "T", "R", "R", "R", "R", "R", "B", "B", "B", "B", "B", "L", "L", "L", "L", "L"]
  };
  // traces per bus (4-8) for module i
  const BUS_SIZES = {
    desktop: [6, 4, 5, 4, 6, 5, 4, 6, 4, 5, 6, 4, 5, 4, 6, 5, 4, 6, 4, 5],
    mobile: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]
  };
  const SIDES = ["T", "R", "B", "L"];

  // ---- Palette ----
  const MASK = "#07100f";
  const MASK_EDGE = "#040908";
  const COPPER_TOP = "rgba(203, 141, 80, 0.92)";
  const COPPER_INNER = "rgba(126, 96, 62, 0.62)";
  const PAD_FILL = "rgba(224, 168, 112, 0.95)";
  const PIN_FILL = "rgba(178, 190, 200, 0.75)";
  const SILK = "rgba(196, 212, 224, 0.16)";
  const SILK_TEXT = "rgba(196, 212, 224, 0.34)";
  const PKG_BODY = "#0f1719";
  const PKG_EDGE = "#2c3b41";
  const DIE_LINE = "rgba(126, 190, 205, 0.22)";

  // ---- state shared with the pipeline overlay + engineering UI ----
  let isPipelineActive = false;
  let pipelineStageIndex = -1;
  let loadingProject = null;
  const pipelineStages = ["FETCH", "DECODE", "EXECUTE", "MEMORY", "WRITEBACK"];
  let pipelineTimeouts = [];

  // Pipeline overlay
  const pipelineOverlay = document.createElement("div");
  Object.assign(pipelineOverlay.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(6px)",
    zIndex: "50"
  });

  const pipelineBox = document.createElement("div");
  Object.assign(pipelineBox.style, {
    background: "#050814",
    border: "1px solid #3b3b4a",
    borderRadius: "16px",
    padding: "16px 20px",
    maxWidth: "420px",
    width: "90%",
    color: "#e5e5f0",
    fontFamily: "'IBM Plex Mono','Fira Mono',monospace",
    boxShadow: "0 0 24px rgba(56,189,248,0.4)"
  });

  const pipelineLabel = document.createElement("div");
  pipelineLabel.textContent = "Executing instruction";
  Object.assign(pipelineLabel.style, {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: "#9ca3af",
    marginBottom: "6px"
  });

  const pipelineTitle = document.createElement("div");
  Object.assign(pipelineTitle.style, {
    fontSize: "14px",
    fontWeight: "600",
    marginBottom: "10px",
    color: "#e5e7eb"
  });

  const pipelineStagesRow = document.createElement("div");
  Object.assign(pipelineStagesRow.style, {
    display: "flex",
    gap: "8px"
  });

  const pipelineStageEls = pipelineStages.map((stage) => {
    const span = document.createElement("div");
    span.textContent = stage;
    Object.assign(span.style, {
      flex: "1",
      textAlign: "center",
      fontSize: "10px",
      padding: "4px 0",
      borderRadius: "999px",
      border: "1px solid #4b5563",
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      transition: "all 0.18s ease"
    });
    pipelineStagesRow.appendChild(span);
    return span;
  });

  pipelineBox.appendChild(pipelineLabel);
  pipelineBox.appendChild(pipelineTitle);
  pipelineBox.appendChild(pipelineStagesRow);
  pipelineOverlay.appendChild(pipelineBox);
  document.body.appendChild(pipelineOverlay);

  function updatePipelineOverlay() {
    if (!loadingProject) return;
    pipelineTitle.textContent = loadingProject.title || "Project";

    pipelineStageEls.forEach((el, idx) => {
      const active = idx === pipelineStageIndex;
      const done = idx < pipelineStageIndex;

      const baseOpacity = done ? 0.95 : active ? 1 : 0.35;
      const glow = active ? 1 : done ? 0.5 : 0.0;

      el.style.opacity = String(baseOpacity);
      el.style.borderColor = active ? "#38bdf8" : done ? "#22c55e" : "#4b5563";
      el.style.boxShadow = glow
        ? "0 0 14px rgba(56,189,248,0.9)"
        : done
        ? "0 0 6px rgba(34,197,94,0.6)"
        : "none";
      el.style.color = done ? "#bbf7d0" : active ? "#e0f2fe" : "#9ca3af";
      el.style.background =
        active || done ? "linear-gradient(135deg,#020617,#022c22)" : "transparent";
    });
  }

  function startPipelineLoad(project) {
    if (loadingProject) return;

    loadingProject = project;
    isPipelineActive = true;
    pipelineStageIndex = -1;
    pipelineOverlay.style.display = "flex";
    updatePipelineOverlay();

    pipelineTimeouts.forEach((id) => clearTimeout(id));
    pipelineTimeouts = [];

    // slower, more deliberate cycle
    const stepDuration = 420; // ms per stage
    pipelineStages.forEach((_, idx) => {
      const id = setTimeout(() => {
        pipelineStageIndex = idx;
        updatePipelineOverlay();
      }, idx * stepDuration);
      pipelineTimeouts.push(id);
    });

    const total = pipelineStages.length * stepDuration + 260;
    const finishId = setTimeout(() => {
      isPipelineActive = false;
      loadingProject = null;
      pipelineStageIndex = -1;
      pipelineOverlay.style.display = "none";

      // redirect in SAME tab after animation
      if (project.url) {
        window.location.href = project.url;
      }
    }, total);
    pipelineTimeouts.push(finishId);
  }

  // ============================================================
  // 2. ENGINEERING MODE UI + OVERDRIVE + TOAST
  // ============================================================

  let engineeringMode = false;
  let clockSpeed = 1.0;
  let coreOverdrive = 0; // increases with core clicks, decays slowly
  let halted = false;

  // helper button
  const engChipBtn = document.createElement("button");
  engChipBtn.id = "eng-chip-toggle";
  engChipBtn.innerHTML = `
    <div style="
      width:24px;height:24px;border-radius:10px;
      border:1px solid #4b5563;position:relative;
      margin-right:8px;overflow:hidden;">
      <div style="
        position:absolute;inset:3px;border-radius:8px;
        background:radial-gradient(circle at 30% 30%,#38bdf8,#22c55e);
        animation:pulse-eng-chip 2s ease-in-out infinite;">
      </div>
    </div>
    <div style="text-align:left;">
      <div class="eng-chip-label"
        style="font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#9ca3af;">
        ENTER ENG MODE
      </div>
      <div style="font-size:11px;color:#9aa3b5;">
        tap the core for overdrive
      </div>
    </div>
  `;
  Object.assign(engChipBtn.style, {
    position: "fixed",
    right: "1rem",
    bottom: "1rem",
    zIndex: "40",
    display: "flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    border: "1px solid #4b5563",
    background: "rgba(15,23,42,0.96)",
    color: "#e5e7eb",
    fontFamily: "'IBM Plex Mono','Fira Mono',monospace",
    fontSize: "11px",
    cursor: "pointer",
    boxShadow: "0 0 18px rgba(56,189,248,0.4)",
    backdropFilter: "blur(4px)"
  });

  const styleTag = document.createElement("style");
  styleTag.textContent = `
    @keyframes pulse-eng-chip {
      0%,100% { transform: scale(0.96); opacity:0.8; }
      50% { transform: scale(1.05); opacity:1; }
    }
  `;
  document.head.appendChild(styleTag);
  document.body.appendChild(engChipBtn);
  // >= 900px: pinned over the board (lower left; the layout keeps a module out of that corner,
  // see CHIP_KEEPOUT). Narrower: a static row under the "My Projects" heading so it never
  // covers a card. Placement only; behaviour is unchanged.
  const engChipMq = window.matchMedia("(min-width: 900px)");
  function placeEngChip() {
    const h1 = document.querySelector("main h1");
    if (engChipMq.matches || !h1) {
      if (engChipBtn.parentNode !== document.body) document.body.appendChild(engChipBtn);
    } else if (engChipBtn.previousElementSibling !== h1) {
      h1.insertAdjacentElement("afterend", engChipBtn);
    }
  }
  placeEngChip();
  if (engChipMq.addEventListener) engChipMq.addEventListener("change", placeEngChip);

  // center toast
  const engToast = document.createElement("div");
  Object.assign(engToast.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "45",
    pointerEvents: "none"
  });
  const engToastInner = document.createElement("div");
  Object.assign(engToastInner.style, {
    background: "rgba(5,7,17,0.95)",
    borderRadius: "18px",
    padding: "16px 24px",
    border: "1px solid #38bdf8",
    color: "#e5e7eb",
    fontFamily: "'IBM Plex Mono','Fira Mono',monospace",
    fontSize: "12px",
    boxShadow: "0 0 40px rgba(56,189,248,0.6)",
    textAlign: "center"
  });
  engToastInner.innerHTML = `
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.18em;color:#93c5fd;margin-bottom:6px;">
      Engineering Mode
    </div>
    <div>Core unlocked. Clock speed and electron flow are now under your command.</div>
  `;
  engToast.appendChild(engToastInner);
  document.body.appendChild(engToast);

  function showEngToast() {
    engToast.style.display = "flex";
    engToastInner.style.transform = "scale(0.9)";
    engToastInner.style.opacity = "0";
    requestAnimationFrame(() => {
      engToastInner.style.transition = "all 0.18s ease-out";
      engToastInner.style.transform = "scale(1)";
      engToastInner.style.opacity = "1";
    });
    setTimeout(() => {
      engToastInner.style.transition = "all 0.22s ease-in";
      engToastInner.style.transform = "scale(0.96)";
      engToastInner.style.opacity = "0";
      setTimeout(() => {
        engToast.style.display = "none";
      }, 230);
    }, 1200);
  }

  // side panel
  const engPanel = document.createElement("div");
  Object.assign(engPanel.style, {
    position: "fixed",
    right: "1rem",
    bottom: "3.6rem",
    zIndex: "39",
    width: "280px",
    maxWidth: "80vw",
    background: "rgba(5,7,16,0.97)",
    borderRadius: "18px",
    border: "1px solid #4b5563",
    padding: "12px 14px",
    color: "#e5e7eb",
    fontFamily: "'IBM Plex Mono','Fira Mono',monospace",
    fontSize: "11px",
    display: "none",
    boxShadow: "0 0 24px rgba(56,189,248,0.4)",
    backdropFilter: "blur(6px)"
  });

  engPanel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.18em;color:#9ca3af;">
        Engineering Mode
      </div>
      <button id="eng-close-btn" style="
        background:none;border:none;color:#9ca3af;
        font-size:12px;cursor:pointer;">&times;</button>
    </div>
    <div style="margin-bottom:10px;color:#9ca3af;">
      Tap the core multiple times to push it into overdrive. Clock speed, buses and arcs respond.
    </div>
    <div style="margin-bottom:10px;">
      <div style="margin-bottom:4px;color:#9ca3af;">Clock speed</div>
      <input id="eng-clock-slider" type="range" min="0.5" max="2" step="0.1" value="1" style="width:100%;">
      <div style="font-size:10px;color:#6b7280;margin-top:2px;">
        Scales animation speed globally.
      </div>
    </div>
    <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;">
      <div style="color:#9ca3af;">Core state</div>
      <button id="eng-halt-btn" style="
        font-size:10px;
        font-family:'IBM Plex Mono','Fira Mono',monospace;
        padding:4px 10px;
        border-radius:999px;
        border:1px solid #f97316;
        background:rgba(15,23,42,0.9);
        color:#fed7aa;
        cursor:pointer;">
        HALT
      </button>
    </div>
  `;
  document.body.appendChild(engPanel);

  const engCloseBtn = engPanel.querySelector("#eng-close-btn");
  const clockSlider = engPanel.querySelector("#eng-clock-slider");
  const haltBtn = engPanel.querySelector("#eng-halt-btn");

  function updateEngChipLabel() {
    const label = engChipBtn.querySelector(".eng-chip-label");
    if (label) label.textContent = engineeringMode ? "ENG MODE" : "ENTER ENG MODE";
  }

  function setEngineeringMode(on, fromCore = false) {
    const wasOff = !engineeringMode;
    engineeringMode = !!on;
    engPanel.style.display = engineeringMode ? "block" : "none";
    updateEngChipLabel();
    if (engineeringMode && wasOff && fromCore) {
      showEngToast();
    }
  }

  engChipBtn.addEventListener("click", () => {
    setEngineeringMode(!engineeringMode, false);
  });

  engCloseBtn.addEventListener("click", () => {
    setEngineeringMode(false, false);
  });

  clockSlider.addEventListener("input", (e) => {
    clockSpeed = parseFloat(e.target.value) || 1.0;
  });

  haltBtn.addEventListener("click", () => {
    halted = !halted;
    if (halted) {
      haltBtn.textContent = "RUN";
      haltBtn.style.borderColor = "#22c55e";
      haltBtn.style.color = "#bbf7d0";
    } else {
      haltBtn.textContent = "HALT";
      haltBtn.style.borderColor = "#f97316";
      haltBtn.style.color = "#fed7aa";
    }
  });



  // ============================================================
  // 3. BOARD: LAYOUT (pure geometry, no drawing)
  // ============================================================

  const root = document.documentElement;
  const T = window.SiteTransition;
  const QA = window.__QA || {};
  const reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const canvas = document.getElementById("circuit-canvas");
  const mainCtx = canvas.getContext("2d");
  let ctx = mainCtx;   // the dynamic layer draws through ctx; the intro points it at sceneCtx for a frame
  const staticCv = document.createElement("canvas");
  const sctx = staticCv.getContext("2d");
  // intro only: the zoomed scene is drawn here, faded at the board's right edge, then composited
  const sceneCv = document.createElement("canvas");
  const sceneCtx = sceneCv.getContext("2d");

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const easeInOut = (t) => (T ? T.easeInOutCubic(t) : t);

  const cardEls = Array.from(document.querySelectorAll("#project-list .project"));
  const projectDefs = cardEls.map((el, i) => ({
    id: el.id,
    label: (el.getAttribute("data-short") || el.id || "P" + i).toUpperCase()
  }));

  // Frames: (u, v) is "u out from the package edge, v along the edge".
  function makeFrames(cx, cy, S) {
    return {
      T: (u, v) => ({ x: cx + v, y: cy - S / 2 - u }),
      R: (u, v) => ({ x: cx + S / 2 + u, y: cy + v }),
      B: (u, v) => ({ x: cx - v, y: cy + S / 2 + u }),
      L: (u, v) => ({ x: cx - S / 2 - u, y: cy - v })
    };
  }

  function rectsOverlap(a, b, pad) {
    return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  }

  // One attempt at a pitch. Returns { ok, board }.
  function tryLayout(o) {
    const { W, H, x0, x1, y0, y1, p, mobile } = o;
    const keep = mobile ? null : { x: CHIP_KEEPOUT.x, y: H - CHIP_KEEPOUT.bottom - CHIP_KEEPOUT.h, w: CHIP_KEEPOUT.w, h: CHIP_KEEPOUT.h };
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const font = clamp(p * 1.05, mobile ? 7 : LABEL_MIN_PX, 11);
    const charW = font * 0.62;
    const pinLen = Math.max(6, p * 0.9), pinW = p * 0.5;
    const padLen = Math.max(5, p * 0.7), padW = p * 0.5;
    const tw = Math.max(1.3, p * 0.2);
    const viaR = Math.max(2, p * 0.34);
    const stub0 = Math.max(8, p * 1.4), approach = Math.max(8, p * 1.4), rankStep = 2 * p;
    const pattern = mobile ? SIDE_PATTERN.mobile : SIDE_PATTERN.desktop;
    const sizes = mobile ? BUS_SIZES.mobile : BUS_SIZES.desktop;

    const bySide = { T: [], R: [], B: [], L: [] };
    projectDefs.forEach((d, i) => {
      bySide[pattern[i % pattern.length]].push({ i, id: d.id, label: d.label, size: sizes[i % sizes.length] });
    });
    let maxPins = 6;
    const pinsPer = {};
    SIDES.forEach((s) => {
      pinsPer[s] = bySide[s].reduce((a, m) => a + m.size, 0);
      maxPins = Math.max(maxPins, pinsPer[s]);
    });
    const S = maxPins * p + PKG_MARGIN_PINS * p;
    const frame = makeFrames(cx, cy, S);
    const board = {
      W, H, x0, x1, y0, y1, cx, cy, S, p, font, tw, viaR, mobile,
      pkg: { x: cx - S / 2, y: cy - S / 2, s: S },
      modules: new Array(projectDefs.length), pins: [], pads: [], traces: [], vias: []
    };

    for (const side of SIDES) {
      const list = bySide[side];
      const k = list.length;
      if (!k) continue;
      const n = pinsPer[side];
      const horiz = side === "T" || side === "B";
      list.forEach((m) => {
        const lw = m.label.length * charW;
        m.ts = horiz ? Math.max(m.size * p + 2 * p, lw + 16) : Math.max(m.size * p + 1.4 * p, font * 2.4);
        m.nd = horiz ? Math.max(3.6 * p, font * 2.8) : lw + 16;
      });
      let off = 0;
      list.forEach((m) => { m.off = off; m.pvc = (off + (m.size - 1) / 2 - (n - 1) / 2) * p; off += m.size; });

      const gapM = horiz ? Math.max(12, p * 1.6) : Math.max(4, p * 0.9);
      let Dmin = 0;
      for (let j = 0; j < k - 1; j++) {
        const need = (list[j].ts + list[j + 1].ts) / 2 + gapM;
        Dmin = Math.max(Dmin, need - (list[j + 1].pvc - list[j].pvc));
      }
      const maxND = Math.max(...list.map((m) => m.nd));
      const maxTS = Math.max(...list.map((m) => m.ts));
      let Ud;
      if (side === "T") Ud = (cy - S / 2) - (y0 + EDGE_PX + maxND);
      else if (side === "B") Ud = (y1 - EDGE_PX - maxND) - (cy + S / 2);
      else if (side === "L") Ud = (cx - S / 2) - (x0 + EDGE_PX + maxND);
      else Ud = (x1 - EDGE_PX - maxND) - (cx + S / 2);

      const half = (k - 1) / 2;
      let D = Dmin;
      if (horiz && k >= 2 && !(keep && side === "B")) {
        const hs = Math.min(cx - x0, x1 - cx) - EDGE_PX - maxTS / 2;
        D = Math.max(Dmin, (0.8 * hs - list[k - 1].pvc) / half);
      }
      // ranks: buses turning the same way fan out from the outside in
      // bottom row on desktop: slide it right until its leftmost module clears the chip keep-out
      const keepR = keep && side === "B" ? keep.x + keep.w + 10 : null;
      const symDv = (j, d) => (k === 1 ? 0 : (j - half) * d);
      const shiftOf = (d) => {
        if (keepR == null) return 0;
        let left = Infinity;
        list.forEach((m, j) => { left = Math.min(left, cx - (m.pvc + symDv(j, d)) - m.ts / 2); });
        return Math.max(0, keepR - left);
      };
      const dvOf = (j, d) => symDv(j, d) - shiftOf(d);
      const stubs = (d) => list.map((m, j) => {
        const dv = dvOf(j, d);
        let rank = 0;
        if (dv < -0.5) { for (let i2 = 0; i2 < j; i2++) if (dvOf(i2, d) < -0.5) rank++; }
        else if (dv > 0.5) { for (let i2 = j + 1; i2 < k; i2++) if (dvOf(i2, d) > 0.5) rank++; }
        return stub0 + rank * rankStep;
      });
      const need = (d) => {
        const st = stubs(d);
        let r = 0;
        list.forEach((m, j) => { r = Math.max(r, pinLen + st[j] + Math.abs(dvOf(j, d)) + approach); });
        return r;
      };
      // shrink the fan-out until every bus fits in the space to its module row
      let guard = 0;
      while (need(D) > Ud - 4 && D > Dmin && guard++ < 200) D = Math.max(Dmin, D - Math.max(2, p * 0.5));
      if (need(D) > Ud - 4) return { ok: false };
      const stubList = stubs(D);

      list.forEach((m, j) => {
        const dv = dvOf(j, D);
        const mv = m.pvc + dv;
        const stub = stubList[j];
        const c = frame[side](Ud + m.nd / 2, mv);
        const rect = horiz ? { x: c.x - m.ts / 2, y: c.y - m.nd / 2, w: m.ts, h: m.nd } : { x: c.x - m.nd / 2, y: c.y - m.ts / 2, w: m.nd, h: m.ts };
        if (!horiz && Math.abs(mv) + m.ts / 2 > S / 2 - 1) return void (board.bad = true);
        if (rect.x < x0 + EDGE_PX - 0.01 || rect.x + rect.w > x1 - EDGE_PX + 0.01 || rect.y < y0 + EDGE_PX - 0.01 || rect.y + rect.h > y1 - EDGE_PX + 0.01) board.bad = true;
        const mod = { i: m.i, id: m.id, label: m.label, side, x: rect.x, y: rect.y, w: rect.w, h: rect.h, bus: [], ref: "U" + (m.i + 2), mv, dv };
        for (let kk = 0; kk < m.size; kk++) {
          const q = m.off + kk;
          const pv = (q - (n - 1) / 2) * p;
          const pd = mv + (kk - (m.size - 1) / 2) * p;
          const uv = [[pinLen - 0.5, pv], [pinLen + stub, pv]];
          const layers = ["t"];
          if (Math.abs(dv) > 0.5) { uv.push([pinLen + stub + Math.abs(dv), pd]); layers.push("i", "i"); } else layers.push("i");
          uv.push([Ud - approach, pd], [Ud, pd]);
          layers.push("t");
          const pts = uv.map((a) => frame[side](a[0], a[1]));
          const len = [0];
          for (let z = 1; z < pts.length; z++) len.push(len[z - 1] + Math.hypot(pts[z].x - pts[z - 1].x, pts[z].y - pts[z - 1].y));
          const pinC = frame[side](pinLen / 2, pv), padC = frame[side](Ud, pd);
          const pinRect = horiz ? { x: pinC.x - pinW / 2, y: pinC.y - pinLen / 2, w: pinW, h: pinLen } : { x: pinC.x - pinLen / 2, y: pinC.y - pinW / 2, w: pinLen, h: pinW };
          const padRect = horiz ? { x: padC.x - padW / 2, y: padC.y - padLen / 2, w: padW, h: padLen } : { x: padC.x - padLen / 2, y: padC.y - padW / 2, w: padLen, h: padW };
          const pinIdx = board.pins.push(Object.assign({ side, q }, pinRect)) - 1;
          const padIdx = board.pads.push(Object.assign({ module: m.id }, padRect)) - 1;
          const tr = { module: m.id, mod: m.i, pin: pinIdx, pad: padIdx, pts, layers, len, total: len[len.length - 1] };
          tr.vz = [];
          for (let z = 1; z < layers.length; z++) if (layers[z] !== layers[z - 1]) { board.vias.push({ x: pts[z].x, y: pts[z].y, r: viaR }); tr.vz.push(z); }
          mod.bus.push(board.traces.push(tr) - 1);
        }
        board.modules[m.i] = mod;
      });
    }
    if (board.bad) return { ok: false };
    const mods = board.modules.filter(Boolean);
    for (let a = 0; a < mods.length; a++) for (let b = a + 1; b < mods.length; b++) if (rectsOverlap(mods[a], mods[b], 4)) return { ok: false };
    if (keep && mods.some((m) => rectsOverlap(m, keep, 6))) return { ok: false };
    board.modules = mods;
    return { ok: true, board };
  }

  function computeLayout(W, regionRight, H, barH) {
    const mobile = W < MOBILE_MAX_W;
    const x0 = 0, x1 = regionRight, y0 = barH, y1 = H;
    const base = clamp(Math.min(x1 - x0, y1 - y0) / 85, BUS_PITCH_MIN, BUS_PITCH_MAX);
    let last = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      const p = base * Math.pow(0.93, attempt);
      const res = tryLayout({ W, H, x0, x1, y0, y1, p, mobile });
      if (res.ok) return res.board;
      last = p;
    }
    // give up gracefully: an empty board (the cards still work)
    return { W, H, x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, S: 0, p: last, font: 8, tw: 1.3, viaR: 2, mobile, pkg: { x: 0, y: 0, s: 0 }, modules: [], pins: [], pads: [], traces: [], vias: [] };
  }

  // ============================================================
  // 4. BOARD: STATIC LAYER (once per resize)
  // ============================================================

  let board = null;
  let dpr = 1, cssW = 0, cssH = 0;
  let dieCells = [];   // { x, y, w, h, core, rank }
  let dieRect = null;

  function chamfer(c, x, y, w, h, k) {
    c.beginPath();
    c.moveTo(x + k, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.lineTo(x, y + k); c.closePath();
  }

  function buildDie(B) {
    const S = B.S;
    const win = { x: B.pkg.x + S * 0.13, y: B.pkg.y + S * 0.13, s: S * 0.74 };
    const dieS = win.s * 0.9;
    const die = { x: win.x + (win.s - dieS) / 2, y: win.y + (win.s - dieS) / 2, s: dieS };
    const N = 9;
    const area = dieS * 0.76;
    const ax = die.x + (dieS - area) / 2, ay = die.y + (dieS - area) / 2;
    const cell = area / N;
    const cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const dr = r - 4, dc = c - 4;
        cells.push({
          x: ax + c * cell, y: ay + r * cell, w: cell, h: cell,
          core: Math.max(Math.abs(dr), Math.abs(dc)) <= 1,
          centre: dr === 0 && dc === 0,
          d: Math.hypot(dr, dc), a: Math.atan2(dr, dc)
        });
      }
    }
    // lighting order: outward from the centre
    const order = cells.map((_, i) => i).sort((a, b) => cells[a].d - cells[b].d || cells[a].a - cells[b].a);
    order.forEach((idx, rank) => { cells[idx].rank = rank / (cells.length - 1); });
    dieCells = cells;
    dieRect = { win, die, ax, ay, area, cell };
  }

  function drawMask(c, B) {
    const g = c.createRadialGradient(B.cx, B.cy, 0, B.cx, B.cy, Math.max(cssW, cssH) * 0.75);
    g.addColorStop(0, "#0a1614");
    g.addColorStop(1, MASK_EDGE);
    c.fillStyle = MASK;
    c.fillRect(0, 0, cssW, cssH);
    c.fillStyle = g;
    c.fillRect(0, 0, cssW, cssH);
  }

  // board outline + mounting holes (silkscreen)
  function drawBoardMarks(c, B) {
    const bo = 8;
    c.strokeStyle = SILK; c.lineWidth = 1; c.setLineDash([6, 4]);
    c.strokeRect(B.x0 + bo, B.y0 + bo, B.x1 - B.x0 - 2 * bo, B.y1 - B.y0 - 2 * bo);
    c.setLineDash([]);
    [[B.x0 + bo + 12, B.y0 + bo + 12], [B.x1 - bo - 12, B.y0 + bo + 12], [B.x0 + bo + 12, B.y1 - bo - 12], [B.x1 - bo - 12, B.y1 - bo - 12]].forEach((h) => {
      c.beginPath(); c.arc(h[0], h[1], 4, 0, Math.PI * 2); c.fillStyle = "#03070a"; c.fill();
      c.beginPath(); c.arc(h[0], h[1], 7, 0, Math.PI * 2); c.strokeStyle = SILK; c.stroke();
    });
  }

  // copper of one trace from its pin up to upto px along it (top layer bright, inner layer muted)
  function strokeCopper(c, B, tr, upto) {
    c.lineJoin = "miter"; c.miterLimit = 4; c.lineCap = "butt";
    c.lineWidth = B.tw;
    let z = 0;
    while (z < tr.layers.length) {
      let e = z;
      while (e + 1 < tr.layers.length && tr.layers[e + 1] === tr.layers[z]) e++;
      if (upto <= tr.len[z]) break;
      c.strokeStyle = tr.layers[z] === "t" ? COPPER_TOP : COPPER_INNER;
      c.beginPath();
      c.moveTo(tr.pts[z].x, tr.pts[z].y);
      for (let q = z + 1; q <= e + 1; q++) {
        if (tr.len[q] <= upto) c.lineTo(tr.pts[q].x, tr.pts[q].y);
        else {
          const f = (upto - tr.len[q - 1]) / (tr.len[q] - tr.len[q - 1]);
          c.lineTo(tr.pts[q - 1].x + (tr.pts[q].x - tr.pts[q - 1].x) * f, tr.pts[q - 1].y + (tr.pts[q].y - tr.pts[q - 1].y) * f);
          break;
        }
      }
      c.stroke();
      z = e + 1;
    }
  }

  function drawVia(c, v, k) {
    const r = v.r * k;
    c.beginPath(); c.arc(v.x, v.y, r, 0, Math.PI * 2); c.fillStyle = "rgba(214, 156, 96, 0.95)"; c.fill();
    c.beginPath(); c.arc(v.x, v.y, r * 0.45, 0, Math.PI * 2); c.fillStyle = "#040908"; c.fill();
  }

  function drawModuleBody(c, B, m) {
    chamfer(c, m.x, m.y, m.w, m.h, Math.min(6, m.h * 0.2));
    c.fillStyle = "#0c1412"; c.fill();
    c.strokeStyle = "rgba(120, 146, 154, 0.38)"; c.lineWidth = 1; c.stroke();
    c.font = "600 " + B.font + "px 'IBM Plex Mono', Consolas, monospace";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "rgba(186, 204, 212, 0.46)";
    c.fillText(m.label, m.x + m.w / 2, m.y + m.h / 2);
    if (B.p >= 8) {
      c.font = "500 7px 'IBM Plex Mono', Consolas, monospace";
      c.textAlign = "left"; c.textBaseline = "top";
      c.fillStyle = SILK_TEXT;
      c.fillText(m.ref, m.x + 4, m.y + 3);
    }
  }

  function drawPins(c, B) {
    c.fillStyle = PIN_FILL;
    for (const d of B.pins) c.fillRect(d.x, d.y, d.w, d.h);
  }

  // package body, lid window, die, die cells, marking
  function drawPackage(c, B) {
    const P = B.pkg;
    c.beginPath(); c.roundRect(P.x, P.y, P.s, P.s, P.s * 0.04);
    c.fillStyle = PKG_BODY; c.fill(); c.strokeStyle = PKG_EDGE; c.lineWidth = 1.2; c.stroke();
    c.beginPath(); c.arc(P.x + P.s * 0.07, P.y + P.s * 0.07, Math.max(1.5, P.s * 0.012), 0, Math.PI * 2);
    c.fillStyle = "rgba(196, 212, 224, 0.5)"; c.fill();   // pin-1 dot
    const R = dieRect;
    c.fillStyle = "#070c0d"; c.strokeStyle = "rgba(150, 190, 200, 0.3)"; c.lineWidth = 1;
    c.beginPath(); c.roundRect(R.win.x, R.win.y, R.win.s, R.win.s, 3); c.fill(); c.stroke();
    c.fillStyle = "#0a1315"; c.fillRect(R.die.x, R.die.y, R.die.s, R.die.s);
    c.strokeStyle = DIE_LINE; c.strokeRect(R.die.x + 0.5, R.die.y + 0.5, R.die.s - 1, R.die.s - 1);
    // I/O ring: pad ticks around the die edge
    const ring = R.die.s * 0.04;
    c.strokeRect(R.die.x + ring, R.die.y + ring, R.die.s - 2 * ring, R.die.s - 2 * ring);
    c.fillStyle = "rgba(126, 190, 205, 0.16)";
    const ticks = 24;
    for (let t = 0; t < ticks; t++) {
      const f = (t + 0.5) / ticks, tk = Math.max(1, ring * 0.45);
      c.fillRect(R.die.x + f * R.die.s, R.die.y + 1, tk, ring * 0.6);
      c.fillRect(R.die.x + f * R.die.s, R.die.y + R.die.s - ring * 0.6 - 1, tk, ring * 0.6);
      c.fillRect(R.die.x + 1, R.die.y + f * R.die.s, ring * 0.6, tk);
      c.fillRect(R.die.x + R.die.s - ring * 0.6 - 1, R.die.y + f * R.die.s, ring * 0.6, tk);
    }
    // cores + cache banks
    c.strokeStyle = DIE_LINE; c.lineWidth = 0.6;
    const ga = c.globalAlpha;
    for (const k of dieCells) {
      const gap = 0.9;
      if (k.core) c.strokeRect(k.x + gap, k.y + gap, k.w - 2 * gap, k.h - 2 * gap);
      else {
        c.strokeRect(k.x + gap, k.y + gap, k.w - 2 * gap, k.h - 2 * gap);
        c.beginPath();
        for (let ly = k.y + k.h / 4; ly < k.y + k.h - 1; ly += k.h / 4) { c.moveTo(k.x + gap, ly); c.lineTo(k.x + k.w - gap, ly); }
        c.globalAlpha = ga * 0.5; c.stroke(); c.globalAlpha = ga;
      }
    }
    // marking
    if (P.s > 170) {
      c.font = "600 " + Math.max(7, P.s * 0.034) + "px 'IBM Plex Mono', Consolas, monospace";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = SILK_TEXT;
      c.fillText("BELLATRIX  U1", P.x + P.s / 2, P.y + P.s - P.s * 0.065);
    }
  }

  function drawStatic(c, B) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);
    drawMask(c, B);
    if (!B.S) return;
    drawBoardMarks(c, B);
    for (const tr of B.traces) strokeCopper(c, B, tr, Infinity);
    for (const v of B.vias) drawVia(c, v, 1);
    c.fillStyle = PAD_FILL;
    for (const d of B.pads) c.fillRect(d.x, d.y, d.w, d.h);
    drawPins(c, B);
    for (const m of B.modules) drawModuleBody(c, B, m);
    drawPackage(c, B);
  }

  // ============================================================
  // 5. BOARD: BUILD (layout + static layer + derived data)
  // ============================================================

  let modById = {};
  let order = [];            // module indices, nearest to the core first
  let introMeta = null;      // per-module launch times for the running intro
  const headerEl = document.querySelector("header.site-bar") || document.querySelector("header");
  const mainEl = document.querySelector("main");

  function measureRegion() {
    const W = document.documentElement.clientWidth || window.innerWidth;
    const H = window.innerHeight;
    const barH = headerEl ? Math.round(headerEl.getBoundingClientRect().height) : 56;
    let right = W;
    if (W >= MOBILE_MAX_W && mainEl) right = Math.max(W * 0.4, Math.round(mainEl.getBoundingClientRect().left) - 32);
    return { W, H, right, barH };
  }

  function buildBoard() {
    const r = measureRegion();
    const prev = board;
    board = computeLayout(r.W, r.right, r.H, r.barH);
    board.staticBuilds = (prev && prev.staticBuilds || 0) + 1;
    board.frames = prev ? prev.frames : 0;
    board.introDone = prev ? prev.introDone : false;
    board.introMs = prev ? prev.introMs : 0;
    board.mode = prev ? prev.mode : null;
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    cssW = window.innerWidth; cssH = window.innerHeight;
    for (const cv of [canvas, staticCv, sceneCv]) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); }
    canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
    buildDie(board);
    drawStatic(sctx, board);
    modById = {};
    board.modules.forEach((m) => {
      modById[m.id] = m;
      m.hoverG = prev && prev.byId && prev.byId[m.id] ? prev.byId[m.id].hoverG : 0;
      m.hover = prev && prev.byId && prev.byId[m.id] ? prev.byId[m.id].hover : false;
      m.flash = 0;
      m.lastBurst = -1e9;
      m.dist = Math.hypot(m.x + m.w / 2 - board.cx, m.y + m.h / 2 - board.cy);
    });
    board.byId = modById;
    order = board.modules.map((_, i) => i).sort((a, b) => board.modules[a].dist - board.modules[b].dist);
    board.modules.forEach((m) => { m.rank = order.indexOf(board.modules.indexOf(m)); });
    board.speedPx = board.p * 26;   // px/s, constant for every packet
    window.__board = board;
  }

  function getAnimMult() {
    let m = 1.0;
    if (engineeringMode) m *= 1.3;
    if (isPipelineActive) m *= 1.4;
    m *= 1 + 0.35 * Math.min(coreOverdrive, 6);
    m *= clockSpeed;
    return halted ? 0 : m;
  }

  // ============================================================
  // 6. BOARD: DYNAMIC LAYER (per frame: packets, glow, core pulse)
  // ============================================================

  const state = {
    packets: [],
    queue: [],
    spawnAcc: 0,
    pulse: 0,
    corePulseBump: 0,
    dirty: true
  };
  const rand = Math.random;

  function pointAt(tr, s) {
    const L = tr.len;
    s = clamp(s, 0, tr.total);
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const seg = L[i] - L[i - 1] || 1;
    const f = (s - L[i - 1]) / seg;
    return { x: tr.pts[i - 1].x + (tr.pts[i].x - tr.pts[i - 1].x) * f, y: tr.pts[i - 1].y + (tr.pts[i].y - tr.pts[i - 1].y) * f, i };
  }

  function strokeTraceRange(tr, s0, s1) {
    const a = pointAt(tr, s0), b = pointAt(tr, s1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (let z = a.i; z < b.i; z++) ctx.lineTo(tr.pts[z].x, tr.pts[z].y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // s = distance travelled from the start of the run (dir +1: pin -> pad, -1: pad -> pin)
  function drawPacket(tr, s, dir) {
    const Lp = Math.max(10, board.p * 1.6);
    let a, b;
    if (dir > 0) { a = s - Lp; b = s; } else { a = tr.total - s; b = a + Lp; }
    if (b <= 0 || a >= tr.total) return;
    const s0 = Math.max(0, a), s1 = Math.min(tr.total, b);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = board.tw * 3.4; ctx.strokeStyle = "rgba(90, 210, 255, 0.22)";
    strokeTraceRange(tr, s0, s1);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = board.tw * 1.3; ctx.strokeStyle = "rgba(226, 252, 255, 0.95)";
    strokeTraceRange(tr, s0, s1);
  }

  function spawn(traceIdx, dir, delay) {
    if (state.packets.length >= MAX_PACKETS) return;
    const tr = board.traces[traceIdx];
    state.packets.push({ tr, dir, s: -(delay || 0) * board.speedPx, hit: false });
  }

  function burst(mod, now) {
    if (reducedMotion || !mod || !board.modules.length) return;
    mod.lastBurst = now;
    mod.bus.forEach((ti, kk) => state.queue.push({ at: now + kk * BURST_STAGGER_MS, ti, dir: 1 }));
  }

  function setHover(mod, on) {
    if (!mod) return;
    mod.hover = on;
    state.dirty = true;
    if (on) burst(mod, performance.now());
    if (reducedMotion) { mod.hoverG = on ? 1 : 0; drawNow(); }
  }

  function moduleGlow(m, introG) {
    return Math.max(introG || 0, m.hoverG * 0.95, m.flash);
  }

  // drawn(kk) -> px of trace kk that exist so far (intro); omitted = whole bus
  function drawModuleGlow(m, g, drawn) {
    if (g < 0.01) return;
    // bus: copper lit up
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "miter"; ctx.miterLimit = 4;
    ctx.lineWidth = board.tw * 1.5;
    ctx.strokeStyle = "rgba(255, 176, 96, " + (0.42 * g).toFixed(3) + ")";
    m.bus.forEach((ti, kk) => {
      const tr = board.traces[ti];
      const upto = drawn ? Math.min(tr.total, drawn(kk)) : tr.total;
      if (upto > 0) strokeTraceRange(tr, 0, upto);
    });
    ctx.globalCompositeOperation = "source-over";
    // module body
    chamfer(ctx, m.x, m.y, m.w, m.h, Math.min(6, m.h * 0.2));
    ctx.fillStyle = "rgba(60, 170, 210, " + (0.10 * g).toFixed(3) + ")"; ctx.fill();
    ctx.strokeStyle = "rgba(130, 225, 255, " + (0.2 + 0.6 * g).toFixed(3) + ")"; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = "600 " + board.font + "px 'IBM Plex Mono', Consolas, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(225, 248, 255, " + (0.25 + 0.7 * g).toFixed(3) + ")";
    ctx.fillText(m.label, m.x + m.w / 2, m.y + m.h / 2);
    // status LED
    ctx.beginPath(); ctx.arc(m.x + m.w - 5, m.y + 5, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(60, 235, 150, " + (0.35 + 0.65 * g).toFixed(3) + ")"; ctx.fill();
  }

  // cellA: function(cell) -> alpha; batches nothing, used during the intro
  function drawDie(cellAlpha, coreGlow, bump) {
    const R = dieRect;
    if (typeof cellAlpha === "function") {
      for (const k of dieCells) {
        const a = cellAlpha(k);
        if (a < 0.005) continue;
        ctx.fillStyle = k.core ? "rgba(90, 215, 255, " + a.toFixed(3) + ")" : "rgba(255, 178, 96, " + (a * 0.7).toFixed(3) + ")";
        ctx.fillRect(k.x + 1, k.y + 1, k.w - 2, k.h - 2);
      }
    } else {
      // idle: two batched fills
      ctx.fillStyle = "rgba(90, 215, 255, " + cellAlpha.toFixed(3) + ")";
      ctx.beginPath();
      for (const k of dieCells) if (k.core) ctx.rect(k.x + 1, k.y + 1, k.w - 2, k.h - 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 178, 96, " + (cellAlpha * 0.7).toFixed(3) + ")";
      ctx.beginPath();
      for (const k of dieCells) if (!k.core) ctx.rect(k.x + 1, k.y + 1, k.w - 2, k.h - 2);
      ctx.fill();
    }
    // core: the centre cell breathes
    const cxm = board.cx, cym = board.cy, rr = R.cell * 3.2;
    const a = clamp(coreGlow * 0.5 + bump * 0.45, 0, 1);
    if (a > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(cxm, cym, 0, cxm, cym, rr);
      g.addColorStop(0, "rgba(190, 245, 255, " + (0.75 * a).toFixed(3) + ")");
      g.addColorStop(0.45, "rgba(70, 200, 255, " + (0.28 * a).toFixed(3) + ")");
      g.addColorStop(1, "rgba(70, 200, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(cxm - rr, cym - rr, rr * 2, rr * 2);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ---- intro frame: redrawn from geometry under the camera ----
  const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

  function camScale(t, cfg) {
    const k = easeInOut(clamp((t - cfg.zoom[0]) / (cfg.zoom[1] - cfg.zoom[0]), 0, 1));
    return INTRO_ZOOM + (1 - INTRO_ZOOM) * k;
  }

  // px of trace kk of module m drawn at time t
  function drawnPx(m, kk, t) {
    const meta = introMeta[m.i];
    return clamp((t - meta.start - kk * TRACE_STAGGER_MS) * meta.speed / 1000, 0, board.traces[m.bus[kk]].total);
  }

  function renderIntro(t, cfg) {
    const B = board, s = camScale(t, cfg), mods = B.modules;
    mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMask(mainCtx, B);
    ctx = sceneCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * B.cx * (1 - s), dpr * B.cy * (1 - s));
    drawBoardMarks(ctx, B);
    // 1. copper laying down, bus by bus
    let drawnSum = 0, totalSum = 0;
    for (const m of mods) {
      m.bus.forEach((ti, kk) => {
        const tr = B.traces[ti], d = drawnPx(m, kk, t);
        drawnSum += d; totalSum += tr.total;
        if (d > 0) strokeCopper(ctx, B, tr, d);
      });
    }
    // 2. vias pop in as the copper reaches them; pads once their trace has landed
    for (const m of mods) {
      const meta = introMeta[m.i];
      m.bus.forEach((ti, kk) => {
        const tr = B.traces[ti], d = drawnPx(m, kk, t);
        for (const z of tr.vz) {
          if (d < tr.len[z]) continue;
          const reach = meta.start + kk * TRACE_STAGGER_MS + tr.len[z] / meta.speed * 1000;
          const via = B.vias.find((v) => Math.abs(v.x - tr.pts[z].x) < 1e-3 && Math.abs(v.y - tr.pts[z].y) < 1e-3);
          if (via) drawVia(ctx, via, clamp(easeOutBack(clamp((t - reach) / VIA_POP_MS, 0, 1)), 0, 1.25));
        }
        if (d >= tr.total) { ctx.fillStyle = PAD_FILL; const pd = B.pads[tr.pad]; ctx.fillRect(pd.x, pd.y, pd.w, pd.h); }
      });
    }
    // 3. modules light as their bus arrives (body + silkscreen label), the package fades up from the dark
    for (const m of mods) {
      const a = clamp((t - introMeta[m.i].arrive) / MODULE_RISE_MS, 0, 1);
      if (a <= 0) continue;
      ctx.globalAlpha = a; drawModuleBody(ctx, B, m); ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = smooth(t / Math.max(1, cfg.core[0]));
    drawPins(ctx, B);
    drawPackage(ctx, B);
    ctx.globalAlpha = 1;
    // 4. die + core power on
    const c0 = cfg.core[0], c1 = cfg.core[1];
    const coreOn = smooth((t - c0) / (c1 - c0));
    const bump = t >= c0 ? clamp(1 - (t - c0) / CORE_BUMP_MS, 0, 1) : 0;
    drawDie((k) => {
      const start = cfg.cells[0] + k.rank * (cfg.cells[1] - cfg.cells[0]);
      const d = t - start;
      if (d < 0) return 0;
      if (d < CELL_RISE_MS) return PEAK_CELL_ALPHA * d / CELL_RISE_MS;
      return IDLE_CELL_ALPHA + (PEAK_CELL_ALPHA - IDLE_CELL_ALPHA) * (1 - clamp((d - CELL_RISE_MS) / CELL_DECAY_MS, 0, 1));
    }, coreOn * (0.5 + 0.5 * pulseValue()), bump);
    // 5. module flash, and a bright head at the front of every trace still being drawn
    const Lp = Math.max(10, B.p * 1.6);
    for (const m of mods) {
      const d = t - introMeta[m.i].arrive;
      let g = 0;
      if (d >= 0) g = d < MODULE_RISE_MS ? d / MODULE_RISE_MS : 1 - clamp((d - MODULE_RISE_MS) / MODULE_DECAY_MS, 0, 1);
      drawModuleGlow(m, g, (kk) => drawnPx(m, kk, t));
    }
    for (const m of mods) {
      m.bus.forEach((ti, kk) => {
        const tr = B.traces[ti], d = drawnPx(m, kk, t);
        if (d > 0 && d < tr.total + Lp) drawPacket(tr, d, 1);
      });
    }
    // the zoomed package would spill under the card column: fade the scene out at the board's right edge
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fw = INTRO_EDGE_FADE_PX * (s - 1) / (INTRO_ZOOM - 1);
    if (B.x1 < cssW - 1 && fw >= 1) {
      const g = ctx.createLinearGradient(B.x1 - fw, 0, B.x1, 0);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = g; ctx.fillRect(B.x1 - fw, 0, cssW - (B.x1 - fw), cssH);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx = mainCtx;
    ctx.drawImage(sceneCv, 0, 0, cssW, cssH);
    B.introState = { t, scale: s, share: totalSum ? drawnSum / totalSum : 1 };
  }

  function baseLayer() { ctx.drawImage(staticCv, 0, 0, cssW, cssH); }

  // ---- one full frame ----
  // intro: null (idle) or { t, cfg }
  function renderScene(now, intro) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    board.frames++;
    if (!board.S) return;
    if (intro) { renderIntro(intro.t, intro.cfg); return; }
    baseLayer();
    const mods = board.modules;

    // idle
    const shimmer = QA.static || reducedMotion ? 0 : 1;
    drawDie(IDLE_CELL_ALPHA, 0.5 + 0.5 * pulseValue() + Math.min(coreOverdrive, 6) * 0.08, state.corePulseBump);
    if (shimmer) {
      // a few die cells flicker
      for (let n = 0; n < 5; n++) {
        const k = dieCells[(Math.floor(now / 900) * 7 + n * 17) % dieCells.length];
        const a = 0.14 * (0.5 + 0.5 * Math.sin(now * 0.004 + n * 1.9));
        ctx.fillStyle = k.core ? "rgba(90, 215, 255, " + a.toFixed(3) + ")" : "rgba(255, 178, 96, " + a.toFixed(3) + ")";
        ctx.fillRect(k.x + 1, k.y + 1, k.w - 2, k.h - 2);
      }
    }
    for (const m of mods) drawModuleGlow(m, moduleGlow(m, 0));
    for (const pk of state.packets) if (pk.s > 0) drawPacket(pk.tr, pk.s, pk.dir);
  }

  function pulseValue() { return 0.5 + 0.5 * Math.sin(state.pulse); }

  // idle update: dt in seconds
  function stepIdle(now, dt) {
    const mult = getAnimMult();
    board.modules.forEach((m) => {
      const target = m.hover ? 1 : 0;
      m.hoverG += (target - m.hoverG) * Math.min(1, dt * HOVER_EASE_PER_S);
      if (Math.abs(target - m.hoverG) < 0.004) m.hoverG = target;
      m.flash = Math.max(0, m.flash - dt * FLASH_DECAY_PER_S);
      if (m.hover && now - m.lastBurst > BURST_REPEAT_MS) burst(m, now);
    });
    state.corePulseBump = Math.max(0, state.corePulseBump - dt * 2.2);
    if (QA.static) { state.packets.length = 0; state.queue.length = 0; return; }
    if (mult <= 0) return;
    state.pulse += dt * 1.6 * Math.max(mult, 0.4);
    coreOverdrive = Math.max(0, coreOverdrive - 0.12 * dt);
    // queued burst packets
    for (let i = state.queue.length - 1; i >= 0; i--) {
      if (state.queue[i].at <= now) { spawn(state.queue[i].ti, state.queue[i].dir, 0); state.queue.splice(i, 1); }
    }
    // ambient traffic
    state.spawnAcc += dt * AMBIENT_PACKETS_PER_S * mult;
    while (state.spawnAcc >= 1 && board.traces.length) {
      state.spawnAcc -= 1;
      spawn(Math.floor(rand() * board.traces.length), rand() < 0.7 ? 1 : -1, 0);
    }
    if (coreOverdrive > 0.8 && board.modules.length && rand() < dt * 0.6 * coreOverdrive) {
      burst(board.modules[Math.floor(rand() * board.modules.length)], now);
    }
    // advance
    const v = board.speedPx * mult;
    for (let i = state.packets.length - 1; i >= 0; i--) {
      const pk = state.packets[i];
      pk.s += v * dt;
      if (!pk.hit && pk.s >= pk.tr.total) {
        pk.hit = true;
        if (pk.dir > 0) { const m = board.modules.find((q) => q.i === pk.tr.mod); if (m) m.flash = 1; }
        else state.corePulseBump = Math.min(1, state.corePulseBump + 0.35);
      }
      if (pk.s >= pk.tr.total + 14) state.packets.splice(i, 1);
    }
  }

  // ---- idle loop: <= IDLE_FPS, paused while the tab is hidden ----
  let raf = 0, lastDraw = -1e9, lastStep = 0;
  const FRAME_MS = 1000 / IDLE_FPS;

  function loop(now) {
    raf = 0;
    if (document.hidden || reducedMotion || !board.introDone) return;
    if (now - lastDraw >= FRAME_MS - 2) {
      const dt = lastStep ? Math.min((now - lastStep) / 1000, 0.1) : 0;
      lastStep = now; lastDraw = now;
      const idleNow = halted && !state.dirty && !state.packets.length && !state.queue.length && !board.modules.some((m) => m.flash > 0 || m.hoverG !== (m.hover ? 1 : 0));
      if (!idleNow) {
        stepIdle(now, dt);
        renderScene(now, null);
        state.dirty = false;
      }
    }
    raf = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (raf || reducedMotion || document.hidden) return;
    lastStep = 0;
    raf = requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; }
    else if (board.introDone) startLoop();
  });

  // draw one idle frame now (reduced motion, resize while paused)
  function drawNow() {
    if (!board || !board.introDone) return;
    renderScene(performance.now(), null);
  }

  // ============================================================
  // 7. INTRO
  // ============================================================

  const ARRIVAL_VARS = ["--arrival-r", "--arrival-x", "--arrival-y", "--arrival-op"];
  let introHandle = null, introOff = null, introCfg = null, introLast = 0;

  function buildIntroMeta(cfg) {
    const maxLen = Math.max(1, ...board.traces.map((t) => t.total));
    const speed = maxLen / (cfg.draw.travel / 1000);   // px/s, one drawing speed for every trace
    const Lp = Math.max(10, board.p * 1.6);
    introMeta = {};
    board.modules.forEach((m) => {
      const start = cfg.draw.start + m.rank * cfg.draw.stagger;
      let arrive = Infinity, end = 0;
      m.bus.forEach((ti, kk) => {
        const tr = board.traces[ti];
        arrive = Math.min(arrive, start + kk * TRACE_STAGGER_MS + tr.total / speed * 1000);
        end = Math.max(end, start + kk * TRACE_STAGGER_MS + (tr.total + Lp) / speed * 1000 + VIA_POP_MS);
      });
      introMeta[m.i] = { start, speed, arrive, settled: Math.max(end, arrive + MODULE_RISE_MS + MODULE_DECAY_MS) };
    });
    board.introMeta = introMeta;
  }

  function applyIntroFrame(t, cfg, arrival) {
    if (arrival) {
      const c = clamp(t / cfg.collapse, 0, 1);
      const r0 = Math.hypot(board.W, board.H);
      root.style.setProperty("--arrival-r", (r0 * (1 - easeInOut(c))).toFixed(1) + "px");
      root.style.setProperty("--arrival-op", c >= 1 ? "0" : "1");
    }
    cardEls.forEach((el) => {
      const m = modById[el.id];
      const meta = m && introMeta[m.i];
      const o = meta ? smooth((t - meta.arrive + CARD_LEAD_MS) / CARD_FADE_MS) : 1;
      el.style.opacity = o >= 1 ? "1" : o.toFixed(3);
    });
    if (board.S) renderScene(0, { t, cfg });
  }

  function finishIntro() {
    if (introOff) { introOff(); introOff = null; }
    introHandle = null;
    root.classList.remove("arriving", "pj-cover");
    ARRIVAL_VARS.forEach((k) => root.style.removeProperty(k));
    cardEls.forEach((el) => el.style.removeProperty("opacity"));
    canvas.classList.add("board-dim"); // narrow screens: CSS dims the board once the intro is over
    board.introDone = true;
    board.introT1 = performance.now();
    board.introState = null;
    drawNow();
    startLoop();
  }

  // mode: 'arrival' | 'first' | 'skip'; arrival: { star, rgb, ts } or null
  function playIntro(mode, arrival) {
    if (introHandle) { introHandle.cancel(); if (introOff) introOff(); introHandle = null; introOff = null; }
    board.mode = mode;
    board.introMs = 0;
    board.introT0 = performance.now();
    if (mode === "skip" || !T) { board.introDone = false; finishIntro(); return; }
    T.markSeen("projects");
    board.introDone = false;
    if (reducedMotion) {
      // reduced motion never gets the board sequence: at most a short fade of the arrival fill
      renderScene(0, null);
      introHandle = T.run(REDUCED_FADE_MS, (t) => root.style.setProperty("--arrival-op", String(1 - clamp(t / REDUCED_FADE_MS, 0, 1))), finishIntro);
      return;
    }
    const isArrival = mode === "arrival";
    const cfg = isArrival ? INTRO_ARRIVAL : INTRO_FIRST;
    introCfg = cfg;
    board.introMs = cfg.total;
    buildIntroMeta(cfg);
    if (isArrival) {
      root.style.setProperty("--arrival-x", board.cx + "px");
      root.style.setProperty("--arrival-y", board.cy + "px");
      root.style.setProperty("--arrival-r", Math.hypot(board.W, board.H).toFixed(1) + "px");
    }
    applyIntroFrame(0, cfg, isArrival);
    introHandle = T.run(cfg.total, (t) => { introLast = t; applyIntroFrame(t, cfg, isArrival); }, finishIntro);
    introOff = T.wireSkip(() => { if (introHandle) introHandle.finish(); });
  }
  window.playIntro = playIntro;

  // ============================================================
  // 8. WIRING: cards, package click, resize
  // ============================================================

  function cardTitle(el) {
    const h = el.querySelector("h2");
    if (!h) return "Project";
    const c = h.cloneNode(true);
    c.querySelectorAll(".status-chip").forEach((n) => n.remove());
    return c.textContent.trim();
  }

  buildBoard();

  cardEls.forEach((el) => {
    const mod = () => modById[el.id];
    el.addEventListener("mouseenter", () => setHover(mod(), true));
    el.addEventListener("mouseleave", () => setHover(mod(), false));
    el.addEventListener("focusin", () => setHover(mod(), true));
    el.addEventListener("focusout", () => setHover(mod(), false));
    // artifact badges are plain links; JS plays the pipeline, then follows the href
    el.querySelectorAll(".artifact-badge").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startPipelineLoad({ title: a.getAttribute("data-title") || cardTitle(el), url: a.getAttribute("href") });
      });
    });
    // clicking the card itself plays the pipeline (and opens its first artifact, if any)
    el.addEventListener("click", (e) => {
      if (e.target.closest("a, summary, details, button")) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && String(sel).length) return;
      const first = el.querySelector(".artifact-badge");
      burst(mod(), performance.now());
      startPipelineLoad({ title: cardTitle(el), url: first ? first.getAttribute("href") : null });
    });
  });

  // package click = engineering mode / overdrive (the canvas itself ignores the pointer)
  function overPackage(e) {
    if (!board || !board.S) return false;
    const t = e.target;
    if (t && t.closest && t.closest("main, header, footer, button, a, #eng-chip-toggle")) return false;
    const P = board.pkg;
    return e.clientX >= P.x && e.clientX <= P.x + P.s && e.clientY >= P.y && e.clientY <= P.y + P.s;
  }
  document.addEventListener("click", (e) => {
    if (!board.introDone || !overPackage(e)) return;
    if (!engineeringMode) setEngineeringMode(true, true);
    coreOverdrive = Math.min(coreOverdrive + 1.2, 6);
    state.corePulseBump = 1;
    state.dirty = true;
    if (reducedMotion) drawNow();
  });
  document.addEventListener("mousemove", (e) => {
    document.body.style.cursor = board.introDone && overPackage(e) ? "pointer" : "";
  }, { passive: true });

  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      const wasDone = board.introDone;
      buildBoard();
      if (wasDone) { board.introDone = true; drawNow(); }
      else if (introCfg && introHandle) { buildIntroMeta(introCfg); applyIntroFrame(introLast, introCfg, root.classList.contains("arriving")); }
    });
  });
  // web fonts change label metrics: repaint the static layer once they are in
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!board) return;
      drawStatic(sctx, board);
      if (board.introDone) drawNow();
    });
  }

  playIntro(T ? T.getMode("projects") : "skip", window.__arrival || null);
})();
