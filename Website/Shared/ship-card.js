// The ship cards of a workbench installation's Logistics tab: one input card
// per ship role the installation needs, and a Ship legs result card. ES module:
//   import { addShipCards } from "../Shared/ship-card.js";
//
// The cards edit the design's ship classes (Shared/ships.js createFleet), not
// the calculator's own settings: a class belongs to the whole design, so an
// edit here changes every installation using that class, and the cards of
// every mounted calculator follow. Each role has a standard class, tagged
// "standard" beside the title.
//
// A card holds one ENTRY per variant of its role that this installation can
// use. With one variant (the standard) the card is the plain form. Once there
// are two or more, each variant is an entry with a chevron that folds it: a
// folded entry shows its name and its payload capacity and Δv when loaded; an
// open one shows the whole form. A capsule or shuttle card can make a local
// version, for this installation alone, shown as a second entry beside the
// standard, with an × that removes it to return to the standard. A freighter
// card makes other versions, titled by payload capacity and heat shield, up to
// MAX_VERSIONS designs in all; a named version carries an × that removes it
// from the design. Which freighter version a route uses is chosen on the Traffic
// card, not here. The fields carry `save: false`; the fleet is saved with the
// design. Which entries are open is saved with the viewer's settings.
//
//   var ships = addShipCards(shell, { fleet, instId, roles: ["shuttle"] });
//   ships.read("shuttle")   // { class, dv: { loaded, empty } } in the recalculation
//   ships.dispose()         // when the calculator is removed
//
// A change to the fleet runs the calculator's recalculation (shell.changed()), so results that read a ship
// stay current.

import { ShellColors as C } from "./calc-shell.js";
import { SHIP_ROLES, PROPELLANTS, SHIELDS, shield, shieldKey, shipDv, shieldMass, shipTitle, versionName, isLocalRole, MAX_VERSIONS } from "./ships.js";

function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
function kms(v) { return num(v / 1e3, 2); }
function el(tag, cls, parent, text) {
	var e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	if (parent) parent.appendChild(e);
	return e;
}
function div(cls, parent) { return el("div", cls, parent); }

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
		var local = isLocalRole(role);
		// Mass fields show their class figure (tonnes) divided by `mass`: a
		// freighter's masses are in kilotonnes, every other ship's in tonnes.
		var mass = role === "freighter" ? 1000 : 1, mu = mass === 1000 ? "kt" : "t";
		var scale = { dry: mass, payload: mass, tank: mass };
		var shared = shell.note(card, "");
		var list = div("cs-ve-list", card.body);
		var choice = shell.buttonRow(card);
		shell.note(card, "Δv = Isp · g₀ · ln(m₀ / m_f): m₀ with full tanks, m_f with them empty. Isp comes with the propellant. Engines count in the dry mass; a heat shield adds to it, as a share of the loaded ship without the shield.");
		var entries = {};

		function cur() { return fleet.classFor(instId, role); }
		// The variants this installation can use, standard first: a shuttle's or capsule's
		// own local version (others belong to other installations), or all of a freighter's.
		function variants() {
			var std = fleet.standard(role), c = cur();
			return local ? (c === std ? [std] : [std, c]) : fleet.list(role);
		}
		function makeCopy() {
			var src = cur(), copy = fleet.copy(src.id, instId);
			if (copy && entries[src.id]) entries[src.id].setOpen(false);   // the new version opens, the one it came from folds
		}

		// One variant's entry: a header (chevron, name, stats while folded, its status and
		// buttons) over the form, built once and refreshed as the class changes.
		function makeEntry(id, open) {
			var box = div("cs-ve", list), head = div("cs-ve-h", box);
			var toggle = el("button", "cs-ve-t", head);
			toggle.type = "button";
			toggle.innerHTML = '<svg class="cs-chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			var nm = el("span", "cs-ve-n", toggle), stat = el("span", "cs-ve-s", toggle);
			var acts = div("cs-ve-a", head);
			var onTag = el("span", "cs-ve-on", acts, "in use"), rmBtn = el("button", "cs-ve-x", acts);
			rmBtn.type = "button";
			rmBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
			var body = div("cs-ve-b", box);
			var e = { id: id, box: box, open: !!open, solo: false };
			e.setOpen = function (v) { e.open = !!v; paint(); };
			function paint() {
				box.classList.toggle("cs-open", e.open || e.solo);
				body.hidden = !(e.open || e.solo);
				head.hidden = e.solo;
				stat.hidden = e.open;
				toggle.setAttribute("aria-expanded", String(e.open));
			}
			toggle.onclick = function () { e.setOpen(!e.open); };
			shell.control(card, { get value() { return e.open ? "0" : "1"; }, set value(v) { e.setOpen(v !== "1"); } }, { key: "Fold " + id });

			var f = {};
			// Each propellant states its vacuum Isp; "~" marks a rough figure.
			f.prop = shell.selectField(card, { label: "Propellant", hint: "vacuum Isp", save: false, parent: body,
				options: PROPELLANTS.map(function (p) { return { value: p.key, label: p.label + " · " + (p.rough ? "~" : "") + p.isp + " s" }; }) });
			f.prop.closest(".cs-row").classList.add("cs-wide");
			f.dry = shell.numberField(card, { label: "Dry mass", unit: mu, value: 0, min: 0.001 / mass, save: false, parent: body });
			f.payload = shell.numberField(card, { label: "Payload", unit: mu, value: 0, min: 0, save: false, parent: body });
			f.tank = shell.numberField(card, { label: "Propellant capacity", unit: mu, value: 0, min: 0, save: false, parent: body });
			// A capsule always carries a heat shield, so it is not offered "None".
			f.shield = shell.selectField(card, { label: "Heat shield", save: false, parent: body,
				options: SHIELDS.filter(function (s) { return role !== "capsule" || s.key !== "none"; })
					.map(function (s) { return { value: s.key, label: s.label }; }) });
			f.shield.closest(".cs-row").classList.add("cs-wide");
			var shieldNote = shell.note(card, "", body);
			var hero = shell.hero({ body: body }, [{ label: "Δv, loaded", unit: "km/s" }, { label: "Δv, empty", unit: "km/s" }]);

			function edit(patch) { fleet.update(id, patch); }
			f.prop.addEventListener("change", function () { edit({ propellant: f.prop.value }); });
			["dry", "payload", "tank"].forEach(function (k) {
				f[k].addEventListener("input", function () {
					var v = parseFloat(f[k].value);
					if (isFinite(v)) { var p = {}; p[k] = v * scale[k]; edit(p); }
				});
			});
			f.shield.addEventListener("change", function () { edit({ shield: f.shield.value }); });
			function put(input, value) { if (document.activeElement !== input) input.value = value; }

			// `count`: how many entries the card has; `inUse`: the one this installation uses.
			e.refresh = function (c, count, inUse) {
				e.solo = count === 1;
				var std = fleet.standard(role) === c;
				put(f.prop, c.propellant);
				["dry", "payload", "tank"].forEach(function (k) { put(f[k], +(c[k] / mass).toPrecision(12)); });
				put(f.shield, shieldKey(c.shield));
				var dv = shipDv(c);
				nm.textContent = std ? "Standard" : local ? "Local" : versionName(c);
				stat.textContent = +(c.payload / mass).toPrecision(3) + " " + mu + " · Δv " + kms(dv.loaded) + " km/s";
				stat.title = "Payload capacity " + +(c.payload / mass).toPrecision(3) + " " + mu + "; Δv " + kms(dv.loaded) + " km/s when loaded";
				onTag.hidden = !(local && inUse);   // a freighter version is chosen on the Traffic card
				rmBtn.hidden = std;
				var what = local ? "Remove the local version. This facility goes back to the standard " + def.label.toLowerCase() + "." :
					"Remove the " + versionName(c) + " version from the design. Facilities using it go back to the standard " + def.label.toLowerCase() + ".";
				rmBtn.title = what; rmBtn.setAttribute("aria-label", what);
				rmBtn.onclick = function () { if (local) fleet.revert(instId, role); else fleet.remove(id); };
				var sh = shield(shieldKey(c.shield));
				var hs = mass === 1000 ? +(shieldMass(c) / 1000).toPrecision(3) + " kt" : +shieldMass(c).toPrecision(3) + " t";
				shieldNote.textContent = "";
				if (sh.fraction) {
					shieldNote.append(Math.round(sh.fraction * 100) + "% of ship mass: ");
					var strong = document.createElement("strong");
					strong.textContent = hs;
					shieldNote.append(strong, ".");
				}
				shieldNote.style.display = sh.fraction ? "" : "none";
				hero[0].set(kms(dv.loaded)); hero[1].set(kms(dv.empty));
				paint();
			};
			paint();
			return e;
		}

		function refresh() {
			var c = cur(), all = variants(), count = all.length;
			Object.keys(entries).forEach(function (id) {
				if (all.some(function (k) { return k.id === id; })) return;
				entries[id].box.remove(); delete entries[id];
			});
			all.forEach(function (k) { if (!entries[k.id]) entries[k.id] = makeEntry(k.id, count === 1 || k === c); });
			// entries sit in the order of the variants; move a node only if it is out of place
			var want = all.map(function (k) { return entries[k.id].box; });
			if (want.some(function (b, i) { return list.children[i] !== b; })) want.forEach(function (b) { list.appendChild(b); });
			all.forEach(function (k) { entries[k.id].refresh(k, count, k === c); });

			var std = fleet.isStandard(c), title = local ? shipTitle(c, std) : def.label;
			var tag = local ? (std ? "standard" : "local") : count === 1 ? "standard" : "";
			card.setTitle(title);
			card.setTag(tag);
			shared.textContent = count > 1 ? "" : std ? "Same design used across facilities. Edits change all standard " + def.label.toLowerCase() + "s." : "";
			shared.style.display = shared.textContent ? "" : "none";
			if (local) choice.set("", std ? [{ label: "Make a local version", onClick: makeCopy }] : []);
			else choice.set("", count < MAX_VERSIONS ? [{ label: "Make another version", onClick: makeCopy }] : []);
			choice.el.hidden = !choice.el.children.length;
			var dv = shipDv(c);
			card.setSummary(!local && count > 1 ? count + " versions" : (tag ? tag + " · " : "") + kms(dv.loaded) + " km/s");
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
