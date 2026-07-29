/* MissionPlanner/ui/phase-slider.js — the segmented-timeline widget behind
 * the phase bar's sliders. ONE PER PHASE, three in all, exactly one on screen
 * at a time (mission-view's syncSliderVisibility): Departure, Coast, Arrival.
 * Each phase's slider IS that phase's clock control; the raw Ephemeris date
 * bar is only a fallback for when a phase has no resolvable span.
 *
 * Two layers:
 *
 *   - createSegmentedSlider(container, opts) — the DOM primitive. A track of
 *     flex-sized segments plus a playhead, matching mock-a-phases.html's
 *     .timeline/.track/.seg/.playhead markup (mirrored here with the mp-
 *     prefix the rest of the shell uses; the caption row above the track,
 *     also in that markup, was dropped 2026-07-12 — Kim reclaimed the space
 *     for the phase bar's now-bigger compliance readout). It knows nothing
 *     about dates or jd: callers hand it segments (fractions along a 0..1
 *     track) and a playhead fraction, and get a 0..1 fraction back whenever
 *     the user clicks or drags the track. B3's Departure slider
 *     (createDepartureSlider below) is a sibling of createCoastSlider, also
 *     linear in time but over a launch→on-course span the caller computes,
 *     with event marks overlaid (setMarks).
 *
 *   - coastSliderState(opts) + createCoastSlider(container, opts) — B2's
 *     actual deliverable. coastSliderState is the pure part (segments +
 *     playhead fraction + pinned flag, given a span/jd/tick count and a
 *     date formatter) — no DOM, Node-testable (see ui/tests/).
 *     createCoastSlider is the thin wrapper that feeds it to the DOM
 *     primitive and turns track clicks/drags into jd values.
 *     departureSliderState/createDepartureSlider (B3) and
 *     arrivalSliderState/createArrivalSlider (task 1.3) are its two siblings,
 *     same split, same shape — all three are linear in time over a span the
 *     caller computes, and differ only in which edges are anchored and how
 *     the playhead readout is stamped.
 */

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function pad2(n) { return String(n).padStart(2, "0"); }

// "T+" mission-elapsed-time readout for the playhead label (Kim, 2026-07-14
// — replaces the earlier absolute-date stamp with something briefer):
// days elapsed since `start` (Coast's own span start IS the departure/
// release epoch; Departure's own span start IS launch itself, so this needs
// no separate "departure epoch" plumbing beyond the start each slider
// already carries), split into a "167 d" line and a separate elapsed
// HH:MM line — ELAPSED time-within-the-current-day, not calendar
// wall-clock, so the two lines always agree ("167 d" + "14:32" means
// exactly that many days+hours+minutes since departure, regardless of what
// time of day departure itself started at). No DOM, Node-testable.
export function elapsedStamp(jd, start) {
	var elapsed = jd - start;
	var days = Math.floor(elapsed);
	var totalMin = Math.round((elapsed - days) * 1440);
	if (totalMin >= 1440) { totalMin -= 1440; days += 1; }
	return { days: days + " d", time: pad2(Math.floor(totalMin / 60)) + ":" + pad2(totalMin % 60) };
}

// The Arrival slider's playhead readout (task 1.3). "T+ since the phase
// started" is the wrong anchor for a window only 3-6 days wide whose BOTH
// edges move: what the user is judging is how far the clock sits from the
// encounter itself, so the readout is signed time relative to closest
// approach ("-2 d 06:00" approaching, "+0 d 14:32" past it). Closest
// approach is also the point both edges are derived from (core/arrival-seam.js),
// so it is the one stable thing on the track to measure against. Same
// two-line days/HH:MM shape as elapsedStamp, same carry handling. No DOM,
// Node-testable.
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

	// A plain click/drag jumps to the cursor and tracks it 1:1, same as
	// before. Holding Shift instead fine-tunes RELATIVELY from wherever the
	// playhead already is, at 10x-slower sensitivity, without jumping —
	// matching Shared/sim/date-bar.js's Shift-drag. Rolling the mouse wheel
	// over the track is a second way to reach that same 10x-slower scrub,
	// in place of dragging: each wheel notch moves the playhead as if the
	// mouse had dragged that many pixels, at the same 0.1 sensitivity.
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

// ---- B2: the Coast slider --------------------------------------------------
// Pure: given the coast span (start/end jd, from the departure and coast
// phases' own events — see mission-view.js's coastSpan()), the shared
// clock's jd, a tick count and a shortDate(jd) formatter for the tick
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
	// The readout always shows the true clock time, even when the handle
	// itself is pinned at an edge because the clock has wandered outside
	// the span — that's the point of showing it. start IS the departure/
	// release epoch here (coastSpan's own envelope minimum, or the frozen
	// plan's departure date once C1 governs it), so elapsedStamp needs no
	// separate epoch.
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

// ---- B3: the Departure slider ---------------------------------------------
// LINEAR in time (like Coast), spanning the ship's departure flight: from
// launch on the LEFT to the moment it must be on course for the coast phase
// (origin-SOI exit) on the RIGHT. The design intent (Kim, 2026-07-11):
//
//   - The RIGHT edge is the compliance deadline — the time the flight plan
//     needs the ship on course. It is the fixed anchor.
//   - The LEFT edge (launch) FLOATS: a well-timed single skyhook release is a
//     short departure; a release plus Earth- and Moon-flyby burns takes far
//     longer; an L1 elevator is different again. So the span grows or shrinks
//     with the departure tech stack, always anchored at the right.
//   - Default length, before a real trajectory exists — including the moment
//     a mission is first created, with no departure tech configured yet —
//     is SOI_radius / v∞: the time to cross the origin body's SOI at the
//     required departure v∞ out imported with the mission from the frozen
//     plan (computed by the caller — see mission-view's departureSpan and
//     departureDefaultSpanSeconds). Once an actual trajectory resolves, its
//     real duration replaces the estimate. The duration can come from
//     two-body coast today or CR3BP later — this widget only wants the two
//     edge times.
//
// That 2026-07-11 design predates WP-I's release-anchor model (task D7) and
// is now only the shape of the PRE-resolution default (no departure tech
// configured yet, or only the release event resolved) — see mission-view's
// departureSpan and departureDefaultSpanSeconds. Once a departure tech
// actually resolves a real flight, the LEFT edge is already pinned instead:
// moon-platform.js, departure-leg.js and body-departure-leg.js all read the
// frozen plan's read-only release anchor (`releaseAnchorJd`, set by
// core/freeze.js from core/departure-estimate.js's estimateDeparture(), read
// back via frozen-plan.js's releaseAnchorFor()) and stamp their Release
// event at exactly that epoch — for every origin, not only Earth. So the
// common case is pinned-start/floating-end already, universally; task 1.4's
// remaining gap is getting the pre-resolution default to match that (reuse
// releaseAnchorJd instead of re-deriving its own estimate) and getting the
// committed hand-off (frozen-plan's "Plan departure" event — currently only
// in mission-view's flat all-phases events bar, since frozen-plan's own
// stage phase is "coast", not "departure") to render as a mark here too.
//
// So the caller hands over the two edge jds (already computed however it
// likes) plus event marks; the widget is a plain linear scrubber over them,
// identical in feel to the Coast slider. Everything about which times mean
// what lives in mission-view; nothing event-scaled remains.

// Pure: even time ticks across [start, end] for the linear scale, plus the
// interior event marks placed at their true time fractions, plus the playhead
// (pinned when the clock is outside the span). No DOM — Node-testable.
export function departureSliderState(opts) {
	var start = opts.start, end = opts.end, jd = opts.jd;
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
	// start IS launch/departure itself here, so elapsedStamp needs no
	// separate epoch — "0 d" reads naturally as "same day as launch".
	var stampVal = elapsedStamp(jd, start);
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
	var span = null;   // { start, end } — null while empty

	var slider = createSegmentedSlider(container, {
		onScrub: function (fraction) {
			if (span) { onSetJd(span.start + fraction * (span.end - span.start)); }
		}
	});

	function update(state) {
		var s = departureSliderState({ start: state.start, end: state.end, jd: state.jd,
			ticks: ticks, stamp: stamp, marks: state.marks });
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
	}

	return { update: update, dispose: slider.dispose };
}

// ---- task 1.3: the Arrival slider ------------------------------------------
// The third and last of the per-phase scrubbers, and the only one whose span
// is derived end to end rather than anchored: it IS the seam window from
// core/arrival-seam.js —
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
//     plan's committed arrival epoch (1.1's fallback). A zero-length span is
//     the empty state here, not an error — mission-view falls back to the raw
//     date bar for the clock while that holds.
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
