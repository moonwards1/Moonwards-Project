// Tip Mass Driver Calculator — page wiring.
// The physics lives in tipDriverModel.js; the pop-up texts in tipDriverInfo.js.

import { sizeTipDriver } from "./tipDriverModel.js";
import { INFO } from "./tipDriverInfo.js";

const G0 = 9.80665;
const KATEX_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs";

// Sled presets: mass as a fraction of ship mass, length in metres per tonne of ship.
const SLED_PRESETS = {
	compact:  { massFrac: 0.10, lengthPerTonne: 0.03 },
	standard: { massFrac: 0.15, lengthPerTonne: 0.05 },
	long:     { massFrac: 0.20, lengthPerTonne: 0.08 },
};

// Power-delivery presets: bank spacing along the track (0 = one bank at the
// hub) and whether each bank has frequency converters.
const POWER_PRESETS = {
	hub:         { spacing: 0,    converters: true },
	clustered:   { spacing: 5000, converters: true },
	distributed: { spacing: 1000, converters: true },
	direct:      { spacing: 500,  converters: false },
};

const DEFAULTS = {
	shipMass: 2000, accel: 10, vFinal: 2000, capPct: 50, brakeAccel: 50,
	cntStrength: 42, cntDensity: 1400, cntSF: 2,
	cerStrength: 400, cerDensity: 2600, cerSF: 2, postFactor: 2, skin: 5,
	height: 4, endFactor: 1.5, T0: 77, T1: 150, speedRatio: 0.5, eta: 95,
	voltage: 100, genField: 2, genSpeed: 1500, genStructure: 2, convSpecific: 100,
};

const $ = id => document.getElementById(id);
const num = id => parseFloat($(id).value);

// ── number formatting (3 significant figures, scaled units) ─────────────
function sig3(x) {
	if (!isFinite(x)) return "—";
	const a = Math.abs(x);
	const digits = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
	return x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
function scaled(x, steps) {
	for (const [div, unit] of steps) if (Math.abs(x) >= div) return sig3(x / div) + " " + unit;
	const [div, unit] = steps[steps.length - 1];
	return sig3(x / div) + " " + unit;
}
const f = {
	num: sig3,
	mass:   kg => scaled(kg, [[1e9, "Mt"], [1e6, "kt"], [1e3, "t"], [1, "kg"]]),
	force:  n  => scaled(n,  [[1e9, "GN"], [1e6, "MN"], [1e3, "kN"], [1, "N"]]),
	power:  w  => scaled(w,  [[1e12, "TW"], [1e9, "GW"], [1e6, "MW"], [1, "W"]]),
	energy: j  => scaled(j,  [[1e12, "TJ"], [1e9, "GJ"], [1e6, "MJ"], [1, "J"]]),
	len:    m  => scaled(m,  [[1e3, "km"], [1, "m"]]),
	time:   s  => sig3(s) + " s",
	speed:  v  => sig3(v) + " m/s",
};

// ── inputs → model ──────────────────────────────────────────────────────
function readInputs() {
	const sled = SLED_PRESETS[$("sledPreset").value];
	return {
		shipMass: num("shipMass") * 1e3,
		accel: num("accel") * G0,
		vFinal: num("vFinal"),
		B: parseFloat($("bPreset").value),
		sledMassFrac: sled.massFrac,
		sledLengthPerKg: sled.lengthPerTonne / 1e3,
		brakeAccel: num("brakeAccel") * G0,
		powerCapFrac: $("capPower").checked ? num("capPct") / 100 : 0,
		magnetHeight: num("height"),
		faces: 2,
		endFactor: num("endFactor"),
		T0: num("T0"),
		T1: num("T1"),
		etaConv: num("eta") / 100,
		cnt: { strength: num("cntStrength") * 1e9, density: num("cntDensity"), sf: num("cntSF") },
		cer: {
			strength: num("cerStrength") * 1e6, density: num("cerDensity"), sf: num("cerSF"),
			postFactor: num("postFactor"), skin: num("skin") / 1e3,
		},
		flywheel: { speedRatio: num("speedRatio") },
		power: {
			...POWER_PRESETS[$("pdPreset").value],
			voltage: num("voltage") * 1e3,
			conductors: 2,
			genField: num("genField"),
			genSpeed: num("genSpeed"),
			genStructure: num("genStructure"),
			convSpecific: num("convSpecific") * 1e3,
		},
	};
}

function problem(p) {
	const pos = [p.shipMass, p.accel, p.vFinal, p.brakeAccel, p.magnetHeight, p.etaConv,
		p.cnt.strength, p.cnt.density, p.cnt.sf, p.cer.strength, p.cer.density, p.cer.sf,
		p.power.voltage, p.power.genField, p.power.genSpeed, p.power.genStructure, p.power.convSpecific];
	if (pos.some(x => !(x > 0))) return "All masses, speeds, accelerations, strengths and densities must be positive.";
	if (!(p.T0 >= 40 && p.T1 <= 300 && p.T1 > p.T0)) return "Winding temperatures must satisfy 40 K ≤ start < maximum ≤ 300 K.";
	if (!(p.flywheel.speedRatio >= 0 && p.flywheel.speedRatio < 1)) return "Flywheel speed ratio must be between 0 and 1.";
	if ($("capPower").checked && !(p.powerCapFrac > 0 && p.powerCapFrac <= 1)) return "Power cap must be between 1 and 100%.";
	if (!(p.etaConv <= 1)) return "Conversion efficiency cannot exceed 100%.";
	return "";
}

let lastResult = null;

function calculate() {
	const p = readInputs();
	const err = problem(p);
	$("msg").textContent = err;
	$("output").style.opacity = err ? 0.35 : 1;
	if (err) return;

	const r = sizeTipDriver(p);
	lastResult = r;

	$("o-sled").textContent = `${f.mass(r.mSled)}, ${f.len(r.sledLength)} long`;

	$("o-L").textContent = f.len(r.launch.L);
	$("o-T").textContent = f.time(r.launch.T);
	$("o-F").textContent = r.launch.capped
		? `${f.force(r.launch.Fmax)} → ${f.force(r.launch.Frelease)}`
		: f.force(r.launch.Fmax);
	$("o-P").textContent = f.power(r.launch.Ppeak);

	$("o-Lb").textContent = f.len(r.brake.L);
	$("o-Tb").textContent = f.time(r.brake.T);
	$("o-Fb").textContent = f.force(r.brake.F);

	$("o-E").textContent = f.energy(r.energy.eKin);
	$("o-Es").textContent = f.energy(r.energy.eStore);
	$("o-Mfw").textContent = f.mass(r.energy.flywheelMass);
	$("o-Erec").textContent = f.energy(r.energy.eRecovered);

	$("o-Mwl").textContent = f.mass(r.windings.launch);
	$("o-Mwb").textContent = f.mass(r.windings.brake);
	$("o-Q").textContent = f.energy(r.windings.heatLaunch);
	$("o-tau").textContent = sig3(r.windings.peakShear / 1e3) + " kPa";
	$("o-K").textContent = sig3(r.windings.peakSheet / 1e3) + " kA/m";

	$("o-sl").textContent = f.mass(r.structure.spineLaunch);
	$("o-sb").textContent = f.mass(r.structure.spineBrake);
	$("o-diag").textContent = f.mass(r.structure.diag);
	$("o-post").textContent = f.mass(r.structure.posts);
	$("o-skin").textContent = f.mass(r.structure.skin);
	$("o-struct").textContent = f.mass(r.structure.total);

	$("o-banks").textContent = String(r.power.banks);
	$("o-gen").textContent = f.mass(r.power.generators);
	$("o-conv").textContent = r.power.converters > 0
		? `${f.mass(r.power.converters)} (rated ${f.power(r.power.rating)})` : "none";
	$("o-feed").textContent = f.mass(r.power.feeders);
	$("o-pdheat").textContent = f.energy(r.power.heat);
	$("o-pd").textContent = f.mass(r.power.total);

	$("o-total").textContent = f.mass(r.total);
}

function resetDefaults() {
	for (const [id, v] of Object.entries(DEFAULTS)) $(id).value = v;
	$("capPower").checked = false;
	$("capPct").disabled = true;
	$("bPreset").value = "2";
	$("sledPreset").value = "standard";
	$("pdPreset").value = "hub";
	calculate();
}

// ── info pop-ups ────────────────────────────────────────────────────────
let katexPromise = null;
function loadKatex() {
	if (!katexPromise) katexPromise = import(KATEX_URL).then(m => m.default).catch(() => null);
	return katexPromise;
}

function texHTML(katex, tex, display) {
	if (!katex) {
		const code = document.createElement("code");
		code.className = "tmd-tex-fallback";
		code.textContent = tex;
		return code.outerHTML;
	}
	return katex.renderToString(tex, { displayMode: display, throwOnError: false });
}

function escapeHTML(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Prose with $…$ inline TeX.
function proseHTML(katex, text) {
	return text.split(/(\$[^$]+\$)/).map(part =>
		part.startsWith("$") && part.endsWith("$") && part.length > 1
			? texHTML(katex, part.slice(1, -1), false)
			: escapeHTML(part)
	).join("");
}

async function openInfo(key) {
	const entry = INFO[key];
	if (!entry) return;
	const katex = await loadKatex();
	const parts = [];
	for (const block of entry.body) {
		if (block.p) parts.push(`<p>${proseHTML(katex, block.p)}</p>`);
		if (block.tex) parts.push(texHTML(katex, block.tex, true));
		if (block.vars) {
			parts.push("<ul class=\"tmd-vars\">" + block.vars.map(([sym, meaning]) =>
				`<li>${texHTML(katex, sym, false)} — ${escapeHTML(meaning)}</li>`).join("") + "</ul>");
		}
	}
	if (lastResult && entry.now) {
		parts.push(`<div class="tmd-now"><strong>With the current inputs:</strong> ${escapeHTML(entry.now(lastResult, f))}</div>`);
	}
	$("tmd-dialog-title").textContent = entry.title;
	$("tmd-dialog-body").innerHTML = parts.join("");
	$("tmd-dialog-body").scrollTop = 0;
	$("tmd-dialog").showModal();
}

// ── wiring ──────────────────────────────────────────────────────────────
document.querySelectorAll("input, select").forEach(el => {
	el.addEventListener("input", calculate);
	el.addEventListener("change", calculate);
});
$("capPower").addEventListener("change", () => { $("capPct").disabled = !$("capPower").checked; });
$("btnReset").addEventListener("click", resetDefaults);
document.querySelectorAll(".tmd-info[data-info]").forEach(btn =>
	btn.addEventListener("click", () => openInfo(btn.dataset.info)));
$("tmd-dialog-close").addEventListener("click", () => $("tmd-dialog").close());
// Click on the backdrop (outside the dialog box) closes it.
$("tmd-dialog").addEventListener("click", e => { if (e.target === $("tmd-dialog")) $("tmd-dialog").close(); });

loadKatex();
resetDefaults();
