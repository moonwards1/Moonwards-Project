// Home page apps section: tabs over the site's full-page apps, each shown in
// an iframe on the same site (so an app reads and writes the same local
// storage as on its own page).
//
// An app loads the first time its tab is clicked, and its frame is kept
// (hidden) while another tab is showing, so work in one app survives a look
// at another. The first tab is selected on arrival but shows its intro until
// clicked: nothing heavy loads with the home page.
//
// Pop out moves the selected app into a window of its own. The frame is
// removed as the window opens, so only one copy of an app is ever live: two copies of the
// Mission Planner would each save their missions on closing, and the later
// save would overwrite the earlier. While an app is out, its tab offers to
// bring it back; closing that window returns the tab to its unloaded state.
//
// ES module, imported by home.js; DOM only, no shared state with the page.

var APPS = [
	{
		id: "planner", label: "Mission Planner", url: "MissionPlanner/planner.html",
		intro: "<p>Plan a trip between bodies through the infrastructure at each end: a skyhook or space elevator releases the ship, it coasts, and infrastructure at the destination catches it. Change any stage and the whole mission recomputes.</p>" +
			"<p>It shows how permanent infrastructure cuts the propellant a ship must carry, and makes launch windows longer and more frequent. Rockets and space tugs are modelled alongside, for comparison and for supporting roles.</p>"
	},
	{
		id: "moonhook", label: "Moon Skyhook", url: "Calculators/Moon-Skyhook-Trajectory-Plotter/moonSkyhookTrajectory.html",
		intro: "<p>To-scale 3D Earth–Moon view with a lunar skyhook and the release physics for a ship let go from it.</p>"
	},
	{
		id: "phobos", label: "Mars–Phobos Skyhook", url: "Calculators/Mars-Phobos-Skyhook-Trajectory-Plotter/marsPhobosSkyhookTrajectory.html",
		intro: "<p>To-scale 3D Mars–Phobos system with a skyhook built onto Phobos, waypoint burns and atmospheric-entry readouts.</p>"
	}
];
var POP_FEATURES = "popup,width=1440,height=900";

export function mountApps(els) {
	var state = {};   // app id → { frame, win, poll }
	var sel = APPS[0].id;
	APPS.forEach(function (a) { state[a.id] = { frame: null, win: null, poll: 0 }; });

	function app(id) { return APPS.find(function (a) { return a.id === id; }); }

	function render() {
		els.tabs.innerHTML = APPS.map(function (a) {
			return '<button class="hm-tab" type="button" role="tab" data-app="' + a.id + '" aria-selected="' + (a.id === sel) + '" aria-controls="appWork">' + a.label + '</button>';
		}).join("");
		var a = app(sel), s = state[sel];
		APPS.forEach(function (b) { if (state[b.id].frame) state[b.id].frame.hidden = b.id !== sel; });
		els.pop.textContent = s.win ? "Bring back" : "Pop out";
		els.pop.title = s.win ? "Close " + a.label + "'s own window and show it here again" : "Open " + a.label + " in a window of its own";
		if (s.frame) { els.intro.hidden = true; return; }
		els.intro.hidden = false;
		els.intro.innerHTML = '<div><b>' + a.label + '</b>' + a.intro +
			(s.win
				? '<p class="hm-app-note">Open in its own window.</p><button class="hm-btn" type="button" data-act="back">Bring it back here</button>'
				: '<button class="hm-btn hm-pri" type="button" data-act="load">Open ' + a.label + '</button>') +
			'</div>';
	}

	function load(id) {
		var s = state[id];
		if (s.frame || s.win) return;
		var f = document.createElement("iframe");
		f.className = "hm-app-frame";
		f.title = app(id).label;
		f.src = app(id).url;
		els.work.appendChild(f);
		s.frame = f;
	}

	function unload(id) {
		var s = state[id];
		if (s.frame) { s.frame.remove(); s.frame = null; }   // its pagehide saves first
	}

	function popOut(id) {
		var s = state[id];
		if (s.win && !s.win.closed) { s.win.focus(); return; }
		var w = window.open(app(id).url, "mw-app-" + id, POP_FEATURES);
		if (!w) return;   // pop-ups blocked: the app stays here
		unload(id);   // synchronous, so its save lands before the window's copy starts
		s.win = w;
		s.poll = setInterval(function () {
			if (!s.win || s.win.closed) { clearInterval(s.poll); s.win = null; render(); }
		}, 800);
		render();
	}

	// The window is closed before the frame loads, and the frame waits until
	// it has gone, so the app's closing save lands before the frame reads it.
	function bringBack(id) {
		var s = state[id];
		clearInterval(s.poll);
		var w = s.win;
		s.win = null;
		if (w && !w.closed) w.close();
		(function wait() {
			if (w && !w.closed) { setTimeout(wait, 50); return; }
			load(id);
			render();
		})();
	}

	els.tabs.addEventListener("click", function (e) {
		var b = e.target.closest("[data-app]");
		if (!b) return;
		sel = b.dataset.app;
		if (!state[sel].win) load(sel);
		render();
	});
	els.intro.addEventListener("click", function (e) {
		var b = e.target.closest("[data-act]");
		if (!b) return;
		if (b.dataset.act === "load") { load(sel); render(); }
		else bringBack(sel);
	});
	els.pop.addEventListener("click", function () {
		if (state[sel].win) bringBack(sel); else popOut(sel);
	});
	render();
}
