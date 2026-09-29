import assert from "node:assert/strict";
import test from "node:test";
import { doorIsClosed, isDoorRequest, isToggleDoor } from "./doors.js";

test("wooden doors can be opened, iron doors cannot", () => {
  assert.equal(isToggleDoor("oak_door"), true);
  assert.equal(isToggleDoor("spruce_fence_gate"), true);
  assert.equal(isToggleDoor("oak_trapdoor"), true);
  assert.equal(isToggleDoor("iron_door"), false);
  assert.equal(isToggleDoor("oak_planks"), false);
  assert.equal(doorIsClosed(false), true);
  assert.equal(doorIsClosed(true), false);
});

test("opening a door is not a request to craft one", () => {
  assert.equal(isDoorRequest("开门"), true);
  assert.equal(isDoorRequest("打开面前的门"), true);
  assert.equal(isDoorRequest("做一扇木门"), false);
});
