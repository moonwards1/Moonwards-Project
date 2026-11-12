import { OrbitalMath as O } from "../../../Shared/math-utils.js";
import { CLOCK_EPOCH } from "./facilities.js";
import { computeFlight, flightStateAt } from "./flight.js";
var JD = CLOCK_EPOCH + 81, H = 3600;
for (const to of [null, "earthSkyhook"]) {
 for (const tw of [2*H, 10*H]) {
  var p = computeFlight({ from: "moonSkyhook", to, jd: JD });
  var w = computeFlight({ from: "moonSkyhook", to, jd: JD, waypoints: [{ t: tw, burn: {pro:0,rad:0,nrm:0} }] });
  console.log(to, tw/H, [tw, tw+H, 30*H, 60*H].map(t => (O.vMag(O.vSub(flightStateAt(w,t).r, flightStateAt(p,t).r))/1e3).toFixed(2)).join("  "), w.waypoints[0].reached);
 }
}
var f = computeFlight({ from: "moonSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 1e3 } }, waypoints: [{ t: 20 * 60, burn: { pro: 5 } }] });
console.log(f.final.duration, f.waypoints, computeFlight({ from: "moonSkyhook", jd: JD, params: { moonSkyhook: { relAlt: 1e3 } }}).final.duration);
