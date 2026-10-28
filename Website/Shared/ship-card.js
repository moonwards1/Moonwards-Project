// The ship cards of a workbench installation's Logistics tab: one input card
// per ship role the installation needs, and a Ship legs result card. ES module:
//   import { addShipCards } from "../Shared/ship-card.js";
//
// The cards edit the design's ship classes (Shared/ships.js createFleet), not
// the calculator's own settings: a class belongs to the whole design, so an
// edit here changes every installation using that class, and the cards of
// every mounted calculator follow. "Make a separate copy" gives this
// installation its own class for the role. The fields carry `save: false`;
// the fleet is saved with the design.
//
//   var ships = addShipCards(shell, { fleet, instId, roles: ["shuttle"], nameOf });
//   ships.read("shuttle")   // { class, dv: { loaded, empty } } in the recalculation
//   ships.dispose()         // when the calculator is removed
//
// nameOf(instId) gives an installation's display name, for the line saying
// which other installations share the class. A change to the fleet runs the
// calculator's recalculation (shell.changed()), so results that read a ship
// stay current.

import { ShellColors as C } from "./calc-shell.js";
import { SHIP_ROLES, PROPELLANTS, propellant, shipDv } from "./ships.js";

function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
function kms(v) { return num(v / 1e3, 2); }

export function addShipCards(shell, opts) {
	var o = opts || {}, fleet = o.fleet, instId = o.instId, tab = o.tab || "log";
	var nameOf = o.nameOf || function (id) { return id; };
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
		f.cls = shell.selectField(card, { label: "Class", options: [], save: false });
		var shared = shell.note(card, "");
		var copyBtn = shell.button(card, { label: "Make a separate copy" });
		f.name = shell.textField(card, { label: "Name", save: false });
		f.prop = shell.selectField(card, { label: "Propellant", save: false,
			options: PROPELLANTS.map(function (p) { return { value: p.key, label: p.label }; }) });
		f.isp = shell.numberField(card, { label: "Specific impulse", hint: "vacuum", unit: "s", value: 0, min: 1, save: false });
		var ispHint = f.isp.closest(".cs-row").querySelector(".cs-hint");
		f.dry = shell.numberField(card, { label: "Dry mass", unit: "t", value: 0, min: 0.001, save: false });
		f.payload = shell.numberField(card, { label: "Payload", unit: "t", value: 0, min: 0, save: false });
		f.tank = shell.numberField(card, { label: "Propellant capacity", unit: "t", value: 0, min: 0, save: false });
		if (role === "capsule") shell.note(card, "Always carries a heat shield.");
		else f.shield = shell.selectField(card, { label: "Heat shield", save: false,
			options: [{ value: "0", label: "None" }, { value: "1", label: "Carried" }] });
		var hero = shell.hero(card, [{ label: "Δv, loaded", unit: "km/s" }, { label: "Δv, empty", unit: "km/s" }]);
		shell.note(card, "Δv = Isp · g₀ · ln(m₀ / m_f): m₀ with full tanks, m_f with them empty. Engines and any heat shield count in the dry mass.");

		function cur() { return fleet.classFor(instId, role); }
		function edit(patch) { fleet.update(cur().id, patch); }
		f.cls.addEventListener("change", function () { fleet.assign(instId, role, f.cls.value); });
		copyBtn.addEventListener("click", function () { fleet.copy(cur().id, instId); });
		f.name.addEventListener("change", function () { edit({ name: f.name.value }); });
		f.prop.addEventListener("change", function () { edit({ propellant: f.prop.value, isp: propellant(f.prop.value).isp }); });
		["isp", "dry", "payload", "tank"].forEach(function (k) {
			f[k].addEventListener("input", function () {
				var v = parseFloat(f[k].value);
				if (isFinite(v)) { var p = {}; p[k] = v; edit(p); }
			});
		});
		if (f.shield) f.shield.addEventListener("change", function () { edit({ shield: f.shield.value === "1" }); });

		function put(el, value) { if (document.activeElement !== el) el.value = value; }
		function refresh() {
			var c = cur(), list = fleet.list(role);
			var opts = list.map(function (x) { return x.id + "\u0000" + x.name; }).join("|");
			if (f.cls._opts !== opts) {
				f.cls.innerHTML = "";
				list.forEach(function (x) { var op = document.createElement("option"); op.value = x.id; op.textContent = x.name; f.cls.appendChild(op); });
				f.cls._opts = opts;
			}
			f.cls.value = c.id;
			put(f.name, c.name); put(f.prop, c.propellant); put(f.isp, c.isp);
			put(f.dry, c.dry); put(f.payload, c.payload); put(f.tank, c.tank);
			if (f.shield) put(f.shield, c.shield ? "1" : "0");
			var pr = propellant(c.propellant);
			if (ispHint) ispHint.textContent = pr.rough && c.isp === pr.isp ? "vacuum · rough figure" : "vacuum";
			var others = fleet.usedBy(c.id).filter(function (id) { return id !== instId; }).map(nameOf);
			shared.textContent = others.length ? "Shared with " + others.join(", ") + ". Edits change it there too." : "Used only here.";
			var dv = shipDv(c);
			hero[0].set(kms(dv.loaded)); hero[1].set(kms(dv.empty));
			card.setSummary(c.name + " · " + kms(dv.loaded) + " km/s");
			legLines[role].set("—", "Carries " + kms(dv.loaded) + " km/s loaded (" + c.name + ").");
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
