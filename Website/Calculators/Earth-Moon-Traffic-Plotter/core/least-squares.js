/* Earth-Moon-Traffic-Plotter/core/least-squares — Levenberg–Marquardt, for
 * the solves that fit burns to a meeting (core/farburn.js,
 * core/sun-route.js).
 *
 * leastSquares(fn, x0, h, cap, maxIter, tol): minimizes |R(x)|, where
 * fn(x) -> { R: [...], norm } | null, from x0, with finite-difference steps
 * `h` and no unknown changing by more than its `cap` in one iteration — a
 * meeting has other, far costlier answers than the one near the start, and an
 * unbounded step can land in one of them. Returns { x, res }, the best point
 * reached, or null when fn(x0) is null.
 *
 * Pure (no DOM): exercised through the solves' Node tests.
 */

export function leastSquares(fn, x0, h, cap, maxIter, tol) {
	var x = x0.slice(), cur = fn(x), n = x.length, lambda = 1e-3;
	if (!cur) { return null; }
	for (var it = 0; it < maxIter && cur.norm > tol; it++) {
		var J = [], m = cur.R.length, j, a, b, i;
		for (j = 0; j < n; j++) {
			var xp = x.slice(); xp[j] += h[j];
			var rj = fn(xp);
			if (!rj) { return { x: x, res: cur }; }
			J.push(rj.R.map(function (v, q) { return (v - cur.R[q]) / h[j]; }));
		}
		var next = null;
		for (var tries = 0; tries < 12 && !next; tries++) {
			// (JtJ + lambda * diag) d = -Jt R, by Gaussian elimination
			var A = [];
			for (a = 0; a < n; a++) {
				var row = [], g = 0;
				for (b = 0; b < n; b++) {
					var s = 0;
					for (i = 0; i < m; i++) { s += J[a][i] * J[b][i]; }
					row.push(a === b ? s * (1 + lambda) : s);
				}
				for (i = 0; i < m; i++) { g += J[a][i] * cur.R[i]; }
				row.push(-g); A.push(row);
			}
			for (a = 0; a < n; a++) {
				var pv = a;
				for (b = a + 1; b < n; b++) { if (Math.abs(A[b][a]) > Math.abs(A[pv][a])) { pv = b; } }
				var tmp = A[a]; A[a] = A[pv]; A[pv] = tmp;
				for (b = a + 1; b < n; b++) {
					var q = A[b][a] / A[a][a];
					for (i = a; i <= n; i++) { A[b][i] -= q * A[a][i]; }
				}
			}
			var d = [];
			for (a = n - 1; a >= 0; a--) {
				var acc = A[a][n];
				for (b = a + 1; b < n; b++) { acc -= A[a][b] * d[b]; }
				d[a] = acc / A[a][a];
			}
			var scale = 1;
			for (a = 0; a < n; a++) { scale = Math.min(scale, cap[a] / Math.abs(d[a] || 1e-30)); }
			var xt = x.map(function (v, q) { return v + scale * d[q]; });
			var rt = d.every(isFinite) ? fn(xt) : null;
			if (rt && rt.norm < cur.norm) { next = { x: xt, res: rt }; lambda = Math.max(1e-9, lambda / 4); }
			else { lambda *= 8; }
		}
		if (!next) { break; }
		var gained = cur.norm - next.res.norm;
		x = next.x; cur = next.res;
		if (gained < 1e-4 * cur.norm) { break; }       // as far as the arithmetic can tell them apart
	}
	return { x: x, res: cur };
}

