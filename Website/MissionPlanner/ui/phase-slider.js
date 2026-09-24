/* MissionPlanner/ui/phase-slider.js — the segmented-timeline widget behind
 * the phase bar's sliders. ONE PER PHASE, three in all, exactly one on screen
 * at a time (mission-view.js's syncSliderVisibility): Departure, Coast,
 * Arrival. Each phase's slider IS that phase's clock control; the raw
 * Ephemeris date bar is only a fallback for a phase with no resolvable span.
 *
 * Two layers:
 *
 *   - createSegmentedSlider(container, opts) — the DOM primitive. A track of
 *     flex-sized segments plus a playhead, with the .mp- class names
 *     planner.css styles. It knows nothing about dates or jd: callers hand it
 *     segments (fractions along a 0..1 track) and a playhead fraction, and get
 *     a 0..1 fraction back whenever the user clicks or drags the track.
 *     setMarks overlays event ticks at arbitrary fractions.
 *
 *   - three PURE state functions — coastSliderState, departureSliderState,
 *     arrivalSliderState — each computing segments + playhead fraction +
 *     pinned flag + marks from a span, a jd, a tick count and a date
 *     formatter. No DOM, Node-testable (ui/tests/phase-slider.test.js). Each
 *     has a thin create* wrapper that feeds it to the DOM primitive and turns
 *     track clicks/drags into jd values.
 *
 * All three sliders are linear in time over a span the CALLER computes
 * (mission-view.js's departureSpan / coastSpan / arrivalSpan); they differ
 * only in which edges are anchored and how the playhead readout is stamped.
 * Coast alone is piecewise: its own span stays linear, but the tacked-on
 * Arrival tail past it is stretched and slowed relative to that — see its
 * own section below.
 */

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function pad2(n) { return String(n).padStart(2, "0"); }

// Even tick segments across [start, end], labeled ONLY at the two ends of the
// track — the first segment with `start`, the last with `end` — so a narrow
// timeline doesn't try to cram a date/time stamp into every interior tick.
// The interior ticks stay as plain unlabeled dividers (tickOnly).
function buildTickSegments(start, end, ticks, formatter) {
	var span = end - start;
	var segments = [];
	for (var i = 0; i < ticks; i++) {
		var seg = { frac0: i / ticks, frac1: (i + 1) / ticks, tickOnly: true };
		if (i === 0) { seg.label = formatter(start); }
		else if (i === ticks - 1) { seg.label = formatter(end); }
		segments.push(seg);
	}
	return segments;
}

// "T+" mission-elapsed-time readout for the playhead label: days elapsed since
// `start`, split into a "167 d" line and a separate elapsed HH:MM line. The
// time line is ELAPSED time within the current day, not calendar wall-clock, so
// the two lines always agree — "167 d" + "14:32" means exactly that many
// days+hours+minutes since the span began, whatever time of day it began at.
// No separate "departure epoch" plumbing is needed: Coast's span start IS the
// departure/release epoch and Departure's IS launch itself. No DOM,
// Node-testable.
export function elapsedStamp(jd, start) {
	var elapsed = jd - start;
	var days = Math.floor(elapsed);
	var totalMin = Math.round((elapsed - days) * 1440);
	if (totalMin >= 1440) { totalMin -= 1440; days += 1; }
	return { days: days + " d", time: pad2(Math.floor(totalMin / 60)) + ":" + pad2(totalMin % 60) };
}

// The Arrival slider's playhead readout. "T+ since the phase started" is the
// wrong anchor for a window only 3-6 days wide whose BOTH edges move: what the
// user is judging is how far the clock sits from the encounter itself, so this
// is signed time relative to the timeline's zero, the arrival mark
// ("-2 d 06:00" approaching, "+0 d 14:32" past it). Same two-line days/HH:MM
// shape as elapsedStamp, same carry handling. No DOM, Node-testable.
export function approachStamp(jd, zero) {
	var delta = jd - zero;
	var mag = Math.abs(delta);
	var days = Math.floor(mag);
	var totalMin = Math.round((mag - days) * 1440);
	if (totalMin >= 1440) { totalMin -= 1440; days += 1; }
	// exactly at the zero reads "+0 d 00:00", not "-0 d"
	var sign = (delta < 0 && (days > 0 || totalMin > 0)) ? "-" : "+";
	return { days: sign + days + " d", time: pad2(Math.floor(totalMin / 60)) + ":" + pad2(totalMin % 60) };
}

// ---- the DOM primitive -----------------------------------------------------
// opts.onScrub(fraction) — called with a 0..1 track fraction on click/drag/
//   wheel (plain click/drag jumps and tracks 1:1; Shift or Ctrl held on a
//   drag or the mouse wheel fine-tune instead, at 10x- or 12x-slower
//   sensitivity respectively — see dragSensitivity/onDown/onMove/onWheel).
// opts.speedAt(fraction) — optional. Returns a multiplier on drag/wheel
//   movement, sampled at the playhead's CURRENT fraction every move — the
//   Coast slider's own tacked-on Arrival tail uses this for its extra
//   ARRIVAL_SLOWDOWN (below); every other slider omits it and gets 1
//   everywhere. A fresh click still jumps straight to the clicked point
//   (onDown), unaffected — only continued dragging/wheeling is scaled.
// Returns { root, setSegments(segs), setEmpty(msg), setPlayhead(fraction,
//   pinned, daysText, timeText), dispose() }.
export function createSegmentedSlider(container, opts) {
	var onScrub = opts.onScrub;

	var root = document.createElement("div");
	root.className = "mp-timeline";

	var track = document.createElement("div");
	track.className = "mp-track";
	root.appendChild(track);

	var playhead = document.createElement("div");
	playhead.className = "mp-playhead";
	track.appendChild(playhead);

	var playheadLabel = document.createElement("div");
	playheadLabel.className = "mp-playhead-label";
	var playheadDaysEl = document.createElement("div");
	playheadDaysEl.className = "mp-playhead-days";
	var playheadTimeEl = document.createElement("div");
	playheadTimeEl.className = "mp-playhead-time";
	playheadLabel.appendChild(playheadDaysEl);
	playheadLabel.appendChild(playheadTimeEl);
	playhead.appendChild(playheadLabel);

	container.appendChild(root);

	function fractionAt(clientX) {
		var r = track.getBoundingClientRect();
		return r.width > 0 ? clamp01((clientX - r.left) / r.width) : 0;
	}

	// A plain click near a mark (event tick / closest-approach) snaps to that
	// mark's exact fraction instead of the raw cursor position, within a small
	// pixel leeway -- clicking "on" a mark should land precisely on its epoch,
	// not a few minutes off from where the pointer happened to land on a thin
	// tick. Only a fresh click snaps (see onDown); dragging and the Shift/wheel
	// fine-tune paths use the raw position throughout, so a drag that starts on
	// a mark is free to move away from it immediately.
	var SNAP_PX = 8;
	var markFractions = [];   // current setMarks() fractions, for the leeway above
	function snapFraction(frac, width) {
		var tolFrac = SNAP_PX / Math.max(1, width);
		var best = frac, bestDist = tolFrac;
		markFractions.forEach(function (mf) {
			var d = Math.abs(mf - frac);
			if (d <= bestDist) { bestDist = d; best = mf; }
		});
		return best;
	}

	// A plain click/drag jumps to the cursor and tracks it 1:1. Holding Shift
	// instead fine-tunes RELATIVELY from wherever the playhead already is, at
	// 10x-slower sensitivity, without jumping — matching Shared/sim/date-bar.js's
	// Shift-drag. Ctrl is the same idea at a coarser 1/12 sensitivity (Shift
	// wins if somehow both are held). Rolling the mouse wheel over the track
	// reaches the same slower scrub without dragging, at whichever of the two
	// rates the held modifier picks (plain wheel keeps the 0.1 default): each
	// notch moves the playhead as if the mouse had dragged that many pixels.
	var currentFraction = 0;
	var dragging = false, lastX = 0;
	// null means "jump to the cursor"; otherwise the drag sensitivity to
	// fine-tune relatively at, without jumping.
	function dragSensitivity(e) {
		if (e.shiftKey) { return 0.1; }
		if (e.ctrlKey) { return 1 / 12; }
		return null;
	}
	function onDown(e) {
		dragging = true;
		lastX = e.clientX;
		if (dragSensitivity(e) === null) {
			var width = track.getBoundingClientRect().width || 1;
			currentFraction = snapFraction(fractionAt(e.clientX), width);
			onScrub(currentFraction);
		}
		e.preventDefault();
	}
	// Both the plain 1:1 track and the Shift/Ctrl fine-tune are the same move:
	// the cursor's raw per-event delta, scaled. Plain-drag's scale is 1 — over
	// a burst of mousemove events that telescopes to exactly the same result
	// as jumping straight to the cursor, so this is a lossless generalization,
	// not a behavior change — until opts.speedAt narrows it further inside a
	// slow zone, which a single "jump to cursor" couldn't express at all.
	function onMove(e) {
		if (!dragging) { return; }
		var width = track.getBoundingClientRect().width || 1;
		var dx = e.clientX - lastX;
		var sens = dragSensitivity(e);
		var scale = (sens === null ? 1 : sens) * (opts.speedAt ? opts.speedAt(currentFraction) : 1);
		currentFraction = clamp01(currentFraction + (dx / width) * scale);
		lastX = e.clientX;
		onScrub(currentFraction);
	}
	function onUp() { dragging = false; }
	function onWheel(e) {
		e.preventDefault();
		var width = track.getBoundingClientRect().width || 1;
		var sens = e.ctrlKey ? 1 / 12 : 0.1;
		var scale = sens * (opts.speedAt ? opts.speedAt(currentFraction) : 1);
		currentFraction = clamp01(currentFraction - (e.deltaY / width) * scale);
		onScrub(currentFraction);
	}
	track.addEventListener("mousedown", onDown);
	window.addEventListener("mousemove", onMove);
	window.addEventListener("mouseup", onUp);
	track.addEventListener("wheel", onWheel, { passive: false });

	function clearSegments() {
		Array.prototype.slice.call(track.children).forEach(function (el) {
			if (el !== playhead) { track.removeChild(el); }
		});
	}

	return {
		root: root,
		// segs: [{ frac0, frac1, label, sub, tickOnly, cls }]
		setSegments: function (segs) {
			clearSegments();
			segs.forEach(function (s) {
				var el = document.createElement("div");
				el.className = "mp-seg" + (s.tickOnly ? " mp-seg-tick" : "") + (s.cls ? " " + s.cls : "");
				el.style.flex = Math.max(s.frac1 - s.frac0, 0.001);
				if (s.label) { el.appendChild(document.createTextNode(s.label)); }
				if (s.sub) {
					var sm = document.createElement("small");
					sm.textContent = s.sub;
					el.appendChild(sm);
				}
				track.insertBefore(el, playhead);
			});
			playhead.style.display = "";
		},
		setEmpty: function (message) {
			clearSegments();
			var el = document.createElement("div");
			el.className = "mp-seg-empty";
			el.textContent = message;
			track.insertBefore(el, playhead);
			playhead.style.display = "none";
		},
		// daysText/timeText: the two lines of the floating readout touching the
		// bottom of the handle (omit/empty to hide it — the empty-state path
		// never calls this, so there's nothing to clear).
		setPlayhead: function (fraction, pinned, daysText, timeText) {
			currentFraction = clamp01(fraction);
			playhead.style.left = (currentFraction * 100) + "%";
			playhead.classList.toggle("mp-pinned", !!pinned);
			playheadDaysEl.textContent = daysText || "";
			playheadTimeEl.textContent = timeText || "";
			playheadLabel.style.display = daysText ? "" : "none";
		},
		// Overlay ticks at arbitrary fractions (event marks on a linear axis),
		// independent of the segment cells. marks: [{ frac, title, cls }].
		setMarks: function (marks) {
			Array.prototype.slice.call(track.querySelectorAll(".mp-mark"))
				.forEach(function (m) { track.removeChild(m); });
			markFractions = (marks || []).map(function (m) { return clamp01(m.frac); });
			(marks || []).forEach(function (m) {
				var el = document.createElement("div");
				el.className = "mp-mark" + (m.cls ? " " + m.cls : "");
				el.style.left = (clamp01(m.frac) * 100) + "%";
				if (m.title) { el.title = m.title; }
				track.appendChild(el);
			});
		},
		dispose: function () {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			root.remove();
		}
	};
}

// ---- the Coast slider ------------------------------------------------------
// The tacked-on Arrival tail (coastSliderState's arrivalEnd) is short — a
// seam window of a few days — next to a coast that routinely runs hundreds of
// days, so a strictly time-linear track would render it as a sliver a pixel
// or two wide and scrub it at the same breakneck days-per-pixel rate as the
// rest of the trip. Two independent fixes, applied together:
//
//   - ARRIVAL_STRETCH renders the tail at 3x its natural (linear-time) share
//     of the track (coastArrivalBoundaryFrac), so it is wide enough to see
//     and to click inside even on a long trip.
//   - ARRIVAL_SLOWDOWN then scrubs it an EXTRA 4x slower on top of that (the
//     widget's own opts.speedAt hook), because 3x more pixels alone still
//     isn't fine enough for a window this consequential.
//
// Combined, dragging through the tail moves the clock at 1/12th the rate
// dragging through the coast does. The track is otherwise still linear in
// time within each of its two pieces — see coastFracForJd/coastJdForFrac.
export var ARRIVAL_STRETCH = 3;
export var ARRIVAL_SLOWDOWN = 4;

// The [0,1] track fraction at the coast/arrival boundary. Capped so the tail
// never claims more than 90% of the track, which would otherwise happen for
// an unusually short coast (leaving the coast portion unusably thin instead).
// No DOM — Node-testable.
export function coastArrivalBoundaryFrac(coastDur, arrivalDur) {
	if (!(coastDur > 0)) { return 0; }
	if (!(arrivalDur > 0)) { return 1; }
	var natural = arrivalDur / (coastDur + arrivalDur);
	return 1 - Math.min(0.9, natural * ARRIVAL_STRETCH);
}

// jd -> track fraction: linear over [start, end] up to `boundary`, linear (at
// the tail's own, denser rate) from `boundary` to 1 across [end, arrivalEnd].
// The inverse of coastJdForFrac. No DOM — Node-testable.
export function coastFracForJd(jd, start, end, arrivalEnd, boundary) {
	if (jd <= end) {
		var coastDur = end - start;
		return coastDur > 0 ? boundary * (jd - start) / coastDur : 0;
	}
	var arrDur = arrivalEnd - end;
	return arrDur > 0 ? boundary + (1 - boundary) * (jd - end) / arrDur : boundary;
}

// track fraction -> jd, the inverse of coastFracForJd. No DOM — Node-testable.
export function coastJdForFrac(frac, start, end, arrivalEnd, boundary) {
	if (frac <= boundary) {
		return boundary > 0 ? start + (frac / boundary) * (end - start) : start;
	}
	return end + ((frac - boundary) / (1 - boundary)) * (arrivalEnd - end);
}

// Pure: given the coast span (start/end jd, from the adopted plan's committed
// dates ending at the arrival seam — see mission-view.js's coastSpan()), the
// shared clock's jd, a tick count and a shortDate(jd) formatter for the tick
// captions, compute what the widget should show. No DOM — Node-testable.
//
// opts.arrivalEnd, when finite and past `end`, tacks the arrival window
// (coastSeam.start..arrivalSeam.end) onto the track as one extra segment past
// the coast's own tick segments (stretched — see the header above), so the
// heliocentric approach+arrival reads as one continuous scrub — see
// mission-view.js's coastSpan/arrivalSpan and Notes/decisions.md. Its own
// tick segments are unchanged (still spaced over [start, end]), just rescaled
// to share the track with the tacked-on piece; the playhead/pin/stamp all
// move to cover the full [start, arrivalEnd].
export function coastSliderState(opts) {
	var start = opts.start, end = opts.end, jd = opts.jd;
	var ticks = opts.ticks || 5;
	var shortDate = opts.shortDate;
	var arrivalEnd = opts.arrivalEnd;

	if (!(isFinite(start) && isFinite(end) && end > start)) {
		return { empty: true };
	}
	var hasArrival = isFinite(arrivalEnd) && arrivalEnd > end;
	var total = hasArrival ? arrivalEnd : end;
	var boundary = hasArrival ? coastArrivalBoundaryFrac(end - start, arrivalEnd - end) : 1;

	var segments = buildTickSegments(start, end, ticks, shortDate).map(function (s) {
		return { frac0: s.frac0 * boundary, frac1: s.frac1 * boundary,
		         label: s.label, tickOnly: s.tickOnly };
	});
	if (hasArrival) {
		segments.push({ frac0: boundary, frac1: 1, cls: "mp-seg-arrival" });
	}

	var pinnedAt = jd < start ? "start" : (jd > total ? "end" : null);
	var playheadFrac = pinnedAt === "start" ? 0
		: pinnedAt === "end" ? 1
		: coastFracForJd(jd, start, end, hasArrival ? arrivalEnd : end, boundary);
	// The readout always shows the true clock time, even when the handle itself
	// is pinned at an edge because the clock has wandered outside the span —
	// that's the point of showing it. `start` IS the departure/release epoch
	// here (the adopted plan's departure date, or the events' envelope minimum
	// without a plan), so elapsedStamp needs no separate epoch.
	var stamp = elapsedStamp(jd, start);
	return { empty: false, segments: segments, playheadFrac: playheadFrac, pinnedAt: pinnedAt,
	         playheadDays: stamp.days, playheadTime: stamp.time };
}

// opts: { onSetJd(jd), shortDate(jd), ticks? }. Returns { update({start,end,
// jd,arrivalEnd}), dispose() }. update() is cheap to call on every
// recompute/clock change — it just rebuilds a handful of DOM nodes and
// repositions the playhead. `arrivalEnd` (optional, NaN when there's no
// arrival window) is coastSliderState's own tack-on edge; scrubbing follows
// it too (through the same stretched/slowed mapping), so dragging into the
// dim-blue tail sets the clock into the arrival phase exactly as dragging
// within the coast portion does, just more precisely.
export function createCoastSlider(container, opts) {
	var onSetJd = opts.onSetJd;
	var shortDate = opts.shortDate;
	var ticks = opts.ticks;
	var span = null;   // { start, end, arrivalEnd, boundary } — null while empty

	var slider = createSegmentedSlider(container, {
		onScrub: function (fraction) {
			if (span) { onSetJd(coastJdForFrac(fraction, span.start, span.end, span.arrivalEnd, span.boundary)); }
		},
		speedAt: function (fraction) {
			return (span && fraction > span.boundary) ? 1 / ARRIVAL_SLOWDOWN : 1;
		}
	});

	function update(state) {
		var s = coastSliderState({ start: state.start, end: state.end, jd: state.jd, ticks: ticks,
			shortDate: shortDate, arrivalEnd: state.arrivalEnd });
		if (s.empty) {
			span = null;
			slider.setEmpty("No computed span yet — departure and the leg both need to resolve.");
			return;
		}
		var hasArrival = isFinite(state.arrivalEnd) && state.arrivalEnd > state.end;
		var arrivalEnd = hasArrival ? state.arrivalEnd : state.end;
		span = { start: state.start, end: state.end, arrivalEnd: arrivalEnd,
			boundary: hasArrival ? coastArrivalBoundaryFrac(state.end - state.start, arrivalEnd - state.end) : 1 };
		slider.setSegments(s.segments);
		slider.setPlayhead(s.playheadFrac, !!s.pinnedAt, s.playheadDays, s.playheadTime);
	}

	return { update: update, dispose: slider.dispose };
}

// ---- the Departure slider --------------------------------------------------
// LINEAR in time (like Coast), spanning the ship's departure flight: from
// launch on the LEFT to the moment the ship must be on course for the coast
// phase (origin-SOI exit) on the RIGHT.
//
// PINNED-START for every origin (mission-view.js's departureSpan): the LEFT
// edge is the release epoch — the departure leg's own `releaseJd`, seeded by
// core/adopt.js from core/departure-estimate.js's estimateDeparture() and
// read via core/release-epoch.js. The RIGHT edge floats: the flight's own
// predicted SOI exit once a departure tech resolves one, else departureSpan's
// default estimate (SOI_radius / required v∞), stretched when needed to keep
// the plan's committed hand-off on the track. That hand-off and the predicted
// SOI exit both arrive as marks — see departureSpan's own header.
//
// The caller hands over two edge jds plus event marks; the widget is a plain
// linear scrubber over them, identical in feel to the Coast slider — except
// the caller also hands over the release event's own jd, which
// createDepartureSlider floors scrubbing at and uses as the "0 d" zero point
// for the playhead readout. Under PINNED-START that floor coincides with the
// left edge; the floor is kept because release, not the geometric edge, is
// what "0 d" means.
// Everything about which times mean what lives in mission-view.js.

// Pure: even time ticks across [start, end] for the linear scale, plus the
// interior event marks placed at their true time fractions, plus the playhead
// (pinned when the clock is outside the span). No DOM — Node-testable.
export function departureSliderState(opts) {
	var start = opts.start, end = opts.end, jd = opts.jd;
	var ticks = opts.ticks || 5;
	var stamp = opts.stamp;
	var releaseJd = isFinite(opts.releaseJd) ? opts.releaseJd : start;
	if (!(isFinite(start) && isFinite(end) && end > start)) { return { empty: true }; }
	var span = end - start;

	var segments = buildTickSegments(start, end, ticks, stamp);

	// Event marks (release, SOI crossings, burns) at their real fractions —
	// interior only; the launch and on-course ends are the edges themselves.
	var marks = (opts.marks || [])
		.filter(function (m) { return m && isFinite(m.jd); })
		.map(function (m) { return { frac: (m.jd - start) / span, title: m.label, jd: m.jd }; })
		.filter(function (m) { return m.frac > 0.001 && m.frac < 0.999; });

	var pinnedAt = jd < start ? "start" : (jd > end ? "end" : null);
	var playheadFrac = pinnedAt === "start" ? 0
		: pinnedAt === "end" ? 1
		: (jd - start) / span;
	// The zero point is the actual release event, not the track's geometric
	// left edge. The two coincide as mission-view.js's departureSpan builds
	// the track, but "0 d" means "at release" by definition, not "at the
	// left edge".
	var stampVal = elapsedStamp(jd, releaseJd);
	return { empty: false, segments: segments, marks: marks,
	         playheadFrac: playheadFrac, pinnedAt: pinnedAt,
	         playheadDays: stampVal.days, playheadTime: stampVal.time };
}

// opts: { onSetJd(jd), stamp(jd), ticks?, emptyMsg }. Returns { update({
// start, end, jd, marks, defaulted }), dispose() }. update() is cheap to
// call on every recompute/clock change.
export function createDepartureSlider(container, opts) {
	var onSetJd = opts.onSetJd;
	var stamp = opts.stamp;
	var ticks = opts.ticks;
	var emptyMsg = opts.emptyMsg ||
		"No departure span yet — the release needs to resolve, and a destination set.";
	var span = null;       // { start, end } — null while empty
	var releaseJd = NaN;   // the scrub floor — see departureSliderState's stamp epoch

	var slider = createSegmentedSlider(container, {
		// Scrubbing can't reach a time before release: nothing happened before
		// it, so there's nothing to scrub to there.
		onScrub: function (fraction) {
			if (!span) { return; }
			var jd = span.start + fraction * (span.end - span.start);
			if (isFinite(releaseJd) && jd < releaseJd) { jd = releaseJd; }
			onSetJd(jd);
		}
	});

	function update(state) {
		var s = departureSliderState({ start: state.start, end: state.end, jd: state.jd,
			ticks: ticks, stamp: stamp, marks: state.marks, releaseJd: state.releaseJd });
		if (s.empty) {
			span = null;
			releaseJd = NaN;
			slider.setMarks([]);
			slider.setEmpty(emptyMsg);
			return;
		}
		span = { start: state.start, end: state.end };
		releaseJd = isFinite(state.releaseJd) ? state.releaseJd : state.start;
		slider.setSegments(s.segments);
		slider.setMarks(s.marks);
		slider.setPlayhead(s.playheadFrac, !!s.pinnedAt, s.playheadDays, s.playheadTime);
	}

	return { update: update, dispose: slider.dispose };
}

// ---- the Arrival slider ----------------------------------------------------
// The only one of the three whose span is derived end to end rather than
// anchored: it IS the seam window from core/arrival-seam.js —
//
//   [ closest approach - Delta-t, closest approach + ~1 day ]
//
// Coast anchors its left edge at the release epoch and Departure anchors one
// edge at the compliance deadline (see each above); here BOTH edges are
// recomputed from the live closest-approach event every recompute pass, so
// the whole window slides bodily as the coast is tuned — typically by hours,
// occasionally by days. Nothing in this widget needs to know that: the caller
// hands over two fresh edge jds each update, exactly as the other two do.
// What IS particular to this slider:
//
//   - The playhead readout is signed time relative to the timeline's zero
//     (approachStamp) rather than "T+" since the phase started. The zero is
//     the arrival mark (modules/arrival-approach.js's arrivalMark): the
//     arc's first equatorial crossing within reach of a tether, else closest
//     approach. Closest approach itself is NOT drawn as a track mark: the
//     equatorial-plane crossing mission-view.js adds (arrivalEvents) sits
//     within minutes of it on any real pass, so a second tick a hair away
//     just doubles up — the crossing carries the marker, and closest
//     approach stays a scene-only marker on the trajectory arc
//     (arrival-leg.js's white dot).
//   - With no encounter at all, the seam collapses to a single point at the
//     coast's own end (core/arrival-seam.js's fallback). A
//     zero-length span is the empty state here, not an error —
//     mission-view.js falls back to the raw date bar for the clock while that
//     holds.
//
// Pure: no DOM, Node-testable. marks are the arrival phase's own flight
// events, filtered to those actually inside the window (an event outside it
// is simply not on this track — same rule departureSliderState uses).
export function arrivalSliderState(opts) {
	var start = opts.start, end = opts.end, jd = opts.jd, zero = opts.zero;
	var ticks = opts.ticks || 5;
	var stamp = opts.stamp;
	if (!(isFinite(start) && isFinite(end) && end > start)) { return { empty: true }; }
	var span = end - start;

	var segments = buildTickSegments(start, end, ticks, stamp);

	var marks = [];
	(opts.marks || [])
		.filter(function (m) { return m && isFinite(m.jd); })
		.map(function (m) { return { frac: (m.jd - start) / span, title: m.label, jd: m.jd }; })
		.filter(function (m) { return m.frac > 0.001 && m.frac < 0.999; })
		.forEach(function (m) { marks.push(m); });

	var pinnedAt = jd < start ? "start" : (jd > end ? "end" : null);
	var playheadFrac = pinnedAt === "start" ? 0
		: pinnedAt === "end" ? 1
		: (jd - start) / span;
	// Relative to the zero, not to the window's start — see approachStamp.
	// The readout always shows the TRUE clock offset even while the handle is
	// pinned at an edge, matching the other two sliders. With no usable zero
	// (shouldn't happen for a non-empty window, but the caller owns that
	// invariant, not this function), fall back to elapsed time since the
	// window opened.
	var stampVal = isFinite(zero) ? approachStamp(jd, zero) : elapsedStamp(jd, start);
	return { empty: false, segments: segments, marks: marks,
	         playheadFrac: playheadFrac, pinnedAt: pinnedAt,
	         playheadDays: stampVal.days, playheadTime: stampVal.time };
}

// opts: { onSetJd(jd), stamp(jd), ticks?, emptyMsg }. Returns { update({
// start, end, jd, zero, marks }), dispose() }, plus an `empty` flag on the
// widget so the caller can decide what provides the clock while there is no
// window (mission-view's syncSliderVisibility). update() is cheap to call on
// every recompute/clock change.
export function createArrivalSlider(container, opts) {
	var onSetJd = opts.onSetJd;
	var stamp = opts.stamp;
	var ticks = opts.ticks;
	var emptyMsg = opts.emptyMsg ||
		"No arrival window yet — the coast has to reach the destination before one exists.";
	var span = null;   // { start, end } — null while empty

	var slider = createSegmentedSlider(container, {
		onScrub: function (fraction) {
			if (span) { onSetJd(span.start + fraction * (span.end - span.start)); }
		}
	});

	var api = {
		empty: true,
		update: function (state) {
			var s = arrivalSliderState({ start: state.start, end: state.end, jd: state.jd,
				zero: state.zero, ticks: ticks, stamp: stamp, marks: state.marks });
			api.empty = !!s.empty;
			if (s.empty) {
				span = null;
				slider.setMarks([]);
				slider.setEmpty(emptyMsg);
				return;
			}
			span = { start: state.start, end: state.end };
			slider.setSegments(s.segments);
			slider.setMarks(s.marks);
			slider.setPlayhead(s.playheadFrac, !!s.pinnedAt, s.playheadDays, s.playheadTime);
		},
		dispose: slider.dispose
	};
	return api;
}
