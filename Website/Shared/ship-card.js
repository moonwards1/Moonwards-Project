// The ship cards of a workbench installation's Logistics tab: one input card
// per ship role the installation needs, and a Ship legs result card. ES module:
//   import { addShipCards } from "../Shared/ship-card.js";
//
// The cards edit the design's ship classes (Shared/ships.js createFleet), not
// the calculator's own settings: a class belongs to the whole design, so an
// edit here changes every installation using that class, and the cards of
// every mounted calculator follow. Each role has a standard class, tagged
// "standard" beside the title. A capsule or shuttle card can make a local
// version, tagged "local", for this installation alone, and remove it again
// to return to the standard. A freighter card makes other versions, titled
// by payload capacity and heat shield, up to MAX_VERSIONS designs in all, and
// switches among them: with two designs, a "Use <the other>" button beside
// "Make 3rd version"; with three, a "Use:" row naming each. A named version
// carries an × that removes it from the design. The fields carry `save: false`;
// the fleet is saved with the design.
//
//   var ships = addShipCards(shell, { fleet, instId, roles: ["shuttle"] });
//   ships.read("shuttle")   // { class, dv: { loaded, empty } } in the recalculation
//   ships.dispose()         // when the calculator is removed
//
// A change to the fleet runs the calculator's recalculation (shell.changed()), so results that read a ship
// stay current.

import { ShellColors as C } from "./calc-shell.js";
import { SHIP_ROLES, PROPELLANTS, propellant, shipDv, shieldMass, SHIELD_FRACTION, shipTitle, versionName, isLocalRole, MAX_VERSIONS } from "./ships.js";

function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
function kms(v) { return num(v / 1e3, 2); }

export function addShipCards(shell, opts) {
	var o = opts || {}, fleet = o.fleet, instId = o.instId, tab = o.tab || "log";
	var roles = (o.roles || []).filter(function (r) { return SHIP_ROLES[r]; });
	var cards = {};
	if (!fleet || !roles.length) return { read: function () { return null; }, dispose: function () {} };

	roles.forEach(function (role) { cards[role] = buildCard(role); });

	var legs = shell.addCard({ id: "ship-legs", tab: tab, side: "out", title: "Ship legs", short: "Legs", color: C.sky });
	var legLines = {};
	roles.forEach(function (role) {
		legLines[role] = shell.line(legs, { label: SHIP_ROLES[role].label + ": gap to close", unit: "km/s" });
	});
	shell.note(legs, "Each leg's Δv split, what the facility delivers and what the ship makes up, comes with the route models.");
	legs.setSummary("routes to come");

	function buildCard(role) {
		var def = SHIP_ROLES[role];
		var card = shell.addCard({ id: "ship-" + role, tab: tab, side: "in", title: def.label, short: def.label, color: C.sky, feeds: ["ship-legs"] });
		var f = {};
		var local = isLocalRole(role);
		var shared = shell.note(card, "");
		var choice = shell.buttonRow(card);
		f.prop = shell.selectField(card, { label: "Propellant", save: false,
			options: PROPELLANTS.map(function (p) { return { value: p.key, label: p.label }; }) });
		f.isp = shell.numberField(card, { label: "Specific impulse", hint: "vacuum", unit: "s", value: 0, min: 1, save: false });
		f.prop.closest(".cs-row").classList.add("cs-wide");
		var ispHint = f.isp.closest(".cs-row").querySelector(".cs-hint");
		// Mass fields show their class figure (tonnes) divided by `mass`: a
		// freighter's masses are in kilotonnes, every other ship's in tonnes.
		var mass = role === "freighter" ? 1000 : 1, mu = mass === 1000 ? "kt" : "t";
		var scale = { isp: 1, dry: mass, payload: mass, tank: mass };
		f.dry = shell.numberField(card, { label: "Dry mass", unit: mu, value: 0, min: 0.001 / mass, save: false });
		f.payload = shell.numberField(card, { label: "Payload", unit: mu, value: 0, min: 0, save: false });
		f.tank = shell.numberField(card, { label: "Propellant capacity", unit: mu, value: 0, min: 0, save: false });
		var pct = Math.round(SHIELD_FRACTION * 100) + "% loaded ship mass";
		var shieldNote = role === "capsule" ? shell.note(card, "") : null;
		if (!shieldNote) f.shield = shell.selectField(card, { label: "Heat shield", hint: " ", save: false,
			options: [{ value: "0", label: "None" }, { value: "1", label: pct }] });
		if (f.shield) f.shield.closest(".cs-row").classList.add("cs-wide");
		var shieldHint = f.shield ? f.shield.closest(".cs-row").querySelector(".cs-hint") : null;
		var hero = shell.hero(card, [{ label: "Δv, loaded", unit: "km/s" }, { label: "Δv, empty", unit: "km/s" }]);
		shell.note(card, "Δv = Isp · g₀ · ln(m₀ / m_f): m₀ with full tanks, m_f with them empty. Engines count in the dry mass; a heat shield adds to it.");

		function cur() { return fleet.classFor(instId, role); }
		function edit(patch) { fleet.update(cur().id, patch); }
		function makeCopy() { fleet.copy(cur().id, instId); }
		function useClass(c) { return function () { fleet.assign(instId, c.id); }; }
		// A design as a choice: standard, or a version with its × to remove it.
		function option(k, label, pressed) {
			var o = { label: label, pressed: pressed, onClick: useClass(k) };
			if (!fleet.isStandard(k)) {
				o.onRemove = function () { fleet.remove(k.id); };
				o.removeTip = "Remove the " + versionName(k) + " version from the design. Facilities using it go back to the standard " + def.label.toLowerCase() + ".";
			}
			return o;
		}
		// The buttons that copy the design or switch to another of its versions.
		function choices(c, std) {
			if (local) return choice.set("", [std ? { label: "Make a local version", onClick: makeCopy }
				: { label: "Remove local version", onClick: function () { fleet.revert(instId, role); } }]);
			var all = fleet.list(role);
			if (all.length === 1) return choice.set("", [{ label: "Make another version", onClick: makeCopy }]);
			if (all.length === 2 && all.length < MAX_VERSIONS) {
				var other = all[0] === c ? all[1] : all[0];
				return choice.set("", [
					option(other, "Use " + (fleet.isStandard(other) ? "standard" : versionName(other, true)), false),
					{ label: "Make 3rd version", onClick: makeCopy }]);
			}
			choice.set("Use:", all.map(function (k) { return option(k, fleet.isStandard(k) ? "Standard" : versionName(k, true), k === c); }));
		}
		f.prop.addEventListener("change", function () { edit({ propellant: f.prop.value, isp: propellant(f.prop.value).isp }); });
		["isp", "dry", "payload", "tank"].forEach(function (k) {
			f[k].addEventListener("input", function () {
				var v = parseFloat(f[k].value);
				if (isFinite(v)) { var p = {}; p[k] = v * scale[k]; edit(p); }
			});
		});
		if (f.shield) f.shield.addEventListener("change", function () { edit({ shield: f.shield.value === "1" }); });

		function put(el, value) { if (document.activeElement !== el) el.value = value; }
		function refresh() {
			var c = cur();
			put(f.prop, c.propellant); put(f.isp, c.isp);
			["dry", "payload", "tank"].forEach(function (k) { put(f[k], +(c[k] / mass).toPrecision(12)); });
			if (f.shield) put(f.shield, c.shield ? "1" : "0");
			var pr = propellant(c.propellant);
			if (ispHint) ispHint.textContent = pr.rough && c.isp === pr.isp ? "vacuum · rough figure" : "vacuum";
			var std = fleet.isStandard(c), title = shipTitle(c, std);
			var tag = std ? "standard" : local ? "local" : "";
			card.setTitle(title);
			card.setTag(tag);
			shared.textContent = std ? "Same design used across facilities. Edits change all standard " + def.label.toLowerCase() + "s."
				: local ? "Specialized for local service." : "";
			shared.style.display = shared.textContent ? "" : "none";
			choices(c, std);
			var hs = mass === 1000 ? +(shieldMass(c) / 1000).toPrecision(3) + " kt" : +shieldMass(c).toPrecision(3) + " t";
			if (shieldNote) shieldNote.textContent = "Always carries a heat shield: " + pct + ", " + hs + ".";
			if (shieldHint) shieldHint.textContent = c.shield ? hs : "";
			var dv = shipDv(c);
			hero[0].set(kms(dv.loaded)); hero[1].set(kms(dv.empty));
			card.setSummary((tag ? tag + " · " : "") + kms(dv.loaded) + " km/s");
			legLines[role].set("—", "Carries " + kms(dv.loaded) + " km/s loaded (" + (tag ? tag + " " + title.toLowerCase() : title) + ").");
		}
		return { refresh: refresh };
	}

	function refreshAll() { roles.forEach(function (r) { cards[r].refresh(); }); }
	refreshAll();
	var off = fleet.subscribe(function () { refreshAll(); shell.changed(); });

	return {
		read: function (role) {
			if (!cards[role]) return null;
			var c = fleet.classFor(instId, role);
			return { class: c, dv: shipDv(c) };
		},
		dispose: off
	};
}
