// ============================================================
// MINTAKA — Skills as a binary MZI splitter tree (photonics pillar)
//
// One input beam, 5 levels of tunable Mach–Zehnder interferometers
// (1+2+4+8+16 = 31 nodes), 32 output ports = 32 skills.
//
// Each node is an MZI (two 50:50 couplers around an internal phase
// shifter θ). Its top-output fraction is |U00|² = sin²(θ/2):
//   θ = π  → 100% up,  θ = π/2 → 50:50,  θ = 0 → 100% down.
// So dragging the phase shifter physically re-routes the light.
//
// Interactions:
//   • drag a node vertically — continuously tune its split
//   • click a node — cycle 100%↑ / 50:50 / 100%↓
//   • click a skill (leaf) — animate the phase shifters level by
//     level so ALL the light routes to that one port
// ============================================================

(function () {
    "use strict";

    // ---------- skills (32 leaves, in tree order) ----------
    var GROUPS = [
        { name: "Hardware", color: [255, 190, 77] },
        { name: "Quantum", color: [95, 216, 232] },
        { name: "Software", color: [126, 227, 154] },
        { name: "ML & Data", color: [180, 154, 255] }
    ];

    var SKILLS = [
        // Hardware (0–7)
        "FPGA design (VHDL)", "Verilog & RTL", "Embedded & microcontrollers", "Digital electronics",
        "Analog electronics", "Lab instrumentation", "LabVIEW", "PCB & prototyping",
        // Quantum (8–15)
        "Photonic quantum computing", "GBS systems", "MZI interferometry", "Single-photon detection",
        "Qiskit", "Quantum error correction", "Quantum simulation", "Quantum optics",
        // Software (16–23)
        "Python", "C & low-level", "JavaScript & creative coding", "Django & REST APIs",
        "Node.js", "MATLAB", "R & statistics", "Linux & shell",
        // ML & Data (24–31)
        "TensorFlow & deep learning", "Graph neural networks", "Computer vision (OpenCV)", "NLP & language modeling",
        "Local LLMs & agents", "Signal processing", "Scientific computing", "Data viz & dashboards"
    ];

    var LEVELS = 5;               // tree depth
    var N_LEAVES = 32;            // 2^LEVELS
    var HALF_PI = Math.PI / 2;

    function groupOf(leaf) { return GROUPS[Math.floor(leaf / 8)]; }

    // ---------- nodes ----------
    // nodes[level][k], level 0..4, k 0..2^level-1
    var nodes = [];
    for (var L = 0; L < LEVELS; L++) {
        nodes.push([]);
        for (var k = 0; k < (1 << L); k++) {
            nodes[L].push({ theta: HALF_PI, level: L, k: k, x: 0, y: 0 });
        }
    }

    function topFrac(theta) {
        var s = Math.sin(theta / 2);
        return s * s; // |U00|² of BS·P(θ)·BS
    }

    // intensity arriving AT node (L,k); root gets 1
    function nodeIntensity(L, k) {
        var I = 1;
        for (var lev = 0; lev < L; lev++) {
            var parentK = k >> (L - lev);
            var childDir = (k >> (L - lev - 1)) & 1; // 0 = top branch
            var f = topFrac(nodes[lev][parentK].theta);
            I *= (childDir === 0) ? f : (1 - f);
        }
        return I;
    }

    function leafIntensity(leaf) {
        // leaf behaves like a "node" at level LEVELS
        var I = 1;
        for (var lev = 0; lev < LEVELS; lev++) {
            var parentK = leaf >> (LEVELS - lev);
            var childDir = (leaf >> (LEVELS - lev - 1)) & 1;
            var f = topFrac(nodes[lev][parentK].theta);
            I *= (childDir === 0) ? f : (1 - f);
        }
        return I;
    }

    // ---------- canvas ----------
    var canvas = document.getElementById("mzi-canvas");
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, DPR = 1;
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var LABEL_ZONE = 200;   // px reserved for skill labels on the right
    var LEFT_PAD = 26;
    var TOP_PAD = 16;
    var leafGap = 24;

    var NODE_W = 20, NODE_H = 26;

    function layout() {
        var treeW = W - LABEL_ZONE - LEFT_PAD - 10;
        var colW = treeW / LEVELS;
        for (var L = 0; L < LEVELS; L++) {
            for (var k = 0; k < nodes[L].length; k++) {
                var span = 1 << (LEVELS - L);       // leaves under this node
                var centerLeaf = k * span + span / 2;
                nodes[L][k].x = LEFT_PAD + (L + 0.35) * colW;
                nodes[L][k].y = TOP_PAD + centerLeaf * leafGap;
            }
        }
    }

    function leafX() { return W - LABEL_ZONE - 4; }
    function leafY(i) { return TOP_PAD + (i + 0.5) * leafGap; }

    function resize() {
        DPR = window.devicePixelRatio || 1;
        var scroll = document.getElementById("mesh-scroll");
        var cssW = Math.max(680, scroll.getBoundingClientRect().width - 20);
        var cssH = TOP_PAD * 2 + N_LEAVES * leafGap;
        canvas.style.width = cssW + "px";
        canvas.style.height = cssH + "px";
        canvas.width = Math.round(cssW * DPR);
        canvas.height = Math.round(cssH * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        W = cssW; H = cssH;
        layout();
    }

    // ---------- route animation ----------
    // anims: [{ node, from, to, start, dur }]
    var anims = [];
    var highlightLeaf = null;

    function routeToLeaf(leaf) {
        anims = [];
        highlightLeaf = leaf;
        var now = performance.now();
        for (var lev = 0; lev < LEVELS; lev++) {
            var k = leaf >> (LEVELS - lev);
            var childDir = (leaf >> (LEVELS - lev - 1)) & 1; // 0 → top → θ=π
            var node = nodes[lev][k];
            var target = childDir === 0 ? Math.PI : 0;
            anims.push({
                node: node,
                from: node.theta,
                to: target,
                start: now + lev * 220,   // cascade level by level
                dur: reducedMotion ? 0 : 650
            });
        }
    }

    function easeInOut(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function stepAnims(now) {
        for (var i = anims.length - 1; i >= 0; i--) {
            var a = anims[i];
            if (now < a.start) continue;
            var t = a.dur === 0 ? 1 : Math.min(1, (now - a.start) / a.dur);
            a.node.theta = a.from + (a.to - a.from) * easeInOut(t);
            if (t >= 1) anims.splice(i, 1);
        }
    }

    // ---------- drawing ----------
    function edgePath(x1, y1, x2, y2) {
        var mx = (x1 + x2) / 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
    }

    function drawEdge(x1, y1, x2, y2, I, tint) {
        // dark guide
        ctx.strokeStyle = "rgba(55, 80, 115, 0.55)";
        ctx.lineWidth = 2.6;
        edgePath(x1, y1, x2, y2);
        ctx.stroke();
        // light
        if (I > 0.003) {
            var c = tint || [110, 230, 255];
            ctx.strokeStyle = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + Math.min(1, 0.12 + 0.95 * I) + ")";
            ctx.lineWidth = 1.6 + 2.2 * I;
            ctx.shadowColor = "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.9)";
            ctx.shadowBlur = 16 * I;
            edgePath(x1, y1, x2, y2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    function pointOnEdge(x1, y1, x2, y2, t) {
        // cubic bezier with control points (mx,y1),(mx,y2)
        var mx = (x1 + x2) / 2;
        var u = 1 - t;
        var x = u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2;
        var y = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
        return { x: x, y: y };
    }

    function drawNode(node) {
        var x = node.x, y = node.y;
        var f = topFrac(node.theta);
        var I = nodeIntensity(node.level, node.k);

        // body
        ctx.fillStyle = "rgba(14, 24, 44, 0.94)";
        ctx.strokeStyle = I > 0.02
            ? "rgba(120, 190, 235, " + (0.35 + 0.5 * I) + ")"
            : "rgba(90, 120, 160, 0.35)";
        ctx.lineWidth = 1;
        roundRect(x - NODE_W / 2, y - NODE_H / 2, NODE_W, NODE_H, 5);
        ctx.fill();
        ctx.stroke();

        // heater bar (the phase shifter): position slides with split ratio
        var barY = y + (0.5 - f) * (NODE_H - 10); // f=1 → top, f=0 → bottom
        var heat = node.theta / Math.PI;
        ctx.fillStyle = "rgba(255, 150, 70, " + (0.35 + 0.6 * heat) + ")";
        ctx.shadowColor = "rgba(255, 140, 60, 0.9)";
        ctx.shadowBlur = 8 * heat * Math.max(0.25, I);
        roundRect(x - NODE_W / 2 + 3, barY - 2.5, NODE_W - 6, 5, 2.5);
        ctx.fill();
        ctx.shadowBlur = 0;

        // split readout (top %) — only when carrying light
        if (I > 0.02) {
            ctx.fillStyle = "rgba(170, 215, 245, " + (0.4 + 0.5 * I) + ")";
            ctx.font = "600 8px 'JetBrains Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(Math.round(f * 100) + "%", x, y - NODE_H / 2 - 4);
        }
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function childPos(L, k, dir) {
        // position of child (top: dir=0, bottom: dir=1) of node (L,k)
        if (L === LEVELS - 1) {
            var leaf = k * 2 + dir;
            return { x: leafX(), y: leafY(leaf), leaf: leaf };
        }
        var n = nodes[L + 1][k * 2 + dir];
        return { x: n.x - NODE_W / 2, y: n.y, leaf: null };
    }

    var photonPhase = 0;

    function drawFrame(now) {
        stepAnims(now || performance.now());
        ctx.clearRect(0, 0, W, H);

        // input stub
        var root = nodes[0][0];
        drawEdge(6, root.y, root.x - NODE_W / 2, root.y, 1);
        ctx.fillStyle = "rgba(140, 240, 255, 0.9)";
        ctx.font = "600 10px 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("LIGHT IN →", 6, root.y - 10);

        // edges (parent → children), leaves tinted by group
        for (var L = 0; L < LEVELS; L++) {
            for (var k = 0; k < nodes[L].length; k++) {
                var node = nodes[L][k];
                var I = nodeIntensity(L, k);
                var f = topFrac(node.theta);
                for (var dir = 0; dir < 2; dir++) {
                    var child = childPos(L, k, dir);
                    var branchI = I * (dir === 0 ? f : 1 - f);
                    var tint = child.leaf !== null ? groupOf(child.leaf).color : null;
                    drawEdge(node.x + NODE_W / 2, node.y, child.x, child.y, branchI, tint);
                }
            }
        }

        // photons along bright branches
        if (!reducedMotion) {
            photonPhase = (photonPhase + 0.012) % 1;
            for (var L2 = 0; L2 < LEVELS; L2++) {
                for (var k2 = 0; k2 < nodes[L2].length; k2++) {
                    var nd = nodes[L2][k2];
                    var I2 = nodeIntensity(L2, k2);
                    var f2 = topFrac(nd.theta);
                    for (var d2 = 0; d2 < 2; d2++) {
                        var bI = I2 * (d2 === 0 ? f2 : 1 - f2);
                        if (bI < 0.03) continue;
                        var ch = childPos(L2, k2, d2);
                        var tt = (photonPhase + (L2 * 0.13 + k2 * 0.07 + d2 * 0.31)) % 1;
                        var p = pointOnEdge(nd.x + NODE_W / 2, nd.y, ch.x, ch.y, tt);
                        ctx.fillStyle = "rgba(220, 250, 255, " + Math.min(1, 0.3 + bI) + ")";
                        ctx.shadowColor = "rgba(150, 240, 255, 1)";
                        ctx.shadowBlur = 7;
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 1.4 + 1.8 * bI, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.shadowBlur = 0;
                    }
                }
            }
        }

        // nodes on top of edges
        for (var L3 = 0; L3 < LEVELS; L3++) {
            for (var k3 = 0; k3 < nodes[L3].length; k3++) drawNode(nodes[L3][k3]);
        }

        // leaves: port dot + label, brightness ∝ intensity, tinted by group
        for (var leaf = 0; leaf < N_LEAVES; leaf++) {
            var Il = leafIntensity(leaf);
            var gx = leafX(), gy = leafY(leaf);
            var col = groupOf(leaf).color;
            var isHi = leaf === highlightLeaf;

            ctx.fillStyle = "rgba(" + col[0] + "," + col[1] + "," + col[2] + "," + (0.15 + 0.85 * Il) + ")";
            ctx.shadowColor = "rgba(" + col[0] + "," + col[1] + "," + col[2] + ",0.9)";
            ctx.shadowBlur = 18 * Il + (isHi ? 6 : 0);
            ctx.beginPath();
            ctx.arc(gx, gy, 3 + 4 * Il, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            var alpha = 0.38 + 0.62 * Math.min(1, Il * 2.2);
            ctx.fillStyle = isHi
                ? "rgba(255,255,255,0.98)"
                : "rgba(" + (155 + col[0] * 0.35) + "," + (165 + col[1] * 0.3) + "," + (190 + col[2] * 0.25) + "," + alpha + ")";
            ctx.font = (isHi ? "700 " : "400 ") + "10.5px 'JetBrains Mono', monospace";
            ctx.textAlign = "left";
            var pct = Il >= 0.005 ? "  " + (Il >= 0.995 ? "100" : (Il * 100).toFixed(Il < 0.095 ? 1 : 0)) + "%" : "";
            ctx.fillText(SKILLS[leaf] + pct, gx + 10, gy + 3.5);
        }

        requestAnimationFrame(drawFrame);
    }

    // ---------- interaction ----------
    var drag = null; // { node, startY, startTheta, moved }

    function canvasPos(e) {
        var r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function hitNode(p) {
        for (var L = 0; L < LEVELS; L++) {
            for (var k = 0; k < nodes[L].length; k++) {
                var n = nodes[L][k];
                // generous hit box (≥40px tall)
                if (Math.abs(p.x - n.x) < 20 && Math.abs(p.y - n.y) < Math.max(20, leafGap * 0.9)) {
                    return n;
                }
            }
        }
        return null;
    }

    function hitLeaf(p) {
        if (p.x < leafX() - 14) return null;
        var i = Math.floor((p.y - TOP_PAD) / leafGap);
        return (i >= 0 && i < N_LEAVES) ? i : null;
    }

    canvas.addEventListener("pointerdown", function (e) {
        var p = canvasPos(e);
        var n = hitNode(p);
        if (n) {
            anims = [];           // manual control cancels any running route
            highlightLeaf = null;
            drag = { node: n, startY: p.y, startTheta: n.theta, moved: false };
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    });

    canvas.addEventListener("pointermove", function (e) {
        var p = canvasPos(e);
        if (drag) {
            var dy = drag.startY - p.y;        // drag up → more light up
            if (Math.abs(dy) > 3) drag.moved = true;
            drag.node.theta = Math.max(0, Math.min(Math.PI, drag.startTheta + dy * 0.02));
            return;
        }
        canvas.style.cursor = (hitNode(p) || hitLeaf(p) !== null) ? "pointer" : "default";
    });

    function endPointer(e) {
        if (drag) {
            if (!drag.moved) {
                // click: cycle ↑ (π) → 50:50 (π/2) → ↓ (0) → ↑ …
                var th = drag.node.theta;
                if (th > Math.PI * 0.75) drag.node.theta = HALF_PI;
                else if (th > Math.PI * 0.25) drag.node.theta = 0;
                else drag.node.theta = Math.PI;
            }
            drag = null;
            return;
        }
        var p = canvasPos(e);
        var leaf = hitLeaf(p);
        if (leaf !== null) routeToLeaf(leaf);
    }

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", function () { drag = null; });

    // ---------- boot ----------
    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(drawFrame);
})();
