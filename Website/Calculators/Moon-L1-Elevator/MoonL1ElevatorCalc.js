// ───────────────────────────────────────────────────────────────────
//  PHYSICS  —  Moon–L1 elevator, cable sized for the LOADED condition
//
//  r = distance from the Moon's centre, measured toward Earth. Earth at
//  r = D. The Earth–Moon system rotates about the barycentre (r = x_b)
//  with angular velocity ω; the tidally-locked Moon holds the tether
//  fixed in this rotating frame.
//
//  Effective specific force (positive = outward, toward Earth):
//      g(r) =  GMe/(D−r)²  −  GMm/r²  +  ω²(r − x_b)
//  Effective potential (g = −dΦ/dr):
//      Φ(r) = −GMm/r − GMe/(D−r) − ½ ω²(r − x_b)²
//
//  The operating stress σ_eff = σ_ult / safety is applied to the
//  FULLY-LOADED cable. Cargo rides on the cable with uniform linear
//  density λ (kg/m), spread surface → counterweight. Force balance on a
//  cable element of area A = T/σ_eff (constant stress under load):
//
//      dT/dr = −[ρA + λ]·g(r) = −(ρ/σ_eff)·g(r)·T − λ·g(r)
//
//  Linear ODE ⇒ superpose a counterweight (homogeneous) part and a
//  cargo (particular) part:
//      T(r) = M_cw·g(r_cw)·E(r) + C(r)
//      E(r) = exp[(ρ/σ_eff)(Φ(r) − Φ(r_cw))]   (closed form, C(r_cw)=0)
//      C(r): cargo particular solution, integrated numerically (RK4).
//
//  Tension peaks at L1 and falls off both ways, so its minimum is at the
//  surface. A taut cable needs T_surf > 0, giving a hard minimum
//  counterweight (below it the cable goes slack near the surface):
//      M_cw,min = −C(R_moon) / [ g(r_cw)·E(R_moon) ]
//
//  Area  A(r) = T(r)/σ_eff ;  Tether mass = ρ ∫ A dr (surface → cw).
//  Because the cable is sized loaded, the empty cable carries a higher
//  safety factor (reported as "spare safety factor when empty").
// ───────────────────────────────────────────────────────────────────

// ES module (loaded with <script type="module">).
import { OrbitalMath } from "../../Shared/math-utils.js";
import { Const } from "../../Shared/constants.js";

const KM = 1e3;

const MATERIALS = {
	steel:   { strength: 2.62, density: 8000 },
	zylon:   { strength: 5.8,  density: 1540 },
	esilica: { strength: 13,   density: 2300 },
	msilica: { strength: 17,   density: 2300 },
	ecnt:    { strength: 18,   density: 1400 },
	mcnt:    { strength: 42,   density: 1400 },
};

document.getElementById("materialPreset").onchange = function() {
	const m = MATERIALS[this.value];
	if (!m) return;
	document.getElementById("strength").value = m.strength;
	document.getElementById("density").value  = m.density;
	updateBreakingLength();
	lockStep2();
};

function resetDefaults() {
	const set = (id,v)=>document.getElementById(id).value=v;
	set("Rmoon",1738); set("Dist",384400); set("Bary",4671);
	set("GMm","4.902e12"); set("GMe","3.986e14"); set("L1",58000);
	set("Vorb",1.022); document.getElementById("omegaSrc").value="kepler";
	set("strength",42); set("density",1400); set("safety",3);
	set("rCW",222100); set("mCW",1000);
	set("rate",30700); set("perClimber",1000); set("vClimb",200); set("effDrive",85);
	set("infraPct",10); set("trackMin",0.4); set("trackGrav",1.2);
	set("Rearth",6371); set("reAlt",50); set("ifaceAlt",122);
	document.getElementById("output").style.display="none";
	updateBreakingLength();
	lockStep2();
}

// Breaking length: length of cable that snaps under its own weight at 1 g₀.
function updateBreakingLength() {
	const sig = parseFloat(document.getElementById("strength").value);
	const rho = parseFloat(document.getElementById("density").value);
	const el  = document.getElementById("o-breaking");
	if (!isFinite(sig) || !isFinite(rho) || rho<=0 || sig<=0) { el.textContent="—"; return; }
	el.textContent = ((sig*1e9)/(rho*Const.g0)/1000).toLocaleString(undefined,{maximumFractionDigits:0});
}

// ── formatting helpers ─────────────────────────────────────────────
function fmtN(n) {            // force in N / kN / MN
	if (!isFinite(n)) return "—";
	if (Math.abs(n)>=1e6) return (n/1e6).toFixed(3)+" MN";
	if (Math.abs(n)>=1e3) return (n/1e3).toFixed(3)+" kN";
	return n.toFixed(3)+" N";
}
function fmtMass(kg) {        // mass in g / kg / t / kt / Mt
	if (!isFinite(kg)) return "—";
	if (kg>=1e9) return (kg/1e9).toLocaleString(undefined,{maximumFractionDigits:3})+" Mt";
	if (kg>=1e6) return (kg/1e6).toLocaleString(undefined,{maximumFractionDigits:3})+" kt";
	if (kg>=1e3) return (kg/1e3).toLocaleString(undefined,{maximumFractionDigits:3})+" t";
	if (kg>=1)   return kg.toLocaleString(undefined,{maximumFractionDigits:2})+" kg";
	return (kg*1e3).toFixed(2)+" g";
}
function fmtArea_mm2(m2) {    // m² → mm²
	const mm2 = m2*1e6;
	if (mm2>=1)   return mm2.toLocaleString(undefined,{maximumFractionDigits:3});
	return mm2.toExponential(3);
}
function fmtRatio(x){ return (isFinite(x) && x>=1e4) ? x.toExponential(3) : (isFinite(x)?x.toFixed(3):"—"); }
function set(id,v){ document.getElementById(id).textContent=v; }

// ── input reader ───────────────────────────────────────────────────
// Reads every field. mCW may be blank/NaN (Step 1 doesn't need it).
function readInputs() {
	const num = id => parseFloat(document.getElementById(id).value);
	return {
		Rmoon: num("Rmoon")*KM,
		D:     num("Dist")*KM,
		baryE: num("Bary")*KM,
		GMm:   num("GMm"),
		GMe:   num("GMe"),
		rL1:   num("L1")*KM,
		Vorb:  num("Vorb")*KM,
		omegaSrc: document.getElementById("omegaSrc").value,
		sig:   num("strength")*1e9,
		rho:   num("density"),
		safety:num("safety"),
		rCW:   num("rCW")*KM,
		rate:  num("rate"),
		perClimber: num("perClimber"),
		vClimb: num("vClimb"),
		eff:   num("effDrive")/100,
		infraPct: num("infraPct"),
		trackMin:  num("trackMin"),
		trackGrav: num("trackGrav"),
		mCW:   num("mCW")*1e6,        // kilotonnes → kg
		Rearth: num("Rearth")*KM,
		reAlt:  num("reAlt")*KM,
		ifaceAlt: num("ifaceAlt")*KM,
	};
}

// ── build the load-aware solution context (independent of M_cw) ─────
function buildContext(p) {
	const xb     = p.D - p.baryE;
	const sigEff = p.sig / p.safety;
	const omega  = (p.omegaSrc==="vorb") ? (p.Vorb/xb)
	                                     : OrbitalMath.angularVelocity(p.GMe+p.GMm, p.D);
	const g   = r => p.GMe/((p.D-r)*(p.D-r)) - p.GMm/(r*r) + omega*omega*(r-xb);
	const Phi = r => -p.GMm/r - p.GMe/(p.D-r) - 0.5*omega*omega*(r-xb)*(r-xb);

	// distributed loads, along surface → counterweight
	const L        = p.rCW - p.Rmoon;
	const tTrip_s  = L / p.vClimb;
	const oncable_kg = (isFinite(p.rate)?p.rate:0)*1e3*(tTrip_s/86400);   // payload on the cable
	const infraF   = 1 + (isFinite(p.infraPct)?p.infraPct:0)/100;        // + climber tare
	const live_kg  = oncable_kg * infraF;            // moving mass (cargo + climbers), only when loaded
	const lamCargo = live_kg / L;                    // kg/m, live load (present only with cargo)
	const lamMin   = isFinite(p.trackMin)  ? p.trackMin  : 0;  // kg/m, track minimum gauge (always on)
	const lamGrav  = isFinite(p.trackGrav) ? p.trackGrav : 0;  // kg/m at surface, traction part ∝ |g|

	const PhiCW = Phi(p.rCW), gCW = g(p.rCW), k = p.rho/sigEff;
	const gSurf = Math.abs(g(p.Rmoon));
	const Efn   = r => Math.exp(k*(Phi(r)-PhiCW));
	const hfn   = r => Math.abs(g(r))/gSurf;         // gravity shape: 1 at surface → ~0 by L1

	// Two unit particular solutions integrated down from the counterweight:
	//   C₁(r):  constant unit load     dC₁/dr = −k·g·C₁ − g
	//   C_g(r): gravity-shaped load     dC_g/dr = −k·g·C_g − h(r)·g
	// A constant load λ adds λ·C₁(r); the traction reinforcement λ_grav·h(r) adds
	// λ_grav·C_g(r). Cable self-weight + counterweight are in the shape E(r).
	const N = 20000, dr = (p.Rmoon - p.rCW)/N;
	const f1 = (r,C) => -k*g(r)*C - g(r);
	const fg = (r,C) => -k*g(r)*C - hfn(r)*g(r);
	let r = p.rCW, C1 = 0, Cg = 0, hInt = 0;
	const rs = new Array(N+1), Cs = new Array(N+1), Cgs = new Array(N+1), Es = new Array(N+1);
	rs[0]=r; Cs[0]=0; Cgs[0]=0; Es[0]=1;
	let C_L1 = null, Cg_L1 = null;
	for (let i=0;i<N;i++){
		const a1=f1(r,C1), b1=f1(r+dr/2,C1+dr/2*a1), c1=f1(r+dr/2,C1+dr/2*b1), d1=f1(r+dr,C1+dr*c1);
		const ag=fg(r,Cg), bg=fg(r+dr/2,Cg+dr/2*ag), cg=fg(r+dr/2,Cg+dr/2*bg), dg=fg(r+dr,Cg+dr*cg);
		const C1n=C1+dr/6*(a1+2*b1+2*c1+d1), Cgn=Cg+dr/6*(ag+2*bg+2*cg+dg), rn=r+dr;
		hInt += 0.5*(hfn(r)+hfn(rn))*Math.abs(rn-r);
		if (C_L1===null && r>=p.rL1 && rn<=p.rL1){ const t=(p.rL1-r)/(rn-r); C_L1=C1+t*(C1n-C1); Cg_L1=Cg+t*(Cgn-Cg); }
		r=rn; C1=C1n; Cg=Cgn; rs[i+1]=r; Cs[i+1]=C1; Cgs[i+1]=Cg; Es[i+1]=Efn(r);
	}
	const Esurf = Es[N], Csurf = Cs[N], Cgsurf = Cgs[N];
	// Floor: full-load surface tension = 0 (min+cargo as constant loads + the grav term).
	const McwMin = -((lamMin+lamCargo)*Csurf + lamGrav*Cgsurf)/(gCW*Esurf);

	return { xb, sigEff, omega, g, Phi, L, tTrip_s, oncable_kg, infraF, live_kg,
	         lamCargo, lamMin, lamGrav, hInt, gCW, Efn, EL1: Efn(p.rL1),
	         C_L1, Cg_L1, Esurf, Csurf, Cgsurf, rs, Cs, Cgs, Es, N, McwMin };
}

// ── load-aware metrics for a given counterweight mass ──────────────
//  Cargo is a LIVE load: the cable must hold σ/safety in every load state
//  from empty to full. Tension is linear in cargo, so the worst case at
//  each point is one of the two endpoints — size the area to the envelope
//  A(r) = max(T_empty(r), T_full(r))/σ_eff. Near the surface, REMOVING
//  cargo raises the hold-down tension, so the empty case governs there;
//  near and above L1 the full case governs. The taut floor uses the full
//  case (the one that can slacken the surface). The track is a constant
//  dead load present in BOTH states; cargo is added only in the full state.
function loadedMetrics(p, ctx, Mcw) {
	const { sigEff, gCW, Es, Cs, Cgs, rs, N, EL1, C_L1, Cg_L1, Esurf, Csurf, Cgsurf,
	        lamCargo, lamMin, lamGrav, hInt, L } = ctx;
	const track  = i => lamMin*Cs[i] + lamGrav*Cgs[i];               // always-on track (min + traction)
	const Tempty = i => Mcw*gCW*Es[i] + track(i);                    // cable + track only
	const Tfull  = i => Mcw*gCW*Es[i] + track(i) + lamCargo*Cs[i];   // + full cargo
	const Aenv   = i => Math.max(Tempty(i), Tfull(i)) / sigEff;

	let mass = 0, TminFull = Infinity, crossR = null;
	const prof = [];                                 // downsampled (r,A) for the diagram
	const stride = Math.max(1, Math.floor(N/400));
	for (let i=0;i<=N;i++){
		const tf = Tfull(i);
		if (tf < TminFull) TminFull = tf;            // taut check uses the full-load case
		if (crossR===null && i>0 && Cs[i-1]>=0 && Cs[i]<0) crossR = rs[i]; // empty governs below
		if (i % stride === 0 || i===N) prof.push({ r: rs[i], A: Aenv(i) });
		if (i<N) mass += p.rho * 0.5*(Aenv(i)+Aenv(i+1)) * Math.abs(rs[i+1]-rs[i]);
	}
	const Tcw = Mcw*gCW;
	const trackSurf  = lamMin*Csurf + lamGrav*Cgsurf;
	const trackL1    = lamMin*C_L1  + lamGrav*Cg_L1;
	const Tsurf_full  = Mcw*gCW*Esurf + trackSurf + lamCargo*Csurf;   // smallest — drives the floor
	const Tsurf_empty = Mcw*gCW*Esurf + trackSurf;                    // larger — what the anchor holds
	const TL1_full    = Mcw*gCW*EL1 + trackL1 + lamCargo*C_L1;        // peak tension (full at L1)
	const trackMass   = lamMin*L + lamGrav*hInt;                      // ∫(λ_min + λ_grav·h) dr
	return {
		mass, TminFull, crossR, trackMass,
		TsurfHold: Tsurf_empty, Tsurf_full, TL1: TL1_full, Tcw,
		Acw: Tcw/sigEff,
		Asurf: Math.max(Tsurf_empty, Tsurf_full)/sigEff,
		AL1:   Math.max(TL1_full, Mcw*gCW*EL1 + trackL1)/sigEff,
		prof,
	};
}

// ── Step-2 gating ───────────────────────────────────────────────────
function lockStep2() {
	document.getElementById("mCW").disabled = true;
	document.getElementById("btnCalc").disabled = true;
	document.getElementById("o-floorHint").innerHTML =
		"<span class='note'>Set the structure &amp; traffic above, then press "
		+ "<em>Compute minimum counterweight</em>.</span>";
	const err = document.getElementById("stepErr"); if (err) err.textContent = "";
	const out = document.getElementById("output");   if (out) out.style.display = "none";
}

// Step 1 → compute the minimum (taut) counterweight, unlock Step 2.
function computeFloor() {
	const p = readInputs();
	const err = document.getElementById("stepErr");
	err.textContent = "";

	// sanity on Step-1 inputs
	const need = ["Rmoon","D","baryE","GMm","GMe","rL1","sig","rho","safety","rCW","rate","vClimb"];
	for (const key of need) if (!isFinite(p[key])) {
		err.textContent = "Fill in all structure, material and traffic fields first.";
		return;
	}
	if (!(p.rCW > p.rL1)) { err.textContent = "Counterweight distance must be beyond L1."; return; }
	if (p.safety < 1)     { err.textContent = "Safety factor must be ≥ 1."; return; }

	const ctx = buildContext(p);
	if (!(ctx.gCW > 0)) {
		err.textContent = "At the counterweight the net force is not outward — move it farther beyond L1.";
		return;
	}

	const floorKt = ctx.McwMin/1e6;   // kilotonnes (the input unit)
	document.getElementById("o-floorHint").innerHTML =
		"Minimum counterweight to keep the elevator up: <b>" + fmtMass(ctx.McwMin)
		+ "</b>.<br><span class='note'>This is the balance point — the counterweight's outward "
		+ "pull just supports the weight of the cable and cargo. Below it the net force turns "
		+ "toward the Moon; a surface anchor can hold the cable down but not up, so the whole "
		+ "structure sinks and crashes onto the Moon.</span>";

	const mEl = document.getElementById("mCW");
	mEl.min = floorKt.toPrecision(4);
	if (!isFinite(p.mCW) || p.mCW < ctx.McwMin) mEl.value = (floorKt*2).toPrecision(3); // suggest 2× floor (kt)
	mEl.disabled = false;
	document.getElementById("btnCalc").disabled = false;
}

// ── Step 2 → full calculation ───────────────────────────────────────
function calculate() {
	const err = document.getElementById("stepErr");
	const p   = readInputs();

	if (!isFinite(p.mCW)) { err.textContent = "Enter a counterweight mass."; return; }
	const ctx = buildContext(p);
	if (!(ctx.gCW > 0)) { err.textContent = "Counterweight is not beyond L1 (net force not outward)."; return; }
	if (p.mCW < ctx.McwMin) {
		err.textContent = "Counterweight " + fmtMass(p.mCW) + " is below the minimum "
		                + fmtMass(ctx.McwMin) + " — its outward pull can't support the cable's "
		                + "weight, so the whole elevator would be pulled toward the Moon and crash.";
		document.getElementById("output").style.display = "none";
		return;
	}
	err.textContent = "";

	const m = loadedMetrics(p, ctx, p.mCW);
	const km = KM, omega = ctx.omega, g = ctx.g, Phi = ctx.Phi;
	const vImplied = omega*ctx.xb;
	const a_net = ctx.gCW, a_net_dir = a_net>=0 ? "outward (toward Earth)" : "inward (toward Moon)";

	// ── rotating frame ──
	set("o-omega",  omega.toExponential(4));
	set("o-vimp",   (vImplied/km).toFixed(4));
	set("o-baryM",  (ctx.xb/km).toLocaleString());
	set("o-gL1",    g(p.rL1).toExponential(3));

	// ── counterweight sizing ──
	set("o-floorOut", fmtMass(ctx.McwMin));
	set("o-cwRatio",  (p.mCW/ctx.McwMin).toFixed(2)+"×");

	// ── cable properties (loaded design) ──
	set("o-taperSurf", fmtRatio(m.AL1/m.Asurf));
	set("o-taperCW",   fmtRatio(m.AL1/m.Acw));
	set("o-mass",      fmtMass(m.mass));
	set("o-trackmass", fmtMass(m.trackMass)+"  ("+(ctx.lamMin+ctx.lamGrav).toFixed(2)
	                   +" kg/m at surface → "+ctx.lamMin.toFixed(2)+" kg/m above the well)");
	set("o-structtot", fmtMass(m.mass + m.trackMass));

	set("o-AL1",   fmtArea_mm2(m.AL1));
	set("o-Asurf", fmtArea_mm2(m.Asurf));
	set("o-Acw",   fmtArea_mm2(m.Acw));

	set("o-TL1",   fmtN(m.TL1));
	set("o-Tsurf", fmtN(m.TsurfHold)+"  (empty — worst case; "+fmtN(m.Tsurf_full)+" full)");
	set("o-anet",  Math.abs(a_net).toExponential(3)+" m/s² "+a_net_dir
	               +" (= "+(Math.abs(a_net)/Const.g0).toExponential(2)+" × Earth g)");

	// ── cargo throughput ──
	const rateTpd = p.rate, mC = p.perClimber, vC = p.vClimb, eff = p.eff;
	const L = ctx.L, tTrip_d = ctx.tTrip_s/86400;
	const depPerDay = rateTpd/mC, interval_h = 24/depPerDay;
	const nOnCable  = depPerDay*tTrip_d;
	const oncable_kg= ctx.oncable_kg, live_kg = ctx.live_kg;
	const spacing_km= (L/1e3)/Math.max(nOnCable,1e-9);
	const pctCW     = 100*live_kg/p.mCW;

	const dPhiLow = Phi(p.rL1)-Phi(p.Rmoon);         // J/kg surface → L1
	const massFlow= rateTpd*1e3/86400;               // kg/s
	const P_lift  = dPhiLow*massFlow/eff;            // W
	const ePerT   = dPhiLow/eff/1e6;                 // GJ/t

	const fmtP = w => w>=1e9 ? (w/1e9).toFixed(2)+" GW" : (w/1e6).toFixed(1)+" MW";
	const fmtT = d => d>=1 ? d.toFixed(1)+" days" : (d*24).toFixed(1)+" hours";

	set("o-trip",    fmtT(tTrip_d));
	set("o-cadence", "one every "+interval_h.toFixed(2)+" h  ("+depPerDay.toFixed(1)+"/day)");
	set("o-nclimb",  nOnCable.toFixed(1));
	set("o-spacing", spacing_km.toLocaleString(undefined,{maximumFractionDigits:0}));
	set("o-oncable", fmtMass(oncable_kg)+" cargo + "+((ctx.infraF-1)*100).toFixed(0)+"% climbers = "
	                 +fmtMass(live_kg)+"  ("+pctCW.toFixed(3)+"% of counterweight)");
	set("o-power",   fmtP(P_lift));
	set("o-epert",   ePerT.toFixed(2)+" GJ/t");

	// ── orbit after release ──  (unchanged physics; uses ctx.omega/g)
	const Rearth = p.Rearth, reAlt = p.reAlt, ifaceAlt = p.ifaceAlt;
	const rRel = p.D - p.rCW, vRel = omega*rRel;
	const epsOrb = OrbitalMath.specificEnergy(vRel, p.GMe, rRel);
	let perigeeTxt="—", dvTxt="—", fpaTxt="—", peakgTxt="—";
	if (epsOrb < 0) {
		const aOrb = -p.GMe/(2*epsOrb);
		const rOther = 2*aOrb - rRel;
		const rPer = Math.min(rRel, rOther);
		perigeeTxt = (rPer/km).toLocaleString(undefined,{maximumFractionDigits:0})+" km from Earth centre"
		           + "  (alt "+((rPer-Rearth)/km).toLocaleString(undefined,{maximumFractionDigits:0})+" km)";
		const rEntry = Rearth + reAlt;
		if (rEntry < rRel) {
			const a2 = OrbitalMath.semiMajorAxisFromApsis(rEntry, rRel);
			const vBurn = OrbitalMath.visVivaVelocity(p.GMe, rRel, a2);
			dvTxt = (vRel - vBurn).toFixed(0)+" m/s retrograde"
			      + "  (apogee "+(vRel).toFixed(0)+" → "+(vBurn).toFixed(0)+" m/s)";
			const e2 = OrbitalMath.eccentricityFromApsis(rEntry, rRel);
			const rI = Rearth + ifaceAlt;
			if (rEntry < rI && rI < rRel) {
				const hOrb2 = Math.sqrt(p.GMe*a2*(1-e2*e2));
				const vI = OrbitalMath.visVivaVelocity(p.GMe, rI, a2);
				const gamma = Math.acos(Math.min(1, hOrb2/(rI*vI)));
				const gDeg = gamma*180/Math.PI;
				const peakG = OrbitalMath.allenEggersPeakDecel(vI, gamma, Const.scaleHeight.earth)/Const.g0;
				fpaTxt = "−"+gDeg.toFixed(1)+"°  (entry speed "+(vI/1000).toFixed(2)+" km/s)";
				peakgTxt = "~"+peakG.toFixed(0)+" g (ballistic est.)";
			} else {
				fpaTxt = "—"; peakgTxt = "target perigee above interface — no entry";
			}
		} else {
			dvTxt = "0 m/s — release radius already at/below entry altitude";
		}
	} else {
		perigeeTxt = "unbound (escape) — no perigee";
	}
	set("o-rRel",      (rRel/km).toLocaleString(undefined,{maximumFractionDigits:0})+" km");
	set("o-vRel",      vRel.toFixed(1)+" m/s");
	set("o-perigee",   perigeeTxt);
	set("o-dvReentry", dvTxt);
	set("o-fpa",       fpaTxt);
	set("o-peakg",     peakgTxt);

	// ── math recap with live numbers ──
	document.getElementById("mathbox").innerHTML =
		"<b>Worked relations (SI), cable sized for the loaded cable:</b><br>"+
		"ω = "+omega.toExponential(4)+" rad/s &nbsp; x<sub>b</sub> = "+(ctx.xb/km).toLocaleString()+" km<br>"+
		"g(r) = GMe/(D−r)² − GMm/r² + ω²(r−x<sub>b</sub>) &nbsp;→&nbsp; g(L1) = "+g(p.rL1).toExponential(3)+" m/s²<br>"+
		"Loads: cargo λ<sub>c</sub> = "+ctx.lamCargo.toFixed(3)+" kg/m (cargo × "+ctx.infraF.toFixed(2)+" climbers, only when loaded) &nbsp;·&nbsp; track λ<sub>t</sub>(r) = "+ctx.lamMin.toFixed(2)+" + "+ctx.lamGrav.toFixed(2)+"·|g(r)|/g<sub>s</sub> kg/m (always on)<br>"+
		"Loaded taper: dT/dr = −(ρ/σ)·g·T − (λ<sub>t</sub>(r)+λ<sub>c</sub>)·g, &nbsp; σ = "+(p.sig/1e9)+" GPa ÷ "+p.safety+" = "+(ctx.sigEff/1e9).toFixed(3)+" GPa<br>"+
		"T(r) = M<sub>cw</sub>·g(r<sub>cw</sub>)·E(r) + (λ<sub>min</sub>+λ<sub>c</sub>)·C₁(r) + λ<sub>grav</sub>·C<sub>g</sub>(r), &nbsp; E(r)=exp[(ρ/σ)(Φ(r)−Φ(cw))]<br>"+
		"Min counterweight (full-load T<sub>surf</sub>=0): M<sub>cw,min</sub> = −[(λ<sub>min</sub>+λ<sub>c</sub>)·C₁(R) + λ<sub>grav</sub>·C<sub>g</sub>(R)]/[g(r<sub>cw</sub>)·E(R)] = "+fmtMass(ctx.McwMin)+
		" &nbsp;(chosen "+fmtMass(p.mCW)+" = "+(p.mCW/ctx.McwMin).toFixed(2)+"×)<br>"+
		"T<sub>surf</sub> = net outward force suspending the whole structure; at M<sub>cw,min</sub> it is 0 (balance), and below it the net force turns Moonward and the elevator falls.<br>"+
		"Peak tension T(L1) = "+fmtN(m.TL1)+" &nbsp;·&nbsp; Cable = ρ∫A dr = "+fmtMass(m.mass)+" &nbsp;·&nbsp; Track = "+fmtMass(m.trackMass)+" &nbsp;·&nbsp; Structure = "+fmtMass(m.mass+m.trackMass);

	document.getElementById("output").style.display="block";
	drawDiagram(p.Rmoon, p.rL1, p.rCW, m.prof, m.TminFull);
	renderSweep(sweepSpeeds(p, ctx, p.mCW));
}

// ── cruise-speed sweep: structure mass vs climb speed ──────────────
//  Holds throughput, material and counterweight HEADROOM (chosen ÷ minimum)
//  fixed, and re-sizes the whole structure at a ladder of climb speeds around
//  the chosen one. The live load on the cable ∝ 1/v, so the cable and the
//  counterweight needed both shrink as v rises — with diminishing returns,
//  while track wear (not modelled here) rises ∝ v². Shows where the knee is.
function sweepSpeeds(pBase, ctxCur, curMcw) {
	const headroom = curMcw / ctxCur.McwMin;          // chosen ÷ minimum, held fixed
	const mults = [0.5, 0.75, 1, 1.5, 2, 3, 4];
	const v0 = pBase.vClimb;
	return mults.map(function(mu){
		const v   = v0 * mu;
		const p   = Object.assign({}, pBase, { vClimb: v });
		const ctx = buildContext(p);
		const Mcw = headroom * ctx.McwMin;
		const m   = loadedMetrics(p, ctx, Mcw);
		const trackMass = ctx.lamMin*ctx.L + ctx.lamGrav*ctx.hInt;
		return { v: v, isCur: Math.abs(mu-1) < 1e-9, trip: ctx.tTrip_s/86400,
		         live: ctx.live_kg, Mcw: Mcw, tether: m.mass,
		         total: m.mass + trackMass + Mcw };
	});
}

function renderSweep(rows) {
	const cur = rows.find(function(r){ return r.isCur; });
	const tbl = document.getElementById("sweepTable");
	if (!tbl || !cur) return;
	const fmtT = d => d>=1 ? d.toFixed(1)+" d" : (d*24).toFixed(1)+" h";
	let html = "<tr><th>Climb speed</th><th>Trip</th><th>On-cable load</th>"
	         + "<th>Counterweight</th><th>Tether</th><th>Structure total</th>"
	         + "<th>vs. current</th></tr>";
	rows.forEach(function(r){
		const pct = 100*r.total/cur.total - 100;
		const pctTxt = r.isCur ? "—" : (pct>=0?"+":"") + pct.toFixed(0) + "%";
		html += "<tr class='"+(r.isCur?"current":"")+"'>"
		      + "<td>"+r.v.toFixed(0)+" m/s</td>"
		      + "<td>"+fmtT(r.trip)+"</td>"
		      + "<td>"+fmtMass(r.live)+"</td>"
		      + "<td>"+fmtMass(r.Mcw)+"</td>"
		      + "<td>"+fmtMass(r.tether)+"</td>"
		      + "<td>"+fmtMass(r.total)+"</td>"
		      + "<td class='savecol'>"+pctTxt+"</td></tr>";
	});
	tbl.innerHTML = html;
}

// ── schematic + loaded taper profile ──────────────────────────────
function drawDiagram(Rmoon, rL1, rCW, prof, Tmin) {
	const svgNS="http://www.w3.org/2000/svg";
	const svg=document.getElementById("diagram");
	while(svg.firstChild) svg.removeChild(svg.firstChild);
	const W=+svg.getAttribute("width"), H=+svg.getAttribute("height");
	const padL=70, padR=90, lineY=70;
	const x = r => padL + (r-Rmoon)/(rCW-Rmoon)*(W-padL-padR);

	function mk(t){return document.createElementNS(svgNS,t);}
	function line(x1,y1,x2,y2,st,dash,sw){const l=mk("line");
		l.setAttribute("x1",x1);l.setAttribute("y1",y1);l.setAttribute("x2",x2);l.setAttribute("y2",y2);
		l.setAttribute("stroke",st||"#666");l.setAttribute("stroke-width",sw||1);
		if(dash)l.setAttribute("stroke-dasharray",dash);svg.appendChild(l);}
	function txt(xx,yy,s,anc,col,sz){const t=mk("text");
		t.setAttribute("x",xx);t.setAttribute("y",yy);t.setAttribute("text-anchor",anc||"middle");
		t.setAttribute("font-size",sz||11);t.setAttribute("fill",col||"#333");t.textContent=s;svg.appendChild(t);}

	// loaded taper profile: half-width ∝ sqrt(A), normalised to the peak
	let maxA=0; for(const pt of prof) if(pt.A>maxA) maxA=pt.A;
	const maxHalf=40;
	const top=[], bot=[];
	for(const pt of prof){
		const half = maxHalf*Math.sqrt(Math.max(pt.A,0)/maxA);
		const xx = x(pt.r).toFixed(2);
		top.push(xx+","+(lineY-half).toFixed(2));
		bot.push(xx+","+(lineY+half).toFixed(2));
	}
	const path=mk("path");
	path.setAttribute("d","M "+top.join(" L ")+" L "+bot.reverse().join(" L ")+" Z");
	path.setAttribute("fill", Tmin>0 ? "#7ab8e8" : "#e8a0a0");
	path.setAttribute("stroke","#2a5a8a");path.setAttribute("stroke-width","1");
	svg.appendChild(path);

	// Moon
	const moon=mk("circle");
	moon.setAttribute("cx",x(Rmoon));moon.setAttribute("cy",lineY);moon.setAttribute("r",16);
	moon.setAttribute("fill","#999");moon.setAttribute("stroke","#555");svg.appendChild(moon);
	txt(x(Rmoon),lineY+34,"Moon surface","middle","#444",11);
	txt(x(Rmoon),lineY+47,(Rmoon/1e3).toFixed(0)+" km","middle","#777",10);

	// L1
	line(x(rL1),lineY-60,x(rL1),lineY+55,"#558","5,4",1);
	txt(x(rL1),lineY-66,"L1","middle","#446",12);
	txt(x(rL1),lineY+70,(rL1/1e3).toLocaleString()+" km","middle","#446",10);

	// counterweight
	const cw=mk("rect");
	cw.setAttribute("x",x(rCW)-7);cw.setAttribute("y",lineY-7);cw.setAttribute("width",14);cw.setAttribute("height",14);
	cw.setAttribute("fill","#c33");cw.setAttribute("stroke","#811");svg.appendChild(cw);
	txt(x(rCW),lineY-16,"counterweight","middle","#811",11);
	txt(x(rCW),lineY+34,(rCW/1e3).toLocaleString()+" km","middle","#811",10);

	// Earth direction arrow + region labels
	txt(W-12,lineY,"→ Earth","end","#357",11);
	txt((x(Rmoon)+x(rL1))/2,H-10,"net force → toward Moon (tether hangs up)","middle","#777",10);
	txt((x(rL1)+x(rCW))/2,H-10,"net force → outward (counterweight holds up)","middle","#777",10);
	txt((x(Rmoon)+x(rCW))/2,H-26,"profile = loaded cross-section (∝ √A)","middle","#999",10);
}

// re-lock Step 2 whenever a Step-1 input changes
function wireStep1Lock() {
	document.querySelectorAll("#step1 input, #step1 select").forEach(el=>{
		el.addEventListener("input", lockStep2);
		el.addEventListener("change", lockStep2);
	});
}

// run the example on load
wireStep1Lock();
resetDefaults();
computeFloor();
calculate();
