// Tip Spin-Launcher Calculator
// ---------------------------------------------------------------------------
// Extends the Space Elevator Calculator with a counter-rotating spin launcher
// mounted at the elevator tip. The elevator block reuses the same model; the
// spin-launcher block takes a user-chosen retrograde boost and plane change
// (from other trajectory tools) and sizes the rotating arm needed to add them.
//
// Shared maths live in ../../Shared/math-utils.js (OrbitalMath) and
// ../../Shared/constants.js (Const). Classic scripts, file:// friendly.

// ── constants ──────────────────────────────────────────────────
const G      = Const.G;
const GM_sun = Const.GM_sun;
const AU     = Const.AU;
const g0     = Const.g0;

const BODIES = {
	ceres:  { radius: 476.2, GM: 6.26325e10, period: 9.074, peri: 2.55, a_sun: 2.77, apo: 2.99, tilt: 4 },
	vesta:  { radius: 262.7, GM: 1.72887e10, period: 5.342, peri: 2.15, a_sun: 2.36, apo: 2.57, tilt: 29 },
	psyche: { radius: 111,   GM: 1.601e9,    period: 4.196, peri: 2.53, a_sun: 2.92, apo: 3.33, tilt: 0 },
};

const MATERIALS = {
	steel:  { strength: 2.62, density: 8000 },
	zylon:  { strength: 5.8,  density: 1540 },
	esilica:{ strength: 13,   density: 2300 },
	msilica:{ strength: 17,   density: 2300 },
	ecnt:   { strength: 18,   density: 1400 },
	mcnt:   { strength: 42,   density: 1400 },
};

// ── preset wiring ──────────────────────────────────────────────
document.getElementById("bodyPreset").onchange = function () {
	const b = BODIES[this.value];
	if (!b) return;
	const R = b.radius * 1e3;
	document.getElementById("radius").value    = b.radius;
	document.getElementById("gsurf").value     = (b.GM / (R * R)).toFixed(4);
	document.getElementById("period").value    = b.period;
	document.getElementById("axialTilt").value = b.tilt;
	document.getElementById("sunPeri").value   = b.peri;
	document.getElementById("sunOrbit").value  = b.a_sun;
	document.getElementById("sunApo").value    = b.apo;
};

document.getElementById("materialPreset").onchange = function () {
	const m = MATERIALS[this.value];
	if (!m) return;
	document.getElementById("strength").value = m.strength;
	document.getElementById("density").value  = m.density;
	updateBreakingLength();
};

document.getElementById("armMaterialPreset").onchange = function () {
	const m = MATERIALS[this.value];
	if (!m) return;
	document.getElementById("armStrength").value = m.strength;
	document.getElementById("armDensity").value  = m.density;
};

// sizing-mode toggle: enable the active field, dim the other
function syncModeFields() {
	const mode = document.querySelector('input[name="sizeMode"]:checked').value;
	const gEl = document.getElementById("gLimit");
	const lEl = document.getElementById("armLen");
	gEl.disabled = (mode !== "g");
	lEl.disabled = (mode !== "L");
	gEl.parentElement.classList.toggle("disabledField", mode !== "g");
	lEl.parentElement.classList.toggle("disabledField", mode !== "L");
}
document.getElementById("modeG").addEventListener("change", function () { syncModeFields(); calculate(); });
document.getElementById("modeL").addEventListener("change", function () { syncModeFields(); calculate(); });

function resetDefaults() {
	document.getElementById("radius").value    = 476.2;
	document.getElementById("gsurf").value     = 0.2763;
	document.getElementById("period").value    = 9.074;
	document.getElementById("axialTilt").value = 4;
	document.getElementById("sunPeri").value   = 2.55;
	document.getElementById("sunOrbit").value  = 2.77;
	document.getElementById("sunApo").value    = 2.99;
	document.querySelector('input[name="sunRef"][value="avg"]').checked = true;
	document.getElementById("strength").value  = 42;
	document.getElementById("density").value   = 1400;
	document.getElementById("safety").value    = 2;
	document.getElementById("tipAlt").value    = 20000;
	document.getElementById("targetPeri").value = 1.0;
	document.getElementById("planeChange").value = 3.5;
	document.getElementById("modeG").checked   = true;
	document.getElementById("gLimit").value    = 10;
	document.getElementById("armLen").value    = 24;
	document.getElementById("tipLoad").value   = 63000;
	document.getElementById("hubMass").value   = 2500000;
	document.getElementById("launchesPerDay").value = 1;
	document.getElementById("armStrength").value = 42;
	document.getElementById("armDensity").value  = 1400;
	document.getElementById("armSafety").value   = 2;
	syncModeFields();
	document.getElementById("output").style.display = "none";
	updateBreakingLength();
}

// ── breaking length ────────────────────────────────────────────
function updateBreakingLength() {
	const sig = parseFloat(document.getElementById("strength").value);
	const rho = parseFloat(document.getElementById("density").value);
	const el  = document.getElementById("o-breaking");
	if (!isFinite(sig) || !isFinite(rho) || rho <= 0 || sig <= 0) { el.textContent = "—"; return; }
	const bl_km = (sig * 1e9) / (rho * g0) / 1000;
	el.textContent = bl_km.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
updateBreakingLength();

// ── formatting helpers ─────────────────────────────────────────
function set(id, val) { document.getElementById(id).textContent = val; }

function siNum(n, digits) {
	if (!isFinite(n)) return "—";
	const a = Math.abs(n);
	if (a >= 1e18) return (n / 1e18).toFixed(digits) + " E";
	if (a >= 1e15) return (n / 1e15).toFixed(digits) + " P";
	if (a >= 1e12) return (n / 1e12).toFixed(digits) + " T";
	if (a >= 1e9)  return (n / 1e9).toFixed(digits) + " G";
	if (a >= 1e6)  return (n / 1e6).toFixed(digits) + " M";
	if (a >= 1e3)  return (n / 1e3).toFixed(digits) + " k";
	return n.toFixed(digits);
}
function fmtSpeed(v) { return v.toFixed(0) + " m/s"; }
function fmtLen(m) {  // metres -> km when large
	if (!isFinite(m)) return "—";
	return Math.abs(m) >= 1000 ? (m / 1000).toFixed(2) + " km" : m.toFixed(1) + " m";
}
function fmtMass(kg, d) {  // kg -> t / kt / Mt / Gt
	if (!isFinite(kg)) return "—";
	const t = kg / 1000, a = Math.abs(t), dd = (d === undefined) ? 2 : d;
	if (a >= 1e9) return (t / 1e9).toFixed(dd) + " Gt";
	if (a >= 1e6) return (t / 1e6).toFixed(dd) + " Mt";
	if (a >= 1e3) return (t / 1e3).toFixed(dd) + " kt";
	return t.toFixed(dd) + " t";
}
function fmtEnergy(J) { return siNum(J, 2) + "J"; }
function fmtPower(W)  { return siNum(W, 2) + "W"; }
function fmtForce(N)  { return siNum(N, 2) + "N"; }
function fmtTorque(Nm){ return siNum(Nm, 2) + "N·m"; }
function fmtL(L)      { return siNum(L, 2) + "kg·m²/s"; }
function fmtVel(v) {  // m/s, switching to mm/s for tiny kicks
	if (!isFinite(v)) return "—";
	const a = Math.abs(v);
	if (a < 1e-3) return (v * 1e6).toFixed(2) + " µm/s";
	if (a < 1)    return (v * 1e3).toFixed(2) + " mm/s";
	return v.toFixed(2) + " m/s";
}
function fmtTime(s) {
	if (!isFinite(s)) return "—";
	if (s >= 3600) return (s / 3600).toFixed(2) + " h";
	if (s >= 60)   return (s / 60).toFixed(2) + " min";
	return s.toFixed(1) + " s";
}

// ── elevator cable helpers ─────────────────────────────────────
function taperRatioElev(GM, omega, rSync, rTip, density, strengthPa, safety) {
	const sigmaEff = strengthPa / safety;
	return OrbitalMath.taperRatio(GM, omega, rSync, rTip, sigmaEff / density);
}

function cableMassRatio(GM, omega, rFoot, rTip, density, strengthPa, safety) {
	const sigmaEff = strengthPa / safety;
	const steps = 2000, dr = (rTip - rFoot) / steps;
	const netTip = omega * omega * rTip - GM / (rTip * rTip);
	const ATip = Math.abs(netTip) / sigmaEff;
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
	return mass;
}

// ── spin-arm mass & moment of inertia (numerical) ──────────────
// Constant-stress profile A(r) = A_tip · exp( c·(L² − r²) ), c = ρω²/(2σ_eff),
// r from the hub axis. Returns one arm's mass (kg) and moment of inertia
// (kg·m²) about the hub, plus the tip cross-section A_tip (m²).
function spinArmStructure(mTip, omega, armLen, density, sigmaEff) {
	const aTipAcc = omega * omega * armLen;          // tip acceleration
	const ATip = (mTip * aTipAcc) / sigmaEff;        // m² to hold the tip load
	const c = density * omega * omega / (2 * sigmaEff);
	const steps = 2000, dr = armLen / steps;
	let mass = 0, inertia = 0;
	for (let i = 0; i <= steps; i++) {
		const r = i * dr;
		const A = ATip * Math.exp(c * (armLen * armLen - r * r));
		const w = (i === 0 || i === steps) ? 0.5 : 1;
		mass    += w * density * A * dr;
		inertia += w * density * A * r * r * dr;
	}
	return { mass: mass, inertia: inertia, ATip: ATip };
}

// ── main calculation ───────────────────────────────────────────
function calculate() {
	// ----- elevator inputs -----
	const R_km   = parseFloat(document.getElementById("radius").value);
	const gSurf  = parseFloat(document.getElementById("gsurf").value);
	const T_hr   = parseFloat(document.getElementById("period").value);
	const sig_GPa= parseFloat(document.getElementById("strength").value);
	const rho    = parseFloat(document.getElementById("density").value);
	const safety = parseFloat(document.getElementById("safety").value);
	let   tipKm  = parseFloat(document.getElementById("tipAlt").value);

	const R      = R_km * 1e3;
	const GM_val = gSurf * R * R;
	const sig    = sig_GPa * 1e9;
	const T_s    = T_hr * 3600;
	const omega  = 2 * Math.PI / T_s;
	const rFoot  = R;
	const rSync  = OrbitalMath.synchronousRadius(GM_val, omega);
	const hSync  = (rSync - R) / 1e3;

	if (tipKm === 0) {
		tipKm = (rSync * 1.2 - R) / 1e3;
		document.getElementById("tipAlt").value = tipKm.toFixed(1);
	}
	const rTip = R + tipKm * 1e3;

	const vSync = omega * rSync;
	const vTip  = omega * rTip;
	const vEsc  = OrbitalMath.escapeVelocity(GM_val, rTip);

	const taper     = taperRatioElev(GM_val, omega, rSync, rTip, rho, sig, safety);
	const massRatio = cableMassRatio(GM_val, omega, rFoot, rTip, rho, sig, safety);

	// heliocentric trajectory after release (same model as the elevator calc)
	const sunRef  = document.querySelector('input[name="sunRef"]:checked').value;
	const sunId   = sunRef === 'peri' ? 'sunPeri' : sunRef === 'apo' ? 'sunApo' : 'sunOrbit';
	const a_sun_m = parseFloat(document.getElementById(sunId).value) * AU;
	const v_primary = OrbitalMath.circularVelocity(GM_sun, a_sun_m);
	const v_h     = v_primary - vTip;
	const speed_h = Math.abs(v_h);
	const E_helio = 0.5 * speed_h * speed_h - GM_sun / a_sun_m;
	let helioText;
	if (E_helio >= 0) helioText = "Escape from solar system";
	else {
		const a_helio = -GM_sun / (2 * E_helio);
		const L_helio = a_sun_m * speed_h;
		const e_helio = Math.sqrt(Math.max(0, 1 - L_helio * L_helio / (GM_sun * a_helio)));
		helioText = (a_helio * (1 - e_helio) / AU).toFixed(4) + " AU";
	}

	// ----- elevator outputs -----
	set("o-hsync",    siNum(hSync, 2));
	set("o-vsync",    vSync.toFixed(2));
	set("o-taper",    taper.toFixed(4));
	set("o-massratio", massRatio < 10000 ? massRatio.toFixed(2) : massRatio.toExponential(3));
	set("o-vtip",     vTip.toFixed(2) + " m/s");
	const aTipElev = omega * omega * rTip - GM_val / (rTip * rTip);
	set("o-tipgrav", aTipElev.toFixed(2));
	set("o-vesc",    vEsc.toFixed(2) + " m/s");
	const escRow = document.getElementById("o-escrow");
	escRow.innerHTML = vTip >= vEsc
		? '<span class="ok">Escapes orbit of body</span>'
		: '<span class="warn">Doesn\'t escape orbit of body</span>';
	const proRow = document.getElementById("o-prograde-row");
	if (vTip >= vEsc) {
		set("o-lastrow-label", "Heliocentric periapsis (retrograde release):");
		set("o-helioperi", helioText);
		const v_h_pro = v_primary + vTip;
		const E_pro   = 0.5 * v_h_pro * v_h_pro - GM_sun / a_sun_m;
		let proText;
		if (E_pro >= 0) proText = "Escapes solar system";
		else {
			const a_pro = -GM_sun / (2 * E_pro);
			const L_pro = a_sun_m * v_h_pro;
			const e_pro = Math.sqrt(Math.max(0, 1 - L_pro * L_pro / (GM_sun * a_pro)));
			proText = (a_pro * (1 + e_pro) / AU).toFixed(4) + " AU";
		}
		set("o-heliopro", proText);
		proRow.style.display = "";
	} else {
		const E_orb = 0.5 * vTip * vTip - GM_val / rTip;
		const h_orb = rTip * vTip;
		const a_orb = -GM_val / (2 * E_orb);
		const e_orb = Math.sqrt(Math.max(0, 1 + 2 * E_orb * h_orb * h_orb / (GM_val * GM_val)));
		set("o-lastrow-label", "Apoapsis altitude (asteroid orbit):");
		set("o-helioperi", siNum((a_orb * (1 + e_orb) - R) / 1e3, 1) + " km");
		proRow.style.display = "none";
	}

	// ----- spin launcher inputs -----
	const dInc     = parseFloat(document.getElementById("planeChange").value) * Math.PI / 180;
	const mode     = document.querySelector('input[name="sizeMode"]:checked').value;
	const mTip     = parseFloat(document.getElementById("tipLoad").value) * 1000;   // kg
	const Mhub     = parseFloat(document.getElementById("hubMass").value) * 1000;   // kg
	const nDay     = parseFloat(document.getElementById("launchesPerDay").value);
	const armSig   = parseFloat(document.getElementById("armStrength").value) * 1e9;
	const armRho   = parseFloat(document.getElementById("armDensity").value);
	const armSafe  = parseFloat(document.getElementById("armSafety").value);
	const sigmaEff = armSig / armSafe;

	// required added velocity — derived from the target heliocentric periapsis.
	// Release is retrograde at Ceres' distance (aphelion of the transfer ellipse),
	// so the in-plane heliocentric release speed (= the velocity being tilted) is
	// the vis-viva aphelion speed of an ellipse aph=Ceres, peri=target.
	const rPeri    = parseFloat(document.getElementById("targetPeri").value) * AU;
	const aHelioT  = (a_sun_m + rPeri) / 2;
	const vRef     = OrbitalMath.visVivaVelocity(GM_sun, a_sun_m, aHelioT);
	const totRetro = v_primary - vRef;          // total retrograde throw to hit target periapsis
	const boost    = totRetro - vTip;           // spin launcher's in-plane share (+ = retrograde)
	const vPerp    = OrbitalMath.planeChangeComponent(vRef, dInc);   // vRef·tan(Δi)
	const vSpin    = OrbitalMath.spinReleaseSpeed(boost, vPerp);     // √(boost²+perp²)
	const tilt     = OrbitalMath.spinPlaneTilt(boost, vPerp);        // atan2(perp, boost)

	// arm length ↔ tip g
	let armLen, aMax;
	if (mode === "g") {
		aMax   = parseFloat(document.getElementById("gLimit").value) * g0;
		armLen = OrbitalMath.spinArmLength(vSpin, aMax);
		document.getElementById("armLen").value = (armLen / 1000).toFixed(2);
	} else {
		armLen = parseFloat(document.getElementById("armLen").value) * 1000;
		aMax   = OrbitalMath.spinTipAccel(vSpin, armLen);
		document.getElementById("gLimit").value = (aMax / g0).toFixed(2);
	}
	const omegaArm = OrbitalMath.spinRate(vSpin, armLen);
	const periodArm = 2 * Math.PI / omegaArm;

	// structure
	const spinTaper = OrbitalMath.spinTaperRatio(vSpin, sigmaEff / armRho);
	const st = spinArmStructure(mTip, omegaArm, armLen, armRho, sigmaEff);
	const hubTension = sigmaEff * st.ATip * spinTaper;        // peak tension at hub, one arm
	const totalStructure = 2 * st.mass + mTip;               // 2 arms + equal counter-mass

	// energy & power
	const ePayload  = 0.5 * mTip * vSpin * vSpin;
	const eFlywheel = 2 * 0.5 * st.inertia * omegaArm * omegaArm + 0.5 * mTip * vSpin * vSpin; // arms + counter-mass
	const avgPower  = nDay * ePayload / T_s;

	// dynamics
	const Lone   = (st.inertia + mTip * armLen * armLen) * omegaArm;  // per arm (arm + tip mass)
	const Lnet   = 0;                                                 // equal counter-rotating arms
	const omegaDay = 2 * Math.PI / T_s;
	const gyroPerArm = omegaDay * Lone;
	const recoil = mTip * vSpin;
	const kick   = recoil / Mhub;
	const mratio = mTip / Mhub;

	// timing
	const vErrPerMs = vSpin * omegaArm * 1e-3;
	const tumbleDeg = omegaArm * 180 / Math.PI;

	// ----- spin launcher outputs -----
	set("s-vref",     vRef.toFixed(1));
	set("s-totretro", totRetro.toFixed(1));
	set("s-boost",    boost.toFixed(1) + (boost < 0 ? "  (prograde — elevator overshoots target)" : ""));
	set("s-vperp",  vPerp.toFixed(1));
	set("s-vspin",  vSpin.toFixed(1));
	set("s-armlen", fmtLen(armLen));
	set("s-tipg",   (aMax / g0).toFixed(2) + " g  (" + aMax.toFixed(1) + " m/s²)");
	set("s-rate",   omegaArm.toExponential(3) + " rad/s  (" + (omegaArm / (2 * Math.PI) * 60).toFixed(3) + " rpm)");
	set("s-period", fmtTime(periodArm));
	set("s-tilt",   (tilt * 180 / Math.PI).toFixed(2) + "°");

	set("s-taper",      spinTaper.toFixed(4));
	set("s-atip",       st.ATip.toFixed(4) + " m²  (Ø " + (2 * Math.sqrt(st.ATip / Math.PI)).toFixed(2) + " m)");
	set("s-armmass",    fmtMass(st.mass));
	set("s-totmass",    fmtMass(totalStructure));
	set("s-hubtension", fmtForce(hubTension));

	set("s-epay",      fmtEnergy(ePayload));
	set("s-eflywheel", fmtEnergy(eFlywheel));
	set("s-power",     fmtPower(avgPower));

	set("s-Lone",      fmtL(Lone));
	set("s-Lnet",      "≈ 0  (balanced counter-rotating pair)");
	set("s-gyro",      fmtTorque(gyroPerArm) + " per arm (cancels at hub)");
	set("s-recoil",    siNum(recoil, 2) + "N·s");
	set("s-kick",      fmtVel(kick));
	const pct = mratio * 100;
	set("s-massratio2", (pct >= 0.01 ? pct.toFixed(2) : pct.toExponential(2)) + " %");

	set("s-timing",  vErrPerMs.toFixed(2));
	set("s-tumble",  tumbleDeg.toFixed(3) + " °/s");

	document.getElementById("output").style.display = "block";
	drawCombined(R, rFoot, rSync, rTip, GM_val, omega, rho, sig, safety);
}

// ── elevator diagram (body + tapered cable + sync marker + drag tip) ─────────
function drawCombined(R, rFoot, rSync, rTip, GM, omega, rho, sig, safety) {
	const sigmaEff = sig / safety;
	const steps = 300, dr = (rTip - rFoot) / steps;
	const logA = new Float64Array(steps + 1);
	for (let i = steps - 1; i >= 0; i--) {
		const r = rFoot + (i + 0.5) * dr;
		logA[i] = logA[i + 1] + (rho / sigmaEff) * (omega * omega * r - GM / (r * r)) * dr;
	}
	const svgNS = "http://www.w3.org/2000/svg";
	const svg = document.getElementById("combined-svg");
	while (svg.firstChild) svg.removeChild(svg.firstChild);
	const W = +svg.getAttribute("width"), H = +svg.getAttribute("height");
	const padR = 30, totalW = W - padR;
	const lineY = 32, taperTop = lineY + 12, taperBot = H - 46;
	const maxTaperH = taperBot - taperTop;
	const toX = r => r / rTip * totalW;
	const toR = px => px * rTip / totalW;
	function mk(t) { return document.createElementNS(svgNS, t); }
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
	const bodyR_px = toX(R);
	const planet = mk("circle");
	planet.setAttribute("cx", 0); planet.setAttribute("cy", lineY);
	planet.setAttribute("r", bodyR_px.toFixed(1));
	planet.setAttribute("fill", "#888"); planet.setAttribute("stroke", "#555");
	planet.setAttribute("stroke-width", 1);
	svg.appendChild(planet);
	line(bodyR_px.toFixed(1), lineY, toX(rTip).toFixed(1), lineY, "#2a5a8a", null, 1.5);
	const referenceScale = maxTaperH / 8;
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
	const shape = mk("path");
	shape.setAttribute("d", "M " + topPts.join(" L ") + " L " + botPts.slice().reverse().join(" L ") + " Z");
	shape.setAttribute("fill", "#7ab8e8"); shape.setAttribute("stroke", "#2a5a8a");
	shape.setAttribute("stroke-width", "1");
	svg.appendChild(shape);
	const sx = toX(rSync).toFixed(1);
	line(sx, 0, sx, taperBot, "#558", "5,4");
	txt(sx, taperBot + 14, "sync orbit", "middle", "#446");
	const tipXpx = toX(rTip).toFixed(1);
	const tipLabel = txt(tipXpx, lineY - 8, ((rTip - R) / 1e3).toFixed(0) + " km", "middle", "#1a6e1a", 11);
	tipLabel.id = "tip-drag-label";
	const marker = mk("circle");
	marker.setAttribute("cx", tipXpx); marker.setAttribute("cy", lineY);
	marker.setAttribute("r", 6); marker.setAttribute("fill", "#2a8a2a");
	marker.setAttribute("stroke", "#145a14"); marker.setAttribute("stroke-width", 1.5);
	marker.setAttribute("cursor", "ew-resize");
	svg.appendChild(marker);
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

// initialise
syncModeFields();
