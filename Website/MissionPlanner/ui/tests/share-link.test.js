// Node tests for ui/share-link.js (task E2): the mission-link envelope and
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

test("unpack: accepts a pre-E2 bare serialized World, title null", () => {
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
