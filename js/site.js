// site.js — small site-bar helper, no dependencies.
// When header.site-bar nav overflows horizontally (phones), scroll it so the
// current-page link is fully visible and roughly centred, and fade whichever
// edges still have more links beyond them. Does nothing when nothing overflows.
(function () {
    "use strict";

    var FADE_PX = 28;         // width of the edge fade
    var EDGE_SLACK_PX = 2;    // scroll positions this close to an end count as "at" the end

    var nav = document.querySelector("header.site-bar nav");
    if (!nav) return;

    try {
        var style = document.createElement("style");
        // beats the single-edge mask in css/site.css by specificity
        style.textContent =
            "header.site-bar nav.nav-fade-l{" +
            "-webkit-mask-image:linear-gradient(90deg,transparent,#000 " + FADE_PX + "px);" +
            "mask-image:linear-gradient(90deg,transparent,#000 " + FADE_PX + "px)}" +
            "header.site-bar nav.nav-fade-l.nav-fade-r{" +
            "-webkit-mask-image:linear-gradient(90deg,transparent,#000 " + FADE_PX + "px,#000 calc(100% - " + FADE_PX + "px),transparent);" +
            "mask-image:linear-gradient(90deg,transparent,#000 " + FADE_PX + "px,#000 calc(100% - " + FADE_PX + "px),transparent)}" +
            "header.site-bar nav.nav-at-end:not(.nav-fade-l){-webkit-mask-image:none;mask-image:none}";
        document.head.appendChild(style);
    } catch (e) { }

    function overflows() { return nav.scrollWidth > nav.clientWidth + 1; }

    function updateFades() {
        var max = nav.scrollWidth - nav.clientWidth;
        var over = max > 1;
        nav.classList.toggle("nav-fade-l", over && nav.scrollLeft > EDGE_SLACK_PX);
        nav.classList.toggle("nav-fade-r", over && nav.scrollLeft < max - EDGE_SLACK_PX);
        nav.classList.toggle("nav-at-end", over && nav.scrollLeft >= max - EDGE_SLACK_PX);
    }

    var touched = false;
    function centreCurrent() {
        if (touched || !overflows()) { updateFades(); return; }
        var cur = nav.querySelector('a[aria-current="page"]');
        if (cur) {
            var n = nav.getBoundingClientRect();
            var c = cur.getBoundingClientRect();
            // set scrollLeft directly: scrollIntoView could also scroll the page vertically
            nav.scrollLeft = nav.scrollLeft + (c.left - n.left) - (n.width - c.width) / 2;
        }
        updateFades();
    }

    ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (ev) {
        nav.addEventListener(ev, function () { touched = true; }, { passive: true });
    });
    nav.addEventListener("scroll", updateFades, { passive: true });
    window.addEventListener("resize", updateFades);

    centreCurrent();
    window.addEventListener("load", centreCurrent);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(centreCurrent);
}());
