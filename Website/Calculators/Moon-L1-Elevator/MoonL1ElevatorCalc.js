// Moon–L1 Space Elevator Calculator — the standalone two-step page. The
// physics is l1ElevatorModel.js (shared with the home workbench's cards);
// README.md derives it. This file reads the fields, runs the model, and
// writes the results, the cruise-speed table and the diagram.
//
// ES module (loaded with <script type="module">).
import { Const } from "../../Shared/constants.js";
import { L1Elevator } from "./l1ElevatorModel.js";

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

	const ctx = L1Elevator.buildContext(p);
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
	const ctx = L1Elevator.buildContext(p);
	if (!(ctx.gCW > 0)) { err.textContent = "Counterweight is not beyond L1 (net force not outward)."; return; }
	if (p.mCW < ctx.McwMin) {
		err.textContent = "Counterweight " + fmtMass(p.mCW) + " is below the minimum "
		                + fmtMass(ctx.McwMin) + " — its outward pull can't support the cable's "
		                + "weight, so the whole elevator would be pulled toward the Moon and crash.";
		document.getElementById("output").style.display = "none";
		return;
	}
	err.textContent = "";

	const m = L1Elevator.loadedMetrics(p, ctx, p.mCW);
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

	// ── orbit after release ──
	const ro = L1Elevator.releaseOrbit({ GMe: p.GMe, D: p.D, rCW: p.rCW, omega: omega,
		Rearth: p.Rearth, ifaceAlt: p.ifaceAlt, targetAlt: p.reAlt });
	const rRel = ro.rRel, vRel = ro.vRel;
	let perigeeTxt="—", dvTxt="—", fpaTxt="—", peakgTxt="—";
	if (ro.bound) {
		perigeeTxt = (ro.rPer/km).toLocaleString(undefined,{maximumFractionDigits:0})+" km from Earth centre"
		           + "  (alt "+((ro.rPer-p.Rearth)/km).toLocaleString(undefined,{maximumFractionDigits:0})+" km)";
		if (ro.burn && !ro.burn.noBurn) {
			dvTxt = ro.burn.dv.toFixed(0)+" m/s retrograde"
			      + "  (apogee "+(vRel).toFixed(0)+" → "+(ro.burn.vAfter).toFixed(0)+" m/s)";
			if (ro.entry) {
				fpaTxt = "−"+(ro.entry.gamma*180/Math.PI).toFixed(1)+"°  (entry speed "+(ro.entry.vI/1000).toFixed(2)+" km/s)";
				peakgTxt = "~"+ro.entry.peakG.toFixed(0)+" g (ballistic est.)";
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
	renderSweep(L1Elevator.sweepSpeeds(p, ctx, p.mCW));
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
var lastDiagramArgs = null;   // redrawn when the column width changes
function drawDiagram(Rmoon, rL1, rCW, prof, Tmin) {
	lastDiagramArgs = Array.prototype.slice.call(arguments);
	const svgNS="http://www.w3.org/2000/svg";
	const svg=document.getElementById("diagram");
	while(svg.firstChild) svg.removeChild(svg.firstChild);
	// Drawn at the width the column actually gives it, so text keeps its size;
	// a narrow column stacks the three captions as a list below the schematic.
	const W=Math.max(320, Math.round(svg.parentElement.clientWidth || 860));
	const narrow = W < 640;
	const H = narrow ? 290 : 250;
	svg.setAttribute("width", W);
	svg.setAttribute("height", H);
	svg.setAttribute("viewBox", "0 0 "+W+" "+H);
	const padL=70, padR=90, lineY=90;
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
	txt(x(Rmoon),lineY+54,"Moon surface","middle","#444",11);
	txt(x(Rmoon),lineY+67,(Rmoon/1e3).toFixed(0)+" km","middle","#777",10);

	// L1
	line(x(rL1),lineY-60,x(rL1),lineY+60,"#558","5,4",1);
	txt(x(rL1),lineY-66,"L1","middle","#446",12);
	txt(x(rL1),lineY+78,(rL1/1e3).toLocaleString()+" km","middle","#446",10);

	// counterweight
	const cw=mk("rect");
	cw.setAttribute("x",x(rCW)-7);cw.setAttribute("y",lineY-7);cw.setAttribute("width",14);cw.setAttribute("height",14);
	cw.setAttribute("fill","#c33");cw.setAttribute("stroke","#811");svg.appendChild(cw);
	txt(x(rCW),lineY-50,"counterweight","middle","#811",11);
	txt(x(rCW),lineY+54,(rCW/1e3).toLocaleString()+" km","middle","#811",10);

	// Earth direction arrow + region labels
	txt(W-12,lineY,"→ Earth","end","#357",11);
	if(narrow){
		txt(8,H-44,"profile = loaded cross-section (∝ √A)","start","#999",10);
		txt(8,H-28,"Moon to L1: net force toward Moon (tether hangs up)","start","#777",10);
		txt(8,H-12,"L1 to counterweight: net force outward (holds it up)","start","#777",10);
	} else {
		txt((x(Rmoon)+x(rL1))/2,H-10,"net force → toward Moon (tether hangs up)","middle","#777",10);
		txt((x(rL1)+x(rCW))/2,H-10,"net force → outward (counterweight holds up)","middle","#777",10);
		txt((x(Rmoon)+x(rCW))/2,H-26,"profile = loaded cross-section (∝ √A)","middle","#999",10);
	}
}

// Redraw the diagram when its column changes width.
(function(){
	const wrap = document.getElementById("diagram").parentElement;
	let lastW = 0;
	new ResizeObserver(function(){
		const w = Math.round(wrap.clientWidth);
		if(w === lastW) return;
		lastW = w;
		const out = document.getElementById("output");
		if(lastDiagramArgs && out && out.style.display !== "none") drawDiagram.apply(null, lastDiagramArgs);
	}).observe(wrap);
})();

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

// Handlers attached here, not inline: module functions are not global,
// so onclick="calculate()" in the HTML cannot see them.
document.getElementById("strength").addEventListener("input", updateBreakingLength);
document.getElementById("density").addEventListener("input", updateBreakingLength);
document.getElementById("btnFloor").addEventListener("click", computeFloor);
document.getElementById("btnReset").addEventListener("click", resetDefaults);
document.getElementById("btnCalc").addEventListener("click", calculate);
