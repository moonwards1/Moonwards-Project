import { MarsElevator as ME } from "./Calculators/Mars-Elevator/marsElevatorModel.js";
import { solveMeridianTether, trackPull } from "./Shared/meridian-tether.js";
import { counterweightFor, pullBalance } from "./Shared/radial-tether.js";
const sys = ME.marsSystem(); const a = ME.anchor(sys, 18.65, 21.9e3);
const q = (M, tr=1) => ({latA:a.lat, rA:a.r, rCW:22820e3, M, rho:1450, sigEff:18e9/2.5, lamMin:0.4*tr, lamGrav:1.2*tr});
const b = solveMeridianTether(sys.field, q(1e8,0));
const M0 = 3*Math.abs(trackPull(b,0.4,1.2))/(b.gCW*b.Esurf); console.log("bare ok", b.ok, "M0 kt", M0/1e6);
for (const f of [3, 2, 1.5, 1.2, 1.0, 0.8]) { const s = solveMeridianTether(sys.field, q(M0*f/3)); console.log(f, s.ok, s.why, s.ok ? [ (s.T0/1e6).toFixed(2), pullBalance(s, s.M).mult.toFixed(3), (counterweightFor(s,1.5)/1e6).toFixed(0), (s.departure*57.3).toFixed(1)] : ""); }
