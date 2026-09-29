import assert from "node:assert/strict";
import test from "node:test";
import { sparTarget } from "./task-planner.js";

test("sparring targets the child, and villagers are a separate target", () => {
  assert.equal(sparTarget("跟我对战"), "player");
  assert.equal(sparTarget("打我"), "player");
  assert.equal(sparTarget("攻击村民"), "villager");
  assert.equal(sparTarget("打村民"), "villager");
  assert.equal(sparTarget("跟着我"), undefined);
  assert.equal(sparTarget("打僵尸"), undefined);
  assert.equal(sparTarget("打僵尸村民"), undefined);
});
