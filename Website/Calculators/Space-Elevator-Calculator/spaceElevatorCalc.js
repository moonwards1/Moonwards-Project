// ── constants ──────────────────────────────────────────────────
const G      = Const.G;
const GM_sun = Const.GM_sun; // m³/s²
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

// ── helpers ────────────────────────────────────────────────────
function fmt(n, digits=4) {
	if (!isFinite(n)) return "—";
	if (Math.abs(n) >= 1e9)  return (n/1e9).toFixed(digits) + " G";
	if (Math.abs(n) >= 1e6)  return (n/1e6).toFixed(digits) + " M";
	if (Math.abs(n) >= 1000) return (n/1e3).toFixed(digits) + " k";
	return n.toFixed(digits);
}

function set(id, val) { document.getElementById(id).textContent = val; }

// ── taper integral (numerical, 2000 steps) ─────────────────────
// Returns A(r_tip)/A(r_foot) — the cross-section ratio needed so
// the cable is nowhere overstressed.
// Taper ratio = A(sync) / A(tip) = exp(∫[rSync→rTip] (ρ/σ_eff)(ω²r - GM/r²) dr)
// Above sync the integrand is always positive, so no abs() needed.
function taperRatio(GM, omega, rSync, rTip, density, strengthPa, safety) {
	const sigmaEff = strengthPa / safety;
	// The integrand (ω²r − GM/r²) is analytically integrable, so use the shared
	// exact taper. (The old 2000-step trapezoidal loop approximated this very
	// integral; the closed form is exact and faster.)
	return OrbitalMath.taperRatio(GM, omega, rSync, rTip, sigmaEff / density);
}

// Cable mass per kg of payload attached at the tether tip.
// A_tip is set by the net outward force on 1 kg at the tip; cross-section
// grows inward following the exponential-taper profile toward sync orbit.
function cableMassRatio(GM, omega, rFoot, rTip, density, strengthPa, safety) {
	const sigmaEff = strengthPa / safety;
	const steps = 2000;
	const dr = (rTip - rFoot) / steps;

	// cross-section at tip to hold 1 kg of payload
	const netTip = omega * omega * rTip - GM / (rTip * rTip);
	const ATip = Math.abs(netTip) / sigmaEff; // m² per kg

	// log(A(r)/A_tip) = (ρ/σ_eff) · ∫[rTip→r] (ω²r' − GM/r'²) dr'
	// built by stepping inward from rTip (index steps) to rFoot (index 0)
	const logA = new Float64Array(steps + 1);
	for (let i = steps - 1; i >= 0; i--) {
		const r = rFoot + (i + 0.5) * dr;
		logA[i] = logA[i + 1] + (density / sigmaEff) * (omega * omega * r - GM / (r * r)) * dr;
	}

	let mass = 0;
	for (let i = 0; i <= steps; i++) {
		const w = (i === 0 || i === steps) ? 0.5 : 1;
		mass += w * density * ATip * Math.exp(logA[i]) * dr;
	}
	return mass; // kg of cable per kg of tip payload
}

// ── main calculation ───────────────────────────────────────────
function calculate() {
	const R_km   = parseFloat(document.getElementById("radius").value);
	const gSurf  = parseFloat(document.getElementById("gsurf").value);
	const T_hr   = parseFloat(document.getElementById("period").value);
	const sig_GPa= parseFloat(document.getElementById("strength").value);
	const rho    = parseFloat(document.getElementById("density").value);
	const safety = parseFloat(document.getElementById("safety").value);
	let   tipKm  = parseFloat(document.getElementById("tipAlt").value);

	const R      = R_km * 1e3;             // m
	const GM_val = gSurf * R * R;          // m³/s²
	const sig    = sig_GPa * 1e9;          // Pa
	const T_s    = T_hr * 3600;            // s
	const omega  = 2 * Math.PI / T_s;     // rad/s
	const rFoot  = R;
	const rSync  = OrbitalMath.synchronousRadius(GM_val, omega); // m
	const hSync  = (rSync - R) / 1e3;     // km

	// auto-tip: 20% above sync orbit radius
	if (tipKm === 0) {
		tipKm = (rSync * 1.2 - R) / 1e3;
		document.getElementById("tipAlt").value = tipKm.toFixed(1);
	}
	const rTip = R + tipKm * 1e3; // m

	const vSync  = omega * rSync;
	const vTip   = omega * rTip;
	const vEsc   = OrbitalMath.escapeVelocity(GM_val, rTip);

	const taper     = taperRatio(GM_val, omega, rSync, rTip, rho, sig, safety);
	const massRatio = cableMassRatio(GM_val, omega, rFoot, rTip, rho, sig, safety);

	// heliocentric periapsis after retrograde release from tip
	// Release is exactly retrograde to the primary's orbit → heliocentric speed = v_primary − v_tip.
	// Radial velocity is zero at release, so the release point is the apoapsis of the new orbit.
	const vTipInertial = vTip;
	const sunRef  = document.querySelector('input[name="sunRef"]:checked').value;
	const sunId   = sunRef === 'peri' ? 'sunPeri' : sunRef === 'apo' ? 'sunApo' : 'sunOrbit';
	const a_sun_m = parseFloat(document.getElementById(sunId).value) * AU;
	const v_primary    = OrbitalMath.circularVelocity(GM_sun, a_sun_m);
	const v_h          = v_primary - vTipInertial;      // heliocentric velocity (can be negative)
	const speed_h      = Math.abs(v_h);
	const E_helio      = 0.5 * speed_h * speed_h - GM_sun / a_sun_m;
	let helioText;
	if (E_helio >= 0) {
		helioText = "Escape from solar system";
	} else {
		const a_helio = -GM_sun / (2 * E_helio);
		const L_helio = a_sun_m * speed_h;
		const e_helio = Math.sqrt(Math.max(0, 1 - L_helio * L_helio / (GM_sun * a_helio)));
		const r_peri  = a_helio * (1 - e_helio);
		helioText     = (r_peri / AU).toFixed(4) + " AU";
	}

	// ── fill outputs ──
	set("o-hsync",     fmt(hSync, 2));
	set("o-vsync",     vSync.toFixed(2));
	set("o-taper",      taper.toFixed(4));
	set("o-massratio",  massRatio < 10000 ? massRatio.toFixed(2) : massRatio.toExponential(3));
	set("o-vtip",      vTipInertial.toFixed(2) + " m/s");
	const aTip = omega * omega * rTip - GM_val / (rTip * rTip); // net centrifugal in rotating frame
	set("o-tipgrav",   aTip.toFixed(2));
	set("o-vesc",      vEsc.toFixed(2) + " m/s");
	const escRow = document.getElementById("o-escrow");
	escRow.innerHTML = vTipInertial >= vEsc
		? '<span class="ok">Escapes orbit of body</span>'
		: '<span class="warn">Doesn\'t escape orbit of body</span>';
	const proRow = document.getElementById("o-prograde-row");
	if (vTipInertial >= vEsc) {
		// Ship escapes the body — show where it ends up in the solar system
		set("o-lastrow-label", "Heliocentric periapsis (retrograde release):");
		set("o-helioperi", helioText);
		// Prograde release: heliocentric apoapsis
		const v_h_pro     = v_primary + vTipInertial;
		const E_helio_pro = 0.5 * v_h_pro * v_h_pro - GM_sun / a_sun_m;
		let proText;
		if (E_helio_pro >= 0) {
			proText = "Escapes solar system";
		} else {
			const a_helio_pro = -GM_sun / (2 * E_helio_pro);
			const L_helio_pro = a_sun_m * v_h_pro;
			const e_helio_pro = Math.sqrt(Math.max(0, 1 - L_helio_pro * L_helio_pro / (GM_sun * a_helio_pro)));
			proText = (a_helio_pro * (1 + e_helio_pro) / AU).toFixed(4) + " AU";
		}
		set("o-heliopro", proText);
		proRow.style.display = "";
	} else {
		// Ship stays bound — show the apoapsis of its orbit around the body.
		// At the tip (rTip > rSync) velocity is tangential and exceeds circular
		// speed, so the release point is the periapsis; the apoapsis is farther out.
		const E_orb  = 0.5 * vTipInertial * vTipInertial - GM_val / rTip;
		const h_orb  = rTip * vTipInertial;                          // tangential release → h = r·v
		const a_orb  = -GM_val / (2 * E_orb);                       // semi-major axis (> 0)
		const e_orb  = Math.sqrt(Math.max(0, 1 + 2 * E_orb * h_orb * h_orb / (GM_val * GM_val)));
		const r_apo  = a_orb * (1 + e_orb);
		const apoAlt = (r_apo - R) / 1e3;                           // km above surface
		set("o-lastrow-label", "Apoapsis altitude (asteroid orbit):");
		set("o-helioperi", fmt(apoAlt, 1) + " km");
		proRow.style.display = "none";
	}

	document.getElementById("output").style.display = "block";
	drawCombined(R, rFoot, rSync, rTip, GM_val, omega, rho, sig, safety);
}


// ── combined diagram + taper profile ──────────────────────────
// Body bar, tapered cable (width proportional to diameter, tip fixed at
// 10 px), sync orbit marker, and a draggable tip handle.
// Dragging updates tipAlt live; releasing triggers a full recalculate.
function drawCombined(R, rFoot, rSync, rTip, GM, omega, rho, sig, safety) {
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

	const W = +svg.getAttribute("width"), H = +svg.getAttribute("height");
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
			const newR = Math.max(rSync * 1.01, toR(e.clientX - rect.left));
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
