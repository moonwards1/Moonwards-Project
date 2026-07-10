// Minimal static server for Website/ — dev tooling for Claude's preview pane
// (see .claude/launch.json). Node-only, no dependencies, because Python is
// not reliably on PATH in the preview launcher's environment. Mirrors
// serve.bat: the served root is Website/, so URLs carry no /Website prefix.
//
//   node .claude/serve-website.mjs [port]     (default 8123)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "Website");
const PORT = parseInt(process.argv[2], 10) || 8123;

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",   // ES modules need a JS MIME type
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".md": "text/plain; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".woff": "font/woff",
	".woff2": "font/woff2"
};

createServer(async (req, res) => {
	try {
		let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
		if (path.endsWith("/")) { path += "index.html"; }
		// normalize + prefix check keeps requests inside ROOT
		const file = normalize(join(ROOT, path));
		if (!file.startsWith(ROOT)) {
			res.writeHead(403); res.end("forbidden"); return;
		}
		const body = await readFile(file);
		res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream" });
		res.end(body);
	} catch (e) {
		res.writeHead(e && e.code === "ENOENT" ? 404 : 500);
		res.end(e && e.code === "ENOENT" ? "not found" : "server error");
	}
}).listen(PORT, () => {
	console.log("Serving " + ROOT + " at http://localhost:" + PORT + "/");
});
