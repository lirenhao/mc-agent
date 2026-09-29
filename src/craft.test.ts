import assert from "node:assert/strict";
import test from "node:test";
import { nextCraftAction, parseCraftRequest } from "./craft.js";

test("craft requests name the item, and a bare table means use one", () => {
  assert.deepEqual(parseCraftRequest("用工作台做一个箱子"), { item: "chest", label: "箱子" });
  assert.deepEqual(parseCraftRequest("做一把木镐"), { item: "wooden_pickaxe", label: "木镐" });
  assert.deepEqual(parseCraftRequest("去工作台"), { item: "use_table", label: "工作台" });
  assert.equal(parseCraftRequest("跟着我"), undefined);
});

test("table recipes use a nearby table and never craft one", () => {
  assert.deepEqual(nextCraftAction({ item: "wooden_pickaxe", have: { oak_log: 3 }, tableNearby: false }), { kind: "need-table" });
  assert.deepEqual(nextCraftAction({ item: "use_table", have: {}, tableNearby: true }), { kind: "use-table" });
  assert.deepEqual(nextCraftAction({ item: "use_table", have: { crafting_table: 1 }, tableNearby: false }), { kind: "need-table" });
  assert.deepEqual(nextCraftAction({ item: "wooden_pickaxe", have: { oak_log: 3 }, tableNearby: true }), {
    kind: "craft",
    item: "oak_planks",
    label: "木板",
    needsTable: false,
  });
  assert.deepEqual(nextCraftAction({
    item: "wooden_pickaxe",
    have: { oak_planks: 3, stick: 2 },
    tableNearby: true,
  }), { kind: "craft", item: "wooden_pickaxe", label: "木镐", needsTable: true });
});

test("a chest without wood says wood is missing", () => {
  assert.deepEqual(nextCraftAction({ item: "chest", have: {}, tableNearby: true }), { kind: "missing", label: "木头" });
});
