// Node tests for Shared/date-format.js. Run from the repo root:
//   node --test Website/Shared/tests/date-format.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { OrbitalMath as O } from "../math-utils.js";
import { dateYM, dateYMD, dateYMDH, dateYMDHM, dateISO, parseDateYMDH } from "../date-format.js";

test("formats year first, with the hour as h0–h23", function () {
	var jd = O.julianDate(2080, 3, 14, 7, 30, 0);
	assert.equal(dateYM(jd), "2080/03");
	assert.equal(dateYMD(jd), "2080/03/14");
	assert.equal(dateYMDH(jd), "2080/03/14 h7");
	assert.equal(dateYMDHM(jd), "2080/03/14 07:30");
	assert.equal(dateISO(jd), "2080-03-14");
	assert.equal(dateYMDH(O.julianDate(2080, 1, 1, 0)), "2080/01/01 h0");
	assert.equal(dateYMDH(O.julianDate(2080, 12, 31, 23, 59, 59)), "2080/12/31 h23");
});

test("an exact hour never shows as the hour before", function () {
	for (var Y = 2030; Y <= 2130; Y += 7) {
		for (var h = 0; h < 24; h++) {
			assert.equal(dateYMDH(O.julianDate(Y, 6, 15, h)), Y + "/06/15 h" + h);
		}
	}
});

test("parses the shown form and its looser spellings", function () {
	var jd7 = O.julianDate(2080, 3, 14, 7);
	["2080/03/14 h7", "2080/3/14 h7", "2080/03/14h7", "2080-03-14 7", "2080.03.14 7h", " 2080 3 14 H07 "]
		.forEach(function (s) { assert.equal(parseDateYMDH(s), jd7, s); });
	assert.equal(parseDateYMDH("2080/03/14"), O.julianDate(2080, 3, 14, 0));
	assert.equal(parseDateYMDH(dateYMDH(jd7)), jd7);
});

test("rejects what isn't a real date or hour", function () {
	["", "2080/13/01", "2080/02/30", "2081/02/29", "2080/03/14 h24", "14/03/2080", "2080/03", "soon"]
		.forEach(function (s) { assert.ok(Number.isNaN(parseDateYMDH(s)), s); });
	assert.ok(!Number.isNaN(parseDateYMDH("2080/02/29")));   // a leap year
});
