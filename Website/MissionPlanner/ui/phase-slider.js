/* MissionPlanner/ui/phase-slider.js — the segmented-timeline widget behind
 * the phase bar's sliders (task B2: the Coast slider; B3 extends the same
 * primitive for the event-scaled Departure/Arrival sliders — see the
 * createSegmentedSlider() doc comment below).
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
 */

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

// ---- the DOM primitive -----------------------------------------------------
// opts.onScrub(fraction) — called with a 0..1 track fraction on click/drag/
//   wheel (plain click/drag jumps and tracks 1:1; Shift-drag or the mouse
//   wheel fine-tune at 10x-slower sensitivity — see onDown/onMove/onWheel).
// Returns { root, setSegments(segs), setEmpty(msg), setPlayhead(fraction,
//   pinned, label), dispose() }.
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
		// label: the formatted current time, shown in a floating readout just
		// below the handle (omit/empty to hide it — the empty-state path never
		// calls this, so there's nothing to clear).
		setPlayhead: function (fraction, pinned, label) {
			currentFraction = clamp01(fraction);
			playhead.style.left = (currentFraction * 100) + "%";
			playhead.classList.toggle("mp-pinned", !!pinned);
			playheadLabel.textContent = label || "";
			playheadLabel.style.display = label ? "" : "none";
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
// clock's jd, a tick count, a shortDate(jd) formatter for the tick captions
// and an optional finer stampPlayhead(jd) formatter for the floating
// readout below the handle (B4 redesign — defaults to shortDate when
// omitted), compute what the widget should show. No DOM — Node-testable.
export function coastSliderState(opts) {
	var start = opts.start, end = opts.end, jd = opts.jd;
	var ticks = opts.ticks || 5;
	var shortDate = opts.shortDate;
	var stampPlayhead = opts.stampPlayhead || shortDate;

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
	// the span — that's the point of showing it.
	var playheadLabel = stampPlayhead(jd);
	return { empty: false, segments: segments, playheadFrac: playheadFrac, pinnedAt: pinnedAt, playheadLabel: playheadLabel };
}

// opts: { onSetJd(jd), shortDate(jd), stampPlayhead(jd)?, ticks? }. Returns
// { update({start,end, jd}), dispose() }. update() is cheap to call on every
// recompute/clock change — it just rebuilds a handful of DOM nodes and
// repositions the playhead. stampPlayhead formats the floating readout below
// the handle (B4's redesign); defaults to shortDate (month+year) when
// omitted, but mission-view.js passes a finer stamp since the coast span can
// run years and shortDate alone can't show what day/time the handle is on.
export function createCoastSlider(container, opts) {
	var onSetJd = opts.onSetJd;
	var shortDate = opts.shortDate;
	var stampPlayhead = opts.stampPlayhead;
	var ticks = opts.ticks;
	var span = null;   // { start, end } — null while empty

	var slider = createSegmentedSlider(container, {
		onScrub: function (fraction) {
			if (span) { onSetJd(span.start + fraction * (span.end - span.start)); }
		}
	});

	function update(state) {
		var s = coastSliderState({ start: state.start, end: state.end, jd: state.jd, ticks: ticks,
			shortDate: shortDate, stampPlayhead: stampPlayhead });
		if (s.empty) {
			span = null;
			slider.setEmpty("No computed span yet — departure and the leg both need to resolve.");
			return;
		}
		span = { start: state.start, end: state.end };
		slider.setSegments(s.segments);
		slider.setPlayhead(s.playheadFrac, !!s.pinnedAt, s.playheadLabel);
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
	var stampPlayhead = opts.stampPlayhead || stamp;
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
	var playheadLabel = stampPlayhead(jd);
	return { empty: false, segments: segments, marks: marks,
	         playheadFrac: playheadFrac, pinnedAt: pinnedAt, playheadLabel: playheadLabel };
}

// opts: { onSetJd(jd), stamp(jd), stampPlayhead(jd)?, ticks?, emptyMsg }.
// Returns { update({ start, end, jd, marks, defaulted }), dispose() }.
// update() is cheap to call on every recompute/clock change. stampPlayhead
// formats the floating readout below the handle (B4's redesign); defaults
// to stamp when omitted.
export function createDepartureSlider(container, opts) {
	var onSetJd = opts.onSetJd;
	var stamp = opts.stamp;
	var stampPlayhead = opts.stampPlayhead;
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
			ticks: ticks, stamp: stamp, stampPlayhead: stampPlayhead, marks: state.marks });
		if (s.empty) {
			span = null;
			slider.setMarks([]);
			slider.setEmpty(emptyMsg);
			return;
		}
		span = { start: state.start, end: state.end };
		slider.setSegments(s.segments);
		slider.setMarks(s.marks);
		slider.setPlayhead(s.playheadFrac, !!s.pinnedAt, s.playheadLabel);
	}

	return { update: update, dispose: slider.dispose };
}
