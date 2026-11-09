// The Traffic card of a hanging skyhook's Logistics tab: what arrives, how it
// divides, what leaves, and what moving it along the tether asks of the power
// supply and the orbit. Its figures size equipment later on: climbers, power
// supply and storage, reboost engines and their propellant. ES module:
//   import { addTrafficCard } from "./trafficCard.js";
//   var traffic = addTrafficCard(shell, { fleet, instId, neighbours });
//   var warnings = traffic.update(env);   // from the calculator's calc()
//
// opts.fleet       the design's ship classes (Shared/ships.js createFleet); a
//                  standalone calculator passes none and gets the standard classes
// opts.instId      the installation, for its shuttle and capsule classes
// opts.neighbours  optional function returning the other installations at this
//                  body ([{ fam, v }]), to find surface launchers
//
// env: { body, GM, omega, period, rMount, places: { foot, recv, outer, release,
// top, anchor } (radii, m; null for an optional station not in use),
// thruster: { eff } }.
//
// Its energy and orbit balance is a result card of its own ("Energy and orbit
// balance"). The Traffic card is a compact form, one line per item, its sections
// folded by a chevron before each title: a route's name, period and
// amount on one line, then its ships, flights, and its docking or release points
// (a multiple-choice dropdown) with each point's share and the haul it needs.
// All cargo passes through the anchor station; ships are hauled empty from where
// they docked to where they are released. The physics is trafficModel.js.
// Masses are kt, each route averaged over its own period ("average" beside the title).

import { systems } from "../../Shared/orbit.js";
import { ShellColors as C } from "../../Shared/calc-shell.js";
import { createFleet, versionName, shieldMass } from "../../Shared/ships.js";
import { Traffic, YEAR } from "./trafficModel.js";

var PLACE = { foot: "Foot", recv: "Receiving deck", outer: "Outer docks", release: "Release deck", top: "Top", anchor: "Anchor" };
// The body's near market, where it has one: the other half of the Earth–Moon system.
var NEAR = { Moon: { name: "Earth", from: "From Earth", to: "To Earth market" }, Earth: { name: "Moon", from: "From the Moon", to: "To the Moon" } };
var LAUNCH = [{ value: "auto", label: "Detect" }, { value: "driver-surface", label: "Mass driver", fam: "driver", v: "surface" },
	{ value: "driver-spin", label: "Spin launcher", fam: "driver", v: "spin" }, { value: "pad", label: "Launchpad" }];

var POWER = [[1e9, 1e9, "GW"], [1e6, 1e6, "MW"], [1e3, 1e3, "kW"], [0, 1, "W"]];
var FORCE = [[1e9, 1e9, "GN"], [1e6, 1e6, "MN"], [1e3, 1e3, "kN"], [0, 1, "N"]];
var ENERGY = [[1e15, 1e15, "PJ"], [1e12, 1e12, "TJ"], [1e9, 1e9, "GJ"], [1e6, 1e6, "MJ"], [1e3, 1e3, "kJ"], [0, 1, "J"]];
var IMPULSE = [[1e12, 1e12, "TN·s"], [1e9, 1e9, "GN·s"], [1e6, 1e6, "MN·s"], [1e3, 1e3, "kN·s"], [0, 1, "N·s"]];

function num(x, d) { return isFinite(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
function scaled(x, units, d) {
	var dp = d == null ? 2 : d;
	for (var i = 0; i < units.length; i++) if (Math.abs(x) >= units[i][0]) return num(x / units[i][1], dp) + " " + units[i][2];
	var last = units[units.length - 1];
	return num(x / last[1], dp) + " " + last[2];
}
// Three significant figures in the largest unit that keeps it at least 1: "12.9 MW".
function sig3(x, units) {
	for (var i = 0; i < units.length; i++) if (x >= units[i][0]) { var v = x / units[i][1]; return num(v, v < 10 ? 2 : v < 100 ? 1 : 0) + " " + units[i][2]; }
	return "0 " + units[units.length - 1][2];
}
// A computed mass in kt: whole kilotons, or three decimals below one kiloton.
// ktField for a field's value (no thousands commas), ktText for text.
function ktField(x) { var v = Math.max(0, x); return v < 1 ? v.toFixed(3) : String(Math.round(v)); }
function ktText(x) { var v = Math.max(0, x); return v < 1 ? num(v, 3) : num(Math.round(v), 0); }
function val(input) { var v = parseFloat(input.value); return isFinite(v) ? Math.max(0, v) : 0; }
function el(tag, cls, parent, text) {
	var e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	if (parent) parent.appendChild(e);
	return e;
}

export function addTrafficCard(shell, opts) {
	var o = opts || {};
	var fleet = o.fleet || createFleet(null), instId = o.instId || "standalone";
	var card = shell.addCard({ id: "trf", tab: "log", side: "in", title: "Traffic", short: "Traffic", color: C.teal, focus: "stations", feeds: ["trfO"] });
	// The balance is a result card of its own, in the results column.
	var balCard = shell.addCard({ id: "trfO", tab: "log", side: "out", title: "Energy and orbit balance", short: "Balance", color: C.teal, focus: "stations" });
	card.el.classList.add("tf-card");
	card.setTag("average");   // every amount is an average over its route's period
	var form = el("div", "tf", card.body);
	var period = 1, warnings = [];
	var changed = function () { shell.changed(); };
	function secs(unit) { return unit === "orbit" ? period : unit === "day" ? 86400 : unit === "week" ? 604800 : YEAR; }
	function rate(ktPer, unit) { return ktPer * 1e6 / secs(unit); }   // kg/s

	// ---------- controls ----------
	// A line: what it is on the left (with any inline controls), its figure on the right.
	function row(parent, label, cls) {
		var r = el("div", "tf-r" + (cls ? " " + cls : ""), parent);
		var k = el("span", "tf-k", r);
		if (label) el("span", "tf-lab", k, label);
		var v = el("span", "tf-v", r);
		// marked as a labelled line for the design outline (Shared/card-outline.js)
		r.dataset.ol = ""; k.dataset.olK = ""; v.dataset.olV = "";
		return { el: r, k: k, v: v };
	}
	// A figure on the right of a line: set(text, unit).
	function out(r, unit) {
		var n = el("span", "tf-n", r.v), u = el("span", "tf-u", r.v, unit || "");
		return { el: n, set: function (text, unit2) { n.textContent = text; if (unit2 != null) u.textContent = unit2; } };
	}
	// An amount typed on the right of a line, kt, saved under `key`.
	function amountIn(r, key, value) {
		var input = el("input", "tf-in", r.v);
		input.type = "number"; input.min = 0; input.step = "any"; input.value = value || 0;
		el("span", "tf-u", r.v, "kt");
		input.addEventListener("input", changed);
		shell.control(card, input, { key: key });
		return input;
	}
	// The period a route is averaged over: radio buttons inline.
	function periodRadios(r, key, choices, value) {
		r.k.firstChild.textContent += ", per";
		var name = "tf-" + key.replace(/\W/g, "") + "-" + Math.random().toString(36).slice(2, 7), radios = [];
		var group = {
			get value() { var c = radios.find(function (x) { return x.checked; }); return c ? c.value : choices[0]; },
			set value(v) { radios.forEach(function (x) { x.checked = x.value === v; }); }
		};
		choices.forEach(function (c) {
			var lab = el("label", "tf-rad", r.k);
			var x = el("input", null, lab); x.type = "radio"; x.name = name; x.value = c; x.checked = c === value;
			x.addEventListener("change", changed);
			lab.append(c);
			radios.push(x);
		});
		shell.control(card, group, { key: key });
		return group;
	}
	// A multiple-choice dropdown, its value the chosen keys joined by commas. Several
	// views may show one choice (the same ships listed on both directions of a route).
	function multiChoice(key, options, value) {
		var chosen = value.slice(), views = [], labels = {}, hidden = {};
		options.forEach(function (op) { labels[op] = op; });
		var model = {
			get value() { return chosen.join(","); },
			set value(v) { chosen = String(v).split(",").filter(function (x) { return options.indexOf(x) >= 0; }); model.refresh(); },
			// Chosen keys still offered; at least the first offered one.
			picked: function () {
				var p = chosen.filter(function (x) { return !hidden[x]; });
				if (!p.length) { var first = options.find(function (x) { return !hidden[x]; }); if (first) { chosen.push(first); p = [first]; model.refresh(); } }
				return options.filter(function (x) { return p.indexOf(x) >= 0; });
			},
			offer: function (key2, on, label) { hidden[key2] = !on; if (label) labels[key2] = label; },
			view: function (parent) {
				var d = el("details", "tf-dd", parent), s = el("summary", null, d), box = el("div", "tf-dd-list", d);
				var items = options.map(function (op) {
					var lab = el("label", null, box), x = el("input", null, lab), t = el("span", null, lab);
					x.type = "checkbox";
					x.addEventListener("change", function () {
						chosen = options.filter(function (k) { return k === op ? x.checked : chosen.indexOf(k) >= 0; });
						model.refresh(); changed();
					});
					return { op: op, lab: lab, x: x, t: t };
				});
				document.addEventListener("click", function (e) { if (d.open && !d.contains(e.target)) d.open = false; });
				var v = { refresh: function () {
					var p = chosen.filter(function (x) { return !hidden[x]; });
					items.forEach(function (it) { it.lab.hidden = !!hidden[it.op]; it.x.checked = p.indexOf(it.op) >= 0; it.t.textContent = labels[it.op]; });
					s.textContent = p.map(function (x) { return labels[x]; }).join(", ") || "—";
				} };
				views.push(v); v.refresh();
				return v;
			},
			refresh: function () { views.forEach(function (v) { v.refresh(); }); }
		};
		shell.control(card, model, { key: key });
		return model;
	}
	// The bulk direction of a route pair: a tick on each side, exactly one ticked.
	function bulkChoice(key, inFirst) {
		var dir = inFirst ? "in" : "out", boxes = [];
		var model = {
			get value() { return dir; },
			set value(v) { dir = v === "out" ? "out" : "in"; model.refresh(); },
			view: function (parent, side) {
				var lab = el("label", "tf-chk", parent), x = el("input", null, lab);
				x.type = "checkbox";
				lab.append("Bulk");
				x.addEventListener("change", function () { dir = (side === "in") === x.checked ? "in" : "out"; model.refresh(); changed(); });
				boxes.push({ x: x, side: side }); model.refresh();
			},
			refresh: function () { boxes.forEach(function (b) { b.x.checked = b.side === dir; }); }
		};
		shell.control(card, model, { key: key });
		return model;
	}
	// "energy: 8.62 MW loss   orbit: 25.1 kN loss" after a haul's name, loss red and gain green.
	function haulRow(parent, label) {
		var r = row(parent, label, "tf-haul");
		function part(name, x, units) {
			var s = el("span", Math.abs(x) < 1e-9 ? "tf-p" : x > 0 ? "tf-p tf-loss" : "tf-p tf-gain");
			s.textContent = name + ": " + sig3(Math.abs(x), units) + (Math.abs(x) < 1e-9 ? "" : x > 0 ? " loss" : " gain");
			return s;
		}
		return {
			set: function (h, label2) {
				if (label2) r.k.firstChild.textContent = label2;
				r.v.textContent = "";
				r.v.append(part("energy", h.power, POWER), part("orbit", h.force, FORCE));
			},
			show: function (on) { r.el.hidden = !on; }
		};
	}
	function haulList(parent) {
		var box = el("div", null, parent), rows = [];
		return { set: function (items) {
			while (rows.length < items.length) rows.push(haulRow(box, " "));
			rows.forEach(function (r, i) { r.show(!!items[i]); if (items[i]) r.set(items[i].h, items[i].label); });
		} };
	}

	// Docking or release points sharing a route's mass: a dropdown of the places, then
	// for each chosen one its amount and its cargo haul. With one point it takes all; with
	// more, one takes what the others leave: the anchor where chosen, otherwise the one not
	// edited last. `cargo` "to": hauled from the point to the anchor; "from": the reverse.
	function points(parent, key, places, cargo, title) {
		var r = row(parent, title + ":", "tf-pt");
		var choice = multiChoice(key + " points", places, [places[0]]);
		places.forEach(function (p) { choice.offer(p, true, PLACE[p]); });
		choice.view(r.k);
		var last = null;
		var items = places.map(function (p) {
			var pr = row(parent, PLACE[p], "tf-ind");
			var input = amountIn(pr, key + " " + PLACE[p], 0);
			input.addEventListener("input", function () { last = p; });
			var h = p === "anchor" ? null : haulRow(parent, cargo === "to" ? "Haul cargo to anchor" : "Haul cargo from anchor");
			return { at: p, row: pr, input: input, haul: h };
		});
		return {
			// total kt per period; avail(place): is it in use. Returns [{ at, amount }].
			// `shown`: the route's amount as its own line shows it, for a single point to repeat.
			resolve: function (total, avail, what, shown) {
				places.forEach(function (p) { choice.offer(p, avail(p), PLACE[p]); });
				var picked = choice.picked();
				choice.refresh();
				var sel = items.filter(function (it) { var on = picked.indexOf(it.at) >= 0; it.row.el.hidden = !on; if (it.haul) it.haul.show(false); return on; });
				items.forEach(function (it) { it.input.disabled = false; it.input.classList.remove("tf-rem"); });
				if (sel.length === 1) {
					sel[0].input.value = shown != null ? shown : ktField(total); sel[0].input.disabled = true;
					return [{ at: sel[0].at, amount: total }];
				}
				var focus = sel.find(function (it) { return it.input === document.activeElement; });
				var keep = focus ? focus.at : last;
				var rem = sel.findIndex(function (it) { return it.at === "anchor"; });
				if (rem < 0) for (var i = sel.length - 1; i >= 0; i--) if (sel[i].at !== keep) { rem = i; break; }
				var sp = Traffic.split(total, sel.map(function (it) { return val(it.input); }), rem);
				sel[rem].input.value = ktField(sp.values[rem]);
				sel[rem].input.classList.add("tf-rem");
				if (sel[rem].at === "anchor") sel[rem].input.disabled = true;
				if (sp.over > 0) warnings.push(what + ": the amounts come to " + ktText(sp.over) + " kt more than the total.");
				return sel.map(function (it, j) { return { at: it.at, amount: sp.values[j] }; });
			},
			// The cargo hauls for these shares, added to `hauls` and shown under each point.
			haul: function (env, shares, unit, hauls) {
				shares.forEach(function (s) {
					var it = items.find(function (x) { return x.at === s.at; }), rt = rate(s.amount, unit);
					if (!it.haul || !(rt > 0)) return;
					var a = env.places.anchor, p = env.places[s.at];
					var h = cargo === "to" ? Traffic.haul(env, p, a, rt) : Traffic.haul(env, a, p, rt);
					hauls.push(h);
					it.haul.set(h); it.haul.show(true);
				});
			}
		};
	}

	// ---------- the form ----------
	// A titled section: its title line, led by a chevron that folds the rest of the
	// section away, and the body below it that holds the rest. Folds are saved.
	function section(parent, title, cls, key) {
		var sec = el("div", "tf-sec", parent);
		var r = row(sec, title, cls);
		var chev = el("button", "tf-chev", null);
		chev.type = "button";
		chev.setAttribute("aria-label", "Fold or expand " + title);
		chev.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
		r.el.insertBefore(chev, r.k);
		var body = el("div", "tf-body", sec);
		body.dataset.fold = "";   // read by the design outline, folded or not
		var fold = {
			get value() { return body.hidden ? "1" : "0"; },
			set value(v) { body.hidden = v === "1"; chev.classList.toggle("tf-folded", body.hidden); }
		};
		chev.addEventListener("click", function () { fold.value = body.hidden ? "0" : "1"; });
		shell.control(card, fold, { key: "Fold " + key });
		return { box: sec, r: r, body: body };
	}
	var S = {}, sec, r;
	var inG = section(form, "Incoming resources", "tf-hh", "incoming");

	// from surface
	sec = section(inG.body, "From surface", "tf-route", "from surface");
	r = sec.r;
	S.inSurf = { per: periodRadios(r, "From surface per", ["orbit", "day"], "orbit"), amount: amountIn(r, "From surface amount", 1) };
	r = row(sec.body, "Launch method");
	S.launch = el("select", "tf-sel", r.v);
	LAUNCH.forEach(function (l) { el("option", null, S.launch, l.label).value = l.value; });
	S.launch.addEventListener("change", changed);
	shell.control(card, S.launch, { key: "Launch method" });
	var bulkSurf = bulkChoice("Surface bulk", true), bulkNear = bulkChoice("Near market bulk", false), bulkFar = bulkChoice("Interplanetary bulk", true);
	r = row(sec.body, "By shuttle");
	bulkSurf.view(r.k, "in");
	S.inSurf.ship = out(r, "t");
	r = row(sec.body, "flights per orbit");
	S.inSurf.flights = { r: r, o: out(r, "") };
	S.inSurf.docks = points(sec.body, "From surface", ["foot", "recv"], "to", "Docking point");

	// from the near market
	sec = section(inG.body, "From Earth", "tf-route", "from near market");
	S.inNear = { box: sec.box, name: sec.r.k.firstChild };
	S.inNear.per = periodRadios(sec.r, "From near market per", ["day", "week"], "day");
	S.inNear.amount = amountIn(sec.r, "From near market amount", 0);
	var nearShips = multiChoice("Near market freighters", ["1", "2", "3"], ["1"]);
	r = row(sec.body, "By freighter");
	nearShips.view(r.k); bulkNear.view(r.k, "in");
	S.inNear.ship = out(r, "kt");
	r = row(sec.body, "load per flight");
	S.inNear.flights = { r: r, o: out(r, "") };
	S.inNear.docks = points(sec.body, "From near market", ["top", "outer"], "to", "Docking point");

	// from interplanetary
	sec = section(inG.body, "From interplanetary, per year", "tf-route", "from interplanetary");
	S.inFar = { amount: amountIn(sec.r, "From interplanetary amount", 0) };
	var farShips = multiChoice("Interplanetary freighters", ["1", "2", "3"], ["1"]);
	r = row(sec.body, "By freighter");
	farShips.view(r.k); bulkFar.view(r.k, "in");
	S.inFar.ship = out(r, "kt");
	r = row(sec.body, "flights per year");
	S.inFar.flights = { r: r, o: out(r, "") };
	S.inFar.docks = points(sec.body, "From interplanetary", ["top", "outer", "anchor"], "to", "Docking point");

	// what becomes of it: outside Incoming, so it stays when Incoming is folded
	sec = section(form, "Total annual resources", "tf-route", "total");
	S.total = out(sec.r, "kt");
	r = row(sec.body, "What leaves as products (or continues on)");
	S.prod = el("input", "tf-in tf-pc", r.v); S.prod.type = "number"; S.prod.min = 0; S.prod.max = 100; S.prod.step = "any"; S.prod.value = 50;
	el("span", "tf-u", r.v, "%"); S.prod.addEventListener("input", changed); shell.control(card, S.prod, { key: "Products share" });
	r = row(sec.body, "Resources sent to the surface");
	S.surf = el("input", "tf-in tf-pc", r.v); S.surf.type = "number"; S.surf.min = 0; S.surf.max = 100; S.surf.step = "any"; S.surf.value = 10;
	el("span", "tf-u", r.v, "%"); S.surf.addEventListener("input", changed); shell.control(card, S.surf, { key: "Surface share" });
	r = row(sec.body, "Waste, and resources used on anchor");
	S.waste = out(r, "%");

	// ---------- outgoing ----------
	var outG = section(form, "Outgoing products per year", "tf-hh", "outgoing");
	S.outTotal = out(outG.r, "kt");

	// to the near market
	sec = section(outG.body, "To Earth market", "tf-route", "to near market");
	S.outNear = { box: sec.box, name: sec.r.k.firstChild };
	S.outNear.per = periodRadios(sec.r, "To near market per", ["orbit", "day"], "day");
	S.outNear.amount = amountIn(sec.r, "To near market amount", 0);
	r = row(sec.body, "By freighter");
	nearShips.view(r.k); bulkNear.view(r.k, "out");
	S.outNear.ship = out(r, "kt");
	S.outNear.fTon = amountIn(r, "To near market by freighter", 0);
	r = row(sec.body, "flights per day");
	S.outNear.flights = { r: r, o: out(r, "") };
	S.outNear.rel = points(sec.body, "To near market", ["top", "release"], "from", "Release point");
	S.outNear.ferry = haulList(sec.body);
	S.outNear.capBox = el("div", "tf-sec", sec.body);
	r = row(S.outNear.capBox, "By capsule");
	S.outNear.cap = out(r, "t");
	S.outNear.cTon = amountIn(r, "To near market by capsule", 0);
	r = row(S.outNear.capBox, "flights per day");
	S.outNear.cFlights = { r: r, o: out(r, "") };
	S.outNear.cRel = points(S.outNear.capBox, "Capsules", ["top", "release"], "from", "Release point");

	// to interplanetary
	sec = section(outG.body, "To interplanetary, per year", "tf-route", "to interplanetary");
	S.outFar = { box: sec.box, amount: amountIn(sec.r, "To interplanetary amount", 0) };
	r = row(sec.body, "By freighter");
	farShips.view(r.k); bulkFar.view(r.k, "out");
	S.outFar.ship = out(r, "kt");
	r = row(sec.body, "load per flight");
	S.outFar.flights = { r: r, o: out(r, "") };
	S.outFar.rel = points(sec.body, "To interplanetary", ["top", "release"], "from", "Release point");
	S.outFar.ferry = haulList(sec.body);

	// to the surface
	sec = section(outG.body, "To surface", "tf-route", "to surface");
	S.outSurf = { box: sec.box, per: periodRadios(sec.r, "To surface per", ["orbit", "day"], "orbit"), amount: out(sec.r, "kt") };
	r = row(sec.body, "By shuttle");
	bulkSurf.view(r.k, "out");
	r = row(sec.body, "load per flight");
	S.outSurf.flights = { r: r, o: out(r, "") };
	S.outSurf.rel = points(sec.body, "To surface", ["foot", "recv"], "from", "Release point");
	S.outSurf.ferry = haulList(sec.body);

	// ---------- balance (its own result card) ----------
	var bal = el("div", "tf tf-bal", balCard.body);
	r = row(bal, "Energy balance"); el("span", "tf-lab tf-per", r.k, "per orbit"); S.eOrbit = out(r, "");
	r = row(bal, "\u00a0"); el("span", "tf-lab tf-per", r.k, "per year"); S.eYear = out(r, "");
	r = row(bal, "Climber efficiency"); S.cEff = out(r, "%");
	r = row(bal, "Orbit balance"); el("span", "tf-lab tf-per", r.k, "per orbit"); S.oOrbit = out(r, "");
	r = row(bal, "\u00a0"); el("span", "tf-lab tf-per", r.k, "per year"); S.oYear = out(r, "");
	r = row(bal, "Thruster efficiency"); S.tEff = out(r, "%");

	// Two amounts that make a total between them: the one edited last stays, the other
	// takes the rest. Each converts to the total's unit by its own factor. Returns both
	// exactly, in their own units ({ a, b }), and how far the kept one exceeds the total.
	var pairLast = { capsule: "b" };   // capsules keep what they are given; freighters carry the rest
	function watchPair(id, a, b) {
		a.addEventListener("input", function () { pairLast[id] = "a"; });
		b.addEventListener("input", function () { pairLast[id] = "b"; });
	}
	function pair(id, a, b, total, ka, kb) {
		var keepA = pairLast[id] !== "b";
		if (document.activeElement === a) keepA = true;
		if (document.activeElement === b) keepA = false;
		var keep = keepA ? a : b, other = keepA ? b : a, kk = keepA ? ka : kb, ko = keepA ? kb : ka;
		var left = total - val(keep) * kk, rest = Math.max(0, left) / ko;
		other.value = ktField(rest);
		a.classList.toggle("tf-rem", other === a); b.classList.toggle("tf-rem", other === b);
		return { a: keepA ? val(a) : rest, b: keepA ? rest : val(b), over: left < 0 ? -left : 0 };
	}
	watchPair("market", S.outNear.amount, S.outFar.amount);
	watchPair("capsule", S.outNear.fTon, S.outNear.cTon);

	// A flights line: on the bulk side "flights per <period>", on the other "load per flight".
	function flightsLine(f, flights, unit, rateKg, list, bulk) {
		var lab = f.r.k.firstChild, per = flights * secs(unit);
		lab.textContent = bulk ? "flights per " + unit : "load per flight";
		f.o.el.classList.remove("tf-loss");
		if (!(per > 0)) { f.o.set("0", ""); return; }
		if (bulk) { f.o.set(num(per, per < 10 ? 2 : 1), ""); return; }
		var load = Traffic.loadPerFlight(rateKg, flights);
		f.o.set(ktText(load / 1e6), "kt");
		if (load > Math.min.apply(null, list.map(function (c) { return c.payload * 1000; })) * (1 + 1e-9)) {
			f.o.el.classList.add("tf-loss");
			warnings.push("Traffic: a return load is more than a ship carries; make that direction the bulk one.");
		}
	}
	function payloads(list) { return list.map(function (c) { return c.payload * 1000; }); }
	function emptyKg(c) { return (c.dry + shieldMass(c)) * 1000; }
	function avgEmpty(list) { return list.reduce(function (s, c) { return s + emptyKg(c); }, 0) / list.length; }
	function capList(list) { return list.map(function (c) { return num(c.payload / 1000, c.payload < 1000 ? 3 : 0); }).join(", "); }
	// The design's freighter versions offered in a dropdown; returns the chosen classes.
	function freighters(model) {
		var list = fleet.list("freighter");
		if (!list.length) list = [fleet.standard("freighter")];
		["1", "2", "3"].forEach(function (k, i) { var c = list[i]; model.offer(k, !!c, c ? (i ? versionName(c) : "Standard") : null); });
		var picked = model.picked();
		model.refresh();
		return picked.map(function (k) { return list[Number(k) - 1]; });
	}
	// Empty ships hauled from their docking points to their release points, in the cargo's shares.
	function ferry(env, what, flights, empty, docks, inTotal, rels, outTotal, hauls) {
		var share = function (list, total) { return list.map(function (x) { return { at: x.at, share: total > 0 ? x.amount / total : 1 / list.length }; }); };
		return Traffic.shipMoves(flights, empty, share(docks, inTotal), share(rels, outTotal)).map(function (m) {
			var h = Traffic.haul(env, env.places[m.from], env.places[m.to], m.rate);
			hauls.push(h);
			return { label: "Haul " + what + " from " + PLACE[m.from].toLowerCase() + (m.to === "top" ? "" : " to " + PLACE[m.to].toLowerCase()), h: h };
		});
	}
	function signed(x, units) {
		var s = Math.abs(x) < 1e-9 ? "" : x > 0 ? " loss" : " gain";
		var t = scaled(Math.abs(x), units).split(" ");
		return [t[0], t[1] + s, Math.abs(x) < 1e-9 ? "" : x > 0 ? "tf-loss" : "tf-gain"];
	}
	function setSigned(o2, x, units) { var t = signed(x, units); o2.set(t[0], t[1]); o2.el.className = "tf-n " + t[2]; }

	// ---------- update ----------
	function update(env) {
		warnings = [];
		period = env.period;
		var hauls = [];
		var avail = function (p) { return env.places[p] != null; };
		var near = NEAR[env.body] || null;
		var capsule = !!near && !!(systems.get(near.name) || {}).atmosphere;
		S.inNear.box.hidden = S.outNear.box.hidden = !near;
		if (near) { S.inNear.name.textContent = near.from + ", per"; S.outNear.name.textContent = near.to + ", per"; }
		S.outNear.capBox.hidden = !capsule;
		S.outNear.fTon.hidden = S.outNear.fTon.nextSibling.hidden = !capsule;

		// launch method: the launchers built at this body, and a launchpad; Detect picks
		// a mass driver, else a spin launcher, else a launchpad (standalone: a launchpad)
		var nb = typeof o.neighbours === "function" ? o.neighbours() : null;
		var have = function (l) { return !!l && (!l.fam || !nb || nb.some(function (n) { return n.fam === l.fam && n.v === l.v; })); };
		var detected = nb ? LAUNCH.find(function (l) { return l.value !== "auto" && have(l); }) : LAUNCH[LAUNCH.length - 1];
		Array.prototype.forEach.call(S.launch.options, function (op) {
			if (op.value === "auto") { op.textContent = "Detect: " + detected.label.toLowerCase(); return; }
			op.hidden = op.disabled = !have(LAUNCH.find(function (x) { return x.value === op.value; }));
		});
		if (!have(LAUNCH.find(function (x) { return x.value === S.launch.value; }))) S.launch.value = "auto";

		var shuttle = fleet.classFor(instId, "shuttle");
		var capC = capsule ? fleet.classFor(instId, "capsule") : null;
		var nearF = near ? freighters(nearShips) : [], farF = freighters(farShips);

		// incoming, and what becomes of it
		var uSurf = S.inSurf.per.value, uNearIn = S.inNear.per.value;
		var inSurf = val(S.inSurf.amount), inNear = near ? val(S.inNear.amount) : 0, inFar = val(S.inFar.amount);
		var inYear = (rate(inSurf, uSurf) + rate(inNear, uNearIn)) * YEAR / 1e6 + inFar;   // kt/yr
		S.total.set(ktText(inYear));
		var pWaste = 100 - val(S.prod) - val(S.surf);
		S.waste.set(num(Math.max(0, pWaste), 1));
		if (pWaste < 0) warnings.push("Traffic: products and surface shares come to more than 100%.");
		var prodYear = inYear * val(S.prod) / 100, surfYear = inYear * val(S.surf) / 100;
		S.outTotal.set(ktText(prodYear));

		// outgoing: near market and interplanetary share the products; freighters and capsules the near market's
		var uNearOut = S.outNear.per.value, uSurfOut = S.outSurf.per.value;
		S.outFar.amount.disabled = !near;
		var outNear = 0, outFar = prodYear;
		if (near) {
			var pm = pair("market", S.outNear.amount, S.outFar.amount, prodYear, YEAR / secs(uNearOut), 1);
			if (pm.over > 0) warnings.push("Traffic: the near market and interplanetary come to " + ktText(pm.over) + " kt a year more than the products.");
			outNear = pm.a; outFar = pm.b;
		} else { S.outFar.amount.value = ktField(prodYear); S.outFar.amount.classList.remove("tf-rem"); }
		var outSurf = surfYear * secs(uSurfOut) / YEAR;
		S.outSurf.amount.set(ktText(outSurf));
		var fOut = outNear, cOut = 0, fShown = S.outNear.amount.value;
		if (capsule) {
			var pc = pair("capsule", S.outNear.fTon, S.outNear.cTon, outNear, 1, 1);
			if (pc.over > 0) warnings.push("Traffic: freighters and capsules carry " + ktText(pc.over) + " kt more than the route.");
			fOut = pc.a; cOut = pc.b; fShown = S.outNear.fTon.value;
		}

		// surface: the same shuttles both ways
		S.inSurf.ship.set(num(shuttle.payload, 1));
		var rIn = rate(inSurf, uSurf), rOut = rate(outSurf, uSurfOut), surfIn = bulkSurf.value === "in";
		var nS = Traffic.flights(surfIn ? rIn : rOut, payloads([shuttle]));
		flightsLine(S.inSurf.flights, nS, uSurf, rIn, [shuttle], surfIn);
		flightsLine(S.outSurf.flights, nS, uSurfOut, rOut, [shuttle], !surfIn);
		var dS = S.inSurf.docks.resolve(inSurf, avail, "Traffic, from surface", S.inSurf.amount.value);
		S.inSurf.docks.haul(env, dS, uSurf, hauls);
		var rS = S.outSurf.rel.resolve(outSurf, avail, "Traffic, to surface", ktField(outSurf));
		S.outSurf.rel.haul(env, rS, uSurfOut, hauls);
		S.outSurf.ferry.set(ferry(env, "shuttle", nS, emptyKg(shuttle), dS, inSurf, rS, outSurf, hauls));

		// near market: the same freighters both ways, and capsules one way
		if (near) {
			S.inNear.ship.set(capList(nearF)); S.outNear.ship.set(capList(nearF));
			var rNi = rate(inNear, uNearIn), rNo = rate(fOut, uNearOut), nearIn = bulkNear.value === "in";
			var nN = Traffic.flights(nearIn ? rNi : rNo, payloads(nearF));
			flightsLine(S.inNear.flights, nN, uNearIn, rNi, nearF, nearIn);
			flightsLine(S.outNear.flights, nN, uNearOut, rNo, nearF, !nearIn);
			var dN = S.inNear.docks.resolve(inNear, avail, "Traffic, " + near.from.toLowerCase(), S.inNear.amount.value);
			S.inNear.docks.haul(env, dN, uNearIn, hauls);
			var rN = S.outNear.rel.resolve(fOut, avail, "Traffic, " + near.to.toLowerCase(), fShown);
			S.outNear.rel.haul(env, rN, uNearOut, hauls);
			S.outNear.ferry.set(ferry(env, "freighter", nN, avgEmpty(nearF), dN, inNear, rN, fOut, hauls));
			if (capC) {
				S.outNear.cap.set(num(capC.payload, 1));
				var rC = rate(cOut, uNearOut);
				flightsLine(S.outNear.cFlights, Traffic.flights(rC, payloads([capC])), uNearOut, rC, [capC], true);
				var rCap = S.outNear.cRel.resolve(cOut, avail, "Traffic, capsules", S.outNear.cTon.value);
				S.outNear.cRel.haul(env, rCap, uNearOut, hauls);
			}
		}

		// interplanetary: the same freighters both ways
		S.inFar.ship.set(capList(farF)); S.outFar.ship.set(capList(farF));
		var rFi = rate(inFar, "year"), rFo = rate(outFar, "year"), farIn = bulkFar.value === "in";
		var nF = Traffic.flights(farIn ? rFi : rFo, payloads(farF));
		flightsLine(S.inFar.flights, nF, "year", rFi, farF, farIn);
		flightsLine(S.outFar.flights, nF, "year", rFo, farF, !farIn);
		var dF = S.inFar.docks.resolve(inFar, avail, "Traffic, from interplanetary", S.inFar.amount.value);
		S.inFar.docks.haul(env, dF, "year", hauls);
		var rF = S.outFar.rel.resolve(outFar, avail, "Traffic, to interplanetary", S.outFar.amount.value);
		S.outFar.rel.haul(env, rF, "year", hauls);
		S.outFar.ferry.set(ferry(env, "freighter", nF, avgEmpty(farF), dF, inFar, rF, outFar, hauls));

		// balance
		var b = Traffic.balance(hauls, { period: env.period, climberEff: null, thrusterEff: env.thruster.eff });
		setSigned(S.eOrbit, b.energyOrbit, ENERGY);
		setSigned(S.eYear, b.energyYear, ENERGY);
		S.cEff.set("—", "");
		setSigned(S.oOrbit, b.impulseOrbit, IMPULSE);
		setSigned(S.oYear, b.impulseYear, IMPULSE);
		S.tEff.set(num(env.thruster.eff * 100, 0));

		card.setSummary(num(inYear, 0) + " kt/yr in · " + num(prodYear, 0) + " kt/yr out");
		balCard.setSummary(signed(b.energyYear, ENERGY).slice(0, 2).join(" ") + "/yr · " + signed(b.impulseYear, IMPULSE).slice(0, 2).join(" ") + "/yr");
		return warnings;
	}

	return { card: card, update: update };
}
