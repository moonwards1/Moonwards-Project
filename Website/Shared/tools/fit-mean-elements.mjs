// Fit mean Keplerian elements for every Sun-orbiting body in Shared/orbit.js to
// JPL Horizons positions, and print the `orbit` field values to paste in.
//
//   node Website/Shared/tools/fit-mean-elements.mjs
//
// Needs network access (Horizons API). For each body it downloads monthly
// heliocentric ecliptic-J2000 position vectors over [WINDOW_START, WINDOW_END],
// then least-squares fits (a, e, i, Omega, omega, M at EPOCH) through
// OrbitalMath.bodyStateAtJD — the propagator the app uses, so mean motion is
// tied to a and the Sun's GM exactly as at run time. Earth is the Earth-Moon
// barycentre, held in the ecliptic (i = Omega = 0, omega = longitude of
// perihelion); Jupiter..Pluto are the system barycentres.

import { systems } from "../orbit.js";
import { OrbitalMath as O } from "../math-utils.js";

const WINDOW_START = "2030-01-01", WINDOW_END = "2130-01-01";
const JD_START = 2462502.5, JD_END = 2499026.5;      // the window, as JD
const EPOCH = 2480764.5;                             // 2080-01-01, mid-window
const TAU = 2 * Math.PI, AU = 149597870700;
const gm = systems.get("Sun").GM;

// body name in orbit.js -> Horizons COMMAND
const TARGETS = {
	Mercury: "199", Venus: "299", Earth: "3", Mars: "499",
	Ceres: "DES=2000001;", Vesta: "DES=2000004;", Psyche: "DES=2000016;",
	Jupiter: "5", Saturn: "6", Uranus: "7", Neptune: "8", Pluto: "9",
	Eris: "DES=2136199;"
};
const IN_AU = new Set(["Ceres", "Vesta", "Psyche", "Eris"]);   // how orbit.js writes them

async function horizons(command) {
	const q = new URLSearchParams({
		format: "json", COMMAND: `'${command}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'",
		EPHEM_TYPE: "'VECTORS'", CENTER: "'500@10'", REF_PLANE: "'ECLIPTIC'",
		REF_SYSTEM: "'ICRF'", OUT_UNITS: "'KM-S'", VEC_TABLE: "'2'", CSV_FORMAT: "'YES'",
		START_TIME: `'${WINDOW_START}'`, STOP_TIME: `'${WINDOW_END}'`, STEP_SIZE: "'1 mo'"
	});
	const res = await fetch("https://ssd.jpl.nasa.gov/api/horizons.api?" + q);
	const text = (await res.json()).result;
	if (!text.includes("$$SOE")) { throw new Error("Horizons: " + text.slice(0, 300)); }
	return text.split("$$SOE")[1].split("$$EOE")[0].trim().split("\n")
		.map(l => l.split(",").map(Number))
		.map(c => ({ jd: c[0], r: [c[2] * 1e3, c[3] * 1e3, c[4] * 1e3], v: [c[5] * 1e3, c[6] * 1e3, c[7] * 1e3] }));   // m, m/s
}

function solve(A, b) {
	const n = b.length, M = A.map((row, i) => [...row, b[i]]);
	for (let i = 0; i < n; i++) {
		let p = i;
		for (let r = i + 1; r < n; r++) { if (Math.abs(M[r][i]) > Math.abs(M[p][i])) { p = r; } }
		[M[i], M[p]] = [M[p], M[i]];
		for (let r = i + 1; r < n; r++) {
			const f = M[r][i] / M[i][i];
			for (let c = i; c <= n; c++) { M[r][c] -= f * M[i][c]; }
		}
	}
	const x = Array(n).fill(0);
	for (let i = n - 1; i >= 0; i--) {
		let s = M[i][n];
		for (let c = i + 1; c < n; c++) { s -= M[i][c] * x[c]; }
		x[i] = s / M[i][i];
	}
	return x;
}

const toOrbit = p => ({ a: p[0] * 1e11, e: p[1], inclination: p[2], longitude: p[3],
	argument: p[4], meanAnomaly: p[5], epoch: EPOCH });

// Levenberg-Marquardt on p = [a/1e11, e, i, Omega, omega, M]; residuals in 1e9 m.
function fit(rows, inEcliptic) {
	const free = inEcliptic ? [0, 1, 4, 5] : [0, 1, 2, 3, 4, 5];
	const mid = rows.reduce((b, c) => Math.abs(c.jd - EPOCH) < Math.abs(b.jd - EPOCH) ? c : b);
	// Starting point: the osculating elements at mid-window.
	const el = O.elementsFromState(gm, mid.r, mid.v);
	const M0 = ((O.meanAnomalyFromTrue(el.nu, el.e) % TAU) + TAU) % TAU;
	let p = inEcliptic
		? [el.a / 1e11, el.e, 0, 0, (el.omega + el.Omega) % TAU, M0]
		: [el.a / 1e11, el.e, el.i, el.Omega, el.omega, M0];
	const res = q => {
		const o = toOrbit(q), out = [];
		for (const row of rows) {
			const s = O.bodyStateAtJD(gm, o, row.jd).r;
			for (let d = 0; d < 3; d++) { out.push((s[d] - row.r[d]) / 1e9); }
		}
		return out;
	};
	const cost = r => r.reduce((s, x) => s + x * x, 0);
	let lam = 1e-3, r = res(p), c = cost(r);
	for (let it = 0; it < 200; it++) {
		const J = free.map(j => {
			const h = j === 0 ? 1e-7 : 1e-8, q = [...p]; q[j] += h;
			return res(q).map((x, n) => (x - r[n]) / h);
		});
		const JTJ = free.map((_, a) => free.map((_, b) => J[a].reduce((s, x, n) => s + x * J[b][n], 0)));
		const g = free.map((_, a) => J[a].reduce((s, x, n) => s + x * r[n], 0));
		let better = false;
		for (let tries = 0; tries < 12 && !better; tries++) {
			const A = JTJ.map((row, i) => row.map((x, j) => x + (i === j ? lam * (JTJ[i][i] + 1e-12) : 0)));
			const dx = solve(A, g.map(x => -x)), q = [...p];
			free.forEach((j, i) => { q[j] += dx[i]; });
			if (q[1] < 0 || q[1] >= 1) { lam *= 10; continue; }
			const r2 = res(q), c2 = cost(r2);
			if (c2 < c) { better = (c - c2) / c > 1e-12 ? true : "done"; p = q; r = r2; c = c2; lam = Math.max(lam / 5, 1e-12); }
			else { lam *= 10; }
		}
		if (!better || better === "done") { break; }
	}
	const errKm = [], pct = [];
	for (let n = 0; n < rows.length; n++) {
		const e = Math.hypot(r[3 * n], r[3 * n + 1], r[3 * n + 2]) * 1e6;
		errKm.push(e); pct.push(100 * e / Math.hypot(...rows[n].r) * 1e3);
	}
	return { p: [p[0], p[1], p[2], ((p[3] % TAU) + TAU) % TAU, ((p[4] % TAU) + TAU) % TAU, ((p[5] % TAU) + TAU) % TAU],
		maxKm: Math.max(...errKm), maxPct: Math.max(...pct) };
}

const D = 180 / Math.PI;
for (const [name, command] of Object.entries(TARGETS)) {
	const rows = (await horizons(command)).filter(c => c.jd >= JD_START - 1e-6 && c.jd <= JD_END + 1e-6);
	const f = fit(rows, name === "Earth"), a = f.p[0] * 1e11, e = f.p[1];
	const L = x => IN_AU.has(name) ? `${(x / AU).toPrecision(15)}*constants.AU` : x.toPrecision(15);
	const deg = x => `${(x * D).toPrecision(12)}*(Math.PI/180)`;
	console.log(`// ${name}: worst error over the window ${(f.maxKm / 1e3).toFixed(0)}k km (${f.maxPct.toFixed(3)}% of orbit radius)`);
	console.log(`\t\tapoapsis: ${L(a * (1 + e))},\n\t\tperiapsis: ${L(a * (1 - e))},\n\t\tsemiMajor: ${L(a)},\n\t\teccentricity: ${e.toPrecision(15)},`);
	console.log(name === "Earth"
		? `\t\tinclination: 0,\n\t\tlongitude: 0,`
		: `\t\tinclination: ${deg(f.p[2])},\n\t\tlongitude: ${deg(f.p[3])},`);
	console.log(`\t\targument: ${deg(f.p[4])},\n\t\tepoch: ${EPOCH},\n\t\tmeanAnomaly: ${deg(f.p[5])}\n`);
}
