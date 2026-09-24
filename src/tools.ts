export type HarvestChoice = { name?: string; missing?: string };

const TIERS = ["netherite", "diamond", "iron", "stone", "golden", "wooden"];

export function toolKindFor(blockName: string): "pickaxe" | "axe" | "shovel" | "hoe" | "shears" | undefined {
  if (/_log$|_wood$|_stem$|hyphae|bamboo_block/.test(blockName)) return "axe";
  if (/dirt|sand|gravel|clay|snow|soul_sand|soul_soil|mud|farmland|grass_block|podzol|mycelium/.test(blockName)) return "shovel";
  if (/leaves|wool|cobweb/.test(blockName)) return "shears";
  if (/hay_block|sponge|shroomlight|moss_block/.test(blockName)) return "hoe";
  if (/ore$|stone|deepslate|netherrack|blackstone|cobbled|obsidian|andesite|diorite|granite|tuff|calcite|basalt|nylium|ancient_debris|amethyst|block$|bricks|terracotta|concrete|prismarine|end_stone|purpur|quartz/.test(blockName)) return "pickaxe";
  return undefined;
}

export function chooseHarvestTool(input: {
  blockName: string;
  tools: string[];
  canHarvest: (toolName: string) => boolean;
  handCanHarvest: boolean;
}): HarvestChoice {
  const kind = toolKindFor(input.blockName);
  const usable = input.tools.filter((name) => input.canHarvest(name) && isTool(name));
  const preferred = kind ? usable.filter((name) => matchesKind(name, kind)) : usable;
  const best = [...preferred].sort((a, b) => toolRank(a) - toolRank(b))[0];
  if (best) return { name: best };
  if (input.handCanHarvest && !kind) return {};
  if (input.handCanHarvest && kind === "shovel") return {};
  return { missing: kindLabel(kind) };
}

function isTool(name: string): boolean {
  return /_(pickaxe|axe|shovel|hoe)$/.test(name) || name === "shears";
}

function matchesKind(name: string, kind: string): boolean {
  return kind === "shears" ? name === "shears" : name.endsWith(`_${kind}`);
}

function toolRank(name: string): number {
  const tier = TIERS.findIndex((prefix) => name.startsWith(`${prefix}_`));
  return tier === -1 ? TIERS.length : tier;
}

function kindLabel(kind: ReturnType<typeof toolKindFor>): string {
  if (kind === "pickaxe") return "镐";
  if (kind === "axe") return "斧头";
  if (kind === "shovel") return "铲子";
  if (kind === "hoe") return "锄头";
  if (kind === "shears") return "剪刀";
  return "工具";
}
