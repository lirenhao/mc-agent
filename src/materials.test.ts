import assert from "node:assert/strict";
import test from "node:test";
import { buildReply, prepareTaskSteps, templateBlocks } from "./materials.js";
import type { ActionIntent } from "./types.js";

const cabin: ActionIntent[] = [
  { type: "collect", block: "wood", count: 8, label: "木头" },
  { type: "come" },
  { type: "build", template: "cabin", label: "小木屋" },
];

test("the cabin is a hut with a door, walls, and a roof", () => {
  const placed = (x: number, y: number, z: number) => templateBlocks.cabin.some((block) => block.dx === x && block.dy === y && block.dz === z);
  assert.equal(placed(0, 0, 1), false);
  assert.equal(placed(0, 1, 1), false);
  assert.equal(placed(0, 2, 1), true);
  assert.equal(placed(1, 0, 1), true);
  assert.equal(placed(1, 3, 1), true);
  assert.equal(templateBlocks.cabin.find((block) => block.dx === 0 && block.dz === 0 && block.dy === 0)?.names[0], "oak_log");
});

test("a cabin uses planks and logs already in the inventory", () => {
  const ready = prepareTaskSteps(cabin, { oak_planks: 41, oak_log: 12 });
  assert.deepEqual(ready.map((step) => step.type), ["build"]);
  assert.equal(buildReply(ready, "好，我来盖小木屋。"), "背包里的材料够了，我直接盖。");

  const logsOnly = prepareTaskSteps(cabin, { oak_log: 23 });
  assert.deepEqual(logsOnly.map((step) => step.type), ["craft", "build"]);
  assert.equal(logsOnly[0].item, "oak_planks");

  const empty = prepareTaskSteps(cabin, {});
  assert.equal(empty[0].type, "collect");
  assert.equal(empty[0].block, "oak_log");
  assert.equal(empty[0].count, 23);
  assert.equal(empty[1].type, "craft");
  assert.equal(empty[2].type, "build");
});
