// rigel.js

// ================== DOM ENTRY ==================
document.addEventListener("DOMContentLoaded", () => {
    // Show the circuit section immediately (no 10s delay nonsense)
    const circuitSection = document.getElementById("circuit-section");
    if (circuitSection) {
        circuitSection.classList.remove("hidden");
    }

    initBlochSphere();
    initCircuitUI();
});

// ================== BLOCH SPHERE ==================

let blochAnimId = null;

function initBlochSphere() {
    const canvas = document.getElementById("bloch-canvas");
    if (!canvas) {
        console.warn("[Rigel] No #bloch-canvas found; skipping Bloch sphere.");
        return;
    }
    const ctx = canvas.getContext("2d");

    function resize() {
        const rect = canvas.getBoundingClientRect();
        const size = rect.width || 420;
        canvas.width = size;
        canvas.height = size; // keep it square inside your pill
    }
    resize();
    window.addEventListener("resize", resize);

    let t = 0;

    function project3D(x, y, z, cx, cy, R, tilt, phi) {
        // Rotate around x-axis (tilt) then around z by phi
        const ct = Math.cos(tilt);
        const st = Math.sin(tilt);

        let y1 = y * ct - z * st;
        let z1 = y * st + z * ct;
        let x1 = x;

        const cz = Math.cos(phi);
        const sz = Math.sin(phi);

        const x2 = x1 * cz - y1 * sz;
        const y2 = x1 * sz + y1 * cz;

        const scale = 1 - 0.18 * z1; // mild fake perspective
        return {
            x: cx + x2 * R * scale,
            y: cy - y2 * R * scale
        };
    }

    function drawFrame() {
        const R = Math.min(canvas.width, canvas.height) * 0.4;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background approx to your CSS gradient
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tilt = 0.7;
        const phi = t * 0.004; // slower rotation

        // Sphere outline
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, 2 * Math.PI);
        ctx.strokeStyle = "#60a5fa";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Equatorial great circle (Z=0)
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(148,163,184,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k <= 64; k++) {
            const a = (2 * Math.PI * k) / 64;
            const p = project3D(Math.cos(a), Math.sin(a), 0, cx, cy, R, tilt, phi);
            if (k === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Axes
        function drawAxis(vec, color) {
            const p0 = project3D(0, 0, 0, cx, cy, R, tilt, phi);
            const p1 = project3D(vec.x, vec.y, vec.z, cx, cy, R, tilt, phi);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }
        drawAxis({ x: 1.2, y: 0,   z: 0 }, "#f97316"); // X
        drawAxis({ x: 0,   y: 1.2, z: 0 }, "#22c55e"); // Y
        drawAxis({ x: 0,   y: 0,   z: 1.2 }, "#38bdf8"); // Z

        // Labels
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "12px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";

        function label(text, x, y, z) {
            const p = project3D(x, y, z, cx, cy, R, tilt, phi);
            ctx.fillText(text, p.x, p.y);
        }

        // Z basis
        label("|0⟩ (Z+)", 0, 0, 1);
        label("|1⟩ (Z−)", 0, 0, -1);
        // X basis
        label("|+⟩ (X+)", 1, 0, 0);
        label("|−⟩ (X−)", -1, 0, 0);
        // Y basis
        label("|+i⟩ (Y+)", 0, 1, 0);
        label("|−i⟩ (Y−)", 0, -1, 0);

        // Maximally mixed at center
        const pCenter = project3D(0, 0, 0, cx, cy, R, tilt, phi);
        ctx.beginPath();
        ctx.arc(pCenter.x, pCenter.y, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#a5b4fc";
        ctx.fill();

        t++;
        blochAnimId = requestAnimationFrame(drawFrame);
    }

    drawFrame();
}

// ================== CIRCUIT UI ==================

const MAX_QUBITS = 4;
const MAX_COLS   = 8;

const GATE_DEFS = [
    { id: "X",   label: "X",   kind: "single" },
    { id: "Y",   label: "Y",   kind: "single" },
    { id: "Z",   label: "Z",   kind: "single" },
    { id: "H",   label: "H",   kind: "single" },
    { id: "S",   label: "S",   kind: "single" },
    { id: "T",   label: "T",   kind: "single" },
    { id: "CX",  label: "CX",  kind: "two"    },
    { id: "CZ",  label: "CZ",  kind: "two"    },
    { id: "CY",  label: "CY",  kind: "two"    },
    { id: "CCX", label: "CCX", kind: "three"  }
];

// circuit[col] = array of gate objects
let circuit           = [];
let currentGateId     = null;
let pendingTwo        = null; // { gateId, col, controlRow }
let pendingThree      = null; // { gateId, col, rows: [c1, c2] }

let numQubitsSelect   = null;
let basisContainer    = null;
let systemPresetSelect= null;
let circuitGrid       = null;

function initCircuitUI() {
    console.log("[Rigel] initCircuitUI");
    circuit = Array.from({ length: MAX_COLS }, () => []);

    numQubitsSelect     = document.getElementById("num-qubits-select");
    basisContainer      = document.getElementById("qubit-basis-selects");
    systemPresetSelect  = document.getElementById("system-preset-select");
    circuitGrid         = document.getElementById("circuit-grid");
    const gatePalette   = document.getElementById("gate-palette");
    const runBtn        = document.getElementById("run-btn");
    const clearBtn      = document.getElementById("clear-circuit-btn");

    if (!numQubitsSelect || !basisContainer || !circuitGrid || !gatePalette) {
        console.warn("[Rigel] Missing core circuit DOM elements; aborting init.");
        return;
    }

    // ---------- basis selectors ----------
    function renderBasisSelectors() {
        const n = parseInt(numQubitsSelect.value, 10);
        basisContainer.innerHTML = "";
        for (let q = 0; q < n; q++) {
            const label = document.createElement("label");
            label.innerHTML = `
                q${q}:
                <select data-qubit="${q}">
                    <option value="0">|0⟩</option>
                    <option value="1">|1⟩</option>
                    <option value="+">|+⟩</option>
                    <option value="-">|−⟩</option>
                    <option value="+i">|+i⟩</option>
                    <option value="-i">|−i⟩</option>
                </select>
            `;
            basisContainer.appendChild(label);
        }
    }

    numQubitsSelect.addEventListener("change", () => {
        renderBasisSelectors();
        renderCircuitGrid();
    });
    renderBasisSelectors();

    // ---------- gate palette ----------
    GATE_DEFS.forEach(g => {
        const btn = document.createElement("button");
        btn.className = "gate-btn";
        btn.textContent = g.label;
        btn.dataset.gateId = g.id;
        btn.addEventListener("click", () => {
            currentGateId = g.id;
            pendingTwo = null;
            pendingThree = null;
            document.querySelectorAll(".gate-btn")
                .forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
        gatePalette.appendChild(btn);
    });

    // ---------- gate placing / deleting ----------
    function deleteGateAt(row, col) {
        circuit[col] = circuit[col].filter(g => {
            if (g.target === row) return false;
            if (g.control === row) return false;
            if (g.controls && g.controls.includes(row)) return false;
            return true;
        });
        pendingTwo = null;
        pendingThree = null;
        renderCircuitGrid();
    }

    function handleCellClick(row, col) {
        if (!currentGateId) return;
        const gateDef = GATE_DEFS.find(g => g.id === currentGateId);
        if (!gateDef) return;

        // ----- single-qubit gate -----
        if (gateDef.kind === "single") {
            circuit[col] = circuit[col].filter(
                g => !(g.target === row && !g.control && !g.controls)
            );
            circuit[col].push({ id: gateDef.id, target: row });
            pendingTwo = null;
            pendingThree = null;
            renderCircuitGrid();
            return;
        }

        // ----- two-qubit gates (CX/CZ/CY) -----
        if (gateDef.kind === "two") {
            if (!pendingTwo) {
                // first click: control
                pendingTwo = { gateId: gateDef.id, col, controlRow: row };
                return;
            } else {
                // second click: target (same column, different row)
                if (
                    pendingTwo.col !== col ||
                    pendingTwo.controlRow === row ||
                    pendingTwo.gateId !== gateDef.id
                ) {
                    pendingTwo = null;
                    return;
                }
                const control = pendingTwo.controlRow;
                const target  = row;

                // clear conflicting gates on those qubits in this column
                circuit[col] = circuit[col].filter(g => {
                    if (g.id === "CX" || g.id === "CZ" || g.id === "CY") {
                        if (
                            g.control === control ||
                            g.control === target ||
                            g.target === control ||
                            g.target === target
                        ) return false;
                    }
                    return true;
                });

                circuit[col].push({ id: gateDef.id, control, target });
                pendingTwo = null;
                renderCircuitGrid();
                return;
            }
        }

        // ----- three-qubit Toffoli (CCX) -----
        if (gateDef.kind === "three" && gateDef.id === "CCX") {
            if (!pendingThree) {
                pendingThree = { gateId: "CCX", col, rows: [row] };
                return;
            } else if (pendingThree.rows.length === 1) {
                if (pendingThree.col !== col || pendingThree.rows[0] === row) {
                    pendingThree = null;
                    return;
                }
                pendingThree.rows.push(row); // second control
                return;
            } else if (pendingThree.rows.length === 2) {
                if (pendingThree.col !== col || pendingThree.rows.includes(row)) {
                    pendingThree = null;
                    return;
                }
                const [c1, c2] = pendingThree.rows;
                const target   = row;

                circuit[col] = circuit[col].filter(g => {
                    if (g.id === "CCX") {
                        if (
                            g.target === target ||
                            g.target === c1 ||
                            g.target === c2 ||
                            g.controls?.includes(target) ||
                            g.controls?.includes(c1) ||
                            g.controls?.includes(c2)
                        ) return false;
                    }
                    return true;
                });

                circuit[col].push({ id: "CCX", controls: [c1, c2], target });
                pendingThree = null;
                renderCircuitGrid();
                return;
            }
        }
    }

    // ---------- circuit grid rendering ----------
    function renderCircuitGrid() {
        const n = parseInt(numQubitsSelect.value, 10);
        circuitGrid.innerHTML = "";

        // top header row
        const corner = document.createElement("div");
        corner.className = "circuit-label-cell";
        circuitGrid.appendChild(corner);

        for (let col = 0; col < MAX_COLS; col++) {
            const h = document.createElement("div");
            h.className = "circuit-label-cell";
            h.textContent = col;
            circuitGrid.appendChild(h);
        }

        // rows q0..q(n-1)
        for (let q = 0; q < n; q++) {
            const labelCell = document.createElement("div");
            labelCell.className = "circuit-label-cell";
            labelCell.textContent = `q${q}`;
            circuitGrid.appendChild(labelCell);

            for (let col = 0; col < MAX_COLS; col++) {
                const cell = document.createElement("div");
                cell.className = "circuit-cell";
                cell.dataset.row = q;
                cell.dataset.col = col;

                cell.addEventListener("click", () => handleCellClick(q, col));
                cell.addEventListener("contextmenu", e => {
                    e.preventDefault();
                    deleteGateAt(q, col);
                });

                circuitGrid.appendChild(cell);
            }
        }

        // now draw the gates and control wires
        for (let col = 0; col < MAX_COLS; col++) {
            circuit[col].forEach(g => {
                if (g.id === "CX" || g.id === "CZ" || g.id === "CY") {
                    renderControlledGate(g, col);
                } else if (g.id === "CCX") {
                    renderCCXGate(g, col);
                } else {
                    renderSingleGate(g, col);
                }
            });
        }
    }

    function renderSingleGate(g, col) {
        const sel = `.circuit-cell[data-row="${g.target}"][data-col="${col}"]`;
        const cell = circuitGrid.querySelector(sel);
        if (!cell) return;
        cell.classList.add("has-gate");
        cell.innerHTML = `<span class="circuit-gate-label">${g.id}</span>`;
    }

    function renderControlledGate(g, col) {
        const tSel = `.circuit-cell[data-row="${g.target}"][data-col="${col}"]`;
        const cSel = `.circuit-cell[data-row="${g.control}"][data-col="${col}"]`;
        const tCell = circuitGrid.querySelector(tSel);
        const cCell = circuitGrid.querySelector(cSel);

        if (tCell) {
            tCell.classList.add("has-gate");
            tCell.innerHTML = `<span class="circuit-gate-label">${g.id.slice(1)}</span>`;
        }
        if (cCell) {
            cCell.classList.add("has-gate");
            cCell.innerHTML = `<span class="circuit-gate-ctl">●</span>`;
        }

        if (tCell && cCell) {
            const rows = [g.control, g.target].sort((a, b) => a - b);
            const rowHeight = 32;
            const rowGap    = 2;
            const wire = document.createElement("div");
            wire.className = "circuit-wire";
            wire.style.left   = `calc(50px + ${col} * 52px + 26px)`;
            wire.style.top    = `${(rows[0] + 1) * (rowHeight + rowGap) + 6}px`;
            wire.style.height = `${(rows[1] - rows[0]) * (rowHeight + rowGap) - 10}px`;
            circuitGrid.appendChild(wire);
        }
    }

    function renderCCXGate(g, col) {
        const [c1, c2] = g.controls;
        const rows = [c1, c2, g.target].sort((a, b) => a - b);

        const tSel = `.circuit-cell[data-row="${g.target}"][data-col="${col}"]`;
        const tCell = circuitGrid.querySelector(tSel);
        if (tCell) {
            tCell.classList.add("has-gate");
            tCell.innerHTML = `<span class="circuit-gate-label">X</span>`;
        }

        [c1, c2].forEach(r => {
            const cSel = `.circuit-cell[data-row="${r}"][data-col="${col}"]`;
            const cCell = circuitGrid.querySelector(cSel);
            if (cCell) {
                cCell.classList.add("has-gate");
                cCell.innerHTML = `<span class="circuit-gate-ctl">●</span>`;
            }
        });

        const rowHeight = 32;
        const rowGap    = 2;
        const wire = document.createElement("div");
        wire.className = "circuit-wire";
        wire.style.left   = `calc(50px + ${col} * 52px + 26px)`;
        wire.style.top    = `${(rows[0] + 1) * (rowHeight + rowGap) + 6}px`;
        wire.style.height = `${(rows[2] - rows[0]) * (rowHeight + rowGap) - 10}px`;
        circuitGrid.appendChild(wire);
    }

    renderCircuitGrid();

    // ---------- buttons ----------
    if (runBtn) {
        runBtn.addEventListener("click", () => {
            runCircuit();
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            circuit = Array.from({ length: MAX_COLS }, () => []);
            renderCircuitGrid();
            const out = document.getElementById("state-output");
            if (out) out.textContent = "";
        });
    }
}

// ================== QUANTUM MATH ==================
// Minimal complex helpers & state evolution.
// This is intentionally simple and limited to n <= 4.

function c(re, im = 0) {
    return { re, im };
}
function cAdd(a, b) {
    return { re: a.re + b.re, im: a.im + b.im };
}
function cSub(a, b) {
    return { re: a.re - b.re, im: a.im - b.im };
}
function cMul(a, b) {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}
function cConj(a) {
    return { re: a.re, im: -a.im };
}
function cScale(a, s) {
    return { re: a.re * s, im: a.im * s };
}
function cAbs2(a) {
    return a.re * a.re + a.im * a.im;
}

// Single-qubit basis states
function basisKet(kind) {
    // |0>, |1>, |+>, |->, |+i>, |-i>
    switch (kind) {
        case "0":  return [c(1,0),   c(0,0)];
        case "1":  return [c(0,0),   c(1,0)];
        case "+":  return [c(1/Math.SQRT2,0), c(1/Math.SQRT2,0)];
        case "-":  return [c(1/Math.SQRT2,0), c(-1/Math.SQRT2,0)];
        case "+i": return [c(1/Math.SQRT2,0), c(0,1/Math.SQRT2)];
        case "-i": return [c(1/Math.SQRT2,0), c(0,-1/Math.SQRT2)];
        default:   return [c(1,0),   c(0,0)];
    }
}

// Tensor product of a list of local kets
function tensorProduct(kets) {
    let state = [c(1, 0)];
    for (const ket of kets) {
        const next = [];
        for (const a of state) {
            for (const b of ket) {
                next.push(cMul(a, b));
            }
        }
        state = next;
    }
    return state;
}

// Global initial state based on system preset or local bases
function buildInitialState() {
    const n = parseInt(numQubitsSelect.value, 10);
    const preset = systemPresetSelect ? systemPresetSelect.value : "none";

    const dim = 1 << n;
    let state = Array.from({ length: dim }, () => c(0,0));

    function setAmp(idx, val) {
        if (idx >= 0 && idx < dim) state[idx] = val;
    }

    if (preset && preset !== "none") {
        // global entangled presets; if n doesn't match, fall back
        if (preset.startsWith("bell") && n === 2) {
            const s = 1 / Math.SQRT2;
            if (preset === "bell-phi-plus") {
                setAmp(0b00, c(s,0));
                setAmp(0b11, c(s,0));
            } else if (preset === "bell-phi-minus") {
                setAmp(0b00, c(s,0));
                setAmp(0b11, c(-s,0));
            } else if (preset === "bell-psi-plus") {
                setAmp(0b01, c(s,0));
                setAmp(0b10, c(s,0));
            } else if (preset === "bell-psi-minus") {
                setAmp(0b01, c(s,0));
                setAmp(0b10, c(-s,0));
            }
            return state;
        }
        if (preset === "ghz-3" && n === 3) {
            const s = 1 / Math.SQRT2;
            setAmp(0b000, c(s,0));
            setAmp(0b111, c(s,0));
            return state;
        }
        if (preset === "ghz-4" && n === 4) {
            const s = 1 / Math.SQRT2;
            setAmp(0b0000, c(s,0));
            setAmp(0b1111, c(s,0));
            return state;
        }
        // if preset chosen but n mismatched, ignore and fall through to product state
    }

    // Product state from local bases
    const kets = [];
    const selects = basisContainer.querySelectorAll("select[data-qubit]");
    for (let q = 0; q < n; q++) {
        const sel = Array.from(selects).find(s => parseInt(s.dataset.qubit, 10) === q);
        const kind = sel ? sel.value : "0";
        kets.push(basisKet(kind));
    }
    state = tensorProduct(kets);
    return state;
}

// Apply single-qubit gate (2x2 unitary) to qubit q
function applySingleQubitGate(state, n, q, U) {
    const dim = state.length;
    const step = 1 << q;
    const span = step << 1;

    for (let base = 0; base < dim; base += span) {
        for (let i = 0; i < step; i++) {
            const i0 = base + i;
            const i1 = base + i + step;
            const a0 = state[i0];
            const a1 = state[i1];
            state[i0] = cAdd(cMul(U[0][0], a0), cMul(U[0][1], a1));
            state[i1] = cAdd(cMul(U[1][0], a0), cMul(U[1][1], a1));
        }
    }
}

// X,Y,Z,H,S,T matrices
const U_X = [[c(0,0), c(1,0)], [c(1,0), c(0,0)]];
const U_Z = [[c(1,0), c(0,0)], [c(0,0), c(-1,0)]];
const U_Y = [[c(0,0), c(0,-1)], [c(0,1), c(0,0)]];
const U_H = [
    [c(1/Math.SQRT2,0), c(1/Math.SQRT2,0)],
    [c(1/Math.SQRT2,0), c(-1/Math.SQRT2,0)]
];
const U_S = [[c(1,0), c(0,0)], [c(0,0), c(0,1)]];
const U_T = [[c(1,0), c(0,0)], [c(0,0), c(Math.SQRT1_2, Math.SQRT1_2)]];

// Controlled-Z
function applyCZ(state, n, control, target) {
    const dim = state.length;
    for (let i = 0; i < dim; i++) {
        const bC = (i >> control) & 1;
        const bT = (i >> target) & 1;
        if (bC && bT) {
            state[i].re *= -1;
            state[i].im *= -1;
        }
    }
}

// Controlled-Y
function applyCY(state, n, control, target) {
    const dim = state.length;
    const step = 1 << target;
    const span = step << 1;
    for (let base = 0; base < dim; base += span) {
        for (let i = 0; i < step; i++) {
            const i0 = base + i;
            const i1 = base + i + step;
            const bC0 = (i0 >> control) & 1;
            const bC1 = (i1 >> control) & 1;
            if (bC0 && bC1) {
                // both with control=1; but that can't happen for same control bit in same pair
                continue;
            }
            if (bC0 && !bC1) {
                const a0 = state[i0];
                const a1 = state[i1];
                // apply Y to (a0,a1)
                state[i0] = cMul(c(0,-1), a1); // -i*a1
                state[i1] = cMul(c(0, 1), a0); // i*a0
            } else if (!bC0 && bC1) {
                const a0 = state[i0];
                const a1 = state[i1];
                state[i0] = cMul(c(0,-1), a1);
                state[i1] = cMul(c(0, 1), a0);
            }
        }
    }
}

// CNOT
function applyCX(state, n, control, target) {
    const dim = state.length;
    const newState = state.map(a => ({ re: a.re, im: a.im }));
    for (let i = 0; i < dim; i++) {
        const bC = (i >> control) & 1;
        if (!bC) continue;
        const bT = (i >> target) & 1;
        const flipped = bT ? (i & ~(1 << target)) : (i | (1 << target));
        newState[flipped] = state[i];
    }
    for (let i = 0; i < dim; i++) {
        state[i] = newState[i];
    }
}

// Toffoli (CCX)
function applyCCX(state, n, c1, c2, target) {
    const dim = state.length;
    const newState = state.map(a => ({ re: a.re, im: a.im }));
    for (let i = 0; i < dim; i++) {
        const b1 = (i >> c1) & 1;
        const b2 = (i >> c2) & 1;
        if (!(b1 && b2)) continue;
        const bT = (i >> target) & 1;
        const flipped = bT ? (i & ~(1 << target)) : (i | (1 << target));
        newState[flipped] = state[i];
    }
    for (let i = 0; i < dim; i++) {
        state[i] = newState[i];
    }
}

// Apply all gates, column by column, left to right
function applyCircuit(state, n) {
    for (let col = 0; col < MAX_COLS; col++) {
        const gates = circuit[col];
        for (const g of gates) {
            switch (g.id) {
                case "X":
                    applySingleQubitGate(state, n, g.target, U_X); break;
                case "Y":
                    applySingleQubitGate(state, n, g.target, U_Y); break;
                case "Z":
                    applySingleQubitGate(state, n, g.target, U_Z); break;
                case "H":
                    applySingleQubitGate(state, n, g.target, U_H); break;
                case "S":
                    applySingleQubitGate(state, n, g.target, U_S); break;
                case "T":
                    applySingleQubitGate(state, n, g.target, U_T); break;
                case "CX":
                    applyCX(state, n, g.control, g.target); break;
                case "CZ":
                    applyCZ(state, n, g.control, g.target); break;
                case "CY":
                    applyCY(state, n, g.control, g.target); break;
                case "CCX":
                    if (g.controls && g.controls.length === 2) {
                        applyCCX(state, n, g.controls[0], g.controls[1], g.target);
                    }
                    break;
                default:
                    break;
            }
        }
    }
    return state;
}

// Expectation <ψ|O_q|ψ> by applying O and taking inner product
function expectationPauli(state, n, q, U) {
    const dim = state.length;
    // apply single-qubit U to copy
    const tmp = state.map(a => ({ re: a.re, im: a.im }));
    applySingleQubitGate(tmp, n, q, U);
    // inner product <ψ|tmp>
    let acc = c(0,0);
    for (let i = 0; i < dim; i++) {
        acc = cAdd(acc, cMul(cConj(state[i]), tmp[i]));
    }
    return acc;
}

// Pretty print final state and Bloch vectors per qubit
function summarizeState(state, n) {
    const dim = state.length;
    let lines = [];

    lines.push(`Final state (n = ${n}):`);
    for (let i = 0; i < dim; i++) {
        const amp = state[i];
        const prob = cAbs2(amp);
        if (prob < 1e-6) continue;
        const bitstring = i.toString(2).padStart(n, "0");
        const re = amp.re.toFixed(3);
        const im = amp.im.toFixed(3);
        lines.push(`  |${bitstring}⟩ : (${re} + ${im}i),  p = ${prob.toFixed(3)}`);
    }

    lines.push("");
    lines.push("Single-qubit reduced Bloch vectors (approx):");

    for (let q = 0; q < n; q++) {
        const ex = expectationPauli(state, n, q, U_X);
        const ey = expectationPauli(state, n, q, U_Y);
        const ez = expectationPauli(state, n, q, U_Z);

        const rx = ex.re;
        const ry = ey.re;
        const rz = ez.re;

        const r2 = rx*rx + ry*ry + rz*rz;
        const purity = (1 + r2) / 2;

        lines.push(
            `  q${q}:  ⟨X⟩=${rx.toFixed(3)}, ⟨Y⟩=${ry.toFixed(3)}, ⟨Z⟩=${rz.toFixed(3)},  |r|²=${r2.toFixed(3)},  purity≈${purity.toFixed(3)}`
        );
    }

    // gate narrative
    lines.push("");
    lines.push("Gate sequence (by column):");
    for (let col = 0; col < MAX_COLS; col++) {
        if (!circuit[col] || circuit[col].length === 0) continue;
        const parts = circuit[col].map(g => {
            if (g.id === "CX" || g.id === "CZ" || g.id === "CY") {
                return `${g.id}(control=q${g.control}, target=q${g.target})`;
            } else if (g.id === "CCX") {
                return `CCX(controls=q${g.controls[0]},q${g.controls[1]}, target=q${g.target})`;
            } else {
                return `${g.id}(q${g.target})`;
            }
        });
        lines.push(`  col ${col}: ${parts.join(", ")}`);
    }

    return lines.join("\n");
}

function runCircuit() {
    const n = parseInt(numQubitsSelect.value, 10);
    const state0 = buildInitialState();
    const state = state0.map(a => ({ re: a.re, im: a.im })); // copy
    applyCircuit(state, n);

    const outEl = document.getElementById("state-output");
    if (outEl) {
        outEl.textContent = summarizeState(state, n);
    }
}
