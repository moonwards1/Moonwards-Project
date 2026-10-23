// ES module (loaded with <script type="module">).
import { Const } from "../../Shared/constants.js";
import { computeSpaceElevator } from "./spaceElevatorModel.js";

// ── constants ──────────────────────────────────────────────────
const AU     = Const.AU;    // m

const BODIES = {
	ceres:  { radius: 476.2, GM: 6.26325e10,   period: 9.074, peri: 2.55, a_sun: 2.77, apo: 2.99 },
	vesta:  { radius: 262.7, GM: 1.72887e10, period: 5.342, peri: 2.15, a_sun: 2.36, apo: 2.57 },
	psyche: { radius: 111,   GM: 1.601e9,    period: 4.196, peri: 2.53, a_sun: 2.92, apo: 3.33 },
};

const MATERIALS = {
	steel:  { strength: 2.62,  density: 8000 },
	zylon:  { strength: 5.8,   density: 1540 },
	esilica: { strength: 13,    density: 2300 },
	msilica: { strength: 17,    density: 2300 },
	ecnt:   { strength: 18,    density: 1400 },
	mcnt:   { strength: 42,    density: 1400 },
};

// ── preset wiring ──────────────────────────────────────────────
document.getElementById("bodyPreset").onchange = function() {
	const b = BODIES[this.value];
	if (!b) return;
	const R = b.radius * 1e3;
	document.getElementById("radius").value   = b.radius;
	document.getElementById("gsurf").value    = (b.GM / (R * R)).toFixed(4);
	document.getElementById("period").value   = b.period;
	document.getElementById("sunPeri").value  = b.peri;
	document.getElementById("sunOrbit").value = b.a_sun;
	document.getElementById("sunApo").value   = b.apo;
};

document.getElementById("materialPreset").onchange = function() {
	const m = MATERIALS[this.value];
	if (!m) return;
	document.getElementById("strength").value = m.strength;
	document.getElementById("density").value  = m.density;
	updateBreakingLength();
};

function resetDefaults() {
	document.getElementById("radius").value    = 476.2;
	document.getElementById("gsurf").value     = 0.2763;
	document.getElementById("period").value    = 9.074;
	document.getElementById("sunPeri").value   = 2.55;
	document.getElementById("sunOrbit").value  = 2.77;
	document.getElementById("sunApo").value    = 2.99;
	document.querySelector('input[name="sunRef"][value="avg"]').checked = true;
	document.getElementById("strength").value  = 42;
	document.getElementById("density").value   = 1400;
	document.getElementById("safety").value    = 2;
	document.getElementById("tipAlt").value    = 0;
	document.getElementById("output").style.display = "none";
	updateBreakingLength();
}

// ── breaking length ────────────────────────────────────────────
// Length of cable that would break under its own weight at 1 g.
// BL = tensile_strength [Pa] / (density [kg/m³] × g₀ [m/s²])
function updateBreakingLength() {
	const sig = parseFloat(document.getElementById("strength").value);
	const rho = parseFloat(document.getElementById("density").value);
	const el  = document.getElementById("o-breaking");
	if (!isFinite(sig) || !isFinite(rho) || rho <= 0 || sig <= 0) {
		el.textContent = "—"; return;
	}
	const bl_km = (sig * 1e9) / (rho * Const.g0) / 1000;
	el.textContent = bl_km.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Initialise on load
updateBreakingLength();

// Handlers are attached here rather than inline: module functions are not
// global, so onclick="calculate()" in the HTML cannot see them.
document.getElementById("strength").addEventListener("input", updateBreakingLength);
document.getElementById("density").addEventListener("input", updateBreakingLength);
document.getElementById("calcBtn").addEventListener("click", calculate);
document.getElementById("resetBtn").addEventListener("click", resetDefaults);

// ── helpers ────────────────────────────────────────────────────
function fmt(n, digits=4) {
	if (!isFinite(n)) return "—";
	if (Math.abs(n) >= 1e9)  return (n/1e9).toFixed(digits) + " G";
	if (Math.abs(n) >= 1e6)  return (n/1e6).toFixed(digits) + " M";
	if (Math.abs(n) >= 1000) return (n/1e3).toFixed(digits) + " k";
	return n.toFixed(digits);
}

function set(id, val) { document.getElementById(id).textContent = val; }

// ── main calculation ───────────────────────────────────────────
// The physics is spaceElevatorModel.js (shared with the home workbench).
function calculate() {
	const R_km   = parseFloat(document.getElementById("radius").value);
	const gSurf  = parseFloat(document.getElementById("gsurf").value);
	const T_hr   = parseFloat(document.getElementById("period").value);
	const sig_GPa= parseFloat(document.getElementById("strength").value);
	const rho    = parseFloat(document.getElementById("density").value);
	const safety = parseFloat(document.getElementById("safety").value);
	const tipKm  = parseFloat(document.getElementById("tipAlt").value);

	const R      = R_km * 1e3;             // m
	const GM_val = gSurf * R * R;          // m³/s²
	const sig    = sig_GPa * 1e9;          // Pa
	const omega  = 2 * Math.PI / (T_hr * 3600);   // rad/s
	const sunRef = document.querySelector('input[name="sunRef"]:checked').value;
	const sunId  = sunRef === 'peri' ? 'sunPeri' : sunRef === 'apo' ? 'sunApo' : 'sunOrbit';

	const se = computeSpaceElevator({
		GM: GM_val, R: R, omega: omega,
		rTip: tipKm > 0 ? R + tipKm * 1e3 : NaN,
		sigmaEff: sig / safety, density: rho,
		aSun: parseFloat(document.getElementById(sunId).value) * AU
	});
	if (se.autoTip) document.getElementById("tipAlt").value = ((se.rTip - R) / 1e3).toFixed(1);

	// ── fill outputs ──
	set("o-hsync",     fmt(se.hSync / 1e3, 2));
	set("o-vsync",     se.vSync.toFixed(2));
	set("o-taper",     se.taper.toFixed(4));
	set("o-massratio", se.massRatio < 10000 ? se.massRatio.toFixed(2) : se.massRatio.toExponential(3));
	set("o-vtip",      se.vTip.toFixed(2) + " m/s");
	set("o-tipgrav",   se.aTip.toFixed(2));
	set("o-vesc",      se.vEsc.toFixed(2) + " m/s");
	document.getElementById("o-escrow").innerHTML = se.escapes
		? '<span class="ok">Escapes orbit of body</span>'
		: '<span class="warn">Doesn\'t escape orbit of body</span>';
	const proRow = document.getElementById("o-prograde-row");
	if (se.escapes) {
		// The ship escapes the body: where it ends up in the solar system.
		set("o-lastrow-label", "Heliocentric periapsis (retrograde release):");
		set("o-helioperi", isFinite(se.helio.retroPeri) ? (se.helio.retroPeri / AU).toFixed(4) + " AU" : "Escape from solar system");
		set("o-heliopro",  isFinite(se.helio.proApo) ? (se.helio.proApo / AU).toFixed(4) + " AU" : "Escapes solar system");
		proRow.style.display = "";
	} else {
		// The ship stays bound: released above synchronous orbit faster than
		// circular, so the release is the periapsis and the apoapsis lies farther out.
		set("o-lastrow-label", "Apoapsis altitude (asteroid orbit):");
		set("o-helioperi", fmt((se.helio.bodyApo - R) / 1e3, 1) + " km");
		proRow.style.display = "none";
	}

	document.getElementById("output").style.display = "block";
	drawCombined(R, R, se.rSync, se.rTip, GM_val, omega, rho, sig, safety);
}


// ── combined diagram + taper profile ──────────────────────────
// Body bar, tapered cable (width proportional to diameter, tip fixed at
// 10 px), sync orbit marker, and a draggable tip handle.
// Dragging updates tipAlt live; releasing triggers a full recalculate.
var lastDiagramArgs = null;   // redrawn when the column width changes
function drawCombined(R, rFoot, rSync, rTip, GM, omega, rho, sig, safety) {
	lastDiagramArgs = Array.prototype.slice.call(arguments);
	const sigmaEff = sig / safety;
	const steps = 300;
	const dr = (rTip - rFoot) / steps;

	// log(A(r) / A_tip): integrate inward from tip.
	// Correct ODE: d(lnA)/dr = (ρ/σ_eff)(GM/r² − ω²r)
	//   ↔ stepping downward: logA[i] = logA[i+1] + (ρ/σ)(ω²r − GM/r²)·dr
	//   (above sync the ω² term wins → logA grows toward sync ✓)
	const logA = new Float64Array(steps + 1); // logA[steps] = 0 at tip
	for (let i = steps - 1; i >= 0; i--) {
		const r = rFoot + (i + 0.5) * dr;
		logA[i] = logA[i + 1] + (rho / sigmaEff) * (omega * omega * r - GM / (r * r)) * dr;
	}

	const svgNS = "http://www.w3.org/2000/svg";
	const svg = document.getElementById("combined-svg");
	while (svg.firstChild) svg.removeChild(svg.firstChild);

	// Drawn at the width the column actually gives it, so text keeps its size.
	const W = Math.max(320, Math.round(svg.parentElement.clientWidth || 860));
	const H = 220;
	svg.setAttribute("width", W);
	svg.setAttribute("height", H);
	svg.setAttribute("viewBox", "0 0 " + W + " " + H);
	const padR = 30;
	const totalW = W - padR;   // usable width, origin = body centre

	const lineY    = 32;          // y of the thin tether line
	const taperTop = lineY + 12;  // top edge of taper profile (just below line)
	const taperBot = H - 46;      // bottom limit of taper profile
	const maxTaperH = taperBot - taperTop;

	// Coordinate system matches tetherTool_2: origin at body centre.
	// toX(r) maps any absolute radius r to an SVG x pixel.
	// The planet circle at x=0 is clipped at the SVG left edge, just like
	// the planet in tetherTool_2 sits at the origin of its viewBox.
	const toX = r  => r / rTip * totalW;
	const toR = px => px * rTip / totalW;

	function mk(tag) { return document.createElementNS(svgNS, tag); }

	function line(x1, y1, x2, y2, stroke, dash, sw) {
		const l = mk("line");
		l.setAttribute("x1", x1); l.setAttribute("y1", y1);
		l.setAttribute("x2", x2); l.setAttribute("y2", y2);
		l.setAttribute("stroke", stroke || "#666");
		l.setAttribute("stroke-width", sw || 1);
		if (dash) l.setAttribute("stroke-dasharray", dash);
		svg.appendChild(l);
	}

	function txt(x, y, s, anchor, col, size) {
		const t = mk("text");
		t.setAttribute("x", x); t.setAttribute("y", y);
		t.setAttribute("text-anchor", anchor || "middle");
		t.setAttribute("font-size", size || 11);
		t.setAttribute("fill", col || "#333");
		t.setAttribute("pointer-events", "none");
		t.textContent = s;
		svg.appendChild(t);
		return t;
	}

	// Planet circle: centred at x=0 (body centre), radius scaled to match the
	// tether length — same approach as tetherTool_2.  Only the right half is
	// visible since the SVG clips at x=0.
	const bodyR_px = toX(R);
	const planet = mk("circle");
	planet.setAttribute("cx", 0);
	planet.setAttribute("cy", lineY);
	planet.setAttribute("r", bodyR_px.toFixed(1));
	planet.setAttribute("fill", "#888");
	planet.setAttribute("stroke", "#555");
	planet.setAttribute("stroke-width", 1);
	svg.appendChild(planet);

	// Thin tether line from surface to tip (shows length only)
	line(bodyR_px.toFixed(1), lineY, toX(rTip).toFixed(1), lineY, "#2a5a8a", null, 1.5);

	// Taper cross-section profile (tetherTool_2 approach)
	// Diameter proportional to sqrt(A(r)/A_tip) = exp(0.5*logA[i]).
	// Profile hangs below the tether line: flat top edge, curved bottom.
	// Scale = referenceScale * maxHalf (i.e. ∝ sqrt(taperRatio)), capped at
	// maxTaperH.  Low taper → whole profile is thin; high taper → tall peak
	// at sync orbit, tiny tip.  Mirrors the tetherTool_2 tether_width_scale.
	const referenceScale = maxTaperH / 8;   // px per unit sqrt(ratio) at reference
	let maxHalf = 0;
	for (let i = 0; i <= steps; i++) maxHalf = Math.max(maxHalf, Math.exp(0.5 * logA[i]));
	const k = Math.min(referenceScale, maxTaperH / maxHalf);

	const topPts = [], botPts = [];
	for (let i = 0; i <= steps; i++) {
		const r = rFoot + i / steps * (rTip - rFoot);
		const x = toX(r).toFixed(2);
		const depth = (Math.exp(0.5 * logA[i]) * k).toFixed(2);
		topPts.push(x + "," + taperTop);
		botPts.push(x + "," + (taperTop + parseFloat(depth)).toFixed(2));
	}
	const taperShape = mk("path");
	taperShape.setAttribute("d",
		"M " + topPts.join(" L ") + " L " + botPts.slice().reverse().join(" L ") + " Z");
	taperShape.setAttribute("fill", "#7ab8e8");
	taperShape.setAttribute("stroke", "#2a5a8a");
	taperShape.setAttribute("stroke-width", "1");
	svg.appendChild(taperShape);

	// Sync orbit dashed line spanning both regions + label
	const sx = toX(rSync).toFixed(1);
	line(sx, 0, sx, taperBot, "#558", "5,4");
	txt(sx, taperBot + 14, "sync orbit", "middle", "#446");

	// Tip altitude label (above tether line; moves during drag)
	const tipXpx = toX(rTip).toFixed(1);
	const tipLabel = txt(tipXpx, lineY - 8,
		((rTip - R) / 1e3).toFixed(0) + " km", "middle", "#1a6e1a", 11);
	tipLabel.id = "tip-drag-label";

	// Draggable tip marker (sits on the tether line)
	const marker = mk("circle");
	marker.setAttribute("cx", tipXpx);
	marker.setAttribute("cy", lineY);
	marker.setAttribute("r", 6);
	marker.setAttribute("fill", "#2a8a2a");
	marker.setAttribute("stroke", "#145a14");
	marker.setAttribute("stroke-width", 1.5);
	marker.setAttribute("cursor", "ew-resize");
	svg.appendChild(marker);

	// Drag — listeners on document so releasing outside the SVG still fires
	marker.addEventListener("mousedown", e => {
		e.preventDefault();
		svg.style.cursor = "ew-resize";

		const onMove = e => {
			const rect = svg.getBoundingClientRect();
			const newR = Math.max(rSync * 1.01, toR((e.clientX - rect.left) * (W / rect.width)));
			const newX = toX(newR).toFixed(1);
			marker.setAttribute("cx", newX);
			const lbl = document.getElementById("tip-drag-label");
			if (lbl) { lbl.setAttribute("x", newX); lbl.textContent = ((newR - R) / 1e3).toFixed(0) + " km"; }
			document.getElementById("tipAlt").value = ((newR - R) / 1e3).toFixed(1);
		};

		const onUp = () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			svg.style.cursor = "default";
			calculate();
		};

		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});
}

// Redraw the diagram when its column changes width.
(function () {
	const wrap = document.getElementById("combined-svg").parentElement;
	let lastW = 0;
	new ResizeObserver(function () {
		const w = Math.round(wrap.clientWidth);
		if (w === lastW) return;
		lastW = w;
		if (lastDiagramArgs && document.getElementById("output").style.display !== "none") {
			drawCombined.apply(null, lastDiagramArgs);
		}
	}).observe(wrap);
})();
