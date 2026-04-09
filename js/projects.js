document.addEventListener("DOMContentLoaded", () => {
  // ============================================================
  // 1. PROJECT LIST + PIPELINE LOADER
  // ============================================================

  let isPipelineActive = false;
  let pipelineStageIndex = -1;
  let loadingProject = null;
  const pipelineStages = ["FETCH", "DECODE", "EXECUTE", "MEMORY", "WRITEBACK"];
  let pipelineTimeouts = [];

  const projectListEl = document.getElementById("project-list");

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
    fontFamily: "'JetBrains Mono','Fira Mono',monospace",
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

  // Fetch & render projects
  fetch("assets/projects.json")
    .then((res) => res.json())
    .then((projects) => {
      if (!Array.isArray(projects) || !projects.length) {
        projectListEl.innerHTML = "<p>No projects available.</p>";
        return;
      }

      projects.forEach((proj) => {
        const div = document.createElement("div");
        div.className = "project";
        div.innerHTML = `
          <h2>${proj.title}</h2>
          <p>${proj.desc || ""}</p>
          ${
            proj.summary
              ? `<details><summary>Show Summary</summary><div>${proj.summary}</div></details>`
              : ""
          }
        `;
        div.addEventListener("click", (e) => {
          if (e.target.closest("details")) return;
          startPipelineLoad(proj);
        });
        projectListEl.appendChild(div);
      });
    })
    .catch(() => {
      projectListEl.innerHTML = "<p>No projects available.</p>";
    });

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
      <div style="font-size:10px;color:#6b7280;">
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
    fontFamily: "'JetBrains Mono','Fira Mono',monospace",
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
    fontFamily: "'JetBrains Mono','Fira Mono',monospace",
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
    fontFamily: "'JetBrains Mono','Fira Mono',monospace",
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
        font-size:12px;cursor:pointer;">âœ•</button>
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
        font-family:'JetBrains Mono','Fira Mono',monospace;
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
  // 3. CANVAS: CINEMATIC PCB MICROPROCESSOR BACKGROUND
  // ============================================================

  const canvas = document.createElement("canvas");
  canvas.id = "circuit-canvas";
  Object.assign(canvas.style, {
    position: "fixed", top: "0", left: "0",
    width: "100vw", height: "100vh",
    zIndex: "0", pointerEvents: "none"
  });
  document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext("2d");

  let t = 0;
  let cpuCenter = { x: 0, y: 0 };
  let cpuRadius = 0;

  // ---- Intro animation state ----
  const PHASE_DARK = 0, PHASE_POWERON = 1, PHASE_TRACEDRAW = 2,
        PHASE_ZOOMOUT = 3, PHASE_IDLE = 4;
  let introPhase = PHASE_DARK;
  let introTime = 0;
  let introScale = 2.8;
  let traceDrawProgress = 0;
  let cardsShown = false;

  // ---- CPU hitbox ----
  const cpuHitbox = document.createElement("div");
  Object.assign(cpuHitbox.style, {
    position: "fixed", zIndex: "35", pointerEvents: "auto",
    background: "transparent", cursor: "pointer"
  });
  document.body.appendChild(cpuHitbox);
  cpuHitbox.addEventListener("click", () => {
    if (introPhase < PHASE_IDLE) return;
    if (!engineeringMode) setEngineeringMode(true, true);
    coreOverdrive = Math.min(coreOverdrive + 1.2, 6);
  });

  // ---- Resize ----
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  function getAnimMult() {
    let m = 1.0;
    if (engineeringMode) m *= 1.3;
    if (isPipelineActive) m *= 1.4;
    m *= 1 + 0.35 * Math.min(coreOverdrive, 6);
    m *= clockSpeed;
    return halted ? 0 : m;
  }

  // ============================================================
  // ORGANIC TRACE PATHS
  // ============================================================

  let tracePaths = [];
  let modules = [];
  let vias = [];
  let smds = [];

  function buildLayout() {
    const W = canvas.width, H = canvas.height;
    const cx = W * 0.5, cy = H * 0.5;
    const chipSz = Math.min(W, H) * 0.09;
    const mw = chipSz * 1.4, mh = chipSz * 0.5;

    modules = [
      { label: "ROM",     x: cx - mw*2.8, y: cy - mh*4.2, w: mw*0.8, h: mh },
      { label: "RAM",     x: cx - mw*0.9, y: cy - mh*4.6, w: mw*0.8, h: mh },
      { label: "CACHE",   x: cx + mw*1.0, y: cy - mh*4.2, w: mw*0.9, h: mh },
      { label: "MEM",     x: cx + mw*2.4, y: cy - mh*3.0, w: mw*0.8, h: mh },
      { label: "ALU",     x: cx + mw*3.0, y: cy - mh*0.3, w: mw*0.7, h: mh*1.2 },
      { label: "DSP",     x: cx + mw*2.6, y: cy + mh*2.2, w: mw*0.7, h: mh },
      { label: "FPGA",    x: cx - mw*3.2, y: cy - mh*0.5, w: mw*0.9, h: mh*1.2 },
      { label: "REGFILE", x: cx - mw*2.8, y: cy + mh*2.8, w: mw*0.9, h: mh },
      { label: "I/O",     x: cx - mw*0.8, y: cy + mh*4.0, w: mw*0.7, h: mh },
      { label: "CTRL",    x: cx + mw*0.6, y: cy + mh*4.2, w: mw*0.8, h: mh },
      { label: "DEBUG",   x: cx + mw*2.2, y: cy + mh*3.6, w: mw*0.7, h: mh },
    ];

    tracePaths = [];
    for (const mod of modules) {
      const mx = mod.x + mod.w / 2;
      const my = mod.y + mod.h / 2;
      const path = buildTracePath(cx, cy, mx, my, chipSz);
      tracePaths.push({ path, module: mod, numTracks: 4 });
    }

    const decoEnds = [
      { x: W * 0.05, y: H * 0.3 }, { x: W * 0.95, y: H * 0.7 },
      { x: W * 0.08, y: H * 0.75 }, { x: W * 0.92, y: H * 0.25 },
      { x: W * 0.15, y: H * 0.08 }, { x: W * 0.85, y: H * 0.92 },
    ];
    for (const end of decoEnds) {
      tracePaths.push({ path: buildTracePath(cx, cy, end.x, end.y, chipSz), module: null, numTracks: 2 });
    }

    vias = [];
    for (let i = 0; i < 80; i++) {
      vias.push({ x: Math.random() * W, y: Math.random() * H, r: 2 + Math.random() * 2.5, thermal: Math.random() > 0.7 });
    }

    smds = [];
    for (let i = 0; i < 50; i++) {
      smds.push({ x: Math.random() * W, y: Math.random() * H, w: 5 + Math.random() * 6, h: 2.5 + Math.random() * 2, rot: Math.random() > 0.5 ? 0 : Math.PI / 2, isCap: Math.random() > 0.5 });
    }
  }

  function buildTracePath(x0, y0, x1, y1, chipEdge) {
    const dx = x1 - x0, dy = y1 - y0;
    const angle = Math.atan2(dy, dx);
    const exitDist = chipEdge * 1.3;
    const ex = x0 + Math.cos(angle) * exitDist;
    const ey = y0 + Math.sin(angle) * exitDist;
    const pts = [{ x: x0, y: y0 }, { x: ex, y: ey }];
    const remainX = x1 - ex, remainY = y1 - ey;
    const absX = Math.abs(remainX), absY = Math.abs(remainY);
    if (absX > 20 && absY > 20) {
      const bendDist = Math.min(absX, absY) * 0.5;
      const sx = Math.sign(remainX), sy = Math.sign(remainY);
      const b1x = ex + sx * bendDist, b1y = ey + sy * bendDist;
      pts.push({ x: b1x, y: b1y });
      if (absX > absY) pts.push({ x: x1, y: b1y });
      else pts.push({ x: b1x, y: y1 });
    } else if (absX > 10) {
      pts.push({ x: x1, y: ey });
    }
    pts.push({ x: x1, y: y1 });
    return pts;
  }

  function pathMeta(pts) {
    let totalLen = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      segs.push(len);
      totalLen += len;
    }
    return { segs, totalLen };
  }

  function posOnPath(pts, segs, totalLen, f) {
    let target = f * totalLen, traveled = 0;
    for (let i = 0; i < segs.length; i++) {
      if (target <= traveled + segs[i]) {
        const local = (target - traveled) / segs[i];
        return { x: pts[i].x + (pts[i+1].x - pts[i].x) * local, y: pts[i].y + (pts[i+1].y - pts[i].y) * local };
      }
      traveled += segs[i];
    }
    return { x: pts[pts.length-1].x, y: pts[pts.length-1].y };
  }

  function perpAtFrac(pts, segs, totalLen, f) {
    let target = f * totalLen, traveled = 0;
    for (let i = 0; i < segs.length; i++) {
      if (target <= traveled + segs[i]) {
        const dx = pts[i+1].x - pts[i].x, dy = pts[i+1].y - pts[i].y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: -dy/len, y: dx/len };
      }
      traveled += segs[i];
    }
    return { x: 0, y: 1 };
  }

  buildLayout();
  window.addEventListener("resize", () => { resize(); buildLayout(); });

  // ============================================================
  // DRAWING FUNCTIONS
  // ============================================================

  function drawPCBBase() {
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = 0.025;
    ctx.strokeStyle = "#1a3020";
    ctx.lineWidth = 0.4;
    for (let x = 0; x < canvas.width; x += 7) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = 0; y < canvas.height; y += 7) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.015;
    ctx.strokeStyle = "#6B5010";
    ctx.lineWidth = 0.3;
    for (let x = -canvas.height; x < canvas.width; x += 18) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + canvas.height, canvas.height); ctx.stroke(); }
    ctx.restore();
  }

  function drawVias() {
    ctx.save();
    for (const v of vias) {
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r + 1.8, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(100, 80, 20, 0.12)"; ctx.fill();
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, Math.PI * 2);
      ctx.fillStyle = "#060a0e"; ctx.fill();
      ctx.strokeStyle = "rgba(120, 100, 30, 0.15)"; ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.restore();
  }

  function drawSMDs() {
    ctx.save();
    for (const s of smds) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      const pw = s.w * 0.25;
      ctx.fillStyle = "rgba(120, 100, 30, 0.14)";
      ctx.fillRect(-s.w/2, -s.h/2, pw, s.h); ctx.fillRect(s.w/2 - pw, -s.h/2, pw, s.h);
      ctx.fillStyle = s.isCap ? "rgba(90, 70, 40, 0.25)" : "rgba(20, 22, 30, 0.35)";
      ctx.fillRect(-s.w/2 + pw, -s.h/2, s.w - pw*2, s.h);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawModule(mod, glowFrac) {
    const { x, y, w, h, label } = mod;
    ctx.save();
    const ch = Math.min(w, h) * 0.06;
    ctx.beginPath();
    ctx.moveTo(x + ch, y); ctx.lineTo(x + w - ch, y); ctx.lineTo(x + w, y + ch);
    ctx.lineTo(x + w, y + h - ch); ctx.lineTo(x + w - ch, y + h); ctx.lineTo(x + ch, y + h);
    ctx.lineTo(x, y + h - ch); ctx.lineTo(x, y + ch); ctx.closePath();
    ctx.fillStyle = "rgba(14, 18, 28, " + (0.7 + 0.25 * glowFrac) + ")";
    ctx.fill();
    ctx.strokeStyle = "rgba(80, 100, 140, " + (0.2 + 0.4 * glowFrac) + ")";
    ctx.lineWidth = 1; ctx.stroke();
    if (glowFrac > 0.01) {
      ctx.shadowColor = "rgba(56, 180, 248, 0.6)"; ctx.shadowBlur = 12 * glowFrac;
      ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.fillStyle = "rgba(130, 110, 40, " + (0.12 + 0.15 * glowFrac) + ")";
    const ps = 4.5, pl = 4, pwi = 1.5;
    for (let px = x + ch + 5; px < x + w - ch - 5; px += ps) { ctx.fillRect(px, y - pl, pwi, pl); ctx.fillRect(px, y + h, pwi, pl); }
    for (let py = y + ch + 5; py < y + h - ch - 5; py += ps) { ctx.fillRect(x - pl, py, pl, pwi); ctx.fillRect(x + w, py, pl, pwi); }
    ctx.beginPath(); ctx.arc(x + ch + 4, y + ch + 4, 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(160, 170, 200, " + (0.15 + 0.3 * glowFrac) + ")"; ctx.fill();
    ctx.font = "bold 9px 'JetBrains Mono',monospace";
    ctx.fillStyle = "rgba(180, 195, 220, " + (0.3 + 0.5 * glowFrac) + ")";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x + w/2, y + h/2);
    if (glowFrac > 0.5) {
      const colors = ["#22c55e", "#38bdf8", "#facc15"];
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(x + w - 7 - i*6, y + h - 5, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = colors[i];
        ctx.globalAlpha = glowFrac * (0.3 + 0.25 * Math.sin(t * 0.06 + i * 2));
        ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  function drawCore(cx, cy, size, glowFrac) {
    const mult = getAnimMult();
    const jBase = engineeringMode || isPipelineActive ? 1.2 : 0.4;
    const jOver = 1.0 * coreOverdrive;
    const jitter = (jBase + jOver) * (mult / 2.5);
    const xx = cx + Math.sin(t / 25) * jitter;
    const yy = cy + Math.cos(t / 23) * jitter;
    const half = size;
    ctx.save();
    const ihsSize = size * 2.3, ihsH = ihsSize / 2;
    const ihsGrad = ctx.createLinearGradient(xx - ihsH, yy - ihsH, xx + ihsH, yy + ihsH);
    ihsGrad.addColorStop(0, "rgba(30, 35, 50, 0.95)");
    ihsGrad.addColorStop(0.5, "rgba(45, 50, 65, 0.97)");
    ihsGrad.addColorStop(1, "rgba(28, 32, 48, 0.95)");
    ctx.fillStyle = ihsGrad;
    ctx.beginPath(); ctx.roundRect(xx - ihsH, yy - ihsH, ihsSize, ihsSize, 5); ctx.fill();
    ctx.strokeStyle = "rgba(100, 120, 160, " + (0.25 + 0.4 * glowFrac) + ")";
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.globalAlpha = 0.03; ctx.strokeStyle = "#999"; ctx.lineWidth = 0.3;
    for (let ly = yy - ihsH + 3; ly < yy + ihsH - 3; ly += 1.3) { ctx.beginPath(); ctx.moveTo(xx - ihsH + 3, ly); ctx.lineTo(xx + ihsH - 3, ly); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = "rgba(15, 20, 12, 0.9)";
    ctx.beginPath(); ctx.roundRect(xx - half, yy - half, half*2, half*2, 3); ctx.fill();
    ctx.strokeStyle = "rgba(80, 90, 50, " + (0.2 + 0.3 * glowFrac) + ")";
    ctx.lineWidth = 0.8; ctx.stroke();
    const dieSize = size * 1.05, dieH = dieSize / 2;
    const dieGrad = ctx.createLinearGradient(xx - dieH, yy - dieH, xx + dieH, yy + dieH);
    dieGrad.addColorStop(0, "rgba(15, 22, 42, 0.96)");
    dieGrad.addColorStop(0.5, "rgba(25, 40, 70, 0.98)");
    dieGrad.addColorStop(1, "rgba(12, 20, 38, 0.96)");
    ctx.fillStyle = dieGrad;
    ctx.beginPath(); ctx.rect(xx - dieH, yy - dieH, dieSize, dieSize); ctx.fill();
    ctx.save(); ctx.globalAlpha = 0.06; ctx.strokeStyle = "#4080c0"; ctx.lineWidth = 0.3;
    for (let gx = xx - dieH + 2; gx < xx + dieH; gx += 3.5) { ctx.beginPath(); ctx.moveTo(gx, yy - dieH + 2); ctx.lineTo(gx, yy + dieH - 2); ctx.stroke(); }
    for (let gy = yy - dieH + 2; gy < yy + dieH; gy += 3.5) { ctx.beginPath(); ctx.moveTo(xx - dieH + 2, gy); ctx.lineTo(xx + dieH - 2, gy); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = "rgba(180, 150, 40, " + (0.15 + 0.25 * glowFrac) + ")";
    ctx.lineWidth = 1; ctx.stroke();
    ctx.save(); ctx.globalAlpha = 0.08; ctx.fillStyle = "#8B6914";
    for (let bx = xx - half + 5; bx < xx + half - 5; bx += 6) {
      for (let by = yy - half + 5; by < yy + half - 5; by += 6) {
        if (bx > xx - dieH + 3 && bx < xx + dieH - 3 && by > yy - dieH + 3 && by < yy + dieH - 3) continue;
        ctx.beginPath(); ctx.arc(bx, by, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    if (glowFrac > 0.01) {
      const glowI = 0.3 * glowFrac + 0.12 * (mult / 2.5) + 0.06 * coreOverdrive;
      ctx.save();
      ctx.strokeStyle = "rgba(56, 180, 248, " + glowI + ")";
      ctx.lineWidth = 2.5; ctx.shadowColor = "rgba(56, 180, 248, 0.8)"; ctx.shadowBlur = 25 * glowFrac;
      ctx.beginPath(); ctx.roundRect(xx - ihsH, yy - ihsH, ihsSize, ihsSize, 5); ctx.stroke();
      ctx.restore();
      const bracketLen = ihsSize * 0.12, bracketInset = 4;
      ctx.save();
      ctx.strokeStyle = "rgba(200, 230, 255, " + (0.5 * glowFrac + 0.2 * Math.sin(t * 0.04)) + ")";
      ctx.lineWidth = 2; ctx.shadowColor = "rgba(56, 180, 248, 0.9)"; ctx.shadowBlur = 10;
      const corners = [
        [xx - ihsH + bracketInset, yy - ihsH + bracketInset, 1, 1],
        [xx + ihsH - bracketInset, yy - ihsH + bracketInset, -1, 1],
        [xx - ihsH + bracketInset, yy + ihsH - bracketInset, 1, -1],
        [xx + ihsH - bracketInset, yy + ihsH - bracketInset, -1, -1]
      ];
      for (const [bx, by, sx, sy] of corners) {
        ctx.beginPath(); ctx.moveTo(bx + sx * bracketLen, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + sy * bracketLen); ctx.stroke();
      }
      ctx.restore();
      const rGrad = ctx.createRadialGradient(xx, yy, 0, xx, yy, ihsSize * 1.2);
      rGrad.addColorStop(0, "rgba(56, 180, 248, " + (glowI * 0.4) + ")");
      rGrad.addColorStop(0.4, "rgba(100, 60, 200, " + (glowI * 0.15) + ")");
      rGrad.addColorStop(1, "rgba(56, 180, 248, 0)");
      ctx.fillStyle = rGrad;
      ctx.fillRect(xx - ihsSize * 1.2, yy - ihsSize * 1.2, ihsSize * 2.4, ihsSize * 2.4);
    }
    ctx.font = "bold " + Math.round(size * 0.22) + "px 'JetBrains Mono',monospace";
    ctx.fillStyle = "rgba(200, 220, 245, " + (0.4 + 0.4 * glowFrac + 0.1 * Math.sin(t * 0.03)) + ")";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("CORE", xx, yy);
    ctx.font = "6px 'JetBrains Mono',monospace";
    ctx.fillStyle = "rgba(140, 150, 170, " + (0.15 * glowFrac) + ")";
    ctx.fillText("RP-2025K", xx, yy + ihsH - 8);
    ctx.restore();
  }

  function drawTrace(tp, drawFrac, glowFrac) {
    const { path, numTracks } = tp;
    const { segs, totalLen } = pathMeta(path);
    if (totalLen < 1) return;
    const trackSpacing = 3.5;
    const mult = getAnimMult();
    const visibleLen = drawFrac * totalLen;
    for (let trk = 0; trk < numTracks; trk++) {
      const offset = (trk - (numTracks - 1) / 2) * trackSpacing;
      ctx.save(); ctx.beginPath();
      let segTraveled = 0;
      for (let i = 0; i < path.length; i++) {
        if (i === 0) {
          const perp = perpAtFrac(path, segs, totalLen, 0);
          ctx.moveTo(path[0].x + perp.x * offset, path[0].y + perp.y * offset);
        } else {
          segTraveled += segs[i-1];
          if (segTraveled > visibleLen) {
            const overshoot = segTraveled - visibleLen;
            const frac = 1 - overshoot / segs[i-1];
            const px = path[i-1].x + (path[i].x - path[i-1].x) * frac;
            const py = path[i-1].y + (path[i].y - path[i-1].y) * frac;
            const perp = perpAtFrac(path, segs, totalLen, drawFrac);
            ctx.lineTo(px + perp.x * offset, py + perp.y * offset);
            break;
          }
          const perp = perpAtFrac(path, segs, totalLen, segTraveled / totalLen);
          ctx.lineTo(path[i].x + perp.x * offset, path[i].y + perp.y * offset);
        }
      }
      ctx.strokeStyle = "rgba(110, 90, 25, " + (0.18 + 0.12 * glowFrac) + ")";
      ctx.lineWidth = 2.8; ctx.stroke();
      if (glowFrac > 0.01) {
        ctx.strokeStyle = "rgba(56, 180, 248, " + (0.12 * glowFrac + 0.04 * (mult / 2.5)) + ")";
        ctx.lineWidth = 1.8; ctx.shadowColor = "rgba(56, 180, 248, 0.5)"; ctx.shadowBlur = 5 * glowFrac;
        ctx.stroke(); ctx.shadowBlur = 0;
      }
      ctx.restore();
    }
    if (glowFrac > 0.1 && !halted) {
      const waveSpeed = 22 / Math.max(mult, 0.01);
      const amplitude = trackSpacing * 0.8;
      const numWaves = 2 + Math.floor(coreOverdrive * 0.5);
      for (let w = 0; w < numWaves; w++) {
        const basePhase = t / waveSpeed + w * 0.4;
        const headFrac = ((basePhase % 1) + 1) % 1;
        ctx.save(); ctx.beginPath();
        let firstPt = true;
        const waveSteps = 40;
        const waveWindowLen = 0.15;
        for (let s = 0; s <= waveSteps; s++) {
          const sf = s / waveSteps;
          const f = headFrac - waveWindowLen + sf * waveWindowLen;
          if (f < 0 || f > drawFrac) continue;
          const pos = posOnPath(path, segs, totalLen, f);
          const perp = perpAtFrac(path, segs, totalLen, f);
          const wavePhase = sf * Math.PI * 4;
          const sinVal = Math.sin(wavePhase) * amplitude;
          const fadeEdge = Math.sin(sf * Math.PI);
          const px = pos.x + perp.x * sinVal * fadeEdge;
          const py = pos.y + perp.y * sinVal * fadeEdge;
          if (firstPt) { ctx.moveTo(px, py); firstPt = false; }
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(180, 220, 255, " + (0.5 * glowFrac) + ")";
        ctx.lineWidth = 1.5; ctx.shadowColor = "rgba(56, 200, 248, 0.8)"; ctx.shadowBlur = 10 * glowFrac;
        ctx.stroke(); ctx.restore();
      }
    }
  }

  function generateBolt(x1, y1, x2, y2, jag) {
    const pts = [{ x: x1, y: y1 }];
    const segments = 6 + Math.floor(Math.random() * 4);
    for (let i = 1; i < segments; i++) {
      const f = i / segments;
      pts.push({ x: x1 + (x2 - x1) * f + (Math.random() - 0.5) * jag, y: y1 + (y2 - y1) * f + (Math.random() - 0.5) * jag });
    }
    pts.push({ x: x2, y: y2 });
    return pts;
  }

  function drawLightning(x1, y1, x2, y2, intensity) {
    const mainPts = generateBolt(x1, y1, x2, y2, intensity * 18);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(mainPts[0].x, mainPts[0].y);
    for (let i = 1; i < mainPts.length; i++) ctx.lineTo(mainPts[i].x, mainPts[i].y);
    ctx.strokeStyle = "rgba(220, 235, 255, 0.9)"; ctx.lineWidth = 1.8;
    ctx.shadowColor = "rgba(100, 160, 255, 0.9)"; ctx.shadowBlur = 20; ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)"; ctx.lineWidth = 0.6; ctx.shadowBlur = 8; ctx.stroke();
    ctx.restore();
    const numBranches = 2 + Math.floor(Math.random() * 3);
    for (let b = 0; b < numBranches; b++) {
      const srcIdx = Math.floor(Math.random() * (mainPts.length - 2)) + 1;
      const src = mainPts[srcIdx];
      const angle = Math.atan2(y2 - y1, x2 - x1) + (Math.random() - 0.5) * 1.5;
      const branchLen = 20 + Math.random() * 40 * intensity;
      const branchPts = generateBolt(src.x, src.y, src.x + Math.cos(angle) * branchLen, src.y + Math.sin(angle) * branchLen, intensity * 8);
      ctx.save(); ctx.beginPath(); ctx.moveTo(branchPts[0].x, branchPts[0].y);
      for (let i = 1; i < branchPts.length; i++) ctx.lineTo(branchPts[i].x, branchPts[i].y);
      ctx.strokeStyle = "rgba(180, 210, 255, " + (0.4 + Math.random() * 0.3) + ")";
      ctx.lineWidth = 0.8; ctx.shadowColor = "rgba(80, 140, 255, 0.6)"; ctx.shadowBlur = 12; ctx.stroke();
      ctx.restore();
    }
  }

  function drawPCBEdge() {
    const m = 10;
    ctx.save();
    ctx.strokeStyle = "rgba(80, 100, 60, 0.25)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(m, m, canvas.width - m*2, canvas.height - m*2, 5); ctx.stroke();
    const fc = 28, fw = 5, fh = 12, fg = 3;
    const totalW = fc * (fw + fg), startX = (canvas.width - totalW) / 2, fY = canvas.height - m - fh;
    for (let i = 0; i < fc; i++) {
      const fx = startX + i * (fw + fg);
      const grad = ctx.createLinearGradient(fx, fY, fx, fY + fh);
      grad.addColorStop(0, "rgba(170, 140, 35, 0.3)"); grad.addColorStop(1, "rgba(140, 110, 25, 0.25)");
      ctx.fillStyle = grad; ctx.fillRect(fx, fY, fw, fh);
    }
    ctx.font = "8px 'JetBrains Mono',monospace";
    ctx.fillStyle = "rgba(180, 190, 160, 0.1)"; ctx.textAlign = "left";
    ctx.fillText("PCB-RP2025-REV.C", m + 60, m + 14);
    ctx.restore();
  }

  // ============================================================
  // INTRO ANIMATION STATE MACHINE
  // ============================================================

  const INTRO_TIMINGS = { DARK_END: 0.6, POWERON_END: 1.8, TRACEDRAW_END: 4.5, ZOOMOUT_END: 6.0 };

  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  function updateIntro(dt) {
    introTime += dt;
    if (introPhase === PHASE_DARK && introTime >= INTRO_TIMINGS.DARK_END) introPhase = PHASE_POWERON;
    if (introPhase === PHASE_POWERON && introTime >= INTRO_TIMINGS.POWERON_END) introPhase = PHASE_TRACEDRAW;
    if (introPhase === PHASE_TRACEDRAW && introTime >= INTRO_TIMINGS.TRACEDRAW_END) introPhase = PHASE_ZOOMOUT;
    if (introPhase === PHASE_ZOOMOUT && introTime >= INTRO_TIMINGS.ZOOMOUT_END) introPhase = PHASE_IDLE;

    if (introPhase <= PHASE_POWERON) introScale = 2.8;
    else if (introPhase === PHASE_TRACEDRAW) {
      const f = (introTime - INTRO_TIMINGS.POWERON_END) / (INTRO_TIMINGS.TRACEDRAW_END - INTRO_TIMINGS.POWERON_END);
      introScale = 2.8 - f * 0.8;
    } else if (introPhase === PHASE_ZOOMOUT) {
      const f = (introTime - INTRO_TIMINGS.TRACEDRAW_END) / (INTRO_TIMINGS.ZOOMOUT_END - INTRO_TIMINGS.TRACEDRAW_END);
      introScale = 2.0 - f * 1.0;
    } else introScale = 1.0;

    if (introPhase >= PHASE_TRACEDRAW) {
      const f = Math.min(1, (introTime - INTRO_TIMINGS.POWERON_END) / (INTRO_TIMINGS.ZOOMOUT_END - INTRO_TIMINGS.POWERON_END));
      traceDrawProgress = easeOutCubic(f);
    }

    if (introPhase === PHASE_IDLE && !cardsShown) { cardsShown = true; showProjectCards(); }
  }

  function getCoreGlow() {
    if (introPhase === PHASE_DARK) return 0;
    if (introPhase === PHASE_POWERON) {
      return easeOutCubic(Math.min(1, (introTime - INTRO_TIMINGS.DARK_END) / (INTRO_TIMINGS.POWERON_END - INTRO_TIMINGS.DARK_END)));
    }
    return 1;
  }

  function getModuleGlow(mod) {
    if (introPhase < PHASE_TRACEDRAW) return 0;
    const cx = canvas.width * 0.5, cy = canvas.height * 0.5;
    const mx = mod.x + mod.w/2, my = mod.y + mod.h/2;
    const dist = Math.hypot(mx - cx, my - cy);
    const maxDist = Math.hypot(canvas.width, canvas.height) * 0.5;
    return Math.max(0, Math.min(1, (traceDrawProgress - (dist / maxDist) * 0.6) / 0.3));
  }

  function showProjectCards() {
    const main = document.querySelector("main");
    const header = document.querySelector("header");
    if (main) {
      main.style.transition = "opacity 0.8s ease-out, transform 0.8s ease-out";
      main.style.opacity = "0"; main.style.transform = "translateY(30px)";
      requestAnimationFrame(() => { main.style.opacity = "1"; main.style.transform = "translateY(0)"; });
    }
    if (header) {
      header.style.transition = "opacity 0.6s ease-out"; header.style.opacity = "0";
      requestAnimationFrame(() => { header.style.opacity = "1"; });
    }
    const engBtn = document.getElementById("eng-chip-toggle");
    if (engBtn) {
      engBtn.style.transition = "opacity 0.6s ease-out 0.5s"; engBtn.style.opacity = "0";
      requestAnimationFrame(() => { engBtn.style.opacity = "1"; });
    }
  }

  // ============================================================
  // MAIN DRAW LOOP
  // ============================================================

  let lastFrameTime = performance.now();

  function drawScene(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;
    if (!halted || introPhase < PHASE_IDLE) updateIntro(dt);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;
    const cx = W * 0.5, cy = H * 0.5;
    const chipSz = Math.min(W, H) * 0.09;

    ctx.save();
    ctx.translate(cx, cy); ctx.scale(introScale, introScale); ctx.translate(-cx, -cy);

    drawPCBBase(); drawPCBEdge(); drawVias(); drawSMDs();

    const coreGlow = getCoreGlow();
    for (const mod of modules) drawModule(mod, getModuleGlow(mod));
    for (const tp of tracePaths) {
      const tpGlow = tp.module ? getModuleGlow(tp.module) : traceDrawProgress;
      drawTrace(tp, traceDrawProgress, coreGlow * Math.max(0.2, tpGlow));
    }

    drawCore(cx, cy, chipSz, coreGlow);

    if (introPhase === PHASE_IDLE && !halted) {
      const intensity = coreOverdrive + (isPipelineActive ? 1 : 0) + (engineeringMode ? 0.5 : 0);
      if (intensity > 0.8 && Math.random() < 0.015 * intensity) {
        const mod = modules[Math.floor(Math.random() * modules.length)];
        drawLightning(cx, cy, mod.x + mod.w/2, mod.y + mod.h/2, intensity);
      }
    }

    ctx.restore();

    cpuCenter = { x: cx, y: cy }; cpuRadius = chipSz;
    const boxSize = chipSz * 2.5 * introScale;
    cpuHitbox.style.left = (cx - boxSize/2) + "px"; cpuHitbox.style.top = (cy - boxSize/2) + "px";
    cpuHitbox.style.width = boxSize + "px"; cpuHitbox.style.height = boxSize + "px";

    const mult = getAnimMult();
    if (!halted) { t += 1.05 * Math.max(mult, 0.4); coreOverdrive = Math.max(0, coreOverdrive - 0.004); }

    requestAnimationFrame(drawScene);
  }

  const mainEl = document.querySelector("main");
  const headerEl = document.querySelector("header");
  const engBtnEl = document.getElementById("eng-chip-toggle");
  if (mainEl) { mainEl.style.opacity = "0"; mainEl.style.transform = "translateY(30px)"; }
  if (headerEl) { headerEl.style.opacity = "0"; }
  if (engBtnEl) { engBtnEl.style.opacity = "0"; }

  requestAnimationFrame(drawScene);
});
