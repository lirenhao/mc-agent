import assert from "node:assert/strict";
import test from "node:test";
import { chooseHarvestTool } from "./tools.js";

test("mining picks the best tool that can actually harvest the block", () => {
  const stone = chooseHarvestTool({
    blockName: "stone",
    tools: ["wooden_pickaxe", "iron_pickaxe", "iron_sword"],
    canHarvest: (name) => name.endsWith("_pickaxe"),
    handCanHarvest: false,
  });
  assert.deepEqual(stone, { name: "iron_pickaxe" });

  const logs = chooseHarvestTool({
    blockName: "oak_log",
    tools: ["wooden_axe", "stone_pickaxe"],
    canHarvest: () => true,
    handCanHarvest: false,
  });
  assert.deepEqual(logs, { name: "wooden_axe" });

  const dirt = chooseHarvestTool({
    blockName: "dirt",
    tools: ["wooden_pickaxe"],
    canHarvest: () => true,
    handCanHarvest: true,
  });
  assert.deepEqual(dirt, {});

  const ore = chooseHarvestTool({
    blockName: "iron_ore",
    tools: ["wooden_pickaxe"],
    canHarvest: () => false,
    handCanHarvest: false,
  });
  assert.deepEqual(ore, { missing: "镐" });
});
