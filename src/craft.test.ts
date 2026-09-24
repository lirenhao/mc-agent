import assert from "node:assert/strict";
import test from "node:test";
import { nextCraftAction, parseCraftRequest } from "./craft.js";

test("craft requests name the item, and a bare table is the crafting table", () => {
  assert.deepEqual(parseCraftRequest("用工作台做一个箱子"), { item: "chest", label: "箱子" });
  assert.deepEqual(parseCraftRequest("做一把木镐"), { item: "wooden_pickaxe", label: "木镐" });
  assert.deepEqual(parseCraftRequest("去工作台"), { item: "crafting_table", label: "工作台" });
  assert.equal(parseCraftRequest("跟着我"), undefined);
});

test("a pickaxe is prepared from logs, then a table, then crafted on it", () => {
  assert.deepEqual(nextCraftAction({ item: "wooden_pickaxe", have: { oak_log: 3 }, tableNearby: false, holdingTable: false }), {
    kind: "craft",
    item: "oak_planks",
    label: "木板",
    needsTable: false,
  });
  const withPlanks = nextCraftAction({
    item: "wooden_pickaxe",
    have: { oak_planks: 4 },
    tableNearby: false,
    holdingTable: false,
  });
  assert.deepEqual(withPlanks, { kind: "craft", item: "crafting_table", label: "工作台", needsTable: false });
  assert.equal(nextCraftAction({
    item: "wooden_pickaxe",
    have: { oak_planks: 8, stick: 2, crafting_table: 1 },
    tableNearby: false,
    holdingTable: true,
  }).kind, "place-table");
  assert.deepEqual(nextCraftAction({
    item: "wooden_pickaxe",
    have: { oak_planks: 3, stick: 2 },
    tableNearby: true,
    holdingTable: false,
  }), { kind: "craft", item: "wooden_pickaxe", label: "木镐", needsTable: true });
});

test("a chest without wood says wood is missing", () => {
  assert.deepEqual(nextCraftAction({ item: "chest", have: {}, tableNearby: true, holdingTable: false }), { kind: "missing", label: "木头" });
});
