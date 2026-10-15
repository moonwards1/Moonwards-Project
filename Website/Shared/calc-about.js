// "About this calculator" pop-up for the calculator pages. Self-wiring: a page
// includes it with a plain module tag, nothing to call.
//
//   <script type="module" src="../../Shared/calc-about.js"></script>
//
// and carries, beside its title, an info button and a template of the text:
//
//   <span class="cf-title-info"><button class="cf-info" data-cf-about="about"
//     aria-label="About this calculator">i</button><span class="cf-hint">&larr; click for info</span></span>
//   <template id="about" data-title="About this calculator">…paragraphs…</template>
//
// The pop-up is a <dialog> built on first click inside the page's .cf-calc, so
// it takes that calculator's identity colour; the backdrop or × closes it.
//
// The same module drives the small tips beside input lines (see "Small tips"
// below): a floating box by the button instead of a dialog over the window.

function buildDialog(host, title, html) {
	const dlg = document.createElement("dialog");
	dlg.className = "cf-dialog";

	const head = document.createElement("div");
	head.className = "cf-dialog-head";
	const h = document.createElement("h3");
	h.textContent = title;
	const close = document.createElement("button");
	close.className = "cf-dialog-close";
	close.setAttribute("aria-label", "Close");
	close.textContent = "\u00d7";
	close.addEventListener("click", () => dlg.close());
	head.append(h, close);

	const body = document.createElement("div");
	body.className = "cf-dialog-body";
	body.innerHTML = html;

	dlg.append(head, body);
	// A click on the backdrop (outside the box) lands on the dialog itself.
	dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
	host.appendChild(dlg);
	return dlg;
}

// Small tips: an info button beside an input line carries its text in
// data-cf-tip and opens a floating box next to itself. One box is shared by
// the whole page and is delegated from the document, so buttons a calculator
// builds after this module has run work too. A button inside a <form> must be
// type="button".
//
//   <button type="button" class="cf-info" data-cf-tip="Short explanation."
//     aria-label="More information">i</button>
let tipBox = null;
let tipButton = null;

function closeTip() {
	if (tipBox) tipBox.hidden = true;
	if (tipButton) tipButton.setAttribute("aria-expanded", "false");
	tipButton = null;
}

function openTip(btn) {
	const host = btn.closest(".cf-calc") || document.body;
	if (!tipBox || tipBox.parentNode !== host) {
		if (tipBox) tipBox.remove();
		tipBox = document.createElement("div");
		tipBox.className = "cf-tip";
		tipBox.setAttribute("role", "tooltip");
		host.appendChild(tipBox);
	}
	tipBox.textContent = btn.dataset.cfTip;
	tipBox.hidden = false;
	btn.setAttribute("aria-expanded", "true");
	tipButton = btn;
	placeTip();
}

// Position against the host's padding box, below the button, kept inside it.
function placeTip() {
	if (!tipBox || !tipButton) return;
	const btn = tipButton;
	const host = tipBox.parentNode;
	const h = host.getBoundingClientRect();
	const b = btn.getBoundingClientRect();
	const originX = h.left + host.clientLeft;
	const originY = h.top + host.clientTop;
	const margin = 8;
	const width = Math.min(tipBox.offsetWidth, host.clientWidth - 2 * margin);
	let left = b.left - originX + b.width / 2 - width / 2;
	left = Math.max(margin, Math.min(left, host.clientWidth - width - margin));
	tipBox.style.left = left + "px";
	tipBox.style.top = (b.bottom - originY + 6) + "px";
}

document.addEventListener("click", e => {
	const btn = e.target.closest("[data-cf-tip]");
	if (btn) {
		e.preventDefault();
		if (btn === tipButton) closeTip(); else openTip(btn);
	} else if (!(tipBox && tipBox.contains(e.target))) {
		closeTip();
	}
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTip(); });
window.addEventListener("resize", placeTip);

document.querySelectorAll("[data-cf-about]").forEach(btn => {
	const tpl = document.getElementById(btn.dataset.cfAbout);
	if (!tpl) return;
	let dlg = null;
	btn.addEventListener("click", () => {
		if (!dlg) {
			const host = btn.closest(".cf-calc") || document.body;
			dlg = buildDialog(host, tpl.dataset.title || "About this calculator", tpl.innerHTML);
		}
		dlg.showModal();
	});
});
