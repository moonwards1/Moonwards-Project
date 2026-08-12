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
 */

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function pad2(n) { return String(n).padStart(2, "0"); }

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
// is signed time relative to closest approach ("-2 d 06:00" approaching,
// "+0 d 14:32" past it). Closest approach is also the point both edges are
// derived from (core/arrival-seam.js), so it is the one stable thing on the
// track to measure against. Same two-line days/HH:MM shape as elapsedStamp,
// same carry handling. No DOM, Node-testable.
export function approachStamp(jd, ca) {
	var delta = jd - ca;
	var mag = Math.abs(delta);
	var days = Math.floor(mag);
	var totalMin = Math.round((mag - days) * 1440);
	if (totalMin >= 1440) { totalMin -= 1440; days += 1; }
	// exactly at closest approach reads "+0 d 00:00", not "-0 d"
	var sign = (delta < 0 && (days > 0 || totalMin > 0)) ? "-" : "+";
	return { days: sign + days + " d", time: pad2(Math.floor(totalMin / 60)) + ":" + pad2(totalMin % 60) };
}

// ---- the DOM primitive -----------------------------------------------------
// opts.onScrub(fraction) — called with a 0..1 track fraction on click/drag/
//   wheel (plain click/drag jumps and tracks 1:1; Shift-drag or the mouse
//   wheel fine-tune at 10x-slower sensitivity — see onDown/onMove/onWheel).
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

	// A plain click/drag jumps to the cursor and tracks it 1:1. Holding Shift
	// instead fine-tunes RELATIVELY from wherever the playhead already is, at
	// 10x-slower sensitivity, without jumping — matching Shared/sim/date-bar.js's
	// Shift-drag. Rolling the mouse wheel over the track reaches that same
	// 10x-slower scrub without dragging: each wheel notch moves the playhead as
	// if the mouse had dragged that many pixels, at the same 0.1 sensitivity.
	var currentFraction = 0;
	var dragging = false, lastX = 0;
	function onDown(e) {
		dragging = true;
		lastX = e.clientX;
		if (!e.shiftKey) {
			currentFraction = fractionAt(e.clientX);
			onScrub(currentFraction);
		}
		e.preventDefault();
	}
	function onMove(e) {
		if (!dragging) { return; }
		if (e.shiftKey) {
			var width = track.getBoundingClientRect().width || 1;
			var dx = e.clientX - lastX;
			currentFraction = clamp01(currentFraction + (dx / width) * 0.1);
		} else {
			currentFraction = fractionAt(e.clientX);
		}
		lastX = e.clientX;
		onScrub(currentFraction);
	}
	function onUp() { dragging = false; }
	function onWheel(e) {
		e.preventDefault();
		var width = track.getBoundingClientRect().width || 1;
		currentFraction = clamp01(currentFraction - (e.deltaY / width) * 0.1);
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
		// segs: [{ frac0, frac1, label, sub, tickOnly }]
		setSegments: function (segs) {
			clearSegments();
			segs.forEach(function (s) {
				var el = document.createElement("div");
				el.className = "mp-seg" + (s.tickOnly ? " mp-seg-tick" : "");
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
// Pure: given the coast span (start/end jd, from the frozen plan's committed
// dates ending at the arrival seam — see mission-view.js's coastSpan()), the
// shared clock's jd, a tick count and a shortDate(jd) formatter for the tick
// captions, compute what the widget should show. No DOM — Node-testable.
export function coastSliderState(opts) {
	var start = opts.start, end = opts.end, jd = opts.jd;
	var ticks = opts.ticks || 5;
	var shortDate = opts.shortDate;

	if (!(isFinite(start) && isFinite(end) && end > start)) {
		return { empty: true };
	}
	var segments = [];
	for (var i = 0; i < ticks; i++) {
		var f0 = i / ticks;
		segments.push({
			frac0: f0, frac1: (i + 1) / ticks, tickOnly: true,
			label: shortDate(start + f0 * (end - start))
		});
	}
	var pinnedAt = jd < start ? "start" : (jd > end ? "end" : null);
	var playheadFrac = pinnedAt === "start" ? 0 : (pinnedAt === "end" ? 1 : (jd - start) / (end - start));
	// The readout always shows the true clock time, even when the handle itself
	// is pinned at an edge because the clock has wandered outside the span —
	// that's the point of showing it. `start` IS the departure/release epoch
	// here (the frozen plan's departure date, or the events' envelope minimum
	// without a plan), so elapsedStamp needs no separate epoch.
	var stamp = elapsedStamp(jd, start);
	return { empty: false, segments: segments, playheadFrac: playheadFrac, pinnedAt: pinnedAt,
	         playheadDays: stamp.days, playheadTime: stamp.time };
}

// opts: { onSetJd(jd), shortDate(jd), ticks? }. Returns { update({start,end,
// jd}), dispose() }. update() is cheap to call on every recompute/clock
// change — it just rebuilds a handful of DOM nodes and repositions the
// playhead.
export function createCoastSlider(container, opts) {
	var onSetJd = opts.onSetJd;
	var shortDate = opts.shortDate;
	var ticks = opts.ticks;
	var span = null;   // { start, end } — null while empty

	var slider = createSegmentedSlider(container, {
		onScrub: function (fraction) {
			if (span) { onSetJd(span.start + fraction * (span.end - span.start)); }
		}
	});

	function update(state) {
		var s = coastSliderState({ start: state.start, end: state.end, jd: state.jd, ticks: ticks,
			shortDate: shortDate });
		if (s.empty) {
			span = null;
			slider.setEmpty("No computed span yet — departure and the leg both need to resolve.");
			return;
		}
		span = { start: state.start, end: state.end };
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
// Which edge is the fixed one depends on mission-view.js's departureSpan,
// which picks between two procedures by whether the origin's departure rides
// a satellite carrier (Earth/Moon today): PINNED-START — the LEFT edge is the
// frozen plan's read-only release anchor (`releaseAnchorJd`, baked by
// core/freeze.js from core/departure-estimate.js's estimateDeparture(), read
// back via frozen-plan.js's releaseAnchorFor()) — or ANCHORED-END — the RIGHT
// edge is the plan's committed hand-off epoch. Either way the OTHER edge
// floats: the live flight's own event once a departure tech resolves one, else
// departureSpan's own default estimate (SOI_radius / required v∞). Both the
// committed hand-off and the predicted SOI exit are handed over as marks
// regardless of which one also frames an edge — see departureSpan's own
// header for the full rule.
//
// Either way the caller hands over two edge jds plus event marks; the widget is
// a plain linear scrubber over them, identical in feel to the Coast slider —
// except the caller also hands over the release event's own jd, which under
// ANCHORED-END/FLOATING-START can land short of the track's geometric left
// edge (nothing happened before release). createDepartureSlider floors
// scrubbing at that jd rather than the track's edge, and it — not the edge —
// is the "0 d" zero point for the playhead readout.
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

	var segments = [];
	for (var i = 0; i < ticks; i++) {
		var f0 = i / ticks;
		segments.push({
			frac0: f0, frac1: (i + 1) / ticks, tickOnly: true,
			label: stamp(start + f0 * span)
		});
	}

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
	// left edge — the two coincide under PINNED-START but can differ under
	// ANCHORED-END/FLOATING-START (see mission-view.js's departureSpan), where
	// the track can run a little short of release. "0 d" always means "at
	// release", wherever its mark sits on the track.
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
		// Scrubbing can't reach a time before release even when the track's
		// geometric left edge sits earlier than that (ANCHORED-END/FLOATING-START
		// — see mission-view.js's departureSpan): nothing happened before release,
		// so there's nothing to scrub to there.
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
//   - Closest approach is marked on the track (mp-mark-ca), because it is the
//     thing the window exists to bracket, and it is not either edge.
//   - The playhead readout is signed time relative to that mark
//     (approachStamp) rather than "T+" since the phase started.
//   - With no encounter at all, the seam collapses to a single point at the
//     plan's committed arrival epoch (core/arrival-seam.js's fallback). A
//     zero-length span is the empty state here, not an error —
//     mission-view.js falls back to the raw date bar for the clock while that
//     holds.
//
// Pure: no DOM, Node-testable. marks are the arrival phase's own flight
// events, filtered to those actually inside the window (an event outside it
// is simply not on this track — same rule departureSliderState uses).
export function arrivalSliderState(opts) {
	var start = opts.start, end = opts.end, jd = opts.jd, ca = opts.ca;
	var ticks = opts.ticks || 5;
	var stamp = opts.stamp;
	if (!(isFinite(start) && isFinite(end) && end > start)) { return { empty: true }; }
	var span = end - start;

	var segments = [];
	for (var i = 0; i < ticks; i++) {
		var f0 = i / ticks;
		segments.push({
			frac0: f0, frac1: (i + 1) / ticks, tickOnly: true,
			label: stamp(start + f0 * span)
		});
	}

	var marks = [];
	if (isFinite(ca)) {
		var caFrac = (ca - start) / span;
		if (caFrac > 0.001 && caFrac < 0.999) {
			marks.push({ frac: caFrac, jd: ca, cls: "mp-mark-ca",
			             title: "Closest approach - " + stamp(ca) });
		}
	}
	(opts.marks || [])
		.filter(function (m) { return m && isFinite(m.jd); })
		.map(function (m) { return { frac: (m.jd - start) / span, title: m.label, jd: m.jd }; })
		.filter(function (m) { return m.frac > 0.001 && m.frac < 0.999; })
		.forEach(function (m) { marks.push(m); });

	var pinnedAt = jd < start ? "start" : (jd > end ? "end" : null);
	var playheadFrac = pinnedAt === "start" ? 0
		: pinnedAt === "end" ? 1
		: (jd - start) / span;
	// Relative to the encounter, not to the window's start — see approachStamp.
	// The readout always shows the TRUE clock offset even while the handle is
	// pinned at an edge, matching the other two sliders. With no usable
	// closest approach (shouldn't happen for a non-empty window, but the
	// caller owns that invariant, not this function), fall back to elapsed
	// time since the window opened.
	var stampVal = isFinite(ca) ? approachStamp(jd, ca) : elapsedStamp(jd, start);
	return { empty: false, segments: segments, marks: marks,
	         playheadFrac: playheadFrac, pinnedAt: pinnedAt,
	         playheadDays: stampVal.days, playheadTime: stampVal.time };
}

// opts: { onSetJd(jd), stamp(jd), ticks?, emptyMsg }. Returns { update({
// start, end, jd, ca, marks }), dispose() }, plus an `empty` flag on the
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
				ca: state.ca, ticks: ticks, stamp: stamp, marks: state.marks });
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
