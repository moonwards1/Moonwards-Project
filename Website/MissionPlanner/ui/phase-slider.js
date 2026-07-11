/* MissionPlanner/ui/phase-slider.js — the segmented-timeline widget behind
 * the phase bar's sliders (task B2: the Coast slider; B3 extends the same
 * primitive for the event-scaled Departure/Arrival sliders — see the
 * createSegmentedSlider() doc comment below).
 *
 * Two layers:
 *
 *   - createSegmentedSlider(container, opts) — the DOM primitive. A
 *     captioned track of flex-sized segments plus a playhead, matching
 *     mock-a-phases.html's .timeline/.track/.seg/.playhead markup (mirrored
 *     here with the mp- prefix the rest of the shell uses). It knows
 *     nothing about dates or jd: callers hand it segments (fractions along
 *     a 0..1 track) and a playhead fraction, and get a 0..1 fraction back
 *     whenever the user clicks or drags the track. B3's event-scaled
 *     sliders are siblings of createCoastSlider() below, built on this same
 *     primitive with a different fraction<->jd mapping (nonlinear, sized by
 *     event gaps instead of even ticks).
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
// opts.onScrub(fraction) — called with a 0..1 track fraction on click/drag.
// Returns { root, setCaption(left,right), setSegments(segs), setEmpty(msg),
//   setPlayhead(fraction, pinned), dispose() }.
export function createSegmentedSlider(container, opts) {
	var onScrub = opts.onScrub;

	var root = document.createElement("div");
	root.className = "mp-timeline";

	var cap = document.createElement("div");
	cap.className = "mp-tl-cap";
	var capLeft = document.createElement("span");
	var capRight = document.createElement("span");
	cap.appendChild(capLeft);
	cap.appendChild(capRight);
	root.appendChild(cap);

	var track = document.createElement("div");
	track.className = "mp-track";
	root.appendChild(track);

	var playhead = document.createElement("div");
	playhead.className = "mp-playhead";
	track.appendChild(playhead);

	container.appendChild(root);

	function fractionAt(clientX) {
		var r = track.getBoundingClientRect();
		return r.width > 0 ? clamp01((clientX - r.left) / r.width) : 0;
	}

	var dragging = false;
	function onDown(e) {
		dragging = true;
		onScrub(fractionAt(e.clientX));
		e.preventDefault();
	}
	function onMove(e) {
		if (dragging) { onScrub(fractionAt(e.clientX)); }
	}
	function onUp() { dragging = false; }
	track.addEventListener("mousedown", onDown);
	window.addEventListener("mousemove", onMove);
	window.addEventListener("mouseup", onUp);

	function clearSegments() {
		Array.prototype.slice.call(track.children).forEach(function (el) {
			if (el !== playhead) { track.removeChild(el); }
		});
	}

	return {
		root: root,
		setCaption: function (left, right) {
			capLeft.textContent = left || "";
			capRight.textContent = right || "";
		},
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
		setPlayhead: function (fraction, pinned) {
			playhead.style.left = (clamp01(fraction) * 100) + "%";
			playhead.classList.toggle("mp-pinned", !!pinned);
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
// clock's jd, a tick count and a shortDate(jd) formatter, compute what the
// widget should show. No DOM — Node-testable.
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
	return { empty: false, segments: segments, playheadFrac: playheadFrac, pinnedAt: pinnedAt };
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
		var s = coastSliderState({ start: state.start, end: state.end, jd: state.jd, ticks: ticks, shortDate: shortDate });
		if (s.empty) {
			span = null;
			slider.setCaption("COAST — date-scaled, departure → arrival", "");
			slider.setEmpty("No computed span yet — departure and the leg both need to resolve.");
			return;
		}
		span = { start: state.start, end: state.end };
		slider.setCaption("COAST — date-scaled, departure → arrival",
			s.pinnedAt === "start" ? "clock is before this phase — playhead pinned at start"
			: s.pinnedAt === "end" ? "clock is past this phase — playhead pinned at end"
			: "playhead = the one shared clock");
		slider.setSegments(s.segments);
		slider.setPlayhead(s.playheadFrac, !!s.pinnedAt);
	}

	return { update: update, dispose: slider.dispose };
}

// ---- B3: the event-scaled Departure/Arrival slider -------------------------
// Same DOM primitive as Coast, but the track is scaled by EVENTS, not linear
// time: the flight's events become breakpoints, and each gap between two
// consecutive events gets an equal share of the track regardless of its real
// duration ("event-scaled, not linear time"). Within a gap, track position
// maps linearly to jd — so the whole fraction<->jd map is piecewise-linear
// and strictly monotonic.
//
// Why cross-boundary dragging stays sane (the task's stated worry): the
// wrapper never stores "which gap am I dragging in". Every scrub converts the
// pointer fraction straight to a jd (eventSliderJd), sets the shared clock,
// and the playhead is re-derived from that jd on the next update. A drag is
// just a rapid series of independent, stateless conversions, so crossing a
// breakpoint is nothing special — no stale drag state to misbehave.
//
// Flight-only: callers pass just the ship's-flight events (release..catch).
// Things before launch (still on the tether) or after the catch (on the
// elevator / ground) are a different regime and don't belong on a flight
// scrubber — the caller filters them out, not this widget.

// Pure: given the flight events (each {jd, label}) and the clock jd, compute
// the segments (gaps), the playhead fraction, and the pinned flag. Needs >= 2
// events to have a gap to scale; fewer -> empty. stamp(jd) formats a segment's
// milestone time. No DOM — Node-testable.
export function eventSliderState(opts) {
	var events = (opts.events || [])
		.filter(function (e) { return e && isFinite(e.jd); })
		.slice()
		.sort(function (a, b) { return a.jd - b.jd; });
	var jd = opts.jd, stamp = opts.stamp;
	var n = events.length - 1;                  // gap count == segment count
	if (n < 1) { return { empty: true }; }

	var segments = [];
	for (var i = 0; i < n; i++) {
		segments.push({
			frac0: i / n, frac1: (i + 1) / n,
			// label the gap by the milestone it REACHES (its right event), so
			// the playhead arrives at each named event exactly on a boundary.
			label: events[i + 1].short || events[i + 1].label,
			sub: stamp ? stamp(events[i + 1].jd) : ""
		});
	}

	var first = events[0].jd, last = events[n].jd;
	var pinnedAt = jd < first ? "start" : (jd > last ? "end" : null);
	var playheadFrac = pinnedAt === "start" ? 0
		: pinnedAt === "end" ? 1
		: fractionOfJd(events, jd);
	return { empty: false, segments: segments, playheadFrac: playheadFrac,
	         pinnedAt: pinnedAt, first: first, last: last };
}

// jd -> track fraction, piecewise-linear across the equal-width gaps. Assumes
// events sorted and jd within [first, last] (callers pin outside that).
function fractionOfJd(events, jd) {
	var n = events.length - 1;
	var g = 0;
	while (g < n - 1 && jd >= events[g + 1].jd) { g++; }
	var lo = events[g].jd, hi = events[g + 1].jd;
	var within = hi > lo ? (jd - lo) / (hi - lo) : 0;   // zero-width gap -> its left edge
	return (g + clamp01(within)) / n;
}

// track fraction -> jd, the inverse of fractionOfJd (what a scrub produces).
// Exported so the mapping is Node-tested in both directions.
export function eventSliderJd(events, fraction) {
	events = (events || [])
		.filter(function (e) { return e && isFinite(e.jd); })
		.slice()
		.sort(function (a, b) { return a.jd - b.jd; });
	var n = events.length - 1;
	if (n < 1) { return NaN; }
	var x = clamp01(fraction) * n;              // 0..n
	var g = Math.min(Math.floor(x), n - 1);     // gap index (n at frac==1 -> last gap)
	var within = x - g;
	var lo = events[g].jd, hi = events[g + 1].jd;
	return lo + within * (hi - lo);
}

// opts: { onSetJd(jd), stamp(jd), caption, emptyMsg }. Returns { update(events,
// jd), dispose() }. update() is cheap to call every recompute/clock change.
export function createEventSlider(container, opts) {
	var onSetJd = opts.onSetJd;
	var stamp = opts.stamp;
	var caption = opts.caption || "event-scaled (not linear time)";
	var emptyMsg = opts.emptyMsg ||
		"No flight span yet — the ship's flight needs at least two events to scale.";
	var flightEvents = null;   // last non-empty event set, for scrub -> jd

	var slider = createSegmentedSlider(container, {
		onScrub: function (fraction) {
			if (flightEvents) { onSetJd(eventSliderJd(flightEvents, fraction)); }
		}
	});

	function update(events, jd) {
		var s = eventSliderState({ events: events, jd: jd, stamp: stamp });
		if (s.empty) {
			flightEvents = null;
			slider.setCaption(caption, "");
			slider.setEmpty(emptyMsg);
			return;
		}
		flightEvents = events;
		slider.setCaption(caption,
			s.pinnedAt === "start" ? "clock is before this phase — playhead pinned at start"
			: s.pinnedAt === "end" ? "clock is past this phase — playhead pinned at end"
			: "playhead = the one shared clock");
		slider.setSegments(s.segments);
		slider.setPlayhead(s.playheadFrac, !!s.pinnedAt);
	}

	return { update: update, dispose: slider.dispose };
}
