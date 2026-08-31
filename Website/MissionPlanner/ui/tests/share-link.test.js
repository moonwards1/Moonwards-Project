// Node tests for ui/share-link.js: the mission-link envelope and
// the paste-side fragment extractor. Run from the repo root:
//   node --test Website/MissionPlanner/ui/tests/share-link.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
	packMissionLink, unpackMissionLink, missionFragmentFrom,
	MISSION_LINK_KIND, MISSION_LINK_VERSION
} from "../share-link.js";
import { encodeFragment, decodeFragment } from "../../../Shared/exchange.js";

var worldData = { kind: "moonwards-world", version: 1, jd: 2463220.75, nextStage: 2, stages: [] };

test("pack -> fragment-encode -> decode -> unpack round-trips title and world", () => {
	var frag = encodeFragment(packMissionLink("Earth → Ceres 2031", worldData));
	var u = unpackMissionLink(decodeFragment(frag));
	assert.equal(u.ok, true);
	assert.equal(u.title, "Earth → Ceres 2031");
	assert.deepEqual(u.world, worldData);
});

test("pack: blank/missing titles become null", () => {
	assert.equal(packMissionLink("   ", worldData).title, null);
	assert.equal(packMissionLink(undefined, worldData).title, null);
	assert.equal(packMissionLink("  Mission X ", worldData).title, "Mission X");
});

test("unpack: accepts a bare serialized World (no envelope), title null", () => {
	var u = unpackMissionLink(worldData);
	assert.equal(u.ok, true);
	assert.equal(u.title, null);
	assert.deepEqual(u.world, worldData);
});

test("unpack: refuses garbage, wrong kinds, and missing world", () => {
	assert.equal(unpackMissionLink(null).ok, false);
	assert.equal(unpackMissionLink("nope").ok, false);
	assert.equal(unpackMissionLink({ kind: "something-else" }).ok, false);
	assert.equal(unpackMissionLink({ kind: MISSION_LINK_KIND, version: 1 }).ok, false);
});

test("unpack: refuses a newer link-format version politely", () => {
	var u = unpackMissionLink({ kind: MISSION_LINK_KIND, version: MISSION_LINK_VERSION + 1, world: worldData });
	assert.equal(u.ok, false);
	assert.match(u.reason, /newer/);
});

test("missionFragmentFrom: full URL, bare fragment, and hash tail all resolve", () => {
	var frag = encodeFragment(packMissionLink("T", worldData));
	assert.equal(missionFragmentFrom("http://x.test/planner.html#mission=" + frag), frag);
	assert.equal(missionFragmentFrom("#mission=" + frag), frag);
	assert.equal(missionFragmentFrom("  " + frag + "  "), frag);   // bare blob, padded
});

test("missionFragmentFrom: rejects non-links", () => {
	assert.equal(missionFragmentFrom("hello"), null);              // too short for a bare blob
	assert.equal(missionFragmentFrom("not a link at all"), null);  // spaces break the blob form
	assert.equal(missionFragmentFrom(""), null);
	assert.equal(missionFragmentFrom(undefined), null);
});

test("missionFragmentFrom: survives Notepad/messaging-app reflow of a pasted link", () => {
	// Notepad and chat apps routinely reflow a long pasted token: real
	// newlines inserted at wrap points, or invisible zero-width characters
	// spliced in so it CAN wrap without a visible break. Neither should
	// break a paste of a real mission link.
	var frag = encodeFragment(packMissionLink("T", worldData));
	var mid = Math.floor(frag.length / 2);
	var withNewline = frag.slice(0, mid) + "\n" + frag.slice(mid);
	var withZeroWidth = frag.slice(0, mid) + "\u200B" + frag.slice(mid);

	// "#mission=" form: reflow noise (and stray trailing punctuation) is
	// filtered out because the marker anchors the rest as link content.
	assert.equal(missionFragmentFrom("https://x.test/planner.html#mission=" + withNewline), frag);
	assert.equal(missionFragmentFrom("https://x.test/planner.html#mission=" + withZeroWidth), frag);
	assert.equal(missionFragmentFrom("https://x.test/planner.html#mission=" + frag + "."), frag);

	// Bare-blob form: newlines and zero-width chars are unambiguous wrap
	// artifacts and get stripped too.
	assert.equal(missionFragmentFrom(withNewline), frag);
	assert.equal(missionFragmentFrom(withZeroWidth), frag);
});

// ---- v2: the two plan sets, and the compressed fragment -------------------

import { encodeFragmentZ, decodeFragmentAny } from "../../../Shared/exchange.js";
import { createHistory, recordUpdate, packSets, readSets, latestOf } from "../../core/revisions.js";
import { defaultMission } from "../../presets/default-mission.js";

test("v2 pack carries the plan sets; unpack hands them back", () => {
	var h = recordUpdate(createHistory({ kind: "moonwards-world", a: 1 }), { kind: "moonwards-world", a: 2 });
	var u = unpackMissionLink(packMissionLink("T", worldData, packSets(h)));
	assert.equal(u.ok, true);
	assert.deepEqual(u.plan.original, { kind: "moonwards-world", a: 1 });
	assert.deepEqual(u.plan.latest.world, { kind: "moonwards-world", a: 2 });
	// `world` is what opens in a tab and stays independent of the sets.
	assert.deepEqual(u.world, worldData);
});

test("a mission never updated packs no plan sets, and unpacks to plan null", () => {
	var payload = packMissionLink("T", worldData, packSets(createHistory(worldData)));
	var u = unpackMissionLink(payload);
	assert.equal(u.ok, true);
	assert.equal(u.plan.latest, null);
	assert.equal(latestOf(readSets(u.plan)), null);
});

test("unpack: a v1 envelope still loads, with no plan", () => {
	var v1 = { kind: MISSION_LINK_KIND, version: 1, title: "Old link", world: worldData };
	var u = unpackMissionLink(v1);
	assert.equal(u.ok, true);
	assert.equal(u.title, "Old link");
	assert.equal(u.plan, null);
});

test("unpack: a bare serialized World reports plan null rather than undefined", () => {
	assert.equal(unpackMissionLink(worldData).plan, null);
});

test("unpack: a link from a newer format is refused politely", () => {
	var future = { kind: MISSION_LINK_KIND, version: MISSION_LINK_VERSION + 1, world: worldData };
	var u = unpackMissionLink(future);
	assert.equal(u.ok, false);
	assert.match(u.reason, /newer than this page understands/);
});

test("a compressed fragment round-trips, and the plain one still reads", async () => {
	var payload = packMissionLink("T", worldData, packSets(createHistory(worldData)));
	var z = await encodeFragmentZ(payload);
	assert.equal(z.charAt(0), "z");
	assert.deepEqual(await decodeFragmentAny(z), payload);
	assert.deepEqual(await decodeFragmentAny(encodeFragment(payload)), payload);
});

test("compression is what keeps a two-set link inside a chat message", async () => {
	// A Discord message stops at 2,000 characters, and a mission link is
	// pasted into one as often as into a browser.
	var h = recordUpdate(createHistory(defaultMission), defaultMission);
	var payload = packMissionLink("Moon → Ceres 2031", defaultMission, packSets(h));
	assert.ok(encodeFragment(payload).length > 2000, "two sets do NOT fit uncompressed");
	assert.ok((await encodeFragmentZ(payload)).length < 2000, "two sets fit compressed");
});

test("missionFragmentFrom carries the compression marker through reflow", async () => {
	var z = await encodeFragmentZ(packMissionLink("T", worldData, null));
	var mid = Math.floor(z.length / 2);
	assert.equal(missionFragmentFrom("https://x.test/planner.html#mission=" + z), z);
	assert.equal(missionFragmentFrom(z.slice(0, mid) + "\n" + z.slice(mid)), z);
	assert.equal(missionFragmentFrom(z.slice(0, mid) + "\u200B" + z.slice(mid)), z);
});
