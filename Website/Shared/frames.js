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
// Most bodies resolve in one hop: B has its own heliocentric orbit record
// (`systems.get(B).orbit`, centred on the Sun). The Moon takes a SECOND hop —
// Earth's heliocentric state plus its own geocentric offset from the lunar
// ephemeris — because it has no Sun-centred ellipse and its heliocentric path
// is not a conic at all. `SATELLITE_PRIMARY` lists which bodies need that hop
// and around what; everything else is one hop, exactly as before.
//
// Separately, `escapeReferenceFor` answers a different question with the same
// flavour: which body's SOI a departure from B actually leaves, and therefore
// whose heliocentric velocity a hand-off's v-infinity is measured against. For
// every body that is itself; for the Moon it is Earth, because a ship leaving
// the Moon is still 850,000 km inside Earth's sphere of influence and its
// departure phase does not end until it crosses THAT boundary. Position and
// velocity genuinely take different answers for a satellite origin, so the two
// lookups are kept separate rather than collapsed into one "origin body".

import { systems } from "./orbit.js";
import { OrbitalMath } from "./math-utils.js";
import { LunarEphemeris } from "./lunar-ephemeris.js";

// Bodies with no heliocentric orbit record: the primary they orbit, and their
// own state relative to it (m, m/s) — the lunar ephemeris reports km and km/s.
export const SATELLITES = {
	Moon: {
		primary: "Earth",
		localState: function (jd) {
			var s = LunarEphemeris.moonState(jd);
			return { r: [s.r[0] * 1e3, s.r[1] * 1e3, s.r[2] * 1e3],
			         v: [s.v[0] * 1e3, s.v[1] * 1e3, s.v[2] * 1e3] };
		}
	}
};

export const Frames = {

	HELIO: "helio",

	// Which body's SOI a departure from `bodyName` exits — the reference its
	// hand-off v-infinity is measured against. Identity for every body with its
	// own heliocentric orbit; the primary for a satellite.
	escapeReferenceFor: function (bodyName) {
		var sat = SATELLITES[bodyName];
		return sat ? sat.primary : bodyName;
	},

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
	// A satellite (SATELLITES) is its primary's state plus its own offset from
	// the ephemeris, so the Moon reports where it really is rather than where a
	// Sun-centred conic would put it.
	bodyHelioState: function (bodyName, jd) {
		var sat = SATELLITES[bodyName];
		if (sat) {
			var base = this.bodyHelioState(sat.primary, jd);
			var loc = sat.localState(jd);
			return { r: OrbitalMath.vAdd(base.r, loc.r), v: OrbitalMath.vAdd(base.v, loc.v) };
		}
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
