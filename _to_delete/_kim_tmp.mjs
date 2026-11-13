import { systems } from "./../../Shared/orbit.js";
import { MATERIALS } from "./../../Shared/materials.js";
import { computeSkyhook } from "./skyhookModel.js";
var moon = systems.get("Moon"), m = MATERIALS.silica;
var t = computeSkyhook(moon, { foot: 0.5e3, centre: 1500e3, top: 2000e3, stationMass:{}, strength: (m.strength/3)/m.density,
 loadTop: 2e6, distUpper: 5e6, comMass: 2000e6, distLower: 10e6, loadFoot: 20e6, ifaceAlt: 122 });
var P=t.profile, all=[]; P.low.r.forEach((r,i)=>all.push([r,P.low.T[i]])); for (var q=P.up.r.length-1;q>=0;q--) all.push([P.up.r[q],P.up.T[q]]);
var rS=P.low.r[P.low.r.length-1]+t.comOffset, iS=all.length-1; for (var j=0;j<all.length;j++) if (all[j][0]>=rS-1){iS=j;break;}
function w(seg){var pk=Math.max(...seg.map(p=>p[1])),ref=Infinity,dM=1;seg.forEach(p=>{if(p[1]>1e-6*pk&&p[1]<ref)ref=p[1];});seg.forEach(p=>dM=Math.max(dM,Math.sqrt(p[1]/ref)));var k=Math.max(0.5,Math.min(3,16/dM));return seg.map(p=>[(p[0]-moon.radius)/1e3,k*Math.sqrt(p[1]/ref)]);}
for (const [name,seg] of [["lower",all.slice(0,iS+1)],["upper",all.slice(iS+1)]]) { const x=w(seg); console.log(name, "comOffset km", (t.comOffset/1e3).toFixed(1), x.filter((_,i)=>i%150==0||i==x.length-1).map(p=>p[0].toFixed(0)+"km:"+p[1].toFixed(2)+"px").join("  ")); }
console.log(t.lowRatio.toFixed(2), t.highRatio.toFixed(2));
