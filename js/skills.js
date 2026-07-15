// ============================================================
// MINTAKA — Skills as an 8-mode rectangular MZI mesh (Clements)
//
// Four input channels — one per skill group — feed an 8-mode
// Mach–Zehnder mesh: 6 columns of couplers with fixed splitting
// ratios and a phase shifter on each top arm. Light pulses enter
// on the selected channel's two rails, interfere their way across
// the lattice, and land on the output ports — each port carries
// four skills.
//
// Interactions:
//   • click a channel button — inject light on that input
//   • otherwise the mesh auto-cycles through the channels
// ============================================================

(function () {
    "use strict";

    // ---------- skill groups (channel order = input rail pairs) ----------
    var GROUPS = [
        { name: "Hardware", rgb: [255, 190, 77] },
        { name: "Quantum", rgb: [95, 216, 232] },
        { name: "Software", rgb: [126, 227, 154] },
        { name: "ML & Data", rgb: [180, 154, 255] }
    ];

    // rail r carries SKILLS[r*4 .. r*4+3]; group of rail r = r >> 1
    var SKILLS = [
        // Hardware (rails 0–1)
        "FPGA design (VHDL)", "Verilog & RTL", "Embedded & microcontrollers", "Digital electronics",
        "Analog electronics", "Lab instrumentation", "LabVIEW", "PCB & prototyping",
        // Quantum (rails 2–3)
        "Photonic quantum computing", "GBS systems", "MZI interferometry", "Single-photon detection",
        "Qiskit", "Quantum error correction", "Quantum simulation", "Quantum optics",
        // Software (rails 4–5)
        "Python", "C & low-level", "JavaScript & creative coding", "Django & REST APIs",
        "Node.js", "MATLAB", "R & statistics", "Linux & shell",
        // ML & Data (rails 6–7)
        "TensorFlow & deep learning", "Graph neural networks", "Computer vision (OpenCV)", "NLP & language modeling",
        "Local LLMs & agents", "Signal processing", "Scientific computing", "Data viz & dashboards"
    ];

    // ---------- geometry (logical px; canvas backing store is 2x) ----------
    var W = 1040, RAILS = 8, COLS = 6;
    var TOP_PAD = 46, RAIL_GAP = 54;
    var H = TOP_PAD * 2 + (RAILS - 1) * RAIL_GAP; // 470 — matches height=940 (2x)
    var IN_X = 34;        // input markers / rail start
    var MESH_L = 64;      // first coupler column offset base
    var MESH_R = 776;     // output ports
    var LABEL_X = 806;    // skill labels

    var railY0 = [];
    for (var i = 0; i < RAILS; i++) railY0.push(TOP_PAD + i * RAIL_GAP);

    // Clements arrangement: alternating even/odd coupler pairings,
    // fixed pseudo-random splitting ratios
    var cols = [];
    var colSpan = (MESH_R - MESH_L - 140) / (COLS - 1);
    for (var j = 0; j < COLS; j++) {
        var pairs = (j % 2 === 0)
            ? [[0, 1], [2, 3], [4, 5], [6, 7]]
            : [[1, 2], [3, 4], [5, 6]];
        var ratios = [];
        for (var q = 0; q < pairs.length; q++) {
            ratios.push(0.5 + 0.42 * Math.sin(j * 2.7 + pairs[q][0] * 1.9 + 0.6));
        }
        cols.push({ xc: MESH_L + 70 + j * colSpan, pairs: pairs, ratios: ratios });
    }

    // waveguides converge toward each coupler they take part in
    var CONV_HALF = 40, CONV_FLAT = 22, CONV_OFF = 20;

    function railY(rail, x) {
        var y = railY0[rail];
        for (var c = 0; c < cols.length; c++) {
            var col = cols[c];
            var dx = Math.abs(x - col.xc);
            if (dx >= CONV_HALF) continue;
            for (var k = 0; k < col.pairs.length; k++) {
                var a = col.pairs[k][0], b = col.pairs[k][1];
                if (rail !== a && rail !== b) continue;
                var t = dx <= CONV_FLAT ? 1 : (CONV_HALF - dx) / (CONV_HALF - CONV_FLAT);
                y += (rail === a) ? CONV_OFF * t : -CONV_OFF * t;
            }
        }
        return y;
    }

    // ---------- state ----------
    var canvas = document.getElementById("mzi-canvas");
    var ctx = canvas.getContext("2d");
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var cat = 0;                          // active input channel
    var parts = [];                       // light pulses in flight
    var out = new Array(RAILS).fill(0);   // output port glow levels
    var lastSpawn = 0, holdUntil = 0, nextCycle = 5200, lastTs = 0;

    var buttons = Array.prototype.slice.call(
        document.querySelectorAll("#channel-row .ch-btn"));

    function rgba(c, a) {
        return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
    }

    function setCat(i, manual) {
        cat = i;
        for (var b = 0; b < buttons.length; b++) {
            var on = b === i;
            buttons[b].classList.toggle("active", on);
            buttons[b].style.borderColor = on ? rgba(GROUPS[b].rgb, 1) : "";
            buttons[b].style.color = on ? rgba(GROUPS[b].rgb, 1) : "";
        }
        if (manual) {
            holdUntil = performance.now() + 15000;
            lastSpawn = -1e9; // fire a pulse on the next frame, not up to ~1s later
        }
        if (reducedMotion) drawFrame();
    }

    buttons.forEach(function (btn, i) {
        btn.addEventListener("click", function () { setCat(i, true); });
    });

    // ---------- simulation ----------
    var SPEED = 2.6; // logical px per 16.7 ms

    function step(ts) {
        var dt = lastTs ? Math.min(50, ts - lastTs) : 16.7;
        lastTs = ts;
        var adv = SPEED * dt / 16.7;

        if (ts > nextCycle && ts > holdUntil) {
            nextCycle = ts + 5200;
            setCat((cat + 1) % GROUPS.length, false);
        }

        if (ts - lastSpawn > 1050) {
            lastSpawn = ts;
            var rgb = GROUPS[cat].rgb;
            parts.push({ rail: cat * 2, x: IN_X + 8, inten: 1, rgb: rgb });
            parts.push({ rail: cat * 2 + 1, x: IN_X, inten: 0.85, rgb: rgb });
        }

        var next = [];
        for (var n = 0; n < parts.length; n++) {
            var p = parts[n];
            var prevX = p.x;
            p.x += adv;
            for (var c = 0; c < cols.length; c++) {
                var col = cols[c];
                if (prevX < col.xc && p.x >= col.xc) {
                    for (var k = 0; k < col.pairs.length; k++) {
                        var a = col.pairs[k][0], b = col.pairs[k][1];
                        if (p.rail !== a && p.rail !== b) continue;
                        var cr = col.ratios[k];
                        var other = p.rail === a ? b : a;
                        var iCross = p.inten * cr, iStay = p.inten * (1 - cr);
                        if (iCross > 0.05 && iStay > 0.05 && parts.length + next.length < 220) {
                            p.inten = iStay;
                            next.push({ rail: other, x: p.x, inten: iCross, rgb: p.rgb });
                        } else if (iCross > iStay) { p.rail = other; p.inten = iCross; }
                        else { p.inten = iStay; }
                        break;
                    }
                }
            }
            if (p.x >= MESH_R) out[p.rail] = Math.min(1.4, out[p.rail] + p.inten);
        }
        parts = parts.concat(next).filter(function (p) {
            return p.x < MESH_R && p.inten > 0.03;
        });
        var decay = Math.pow(0.965, dt / 16.7);
        for (var r = 0; r < RAILS; r++) out[r] *= decay;
    }

    // ---------- drawing ----------
    function drawFrame() {
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.clearRect(0, 0, W, H);

        // rails
        ctx.strokeStyle = "rgba(130, 160, 210, 0.28)";
        ctx.lineWidth = 1.4;
        for (var r = 0; r < RAILS; r++) {
            ctx.beginPath();
            ctx.moveTo(IN_X, railY(r, IN_X));
            for (var x = IN_X + 4; x <= MESH_R + 6; x += 4) ctx.lineTo(x, railY(r, x));
            ctx.stroke();
        }

        // couplers + phase shifters
        for (var c = 0; c < cols.length; c++) {
            var col = cols[c];
            for (var k = 0; k < col.pairs.length; k++) {
                var a = col.pairs[k][0], b = col.pairs[k][1];
                var yTop = railY0[a] + CONV_OFF, yBot = railY0[b] - CONV_OFF;
                ctx.strokeStyle = "rgba(170, 200, 255, 0.5)";
                ctx.lineWidth = 2;
                for (var side = -1; side <= 1; side += 2) {
                    ctx.beginPath();
                    ctx.moveTo(col.xc + side * 15, yTop);
                    ctx.lineTo(col.xc + side * 15, yBot);
                    ctx.stroke();
                }
                ctx.fillStyle = "rgba(170, 200, 255, 0.35)";
                ctx.fillRect(col.xc - 6, yTop - 2.5, 12, 5);
            }
        }

        // light pulses (trail + glowing head)
        for (var n = 0; n < parts.length; n++) {
            var p = parts[n];
            var y = railY(p.rail, p.x);
            var x0 = Math.max(IN_X, p.x - 15);
            ctx.globalAlpha = Math.min(1, 0.25 + p.inten);
            ctx.strokeStyle = rgba(p.rgb, 1);
            ctx.lineWidth = 0.8 + 2.4 * p.inten;
            ctx.beginPath();
            ctx.moveTo(x0, railY(p.rail, x0));
            ctx.lineTo(p.x, y);
            ctx.stroke();
            ctx.shadowBlur = 14;
            ctx.shadowColor = rgba(p.rgb, 1);
            ctx.fillStyle = rgba(p.rgb, 1);
            ctx.beginPath();
            ctx.arc(p.x, y, 2 + 2.5 * Math.sqrt(p.inten), 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // output port glows
        for (var r2 = 0; r2 < RAILS; r2++) {
            var g = out[r2];
            if (g < 0.02) continue;
            ctx.globalAlpha = Math.min(1, g);
            ctx.fillStyle = rgba(GROUPS[cat].rgb, 1);
            ctx.shadowBlur = 14;
            ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath();
            ctx.arc(MESH_R + 4, railY0[r2], 3 + 5 * g, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // input markers on the active channel's rails
        ctx.globalAlpha = 1;
        ctx.fillStyle = rgba(GROUPS[cat].rgb, 1);
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.fillStyle;
        for (var d = 0; d < 2; d++) {
            ctx.beginPath();
            ctx.arc(IN_X - 10, railY0[cat * 2 + d], 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        // output skill labels — four per port, active group tinted
        ctx.textAlign = "left";
        for (var r3 = 0; r3 < RAILS; r3++) {
            var group = GROUPS[r3 >> 1];
            var active = (r3 >> 1) === cat;
            var glow = Math.min(1, out[r3]);
            for (var s = 0; s < 4; s++) {
                var yl = railY0[r3] + (s - 1.5) * 12.5 + 3.5;
                var alpha = Math.min(1, (active ? 0.85 : 0.4) + 0.4 * glow);
                if (active) {
                    ctx.fillStyle = rgba(group.rgb, alpha);
                    ctx.font = "500 10.5px 'IBM Plex Mono', monospace";
                } else {
                    ctx.fillStyle = "rgba(139, 150, 171, " + alpha + ")";
                    ctx.font = "400 10.5px 'IBM Plex Mono', monospace";
                }
                ctx.fillText(SKILLS[r3 * 4 + s], LABEL_X, yl);
            }
        }
    }

    // ---------- boot ----------
    function loop(ts) {
        step(ts);
        drawFrame();
        requestAnimationFrame(loop);
    }

    setCat(0, false);
    if (reducedMotion) {
        drawFrame(); // static mesh; channel clicks re-highlight labels
    } else {
        requestAnimationFrame(loop);
    }

    // canvas text renders before webfonts arrive — redraw once they do
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
            if (reducedMotion) drawFrame();
        });
    }
})();
