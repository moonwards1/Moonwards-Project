import { OrbitalMath as O } from "../../../../Shared/math-utils.js";
import { systems } from "../../../../Shared/orbit.js";
import { CLOCK_EPOCH, facilityFigures } from "../facilities.js";
import { arrivalPass } from "../flight.js";
import { arrivalDateInSpan } from "../arrival-date.js";
import { SOI_EARTH } from "../offworld.js";
var GM = systems.get("Earth").GM, RE = 6378137;
function inb(vInf,h,tilt){var rp=RE+h,vp=Math.sqrt(vInf*vInf+2*GM/rp),c=Math.cos(tilt||0),s=Math.sin(tilt||0),lo=0,hi=30*86400;for(var i=0;i<80;i++){var m=(lo+hi)/2;if(O.vMag(O.propagateState(GM,[rp,0,0],[0,vp*c,vp*s],-m).r)<SOI_EARTH*0.999)lo=m;else hi=m;}return O.propagateState(GM,[rp,0,0],[0,vp*c,vp*s],-lo);}
function pass(st,jd){return arrivalPass(facilityFigures("offworld",{r:st.r,v:st.v,jd:jd}),jd,null,[]).alt;}
var J1=CLOCK_EPOCH+6799;
for (const [vi,tilt,j] of [[4000,0.5,O.julianDate(2041,6,10,2,0,0)],[4000,1.2,O.julianDate(2040,3,12,6,0,0)],[10300,0.3,O.julianDate(2041,6,10,2,0,0)],[6000,-0.8,O.julianDate(2041,12,1,0,0,0)]]) {
  // aim at 80 km on the real date
  var h=80e3, st; for (var i=0;i<4;i++){ st=inb(vi,h,tilt); h += 80e3 - pass(st,j); }
  var d=arrivalDateInSpan(j,CLOCK_EPOCH,J1);
  console.log(vi, tilt, "real", Math.round(pass(st,j)/1e3), "flown on", O.dateFromJulian(d.jd).Y, Math.round(pass(st,d.jd)/1e3), "km; sun", d.sunDeg.toFixed(1), "moon", Math.round(d.moonMiss/1e3));
}
