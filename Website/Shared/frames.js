// Heliocentric <-> body-relative frame patching for ship-state packets. ES
// module:
//   import { Frames } from "../../Shared/frames.js";
// Everything hangs off the `Frames` namespace. Pure (no DOM), so it imports
// directly in Node for unit testing, same as math-utils.js.
//
// The one vector shift this file exists for, promoted from the Mars-Phobos
// plotter's escape-state lift (its `marsHelioState`/`escR`,`escV`, ported to
// use this module — see Website/ARCHITECTURE.md, "Migration path" step 3):
// a "local" state is relative to some body B that itself has a heliocentric
// orbit record in `Shared/orbit.js` (a planet or dwarf planet — Mars, Ceres,
// Earth, ...); heliocentric = local + B's own heliocentric state at the same
// epoch.
//
//   r_helio = r_local + R_B(jd)      v_helio = v_local + V_B(jd)
//
// See ARCHITECTURE.md, "Packets — the data contract" > "Frames" for the
// packet-level convention this backs: a ship-state packet's `frame` field is
// either `"helio"` or `"body:<Name>"`.
//
// This only handles one level of lift/drop — B must have its own heliocentric
// orbit record (`systems.get(B).orbit`, centred on the Sun), not a moon
// orbiting a planet. That matches every plotter that currently needs this
// (Solar-System-Trajectory-Plotter's bodies, Mars-Phobos's Mars-relative
// legs); a moon-relative frame (e.g. "body:Phobos") is out of scope until a
// tool actually needs one, at which point this file is the place to add a
// second hop rather than resolving it ad hoc in a calculator.

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";

export const Frames = {

	HELIO: "helio",

	// "body:Mars" -> "Mars". "helio" -> null. Throws on anything else, so a
	// malformed frame string fails loudly rather than silently no-op'ing.
	bodyNameFromFrame: function (frame) {
		if (frame === this.HELIO) { return null; }
		var m = /^body:(.+)$/.exec(frame || "");
		if (!m) { throw new Error("Frames: unrecognised frame '" + frame + "'"); }
		return m[1];
	},

	// "Mars" -> "body:Mars".
	frameForBody: function (bodyName) {
		return "body:" + bodyName;
	},

	// Body B's heliocentric state (r [m] x3, v [m/s] x3) at Julian date jd.
	bodyHelioState: function (bodyName, jd) {
		var sys = systems.get(bodyName);
		if (!sys || !sys.orbit) {
			throw new Error("Frames.bodyHelioState: '" + bodyName + "' has no heliocentric orbit");
		}
		var gmSun = systems.get("Sun").GM;
		return OrbitalMath.bodyStateAtJD(gmSun, sys.orbit, jd);
	},

	// The core shift, in one direction or the other. rLocal/vLocal (or
	// rHelio/vHelio) are plain [x,y,z] arrays, metres and m/s.
	localToHelio: function (bodyName, jd, rLocal, vLocal) {
		var b = this.bodyHelioState(bodyName, jd);
		return { r: OrbitalMath.vAdd(rLocal, b.r), v: OrbitalMath.vAdd(vLocal, b.v) };
	},
	helioToLocal: function (bodyName, jd, rHelio, vHelio) {
		var b = this.bodyHelioState(bodyName, jd);
		return { r: OrbitalMath.vSub(rHelio, b.r), v: OrbitalMath.vSub(vHelio, b.v) };
	},

	// Convert a ship-state packet's `data` ({ r, v, jd, frame, ... }) to a
	// target frame string ("helio" or "body:<Name>"). Returns a new data
	// object with `r`/`v`/`frame` replaced — `jd`, `mass`, `dvUsed`, and any
	// other fields pass through untouched. A same-frame call (including
	// body:X -> body:X) is a correct no-op, just via a redundant lift+drop
	// rather than a special case — not worth the extra branch at this scale.
	convert: function (data, targetFrame) {
		var srcBody = this.bodyNameFromFrame(data.frame);
		var dstBody = this.bodyNameFromFrame(targetFrame);
		var helioR = data.r, helioV = data.v;
		if (srcBody !== null) {
			var lifted = this.localToHelio(srcBody, data.jd, data.r, data.v);
			helioR = lifted.r; helioV = lifted.v;
		}
		var outR = helioR, outV = helioV;
		if (dstBody !== null) {
			var dropped = this.helioToLocal(dstBody, data.jd, helioR, helioV);
			outR = dropped.r; outV = dropped.v;
		}
		return Object.assign({}, data, { r: outR, v: outV, frame: targetFrame });
	}
};
