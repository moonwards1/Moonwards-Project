/* Shared/sim/readout-panes.js
 *
 * The small "straddling" info card that hangs off a burn widget's host
 * element, poking out past the side panel's edge (see
 * Website/ARCHITECTURE.md, "Step 1: scene kit"). Extracted from three call
 * sites (Solar-System-Trajectory-Plotter's single scene; Moon-Skyhook's and
 * Mars-Phobos's panels), which agreed on everything except:
 *
 * - CSS class prefix (`sst-readout` / `msk-readout` / `mps-readout`) — each
 *   tool's stylesheet already scopes its readout styling under its own
 *   prefix, so `renderReadoutBoxes` takes `opts.classPrefix` rather than
 *   assuming one.
 * - The "plane change" row's label text: the Solar-System-Trajectory-Plotter
 *   (whose burns are already about the Sun) just says "plane change", while
 *   Moon-Skyhook and Mars-Phobos say "plane change (to ecliptic)" to
 *   disambiguate from their body-relative inclination. `opts.planeChangeLabel`
 *   (default `"plane change"`) carries this per-tool wording.
 * - The row colours (`opts.dvHex`/`opts.spdHex`) happen to be identical
 *   hex strings everywhere today (pink/amber, matching each tool's own
 *   DV_COLOR/DSPEED_COLOR burn-arrow constants), but are caller-supplied
 *   rather than baked in, since they're derived from each tool's own colour
 *   constants and could diverge.
 * - `opts.compact`: Mission Planner's own layout (a "Δv" title over three
 *   stacked label/value rows — impulse, prograde, plane change — narrower
 *   than the three tools' original label-beside-row layout). Opt-in and
 *   false by default, so the three original call sites are unaffected.
 *
 * THE PROGRADE ROW HAS TWO FORMS. A burn on an existing trajectory reports
 * the signed change ("+0.25 km/s") — the speed it started from is the ship's
 * own and needs no restating. A carrier-chain element instead reports the
 * speed the payload is left AT ("6.09 km/s"), an absolute figure rather than
 * a change: the speed it started from is its MOUNT's, and the mount is itself
 * a card in the same stack, reporting that figure in its own box. A magnitude
 * difference would be the wrong number here anyway — a kick square to a fast
 * mount barely moves the speed, which would hide the entire kick. An entry
 * opts into the second form by carrying `speedAfter` (km/s); without it the
 * signed form is used, so the three original call sites are unaffected.
 *
 * What's NOT here: `burnReadoutData` (the |Δv| / plane-change / prograde-Δv
 * physics) stays local to each calculator — it reads tool-specific state
 * (GM_SUN vs GM_S, local-vs-absolute r/vBefore) that isn't worth threading
 * through a shared signature for three near-identical call sites. This
 * module only owns rendering the rows and positioning the box.
 */

// Rebuild the readout boxes from a list of { host, data } (data may be null
// for a negligible burn, in which case that entry is skipped). Removes the
// old boxes from `layer`, builds new ones, and returns the new boxes array
// (caller keeps this in its own `readoutBoxes`-style variable). Does NOT
// position them — call `positionReadoutBoxes` after.
//
// opts: { classPrefix, dvHex, spdHex, planeChangeLabel, compact }
// classPrefix/dvHex/spdHex are required; planeChangeLabel defaults to
// "plane change" (ignored in compact mode, which always says "plane change");
// compact defaults false.
export function renderReadoutBoxes(layer, boxes, entries, opts) {
	if (!layer) { return boxes; }
	boxes.forEach(function (b) { layer.removeChild(b.el); });
	var next = [];
	var cls = opts.classPrefix;
	var planeChangeLabel = opts.planeChangeLabel || "plane change";
	entries.forEach(function (en) {
		if (!en.data || !en.host) { return; }
		var prograde = fmtPrograde(en.data);
		var box = document.createElement("div");
		box.className = cls + "-readout" + (opts.compact ? " " + cls + "-readout-compact" : "");
		box.innerHTML = opts.compact
			? '<div class="' + cls + '-readout-title">Δv</div>'
			  + '<div class="' + cls + '-readout-row"><span class="' + cls + '-readout-label">impulse</span>'
			  + '<span class="' + cls + '-readout-val" style="color:' + opts.dvHex + '">' + en.data.burnDv.toFixed(2) + ' km/s</span></div>'
			  + '<div class="' + cls + '-readout-row"><span class="' + cls + '-readout-label">prograde</span>'
			  + '<span class="' + cls + '-readout-val" style="color:' + opts.spdHex + '">' + prograde + '</span></div>'
			  + '<div class="' + cls + '-readout-row"><span class="' + cls + '-readout-label">plane<br>change</span>'
			  + '<span class="' + cls + '-readout-val" style="color:' + opts.dvHex + '">' + fmtSigned(en.data.planeChange, 1, '°') + '</span></div>'
			: '<div class="' + cls + '-readout-row"><span class="' + cls + '-readout-label">impulse Δv</span>'
			  + '<span class="' + cls + '-readout-val" style="color:' + opts.dvHex + '">' + en.data.burnDv.toFixed(2) + ' km/s</span></div>'
			  + '<div class="' + cls + '-readout-row"><span class="' + cls + '-readout-label">' + planeChangeLabel + '</span>'
			  + '<span class="' + cls + '-readout-val" style="color:' + opts.dvHex + '">' + fmtSigned(en.data.planeChange, 1, '°') + '</span></div>'
			  + '<div class="' + cls + '-readout-row"><span class="' + cls + '-readout-label">prograde Δv</span>'
			  + '<span class="' + cls + '-readout-val" style="color:' + opts.spdHex + '">' + prograde + '</span></div>';
		layer.appendChild(box);
		next.push({ el: box, host: en.host });
	});
	return next;
}

// Place each readout box straddling the panel's left edge, vertically
// centred on its burn widget's host element. Hidden when its host is
// scrolled out of the panel's visible range (including display:none, whose
// zero-size rect never satisfies the visibility test below).
//
// `edgeOffset` (default 0) shifts the box toward the main pane by that many
// px, narrowing how far it pokes out over the panel side of the boundary —
// Mission Planner's callers pass 15 so the box still straddles centred on
// the edge but sits closer to the main pane than a dead-centre split would.
export function positionReadoutBoxes(boxes, mainEl, panelEl, edgeOffset) {
	if (!boxes.length || !mainEl || !panelEl) { return; }
	var offset = edgeOffset || 0;
	var mr = mainEl.getBoundingClientRect();
	var pr = panelEl.getBoundingClientRect();
	var boundary = pr.left - mr.left;            // panel's left edge in main coords
	boxes.forEach(function (b) {
		var hr = b.host.getBoundingClientRect();
		var visible = hr.bottom > pr.top + 4 && hr.top < pr.bottom - 4;
		b.el.style.display = visible ? "" : "none";
		if (!visible) { return; }
		var w = b.el.offsetWidth, h = b.el.offsetHeight;
		var left = boundary - w / 2 - offset;
		if (left < 4) { left = 4; }              // stacked layout: keep on-screen
		b.el.style.left = left + "px";
		b.el.style.top  = (hr.top - mr.top + hr.height / 2 - h / 2) + "px";
	});
}

// "+1.23", "-0.04" — a signed number with a real minus sign (not a hyphen)
// and a fixed unit suffix. Used for the plane-change/prograde-Δv rows,
// which can go either direction.
function fmtSigned(x, digits, unit) {
	return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(digits) + unit;
}

// isFinite(null) is true (null coerces to 0), so the speed test below needs
// the type check as well — a missing speed must fall through to the signed
// form, not read as 0.00.
function isNum(x) { return typeof x === "number" && isFinite(x); }

// The prograde row's text: "6.09 km/s" when the entry carries the speed it
// leaves the payload at, else the signed change. Exported for the Node tests,
// which check the two forms without a DOM.
export function fmtPrograde(data) {
	if (isNum(data.speedAfter)) { return data.speedAfter.toFixed(2) + " km/s"; }
	return fmtSigned(data.progradeDv, 2, " km/s");
}
