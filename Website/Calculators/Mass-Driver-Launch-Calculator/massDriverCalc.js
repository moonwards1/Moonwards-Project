// ── lunar constants ────────────────────────────────────────────
const GM    = 4.9028695e12;      // m^3/s^2
const R     = 1.7374e6;          // m  (mean radius)
const gE    = 9.80665;           // m/s^2
const T_SID = 27.321661 * 86400; // s  (sidereal rotation)
const V_SURF = 2 * Math.PI * R / T_SID;  // eastward surface speed at equator
const V_CIRC = Math.sqrt(GM / R);
const V_ESC  = Math.sqrt(2 * GM / R);
const G_SURF = GM / (R * R);

// ── formatting helpers ─────────────────────────────────────────
function sig(n, d = 3) {
	if (!isFinite(n)) return "—";
	return Number(n.toPrecision(d)).toLocaleString(undefined, { maximumFractionDigits: 12 });
}
function energy(j) { // J -> readable
	if (!isFinite(j)) return "—";
	if (j >= 1e9) return sig(j / 1e9) + " GJ (" + sig(j / 3.6e6, 4) + " kWh)";
	if (j >= 1e6) return sig(j / 1e6) + " MJ (" + sig(j / 3.6e6, 3) + " kWh)";
	if (j >= 1e3) return sig(j / 1e3) + " kJ";
	return sig(j) + " J";
}
function power(w) {
	if (!isFinite(w)) return "—";
	if (w >= 1e9) return sig(w / 1e9) + " GW";
	if (w >= 1e6) return sig(w / 1e6) + " MW";
	if (w >= 1e3) return sig(w / 1e3) + " kW";
	return sig(w) + " W";
}
function force(n) {
	if (!isFinite(n)) return "—";
	if (n >= 1e6) return sig(n / 1e6) + " MN";
	if (n >= 1e3) return sig(n / 1e3) + " kN";
	return sig(n) + " N";
}
function dur(s) {
	if (!isFinite(s)) return "—";
	if (s >= 3600) return sig(s) + " s (" + sig(s / 3600) + " h)";
	if (s >= 120)  return sig(s) + " s (" + sig(s / 60) + " min)";
	return sig(s) + " s";
}
function len(m) {
	if (!isFinite(m)) return "—";
	if (Math.abs(m) >= 1e3) return sig(m / 1e3) + " km";
	return sig(m) + " m";
}
function accel(a) {
	return sig(a) + " m/s² (" + sig(a / gE) + " g)";
}
function set(id, v) { document.getElementById(id).textContent = v; }

// ── UI wiring ──────────────────────────────────────────────────
const cb = document.getElementById("useApo");
cb.addEventListener("change", syncMode);
function syncMode() {
	const apo = cb.checked;
	document.getElementById("apoalt").disabled = !apo;
	document.getElementById("speed").disabled  = apo;
	document.getElementById("apoRow").classList.toggle("disabled", !apo);
}
function updateSled() {
	const mp = parseFloat(document.getElementById("payload").value);
	const el = document.getElementById("sledmass");
	el.textContent = isFinite(mp) ? "= " + sig(0.07 * mp) + " t (" + sig(70 * mp) + " kg)" : "—";
}
document.getElementById("payload").addEventListener("input", updateSled);
updateSled();

function resetDefaults() {
	document.getElementById("length").value  = 37400;
	document.getElementById("payload").value = 13.4;
	document.getElementById("declen").value  = 2200;
	document.getElementById("height").value  = 25;
	document.getElementById("eff").value     = 80;
	document.getElementById("speed").value   = 1727.3;
	document.getElementById("apoalt").value  = 233;
	cb.checked = false;
	syncMode(); updateSled();
	document.getElementById("output").style.display = "none";
}

// ── main calculation ───────────────────────────────────────────
function calculate() {
	const L     = parseFloat(document.getElementById("length").value);
	const mp_t  = parseFloat(document.getElementById("payload").value);
	const Ldec  = parseFloat(document.getElementById("declen").value);
	const hTrack = parseFloat(document.getElementById("height").value);
	const effPct = parseFloat(document.getElementById("eff").value);
	const useApo = cb.checked;

	if (!(L > 0) || !(mp_t > 0) || !(Ldec > 0)) { alert("Length, payload mass and deceleration length must be positive."); return; }
	if (!(hTrack >= 0)) { alert("Release height must be zero or positive."); return; }
	if (!(effPct > 0 && effPct <= 100)) { alert("Energy efficiency must be between 0 and 100%."); return; }
	const eff = effPct / 100;

	const mp = mp_t * 1000;     // kg
	const ms = 0.07 * mp;       // sled kg
	const mtot = mp + ms;
	const r0 = R + hTrack;      // release radius (track top above the ground)

	// release speed (vs ground) and inertial speed
	let vg, vi;
	if (useApo) {
		const hApo = parseFloat(document.getElementById("apoalt").value);
		if (!(hApo > 0)) { alert("Apoapsis altitude must be a positive number."); return; }
		const rApo = R + hApo * 1e3;
		if (rApo <= r0) { alert("Apoapsis altitude must be above the release height."); return; }
		const a = (rApo + r0) / 2;              // release at periapsis = track top
		vi = Math.sqrt(GM * (2 / r0 - 1 / a));  // inertial periapsis speed
		vg = vi - V_SURF;
		document.getElementById("speed").value = sig(vg, 6);
	} else {
		vg = parseFloat(document.getElementById("speed").value);
		if (!(vg > 0)) { alert("Release speed must be positive."); return; }
		vi = vg + V_SURF;
	}

	// reference outputs
	set("o-vg", sig(vg, 5));
	set("o-vi", sig(vi, 5));
	set("o-vsurf", sig(V_SURF, 4));
	set("o-vcirc", sig(V_CIRC, 5));
	set("o-vesc", sig(V_ESC, 5));

	// ── classify regime from the release state (horizontal release at r0) ──
	// r0 = R + track height. The orbit's periapsis decides the outcome:
	//   periapsis below the surface  -> sub-orbital, lands downrange
	//   periapsis at/above surface   -> reaches orbit
	//   unbound (eps >= 0)           -> escape
	const eps = vi * vi / 2 - GM / r0;      // specific orbital energy at release
	const hAng = r0 * vi;                   // specific angular momentum (tangential release)
	const banner = document.getElementById("banner");
	const blkOrbit = document.getElementById("blk-orbit");
	const blkBurn  = document.getElementById("blk-burn");
	const blkLand  = document.getElementById("blk-land");

	let orbitForDiagram = null;

	if (eps >= 0) {
		// ESCAPE: hyperbolic, no apoapsis
		const vInf = Math.sqrt(2 * eps);
		const C3 = (vInf * vInf) / 1e6;     // km^2/s^2
		banner.className = "banner escape";
		banner.innerHTML = "<strong>Escape trajectory &mdash; leaves the Moon.</strong> " +
			"Inertial release speed " + sig(vi, 5) + " m/s reaches escape speed, so there is no apoapsis. " +
			"Hyperbolic excess speed v&infin; = <strong>" + sig(vInf, 4) + " m/s</strong> (C3 = " + sig(C3, 3) + " km²/s²).";
		blkOrbit.style.display = "none";
		blkBurn.style.display = "none";
		blkLand.style.display = "none";
		set("o-apoalt", "— (escape)");
		orbitForDiagram = { mode: "escape", vi, r0 };
	} else {
		const a = -GM / (2 * eps);
		const e = Math.sqrt(Math.max(0, 1 + 2 * eps * hAng * hAng / (GM * GM)));
		const p = hAng * hAng / GM;
		const rApo = a * (1 + e);
		const rPeri = a * (1 - e);

		if (rPeri < R) {
			// SUB-ORBITAL: trajectory dips below the surface -> lands downrange.
			// Release point is the apoapsis (highest point); object descends from
			// r0 to the surface r = R. Central angle from release to impact:
			//   cos(nu_impact) = (p/R - 1)/e ,  swept angle = pi - acos(...)
			let C = (p / R - 1) / e;
			C = Math.max(-1, Math.min(1, C));
			const nuImp = 2 * Math.PI - Math.acos(C);   // forward from apoapsis (nu = pi)
			const phi = nuImp - Math.PI;                // ground angle release -> impact
			const dist = R * phi;
			const vImp = Math.sqrt(GM * (2 / R - 1 / a));
			// flight time (apoapsis -> impact) via Kepler's equation
			const n = Math.sqrt(GM / (a * a * a));
			const Eimp = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nuImp / 2),
			                            Math.sqrt(1 + e) * Math.cos(nuImp / 2));
			const EimpW = Eimp < 0 ? Eimp + 2 * Math.PI : Eimp;
			const Mimp = EimpW - e * Math.sin(EimpW);
			const tFlight = (Mimp - Math.PI) / n;       // apoapsis mean anomaly = pi

			banner.className = "banner crash";
			banner.innerHTML = "<strong>Sub-orbital &mdash; lands downrange.</strong> " +
				"Below orbital speed the payload is released at the top of its arc (" + sig(hTrack, 3) +
				"&nbsp;m, the track height) and descends to the surface <strong>" + len(dist) +
				"</strong> downrange. It needs <strong>" + sig(V_CIRC - vi, 3) +
				"</strong> m/s more (inertial) to reach a grazing orbit.";
			blkOrbit.style.display = "none";
			blkBurn.style.display = "none";
			blkLand.style.display = "";
			set("o-apoalt", "— (sub-orbital)");
			set("o-htrack", sig(hTrack, 3));
			set("o-dist", len(dist));
			set("o-tflight", dur(tFlight));
			set("o-phi", sig(phi * 180 / Math.PI, 3) + "°");
			set("o-vimp", sig(vImp, 5) + " m/s");
			orbitForDiagram = { mode: "crash", a, e, p, phi, hTrack, dist };
		} else {
			// ELLIPTICAL ORBIT: release point is periapsis (at the track top, r0).
			const hApoAlt = rApo - R;
			const vApo = hAng / rApo;
			const coast = Math.PI * Math.sqrt(a * a * a / GM);   // release -> apoapsis

			// burn at apoapsis raises periapsis to R + 10 km (if apoapsis is higher)
			const rP2 = R + 10e3;
			let dv = NaN, vApo2 = NaN, vPeri2 = NaN;
			if (rApo > rP2) {
				const a2 = (rApo + rP2) / 2;
				vApo2 = Math.sqrt(GM * (2 / rApo - 1 / a2));
				dv = vApo2 - vApo;
				vPeri2 = Math.sqrt(GM * (2 / rP2 - 1 / a2));
			}
			const rP2eff = (rApo > rP2) ? rP2 : rPeri;
			const a2eff = (rApo + rP2eff) / 2;
			const period = 2 * Math.PI * Math.sqrt(a2eff * a2eff * a2eff / GM);

			banner.className = "banner orbit";
			banner.innerHTML = "<strong>Reaches orbit.</strong> Released at periapsis (the track top, " +
				sig(hTrack, 3) + "&nbsp;m up), the payload coasts half an orbit (180&deg;, to the far side of the Moon) " +
				"up to apoapsis at <strong>" + len(hApoAlt) + "</strong>, where a burn raises periapsis to 10&nbsp;km.";
			blkOrbit.style.display = "";
			blkBurn.style.display = "";
			blkLand.style.display = "none";
			set("o-apoalt", len(hApoAlt));
			set("o-ecc", sig(e, 4));
			set("o-vapo", sig(vApo, 5) + " m/s");
			set("o-vperi", sig(vi, 5) + " m/s");
			set("o-coast", dur(coast));
			set("o-period", dur(period));
			set("o-dv", isFinite(dv) ? sig(dv, 4) + " m/s" : "— (apoapsis below 10 km)");
			set("o-vapo2", isFinite(vApo2) ? sig(vApo2, 5) + " m/s" : "—");
			set("o-vperi2", isFinite(vPeri2) ? sig(vPeri2, 5) + " m/s" : "—");

			orbitForDiagram = { mode: "orbit", a, e, rApo, rPeri, rP2, r0 };
		}
	}

	// ── launch energetics ──
	// Ideal = kinetic energy delivered (work in the track frame).
	// Input = ideal / efficiency (electrical energy the system must draw).
	const eKgId   = 0.5 * vg * vg;
	const ePayId  = 0.5 * mp * vg * vg;
	const eSledId = 0.5 * ms * vg * vg;
	const eTotId  = 0.5 * mtot * vg * vg;
	set("o-ekg",   energy(eKgId / eff));
	set("o-epay",  energy(ePayId / eff));
	set("o-etot",  energy(eTotId / eff));
	set("o-epayid", energy(ePayId));
	set("o-esled", energy(eSledId));
	set("o-effnote", sig(eff * 100, 3));

	// ── acceleration phase (payload + sled to vg over length L) ──
	const aAcc = vg * vg / (2 * L);
	const tAcc = 2 * L / vg;
	const fPay = mp * aAcc;
	const fTot = mtot * aAcc;
	set("o-acc", accel(aAcc));
	set("o-fpay", force(fPay));
	set("o-tacc", dur(tAcc));

	// ── sled deceleration phase ──
	const aDec = vg * vg / (2 * Ldec);
	const tDec = 2 * Ldec / vg;
	const fSled = ms * aDec;
	set("o-dec", accel(aDec));
	set("o-fsled", force(fSled));
	set("o-tdec", dur(tDec));

	// ── power to the track (input = mechanical / efficiency) ──
	const pAvg  = eTotId / tAcc / eff;     // average over the launch, whole driver
	const pPeak = fTot * vg / eff;         // instantaneous at the release end
	const pPer10 = fTot * 10 / tAcc / eff; // energy through a 10 m segment / launch time
	set("o-p10", power(pPer10));
	set("o-ppeak", power(pPeak));
	set("o-pavg", power(pAvg));

	document.getElementById("output").style.display = "block";
	drawDiagram(orbitForDiagram);
}

// ── diagram ────────────────────────────────────────────────────
function drawDiagram(data) {
	const svgNS = "http://www.w3.org/2000/svg";
	const svg = document.getElementById("diagram");
	while (svg.firstChild) svg.removeChild(svg.firstChild);
	const W = +svg.getAttribute("width"), H = +svg.getAttribute("height");
	const cx = W / 2, cy = H / 2;

	function mk(t) { return document.createElementNS(svgNS, t); }
	function txt(x, y, s, col, size, anchor) {
		const t = mk("text");
		t.setAttribute("x", x); t.setAttribute("y", y);
		t.setAttribute("fill", col || "#ccc"); t.setAttribute("font-size", size || 11);
		t.setAttribute("text-anchor", anchor || "middle");
		t.textContent = s; svg.appendChild(t); return t;
	}
	function addPath(d, stroke, dash, wid) {
		const pth = mk("path");
		pth.setAttribute("d", d); pth.setAttribute("fill", "none");
		pth.setAttribute("stroke", stroke); pth.setAttribute("stroke-width", wid || 1.6);
		if (dash) pth.setAttribute("stroke-dasharray", dash);
		svg.appendChild(pth);
	}

	// ── sub-orbital: zoomed downrange schematic (vertical scale exaggerated) ──
	if (data.mode === "crash") {
		const mL = 54, mR = 20, gY = H - 56, topY = 40;
		const usableW = W - mL - mR;
		const e = data.e, p = data.p, phi = data.phi;
		// altitude profile: release (apoapsis) at theta=0, descends to ground at theta=phi
		let d = "";
		const steps = 120;
		for (let i = 0; i <= steps; i++) {
			const th = phi * i / steps;
			const nu = Math.PI + th;                 // forward from apoapsis
			const r = p / (1 + e * Math.cos(nu));
			const alt = Math.max(0, r - R);
			const xp = mL + usableW * (th / phi);
			const yp = gY - (alt / data.hTrack) * (gY - topY);
			d += (d ? " L " : "M ") + xp.toFixed(1) + " " + yp.toFixed(1);
		}
		// ground
		addPath("M " + mL + " " + gY + " L " + (W - mR) + " " + gY, "#777", null, 1.5);
		txt(mL, gY + 16, "surface", "#888", 10, "start");
		// trajectory
		addPath(d, "#e87a7a", null, 2);
		// release marker
		const rcx = mL, rcy = gY - (gY - topY);
		const rdot = mk("circle"); rdot.setAttribute("cx", rcx); rdot.setAttribute("cy", rcy);
		rdot.setAttribute("r", 4); rdot.setAttribute("fill", "#ffd24d"); svg.appendChild(rdot);
		txt(rcx + 6, rcy - 6, "release (" + sig(data.hTrack, 3) + " m up)", "#ffd24d", 10, "start");
		// prograde arrow
		addPath("M " + (rcx + 10) + " " + rcy + " l 22 0 m -7 -4 l 7 4 l -7 4", "#ffd24d", null, 1.4);
		// landing marker
		const ldx = W - mR, ldy = gY;
		const ldot = mk("circle"); ldot.setAttribute("cx", ldx); ldot.setAttribute("cy", ldy);
		ldot.setAttribute("r", 4); ldot.setAttribute("fill", "#e87a7a"); svg.appendChild(ldot);
		txt(ldx, ldy - 10, "impact", "#e87a7a", 10, "end");
		// distance bracket
		addPath("M " + mL + " " + (gY + 26) + " L " + (W - mR) + " " + (gY + 26), "#aaa", null, 1);
		txt((mL + W - mR) / 2, gY + 40, "downrange " + len(data.dist), "#ddd", 11);
		txt(W / 2, 22, "Sub-orbital descent (vertical scale exaggerated)", "#bbb", 11);
		return;
	}

	// choose world scale (metres -> px). Launch point on +x (right).
	let maxR;
	if (data.mode === "orbit") maxR = data.rApo * 1.08;
	else maxR = R * 4.2;
	const scale = (Math.min(W, H) / 2 - 24) / maxR;

	const toX = (xm) =>  cx + xm * scale;
	const toY = (ym) =>  cy - ym * scale;   // +y up

	// Moon
	const moon = mk("circle");
	moon.setAttribute("cx", cx); moon.setAttribute("cy", cy);
	moon.setAttribute("r", R * scale);
	moon.setAttribute("fill", "#3a3a4a"); moon.setAttribute("stroke", "#777");
	svg.appendChild(moon);
	txt(cx, cy + 4, "Moon", "#888", 11);

	// helper to plot a conic (focus at origin), periapsis direction +x or -x
	function conicPath(a, e, periRight, fromNu, toNu, steps) {
		const p = a * (1 - e * e);
		let d = "";
		for (let i = 0; i <= steps; i++) {
			const nu = fromNu + (toNu - fromNu) * i / steps;
			const r = p / (1 + e * Math.cos(nu));
			if (r <= 0) continue;
			// periapsis on +x => measure nu from +x; on -x => from -x
			const ang = periRight ? nu : (Math.PI + nu);
			const x = r * Math.cos(ang), y = r * Math.sin(ang);
			d += (d ? " L " : "M ") + toX(x).toFixed(1) + " " + toY(y).toFixed(1);
		}
		return d;
	}

	// launch marker (right edge of Moon)
	const lx = toX(R), ly = toY(0);
	const dot = mk("circle");
	dot.setAttribute("cx", lx); dot.setAttribute("cy", ly); dot.setAttribute("r", 4);
	dot.setAttribute("fill", "#ffd24d"); svg.appendChild(dot);
	txt(lx + 6, ly - 6, "launch", "#ffd24d", 10, "start");
	// prograde arrow (eastward = +y / counter-clockwise at this point)
	const arr = mk("path");
	arr.setAttribute("d", "M " + (lx + 2) + " " + (ly - 10) + " l 0 -14 m -4 6 l 4 -6 l 4 6");
	arr.setAttribute("stroke", "#ffd24d"); arr.setAttribute("fill", "none"); arr.setAttribute("stroke-width", 1.4);
	svg.appendChild(arr);

	if (data.mode === "orbit") {
		// pre-burn ellipse: periapsis at the track top (+x), full loop, dashed
		addPath(conicPath(data.a, data.e, true, 0, 2 * Math.PI, 240), "#7ab8e8", "5,4", 1.4);
		// post-burn orbit: periapsis raised to R + 10 km, solid green (if apoapsis higher)
		if (data.rApo > data.rP2) {
			const a2 = (data.rApo + data.rP2) / 2;
			const e2 = (data.rApo - data.rP2) / (data.rApo + data.rP2);
			addPath(conicPath(a2, e2, true, 0, 2 * Math.PI, 240), "#5ad17a", null, 1.8);
		}
		// apoapsis marker (-x)
		const ax = toX(-data.rApo), ay = toY(0);
		const am = mk("circle"); am.setAttribute("cx", ax); am.setAttribute("cy", ay);
		am.setAttribute("r", 3.5); am.setAttribute("fill", "#5ad17a"); svg.appendChild(am);
		txt(ax, ay - 8, "apoapsis", "#5ad17a", 10);
		// legend
		txt(10, H - 22, "–– pre-burn ellipse (periapsis at release)", "#7ab8e8", 10, "start");
		txt(10, H - 8,  "— orbit after periapsis-raise burn", "#5ad17a", 10, "start");
	} else if (data.mode === "escape") {
		// hyperbola: e>1. Build from the release state (periapsis at +x).
		const eps = data.vi * data.vi / 2 - GM / data.r0;
		const a = -GM / (2 * eps);            // negative
		const h = data.r0 * data.vi;
		const e = Math.sqrt(1 + 2 * eps * h * h / (GM * GM));
		const nuMax = Math.acos(-1 / e) * 0.96;
		addPath(conicPath(a, e, true, -nuMax, nuMax, 200), "#e8a87a", null, 1.8);
		txt(10, H - 8, "— hyperbolic escape", "#e8a87a", 10, "start");
	}
}

// initialise default UI state
syncMode();
