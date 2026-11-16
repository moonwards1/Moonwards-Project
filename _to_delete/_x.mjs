import { MarsElevator as ME } from "./Website/Calculators/Mars-Elevator/marsElevatorModel.js";
import { solveMeridianTether } from "./Website/Shared/meridian-tether.js";
const sys = ME.marsSystem(); const a = ME.anchor(sys, 18.65, 21.9e3);
console.log("rStat", sys.rStat/1e3, "rA", a.r/1e3, "Phobos reach", ME.phobosReach(sys.phobos)/1e3, "Deimos", sys.deimos);
let s = solveMeridianTether(sys.field, {latA:a.lat, rA:a.r, rCW:51000e3, M:1e8, rho:1450, sigEff:18e9/2.5});
s = solveMeridianTether(sys.field, {latA:a.lat, rA:a.r, rCW:51000e3, M:1e8*1e7/s.T0, rho:1450, sigEff:18e9/2.5, zGuess:s.zCW});
console.log("T0", s.T0/1e6, "M", s.M/1e6);
const zt = ME.heightAtRadius(s, 23458e3);
for (const t of [0.93, 2.8]) { const h = ME.deimosHazard({sys, zT: zt, tilt: t*Math.PI/180, band: 100e3}); console.log(t, JSON.stringify(h, (k,v)=> typeof v==="number"? +v.toPrecision(4):v)); }
const sw = ME.swings(sys, s, {rRef: 23458e3, dodge: 60e3});
for (const m of sw.modes) console.log("mode", (m.period/3600).toFixed(2), (m.atPhobos/1e3).toFixed(1), (m.atRef/1e3).toFixed(1), (m.atCW/1e3).toFixed(1), (m.energy/1e9).toFixed(2));
const m0 = sw.modes[0], n = sw.nodes;
for (const alt of [88,380,790,1590,4590,20000]) { const R=a.r+alt*1e3; let i=1; while(n.r[i]<R) i++; console.log("alt",alt,"fn",Math.abs(n.fn[i]).toFixed(3),"eta km",(Math.abs(m0.eta[i])/1e3).toFixed(1),"MJ/t",(Math.PI*1000*Math.abs(n.fn[i]*m0.eta[i])/1e6).toFixed(2)); }
const p = ME.pumping({nodes:n, mode:m0, rA:a.r, from:400e3, to:800e3, cycles:6, vFull:200, vSlow:20});
console.log("pump", JSON.stringify(p, (k,v)=> typeof v==="number"? +v.toPrecision(4):v));
const p20 = ME.pumping({nodes:n, mode:m0, rA:a.r, from:400e3, to:800e3, cycles:20, vFull:200, vSlow:20}); console.log("20 cycles onoff t", p20.dmOnOff/1e3);
const J = ME.backupImpulse(n, m0); console.log("J", J.toExponential(3), "prop t", J/8000/1e3, J/50000/1e3);
console.log("lean deg", ME.westwardLean({mdot:1, omega:sys.omega, rCW:51000e3, T0:s.T0, rA:a.r, lat:a.lat})*180/Math.PI);
console.log("release", ME.releaseOrbit(sys, 51000e3), ME.releaseOrbit(sys, 22820e3));
