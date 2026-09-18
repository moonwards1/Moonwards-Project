/* MissionPlanner/ui/confirm-dialog.js — an in-page yes/no question.
 *
 * Stands in for window.confirm, which a browser may suppress (an embedded
 * preview pane answers it "Cancel" without ever showing it) and which can't
 * be styled. Wears the same .mp-dialog chrome as the name/paste dialog.
 *
 * confirmDialog({ title, message, okLabel, danger }) -> Promise<boolean>.
 * Resolves true on the OK button, false on Cancel, Escape, or a click on the
 * backdrop. Cancel takes focus, so a stray Enter never confirms a destructive
 * action. One instance, built on first use and appended to <body>; a second
 * call while one is open cancels the first.
 */

var dlg = null;

function build() {
	var wrap = document.createElement("div"); wrap.className = "mp-dialog-wrap";
	var box = document.createElement("div"); box.className = "mp-dialog";
	box.setAttribute("role", "alertdialog");
	var head = document.createElement("h3");
	var msg = document.createElement("p"); msg.className = "mp-dialog-msg";
	var row = document.createElement("div"); row.className = "mp-dialog-btnrow";
	var cancelBtn = document.createElement("button");
	cancelBtn.type = "button"; cancelBtn.className = "mp-btn"; cancelBtn.textContent = "Cancel";
	var okBtn = document.createElement("button");
	okBtn.type = "button"; okBtn.className = "mp-btn mp-big";
	row.appendChild(cancelBtn); row.appendChild(okBtn);
	box.appendChild(head); box.appendChild(msg); box.appendChild(row);
	wrap.appendChild(box);
	document.body.appendChild(wrap);

	var settle = null;
	function finish(answer) {
		if (!settle) { return; }
		var s = settle;
		settle = null;
		wrap.classList.remove("on");
		s(answer);
	}
	cancelBtn.addEventListener("click", function () { finish(false); });
	okBtn.addEventListener("click", function () { finish(true); });
	wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) { finish(false); } });
	wrap.addEventListener("keydown", function (e) {
		if (e.key === "Escape") { e.preventDefault(); finish(false); }
	});

	return {
		open: function (o) {
			finish(false);
			head.textContent = o.title || "Are you sure?";
			msg.textContent = o.message || "";
			msg.hidden = !o.message;
			okBtn.textContent = o.okLabel || "OK";
			okBtn.classList.toggle("mp-danger", !!o.danger);
			wrap.classList.add("on");
			cancelBtn.focus();
			return new Promise(function (resolve) { settle = resolve; });
		}
	};
}

export function confirmDialog(o) {
	if (!dlg) { dlg = build(); }
	return dlg.open(o || {});
}
