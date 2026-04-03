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

  let showAddrBus = true;
  let showDataBus = true;
  let showCtrlBus = true;

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
    <div>Core unlocked. Address, data and control buses are now under your command.</div>
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
        font-size:12px;cursor:pointer;">✕</button>
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
    <div style="margin-bottom:8px;">
      <div style="margin-bottom:4px;color:#9ca3af;">Buses</div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
        <input type="checkbox" id="bus-addr" checked>
        <span>Address bus</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
        <input type="checkbox" id="bus-data" checked>
        <span>Data bus</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="bus-ctrl" checked>
        <span>Control bus</span>
      </label>
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
  const busAddrCheckbox = engPanel.querySelector("#bus-addr");
  const busDataCheckbox = engPanel.querySelector("#bus-data");
  const busCtrlCheckbox = engPanel.querySelector("#bus-ctrl");
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

  busAddrCheckbox.addEventListener("change", (e) => {
    showAddrBus = e.target.checked;
  });
  busDataCheckbox.addEventListener("change", (e) => {
    showDataBus = e.target.checked;
  });
  busCtrlCheckbox.addEventListener("change", (e) => {
    showCtrlBus = e.target.checked;
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
  // 3. CANVAS: CPU + FPGA CIRCUIT BACKGROUND
  // ============================================================

  const canvas = document.createElement("canvas");
  canvas.id = "circuit-canvas";
  Object.assign(canvas.style, {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    zIndex: 0,
    pointerEvents: "none",
    opacity: 0.9
  });
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext("2d");
  let t = 0;

  let cpuCenter = { x: 0, y: 0 };
  let cpuRadius = 0;

  const cpuHitbox = document.createElement("div");
  Object.assign(cpuHitbox.style, {
    position: "fixed",
    zIndex: "35",
    pointerEvents: "auto",
    background: "transparent",
    cursor: "pointer"
  });
  document.body.appendChild(cpuHitbox);

  cpuHitbox.addEventListener("click", () => {
    if (!engineeringMode) {
      setEngineeringMode(true, true);
    }
    coreOverdrive = Math.min(coreOverdrive + 1, 6);
  });

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    updateCpuHitbox();
  }

  window.addEventListener("resize", resize);
  resize();

  function updateCpuHitbox() {
    const baseSize = Math.min(canvas.width, canvas.height) * 0.22;
    const cx = canvas.width * 0.30;
    const cy = canvas.height * 0.48;

    const radius = baseSize * Math.SQRT1_2;
    cpuCenter = { x: cx, y: cy };
    cpuRadius = radius;

    const boxSize = radius * 2 * 1.15;
    cpuHitbox.style.left = `${cx - boxSize / 2}px`;
    cpuHitbox.style.top = `${cy - boxSize / 2}px`;
    cpuHitbox.style.width = `${boxSize}px`;
    cpuHitbox.style.height = `${boxSize}px`;
  }

function getAnimMultiplier() {
  // base < eng mode < pipeline < overdrive, then HALT can completely freeze
  let mult = 1.0;
  if (engineeringMode) mult *= 1.3;
  if (isPipelineActive) mult *= 1.4;
  mult *= 1 + 0.35 * Math.min(coreOverdrive, 6);
  mult *= clockSpeed;

  // HALT: fully freeze animation
  if (halted) return 0;

  return mult;
}

  function drawGrid() {
    ctx.save();
    const spacing = 48;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(15,23,42,0.5)";
    for (let x = 0; x < canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCpuDiamond(cx, cy, size) {
    const mult = getAnimMultiplier();
    const jBase = engineeringMode || isPipelineActive ? 2.5 : 1.2;
    const jOver = 2.0 * coreOverdrive;
    const jitter = (jBase + jOver) * (mult / 2.5);

    const jx = Math.sin(t / 25) * jitter;
    const jy = Math.cos(t / 23) * jitter;

    const xx = cx + jx;
    const yy = cy + jy;
    const half = size / 2;

    ctx.save();
    ctx.translate(xx, yy);
    ctx.rotate(Math.PI / 4);

    const gradient = ctx.createLinearGradient(-half, -half, half, half);
    gradient.addColorStop(0, "#0ea5e9");
    gradient.addColorStop(0.4, "#38bdf8");
    gradient.addColorStop(1, "#22c55e");

    ctx.fillStyle = "rgba(5,15,35,0.98)";
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(56,189,248,0.9)";
    ctx.shadowBlur = 22 * (mult / 1.5);

    ctx.beginPath();
    ctx.roundRect(-half, -half, size, size, 14);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "rgba(148,163,184,0.9)";
    ctx.beginPath();
    ctx.roundRect(-half * 0.7, -half * 0.7, size * 0.7, size * 0.7, 8);
    ctx.stroke();

    // vertical slits
    ctx.strokeStyle = "rgba(56,189,248,0.5)";
    ctx.lineWidth = 0.9;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-half * 0.6 + i * 6, -half * 0.45);
      ctx.lineTo(-half * 0.6 + i * 6, half * 0.45);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(226,232,240,0.95)";
    ctx.font = `${Math.round(size * 0.18)}px 'JetBrains Mono','Fira Mono',monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CORE", 0, 0);

    ctx.restore();
  }

  function drawModule(mod) {
    const { x, y, w, h, label } = mod;
    const chamfer = Math.min(w, h) * 0.16;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + chamfer, y);
    ctx.lineTo(x + w - chamfer, y);
    ctx.lineTo(x + w, y + chamfer);
    ctx.lineTo(x + w, y + h - chamfer);
    ctx.lineTo(x + w - chamfer, y + h);
    ctx.lineTo(x + chamfer, y + h);
    ctx.lineTo(x, y + h - chamfer);
    ctx.lineTo(x, y + chamfer);
    ctx.closePath();

    ctx.fillStyle = "rgba(10,16,35,0.92)";
    ctx.fill();

    ctx.strokeStyle = "rgba(148,163,184,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // internal stripes + tiny indicators
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 6, y + 6, w - 12, h - 12);
    ctx.clip();

    ctx.strokeStyle = "rgba(30,64,175,0.7)";
    ctx.lineWidth = 0.7;
    for (let yy = y + 8; yy < y + h - 8; yy += 5) {
      ctx.beginPath();
      ctx.moveTo(x + 10, yy);
      ctx.lineTo(x + w - 10, yy);
      ctx.stroke();
    }

    const ledCount = 3;
    for (let i = 0; i < ledCount; i++) {
      const lx = x + 10 + i * ((w - 20) / Math.max(ledCount - 1, 1));
      const ly = y + h - 10;
      ctx.beginPath();
      ctx.arc(lx, ly, 2, 0, 2 * Math.PI);
      ctx.fillStyle = i === 0 ? "#22c55e" : i === 1 ? "#38bdf8" : "#facc15";
      ctx.fill();
    }
    ctx.restore();

    ctx.font = "11px 'JetBrains Mono','Fira Mono',monospace";
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2 - 4);
    ctx.restore();
  }

  function drawOscillator(x, y) {
    ctx.save();
    ctx.strokeStyle = "rgba(148,163,184,0.9)";
    ctx.lineWidth = 1.6;

    ctx.beginPath();
    ctx.moveTo(x - 22, y);
    ctx.lineTo(x + 22, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(x - 18, y - 10, 36, 20, 6);
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(x - 12, y - 4, 24, 8, 4);
    ctx.stroke();

    ctx.restore();
  }

  function moduleCenter(mod) {
    return { x: mod.x + mod.w / 2, y: mod.y + mod.h / 2 };
  }

  function buildModules(cpuX, cpuY, cpuSize) {
    const modW = cpuSize * 0.7;
    const modH = cpuSize * 0.22;

    const modules = [];

    // top row
    modules.push({
      name: "ROM",
      label: "ROM",
      x: canvas.width * 0.12,
      y: canvas.height * 0.16,
      w: modW * 0.7,
      h: modH * 0.9
    });
    modules.push({
      name: "RAM",
      label: "RAM",
      x: canvas.width * 0.30,
      y: canvas.height * 0.16,
      w: modW * 0.7,
      h: modH * 0.9
    });
    modules.push({
      name: "MEM",
      label: "MEM",
      x: canvas.width * 0.64,
      y: canvas.height * 0.16,
      w: modW * 0.75,
      h: modH * 0.9
    });
    modules.push({
      name: "CACHE",
      label: "CACHE",
      x: canvas.width * 0.78,
      y: canvas.height * 0.16,
      w: modW * 0.6,
      h: modH * 0.9
    });

    // mid row around data bus
    modules.push({
      name: "ALU",
      label: "ALU",
      x: canvas.width * 0.68,
      y: canvas.height * 0.40,
      w: modW * 0.7,
      h: modH * 1.0
    });
    modules.push({
      name: "DSP",
      label: "DSP",
      x: canvas.width * 0.76,
      y: canvas.height * 0.52,
      w: modW * 0.6,
      h: modH * 0.9
    });
    modules.push({
      name: "FPGA",
      label: "FPGA FABRIC",
      x: canvas.width * 0.15,
      y: canvas.height * 0.40,
      w: modW * 0.8,
      h: modH * 1.0
    });

    // bottom row near control bus
    modules.push({
      name: "REGFILE",
      label: "REGFILE",
      x: canvas.width * 0.12,
      y: canvas.height * 0.68,
      w: modW * 0.75,
      h: modH
    });
    modules.push({
      name: "IO",
      label: "I/O",
      x: canvas.width * 0.32,
      y: canvas.height * 0.68,
      w: modW * 0.65,
      h: modH
    });
    modules.push({
      name: "CTRL",
      label: "CONTROL UNIT",
      x: canvas.width * 0.52,
      y: canvas.height * 0.68,
      w: modW * 0.7,
      h: modH
    });
    modules.push({
      name: "DEBUG",
      label: "DEBUG",
      x: canvas.width * 0.76,
      y: canvas.height * 0.68,
      w: modW * 0.6,
      h: modH
    });

    return modules;
  }

function buildBuses(cpuX, cpuY, cpuSize, modules) {
  const buses = [];

  const leftX = canvas.width * 0.10;
  const rightX = canvas.width * 0.90;

  const addrY = canvas.height * 0.24;
  const dataY = cpuY;                // mid-level data bus
  const ctrlY = canvas.height * 0.82; // pushed below bottom modules

  // plain horizontal trunks (we’ll add bends in drawing)
  const addrPath = [
    { x: leftX, y: addrY },
    { x: rightX, y: addrY }
  ];
  const dataPath = [
    { x: leftX, y: dataY },
    { x: rightX, y: dataY }
  ];
  const ctrlPath = [
    { x: leftX, y: ctrlY },
    { x: rightX, y: ctrlY }
  ];

  // All buses connect to all modules now
  const addrModules = modules;
  const dataModules = modules;
  const ctrlModules = modules;

  function stubToBus(module, busY) {
    const cx = module.x + module.w / 2;
    let yBus, yMod;

    if (busY < module.y) {
      // bus above module
      yBus = busY;
      yMod = module.y;
    } else if (busY > module.y + module.h) {
      // bus below module
      yBus = busY;
      yMod = module.y + module.h;
    } else {
      // overlapping case (rare); keep it tiny
      yBus = busY;
      yMod = busY;
    }

    return {
      x: cx,
      yBus,
      yMod,
      module
    };
  }

  function makeBus(type, path, y, modulesForBus) {
    const bus = {
      type,
      path,
      y,
      modules: modulesForBus,
      numTracks: 5, // bundle size = 5 traces
      draw: () =>
        (type === "ADDR" && showAddrBus) ||
        (type === "DATA" && showDataBus) ||
        (type === "CTRL" && showCtrlBus)
    };
    bus.stubs = modulesForBus.map((mod) => stubToBus(mod, y));
    return bus;
  }

  buses.push(makeBus("ADDR", addrPath, addrY, addrModules));
  buses.push(makeBus("DATA", dataPath, dataY, dataModules));
  buses.push(makeBus("CTRL", ctrlPath, ctrlY, ctrlModules));

  return buses;
}

function drawBus(bus, phase) {
  if (!bus.draw()) return;

  const mult = getAnimMultiplier();
  const path = bus.path;
  const tracks = bus.numTracks || 5;
  const trackOffset = 5;   // spacing between traces
  const stubOffset = 4;    // spacing between stub traces

  let color;
  if (bus.type === "ADDR") color = "rgba(129,140,248,0.9)";
  else if (bus.type === "DATA") color = "rgba(56,189,248,0.9)";
  else color = "rgba(34,197,94,0.9)";

  // --- MAIN BUNDLE (5 parallel traces) ---
  ctx.save();
  for (let track = 0; track < tracks; track++) {
    const offset = (track - (tracks - 1) / 2) * trackOffset;

    ctx.beginPath();

    // add a slight octagonal-ish bend near the center
    const midX = (path[0].x + path[1].x) / 2;
    const bendY = path[0].y + ((bus.type === "ADDR") ? -6 : (bus.type === "CTRL") ? 6 : 0);

    ctx.moveTo(path[0].x, path[0].y + offset);
    ctx.lineTo(midX - 40, path[0].y + offset);
    ctx.lineTo(midX, bendY + offset);
    ctx.lineTo(midX + 40, path[0].y + offset);
    ctx.lineTo(path[1].x, path[1].y + offset);

    ctx.strokeStyle = color;
    ctx.lineWidth = 3.2; // thicker so you can see each line
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 * (mult / 1.5);
    ctx.globalAlpha = 0.32 + 0.05 * (mult / 2.5);
    ctx.stroke();
  }
  ctx.restore();

  // subtle dark backing underneath bundle
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  ctx.lineTo(path[1].x, path[1].y);
  ctx.strokeStyle = "rgba(15,23,42,0.9)";
  ctx.lineWidth = 6 + (tracks - 1) * trackOffset;
  ctx.globalAlpha = 0.22;
  ctx.stroke();
  ctx.restore();

  // --- STUBS TO MODULES (bundles with tiny octagonal kinks) ---
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.globalAlpha = 0.6;

  bus.stubs.forEach((stub) => {
    for (let track = 0; track < tracks; track++) {
      const offsetX = (track - (tracks - 1) / 2) * stubOffset;
      const x0 = stub.x + offsetX;
      const y0 = stub.yBus;
      const y1 = stub.yMod;

      const midY = (y0 + y1) / 2;
      const kinkX = x0 + (y1 > y0 ? 3 : -3); // tiny _/ kink

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(kinkX, midY);
      ctx.lineTo(x0, y1);
      ctx.stroke();
    }
  });
  ctx.restore();

  // --- ELECTRONS ALONG TRUNK BUNDLE ---
  let segLens = [];
  let totalLen = 0;
  for (let i = 1; i < path.length; i++) {
    const len = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    segLens.push(len);
    totalLen += len;
  }

  const baseSpeed = 18;
  const speedFactor = baseSpeed / Math.max(getAnimMultiplier(), 0.001);

  let centerPx = null;
  let centerPy = null;

  for (let track = 0; track < tracks; track++) {
    const offset = (track - (tracks - 1) / 2) * trackOffset;

    let pulsePos = ((Math.sin(t / speedFactor + phase + track * 0.5) + 1) / 2) * totalLen;
    let px = path[0].x;
    let py = path[0].y;

    let traveled = 0;
    for (let i = 1; i < path.length; i++) {
      if (pulsePos <= traveled + segLens[i - 1]) {
        const local = pulsePos - traveled;
        const f = local / segLens[i - 1];
        const xA = i === 1 ? path[0].x : path[i - 1].x;
        const yA = i === 1 ? path[0].y : path[i - 1].y;
        const xB = path[i].x;
        const yB = path[i].y;
        px = xA + (xB - xA) * f;
        py = yA + (yB - yA) * f;
        break;
      }
      traveled += segLens[i - 1];
    }

    py += offset;

    ctx.save();
    const rBase = 4.5 + 0.9 * (mult / 2.5);
    const r = rBase + 1.1 * Math.sin(t / (4 / Math.max(mult, 0.1)) + phase + track * 0.2);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(244,244,255,0.97)";
    ctx.shadowColor = color;
    ctx.shadowBlur = 18 * (mult / 1.5);
    ctx.globalAlpha = 0.42 + 0.08 * (mult / 2.5);
    ctx.fill();
    ctx.restore();

    if (track === Math.floor(tracks / 2)) {
      centerPx = px;
      centerPy = py;
    }
  }

  // --- ELECTRONS UP & DOWN STUBS (toward modules and back) ---
  const stubSpeed = 26;
  const stubFactor = stubSpeed / Math.max(getAnimMultiplier(), 0.001);

  bus.stubs.forEach((stub, stubIndex) => {
    const len = Math.abs(stub.yMod - stub.yBus) || 1;

    for (let track = 0; track < tracks; track++) {
      const offsetX = (track - (tracks - 1) / 2) * stubOffset;
      const phaseShift = phase + stubIndex * 0.3 + track * 0.4;

      // ping-pong position 0 → 1 → 0
      const p = Math.abs(Math.sin(t / stubFactor + phaseShift));
      const y = stub.yBus + (stub.yMod - stub.yBus) * p;
      const x = stub.x + offsetX;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 3.8, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(248,250,252,0.97)";
      ctx.shadowColor = color;
      ctx.shadowBlur = 16 * (mult / 1.5);
      ctx.globalAlpha = 0.40 + 0.08 * (mult / 2.5);
      ctx.fill();
      ctx.restore();
    }
  });

  // --- LIGHTNING ARCS (disabled when HALTed) ---
  const intensity =
    coreOverdrive + (isPipelineActive ? 1 : 0) + (engineeringMode ? 0.5 : 0);
  if (!halted && intensity > 1.2 && bus.modules.length > 0 && centerPx != null) {
    const chance = 0.01 * intensity;
    if (Math.random() < chance) {
      const mod = bus.modules[Math.floor(Math.random() * bus.modules.length)];
      const mc = moduleCenter(mod);
      drawLightning(centerPx, centerPy, mc.x, mc.y, intensity, color);
    }
  }
}

 

  function drawLightning(x1, y1, x2, y2, intensity, color) {
    ctx.save();
    const segments = 5 + Math.floor(intensity * 2);
    const points = [];
    points.push({ x: x1, y: y1 });

    for (let i = 1; i < segments; i++) {
      const tt = i / segments;
      const mx = x1 + (x2 - x1) * tt;
      const my = y1 + (y2 - y1) * tt;
      const offset = (Math.random() - 0.5) * 24 * intensity;
      points.push({ x: mx + offset, y: my - offset });
    }
    points.push({ x: x2, y: y2 });

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);

    ctx.strokeStyle = "rgba(248,250,252,0.96)";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();
  }

  function drawScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawGrid();

    const cpuSize = Math.min(canvas.width, canvas.height) * 0.22;
    const cpuX = canvas.width * 0.30;
    const cpuY = canvas.height * 0.48;

    const modules = buildModules(cpuX, cpuY, cpuSize);
    modules.forEach(drawModule);

    const buses = buildBuses(cpuX, cpuY, cpuSize, modules);
    buses.forEach((bus, idx) => drawBus(bus, idx * 0.7));

    // oscillator under control bus, right of core
    const oscX = cpuX + cpuSize * 0.2;
    const oscY = canvas.height * 0.82;
    drawOscillator(oscX, oscY);

    drawCpuDiamond(cpuX, cpuY, cpuSize);

    // keep hitbox synced
    const radius = cpuSize * Math.SQRT1_2;
    cpuCenter = { x: cpuX, y: cpuY };
    cpuRadius = radius;
    const boxSize = radius * 2 * 1.15;
    cpuHitbox.style.left = `${cpuX - boxSize / 2}px`;
    cpuHitbox.style.top = `${cpuY - boxSize / 2}px`;
    cpuHitbox.style.width = `${boxSize}px`;
    cpuHitbox.style.height = `${boxSize}px`;

    const mult = getAnimMultiplier();

    // If HALTed, keep t and overdrive fixed (full freeze)
    if (!halted) {
      t += 1.05 * Math.max(mult, 0.4);
      coreOverdrive = Math.max(0, coreOverdrive - 0.003);
    }

    requestAnimationFrame(drawScene);
  }


  drawScene();
});
