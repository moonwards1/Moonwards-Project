// A polyline drawn a fixed number of PIXELS wide, whatever the zoom.
//
// WebGL draws THREE.Line one pixel wide on every platform (linewidth is
// ignored), so a thick line has to be triangles. Each path point becomes two
// vertices, one either side of the line; the vertex shader pushes them apart
// along the screen-space normal, so the width is in pixels and the strip
// always faces the camera. Used for highlights that a 1 px line can't carry
// (the Mission Planner tutorial's trajectory flash).
//
// THREE is the page's global (Shared/three.min.js); only makeScreenLine
// touches it, so screenLineAttributes stays Node-testable.

// The strip's vertex data for points [[x,y,z], ...]: two vertices per point
// (side -1 and +1), each carrying its point, the previous one and the next
// one (an end repeats itself), plus the two triangles joining each pair of
// points to the next.
export function screenLineAttributes(points) {
	var n = points.length;
	var pos = new Float32Array(n * 6), prev = new Float32Array(n * 6), next = new Float32Array(n * 6);
	var side = new Float32Array(n * 2);
	var index = [];
	for (var i = 0; i < n; i++) {
		var p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
		for (var s = 0; s < 2; s++) {
			var o = (i * 2 + s) * 3;
			pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
			prev[o] = a[0]; prev[o + 1] = a[1]; prev[o + 2] = a[2];
			next[o] = b[0]; next[o + 1] = b[1]; next[o + 2] = b[2];
			side[i * 2 + s] = s ? 1 : -1;
		}
		if (i < n - 1) {
			var v = i * 2;
			index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
		}
	}
	return { position: pos, prev: prev, next: next, side: side, index: index };
}

var VERTEX = [
	"attribute vec3 prevP;",
	"attribute vec3 nextP;",
	"attribute float side;",
	"uniform vec2 resolution;",
	"uniform float widthPx;",
	"vec2 toPx(vec4 c) { return c.xy / c.w * resolution * 0.5; }",
	"void main() {",
	"	mat4 m = projectionMatrix * modelViewMatrix;",
	"	vec4 c = m * vec4(position, 1.0);",
	"	vec2 cs = toPx(c);",
	"	vec2 a = cs - toPx(m * vec4(prevP, 1.0));",
	"	vec2 b = toPx(m * vec4(nextP, 1.0)) - cs;",
	"	vec2 dir = vec2(1.0, 0.0);",
	"	if (length(a) > 1e-4 && length(b) > 1e-4) { dir = normalize(normalize(a) + normalize(b) + 1e-6); }",
	"	else if (length(b) > 1e-4) { dir = normalize(b); }",
	"	else if (length(a) > 1e-4) { dir = normalize(a); }",
	"	vec2 normal = vec2(-dir.y, dir.x);",
	"	c.xy += normal * side * widthPx / resolution * c.w;",
	"	gl_Position = c;",
	"}"
].join("\n");

var FRAGMENT = [
	"uniform vec3 color;",
	"uniform float opacity;",
	"void main() { gl_FragColor = vec4(color, opacity); }"
].join("\n");

// points: [[x,y,z], ...] in scene units. opts: { color (hex), widthPx,
// opacity, renderOrder }. Before each render, call
// line.setResolution(widthPx, heightPx) with the pane's size in CSS pixels;
// line.material.uniforms.opacity / widthPx / color can be changed any time.
export function makeScreenLine(points, opts) {
	opts = opts || {};
	var at = screenLineAttributes(points);
	var g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(at.position, 3));
	g.setAttribute("prevP", new THREE.BufferAttribute(at.prev, 3));
	g.setAttribute("nextP", new THREE.BufferAttribute(at.next, 3));
	g.setAttribute("side", new THREE.BufferAttribute(at.side, 1));
	g.setIndex(at.index);
	var mat = new THREE.ShaderMaterial({
		uniforms: {
			resolution: { value: new THREE.Vector2(1, 1) },
			widthPx: { value: opts.widthPx != null ? opts.widthPx : 4 },
			color: { value: new THREE.Color(opts.color != null ? opts.color : 0xffffff) },
			opacity: { value: opts.opacity != null ? opts.opacity : 1 }
		},
		vertexShader: VERTEX,
		fragmentShader: FRAGMENT,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		side: THREE.DoubleSide
	});
	var mesh = new THREE.Mesh(g, mat);
	mesh.frustumCulled = false;     // the strip's real extent is set in the shader
	mesh.renderOrder = opts.renderOrder || 0;
	mesh.setResolution = function (w, h) { mat.uniforms.resolution.value.set(w, h); };
	return mesh;
}
