"""Serve Website/ at http://localhost:8000/ for local viewing (serve.bat runs this).

The same as `python -m http.server`, plus one header: every response carries
`Cache-Control: no-cache`, so the browser checks back with this server before
reusing a file it already has. An unchanged file costs a quick "not modified"
reply; an edited one is fetched fresh. Without it, browsers (Firefox above
all) keep running old copies of the site's ES modules after a plain reload.

Local only: GitHub Pages serves the live site with its own headers.
"""

import functools
import http.server
import os
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Website")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # Module scripts must be served as JavaScript; Windows' registry can map
    # .js to something else, and the browser then refuses to run them.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class DualStackServer(http.server.ThreadingHTTPServer):
    """Listens on IPv6 and IPv4 alike, as `python -m http.server` does, so
    "localhost" answers whichever one the browser tries first."""

    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with DualStackServer(("::", PORT), handler) as httpd:
        print(f"Serving HTTP on :: port {PORT} (http://localhost:{PORT}/), no-cache", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
