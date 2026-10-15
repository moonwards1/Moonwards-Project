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
