// The Lore page: every entry in entries.md as a section, grouped by chapter,
// in file order — its title (unless `notitle`), then its pop-up text with any
// "::: lore" additions around it. The same entries back the info tiers across
// the site, and links between entries expand in place here exactly as they
// do in dialogs. "Pending" means the pop-up text is not written yet.

import { initLore, loreBodyHTML, typesetLore } from "../Shared/lore.js";
import { create } from "../Shared/ui-components.js";

var TIER_NAME = { 1: "Tier 1 · tooltip", 2: "Tier 2 · dialog", 3: "Tier 3 · ⓘ" };

initLore().then(function (lore) {
	var main = document.getElementById("main");
	var toc = document.getElementById("tocList");
	var pendingCount = 0;

	lore.chapters.forEach(function (ch, ci) {
		var sec = create("section", "lp-chapter", false, main);
		var tocCh = create("div", "lp-toc-ch", false, toc);
		if (ch.title) {
			sec.id = "chapter-" + (ci + 1);
			create("h2", "lp-ch-title", ch.title, sec);
			var a = create("a", "lp-toc-ch-title", ch.title, tocCh);
			a.href = "#" + sec.id;
		}
		var ul = create("ul", false, false, tocCh);
		ch.ids.forEach(function (id) {
			var e = lore.entries[id];
			if (e.pending) pendingCount++;
			var art = create("article", ["lp-entry", "lp-t" + e.tier], false, sec);
			art.id = id;
			if (e.pending) art.classList.add("lp-pending");
			var head = create("header", "lp-entry-head", false, art);
			var h = create("h3", e.notitle ? ["lp-entry-title", "lp-notitle"] : "lp-entry-title", e.title, head);
			var anchor = create("a", "lp-anchor", "#", h);
			anchor.href = "#" + id;
			anchor.setAttribute("aria-label", "Link to this entry");
			create("span", "lp-tier", TIER_NAME[e.tier], head);
			var body = create("div", "lore-body", false, art);
			body.innerHTML = loreBodyHTML(e, true);
			var li = create("li", e.pending ? "lp-pending" : false, false, ul);
			var la = create("a", false, e.title, li);
			la.href = "#" + id;
		});
	});

	if (!lore.order.length) create("p", "lore-pending-note", "No entries yet.", main);
	document.getElementById("count").textContent =
		lore.order.length + " entries" + (pendingCount ? " · " + pendingCount + " pending" : "");
	typesetLore(main);

	document.querySelectorAll(".lp-filter button").forEach(function (b) {
		b.addEventListener("click", function () {
			document.querySelectorAll(".lp-filter button").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
			document.body.classList.toggle("lp-only-pending", b.dataset.show === "pending");
		});
	});

	function showHash() {
		var id = decodeURIComponent(location.hash.slice(1));
		var el = id && document.getElementById(id);
		if (!el) return;
		el.scrollIntoView({ block: "start" });
		el.classList.remove("lp-flash");
		void el.offsetWidth;
		el.classList.add("lp-flash");
	}
	window.addEventListener("hashchange", showHash);
	showHash();
});
