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
