import { computeFlight } from "../flight.js";
import { CLOCK_EPOCH } from "../clock.js";
for (const alt of [260e3, 1000e3, 3000e3, 5000e3, 5986e3, 7000e3, 8300e3, 8600e3, 10000e3]) {
  const t0=Date.now(); const f = computeFlight({from:"phobosSkyhook", jd: CLOCK_EPOCH+81.3, params:{phobosSkyhook:{relAlt:alt}}}); const s=f.summary;
  console.log(alt/1e3, s.outcome, "n="+f.leg.samples.length, "dur h", (s.duration/3600).toFixed(2), "peri", (s.periAlt/1e3).toFixed(0), "apo", s.apoAlt==null?"-":(s.apoAlt/1e3).toFixed(0), s.outcome=="entry"? `v ${s.entrySpeed.toFixed(0)} air ${s.entryAirSpeed.toFixed(0)} ang ${(s.entryAngle*57.3).toFixed(1)}`:"", s.vInf?("vinf "+s.vInf.toFixed(0)):"", (Date.now()-t0)+"ms");
}
