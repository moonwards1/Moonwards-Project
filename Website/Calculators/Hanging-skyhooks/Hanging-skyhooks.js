// Hanging Skyhook Calculator — the standalone page. The calculator itself is
// skyhookCalc.js; this mounts one into the page's #app element.
//
// ES module (loaded with <script type="module">); deferred, so the DOM is ready.

import { mountHangingSkyhook } from "./skyhookCalc.js";

mountHangingSkyhook(document.getElementById("app"));
