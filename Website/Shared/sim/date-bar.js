/* Shared/sim/date-bar.js
 *
 * The ephemeris date control shared by every plotter: a coarse slider (the
 * tool's full date span) plus a fine slider (a small offset around the
 * coarse position, for scrubbing smoothly through whatever period matters at
 * that tool's scale — six months for the Solar System plotter, a lunar month
 * for Moon-Skyhook, one Phobos orbit for Mars-Phobos), a typed date field,
 * and a JD readout.
 *
 * Extracted from three near-duplicate copies (see Website/ARCHITECTURE.md,
 * "Step 1: scene kit", and the project decision recorded 2026-07-07): the
 * Solar-System-Trajectory-Plotter implementation is the canonical one —
 * self-contained, with click-to-jump and Shift-drag-to-fine-tune on both
 * sliders, and a fine-slider "wrap" that advances the coarse base when
 * dragged past its end so the displayed date stays continuous. Moon-Skyhook
 * and Mars-Phobos previously had plainer sliders (native `input` only, no
 * drag/wrap) — porting them to this module is a genuine behavioural upgrade,
 * not just a lift.
 *
 * Ownership: this module reads and writes `state.jd` / `state.baseDays` on
 * the HOST's own state object (passed in, not owned here) — those fields are
 * read from dozens of places across each plotter (body placement, trajectory
 * computation, …), so the date bar cannot keep a private copy the way
 * camera-controller.js's `cam` can; it has to mutate the same object
 * everything else already reads.
 *
 * Deliberately out of scope (stays in each plotter, per the same decision):
 * any module-specific slider — a skyhook release point, a hook-phase dial —
 * mounts as its own widget in that module's panel card, underneath the date
 * bar, only while that module is active. This file owns the JD control and
 * nothing else.
 */

import { OrbitalMath } from "../math-utils.js";

// state: the host's shared state object; state.jd and state.baseDays are
//   read/written in place so every other part of the plotter that already
//   reads them stays in sync.
// opts:
//   coarseSlider, fineSlider   — required <input type="range"> elements.
//   fineLoLabel, fineHiLabel   — required elements showing the fine span's
//                                 current end dates (e.g. "Jan 2030").
//   dateField                  — required <input type="date">.
//   jdLabel                    — required element for the "JD ######.#" readout.
//   jd0                        — required: Julian Date at coarse slider position 0.
//   spanDays                   — required: the coarse slider's day span (its
//                                 `max` attribute, as a number — position 0
//                                 is jd0, position spanDays is jd0+spanDays).
//   shortDate(jd)               — required: formats a JD for the fine-span end
//                                 labels; formats differ enough by tool's scale
//                                 (month-level vs. day-level) that this stays
//                                 caller-supplied rather than baked in.
//   jdDecimals                  — optional, default 1: toFixed digits for jdLabel.
//   resolveBaseDays(target)      — optional: -> days. Adjusts the coarse
//                                 slider's clamped target before it's
//                                 committed (e.g. a "lock this phase" toggle
//                                 that nudges the date to the nearest match).
//   resolveFineReset(baseDays)   — optional: -> fine slider value. Replaces
//                                 the default "reset fine to 0" when the
//                                 coarse slider moves (e.g. a lock resolved
//                                 via the fine offset instead of the coarse
//                                 target). Defaults to 0 when omitted.
//
// Returns { setBaseDays(days), applyDate(), bind(onChange) }. `bind` wires
// the DOM listeners and must be called once; `onChange` fires after every
// user-driven date change (coarse/fine drag or keyboard, typed date field) —
// pass the plotter's own recompute function (its `refreshDate()`/`refresh()`).
// `setBaseDays` is also exported for the plotter's own initial-setup call
// (`setBaseDays(0)` before the first render) and a typed-date-field jump.
export function createDateBar(state, opts) {
	var coarseSlider = opts.coarseSlider, fineSlider = opts.fineSlider;
	var fineLoLabel = opts.fineLoLabel, fineHiLabel = opts.fineHiLabel;
	var dateField = opts.dateField, jdLabel = opts.jdLabel;
	var jd0 = opts.jd0, spanDays = opts.spanDays;
	var shortDate = opts.shortDate;
	var jdDecimals = opts.jdDecimals == null ? 1 : opts.jdDecimals;
	var fineHalf = parseFloat(fineSlider.max);   // fine slider is always a symmetric +/- range

	// Sync the date field, JD readout and fine-span end labels to the current
	// state.jd / state.baseDays.
	function syncLabels() {
		var d = OrbitalMath.dateFromJulian(state.jd);
		dateField.value = d.Y + "-" + String(d.Mo).padStart(2, "0") + "-" + String(d.D).padStart(2, "0");
		jdLabel.textContent = "JD " + state.jd.toFixed(jdDecimals);
		fineLoLabel.textContent = shortDate(jd0 + Math.max(0, state.baseDays - fineHalf));
		fineHiLabel.textContent = shortDate(jd0 + Math.min(spanDays, state.baseDays + fineHalf));
	}

	// Recompute state.jd from the coarse base + fine offset, and sync the labels.
	// This is the slider-driven path: the fine slider's value is stepped, so the
	// jd it yields is quantised to that step (fine for scrubbing at the tool's
	// scale). setJd() below is the precise path for programmatic jumps.
	function applyDate() {
		var eff = Math.max(0, Math.min(spanDays, state.baseDays + parseFloat(fineSlider.value)));
		state.jd = jd0 + eff;
		syncLabels();
	}

	// Move the coarse base to a day-from-epoch and recenter (or lock-resolve)
	// the fine slider on it.
	function setBaseDays(days) {
		var target = Math.max(0, Math.min(spanDays, Math.round(days)));
		if (opts.resolveBaseDays) { target = opts.resolveBaseDays(target); }
		state.baseDays = target;
		coarseSlider.value = state.baseDays;
		fineSlider.value = opts.resolveFineReset ? opts.resolveFineReset(state.baseDays) : 0;
		applyDate();
	}

	// Position the clock at an EXACT jd, keeping the full precision the sliders
	// can't hold (the coarse slider is whole-day; the fine slider is stepped).
	// state.jd is set exactly; the coarse base takes the whole-day part and the
	// fine slider is moved to the fractional day only as a VISUAL thumb position
	// (its step-snap doesn't feed back into state.jd here). Use this for
	// programmatic jumps that must land on a precise time — a mission event at
	// 06:00, a phase-slider scrub within a days-long span — rather than
	// setBaseDays (whole-day) or the stepped slider path.
	function setJd(jd) {
		var eff = Math.max(0, Math.min(spanDays, jd - jd0));
		state.baseDays = Math.min(spanDays, Math.floor(eff));
		coarseSlider.value = state.baseDays;
		fineSlider.value = Math.max(-fineHalf, Math.min(fineHalf, eff - state.baseDays));
		state.jd = jd0 + eff;   // exact — independent of the fine slider's step
		syncLabels();
	}

	// Marker-style fine dragging for a date slider. A plain press jumps the
	// date to the clicked position (native feel), then dragging fine-tunes
	// RELATIVELY; holding Shift makes the drag 10x slower. A Shift-press
	// fine-tunes from the current date without jumping. Rolling the mouse
	// wheel over the slider is a second way to reach the same 10x-slower
	// scrub, without needing to hold Shift or drag at all — each wheel
	// notch is treated as if the mouse had moved that many pixels, at the
	// same 0.1 sensitivity. (The native `input` listener still handles
	// keyboard arrows.)
	function enableShiftDrag(slider, apply, onOverflow) {
		var drag = false, lastX = 0, perPx = 1;
		var lo = parseFloat(slider.min), hi = parseFloat(slider.max);
		function setVal(v) {
			// past an end, an overflow handler (the fine slider's wrap) may
			// advance the period and return a residual value back inside the track
			if (onOverflow && (v > hi || v < lo)) { v = onOverflow(v); }
			slider.value = Math.max(lo, Math.min(hi, v)); apply();
		}
		slider.addEventListener("pointerdown", function (e) {
			e.preventDefault();                       // take over from the native thumb
			drag = true; lastX = e.clientX;
			perPx = (hi - lo) / (slider.clientWidth || 1);   // native units per pixel
			if (!e.shiftKey) {                        // plain press: jump to the click
				var rect = slider.getBoundingClientRect();
				var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
				setVal(lo + frac * (hi - lo));
			}
			try { slider.setPointerCapture(e.pointerId); } catch (_) {}
			slider.focus();
		});
		slider.addEventListener("pointermove", function (e) {
			if (!drag) { return; }
			var dx = e.clientX - lastX; lastX = e.clientX;
			setVal(parseFloat(slider.value) + dx * perPx * (e.shiftKey ? 0.1 : 1));
		});
		function end(e) {
			if (!drag) { return; }
			drag = false;
			try { slider.releasePointerCapture(e.pointerId); } catch (_) {}
		}
		slider.addEventListener("pointerup", end);
		slider.addEventListener("pointercancel", end);
		slider.addEventListener("wheel", function (e) {
			e.preventDefault();
			var wheelPerPx = (hi - lo) / (slider.clientWidth || 1);
			setVal(parseFloat(slider.value) - e.deltaY * wheelPerPx * 0.1);
		}, { passive: false });
	}

	// Fine-slider wrap: when dragged past an end, advance the coarse base by
	// half the fine span so the point that was at the end becomes the new
	// centre, and carry the overshoot as the new (near-centred) fine value.
	// The absolute date stays continuous (base+fine is unchanged by a wrap);
	// the dot snaps back near the middle. Stops wrapping at the tool's date
	// limits (then just clamps). Deliberately does not consult
	// `resolveBaseDays` — that hook is for the coarse slider's larger jumps;
	// a fine-slider wrap is a small, local continuation of the current
	// scrub, not a new target to re-resolve a lock against.
	function wrapFine(v) {
		while (v > fineHalf && state.baseDays + fineHalf <= spanDays) {
			state.baseDays += fineHalf; v -= fineHalf;
		}
		while (v < -fineHalf && state.baseDays - fineHalf >= 0) {
			state.baseDays -= fineHalf; v += fineHalf;
		}
		coarseSlider.value = Math.round(state.baseDays);
		return v;
	}

	function bind(onChange) {
		coarseSlider.addEventListener("input", function () {
			setBaseDays(parseInt(coarseSlider.value, 10));
			onChange();
		});
		fineSlider.addEventListener("input", function () {
			applyDate();
			onChange();
		});
		enableShiftDrag(coarseSlider, function () {
			setBaseDays(parseInt(coarseSlider.value, 10));
			onChange();
		});
		enableShiftDrag(fineSlider, function () { applyDate(); onChange(); }, wrapFine);

		dateField.addEventListener("change", function () {
			var parts = dateField.value.split("-");
			if (parts.length === 3) {
				var jd = OrbitalMath.julianDate(+parts[0], +parts[1], +parts[2], 0, 0, 0);
				setBaseDays(jd - jd0);
				onChange();
			}
		});
	}

	return { setBaseDays: setBaseDays, setJd: setJd, applyDate: applyDate, bind: bind };
}
