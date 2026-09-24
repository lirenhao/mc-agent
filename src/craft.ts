export type CraftAction =
  | { kind: "craft"; item: string; label: string; needsTable: boolean }
  | { kind: "place-table" }
  | { kind: "done"; label: string }
  | { kind: "missing"; label: string };

type Ingredient = { item: string; count: number };

type CraftSpec = {
  item: string;
  label: string;
  needsTable: boolean;
  ingredients: Ingredient[];
  aliases: RegExp;
};

const LOGS = ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"];
const PLANKS = ["oak_planks", "birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"];

const CRAFTS: CraftSpec[] = [
  { item: "oak_planks", label: "木板", needsTable: false, ingredients: [{ item: "oak_log", count: 1 }], aliases: /木板/ },
  { item: "stick", label: "木棍", needsTable: false, ingredients: [{ item: "planks", count: 2 }], aliases: /木棍|棍子/ },
  { item: "crafting_table", label: "工作台", needsTable: false, ingredients: [{ item: "planks", count: 4 }], aliases: /工作台|合成台/ },
  { item: "chest", label: "箱子", needsTable: true, ingredients: [{ item: "planks", count: 8 }], aliases: /箱子/ },
  { item: "wooden_pickaxe", label: "木镐", needsTable: true, ingredients: [{ item: "planks", count: 3 }, { item: "stick", count: 2 }], aliases: /木镐/ },
  { item: "wooden_axe", label: "木斧", needsTable: true, ingredients: [{ item: "planks", count: 3 }, { item: "stick", count: 2 }], aliases: /木斧/ },
  { item: "wooden_sword", label: "木剑", needsTable: true, ingredients: [{ item: "planks", count: 2 }, { item: "stick", count: 1 }], aliases: /木剑/ },
  { item: "wooden_shovel", label: "木铲", needsTable: true, ingredients: [{ item: "planks", count: 1 }, { item: "stick", count: 2 }], aliases: /木铲/ },
  { item: "stone_pickaxe", label: "石镐", needsTable: true, ingredients: [{ item: "cobblestone", count: 3 }, { item: "stick", count: 2 }], aliases: /石镐/ },
  { item: "furnace", label: "熔炉", needsTable: true, ingredients: [{ item: "cobblestone", count: 8 }], aliases: /熔炉/ },
  { item: "torch", label: "火把", needsTable: false, ingredients: [{ item: "coal", count: 1 }, { item: "stick", count: 1 }], aliases: /火把/ },
  { item: "oak_door", label: "木门", needsTable: true, ingredients: [{ item: "planks", count: 6 }], aliases: /木门/ },
];

const GROUP_LABEL: Record<string, string> = {
  log: "木头",
  planks: "木板",
  stick: "木棍",
  coal: "煤或木炭",
  cobblestone: "圆石",
  oak_log: "橡木",
};

export function parseCraftRequest(text: string): { item: string; label: string } | undefined {
  if (!/(做|合成|制作|打造|工作台|合成台)/.test(text)) return undefined;
  const specific = CRAFTS.find((spec) => spec.item !== "crafting_table" && spec.aliases.test(text));
  if (specific) return { item: specific.item, label: specific.label };
  if (/(工作台|合成台)/.test(text)) return { item: "crafting_table", label: "工作台" };
  return undefined;
}

export function craftLabel(item: string): string {
  return specFor(item)?.label ?? item;
}

export function craftItemId(name: string): string | undefined {
  const text = name.trim();
  const found = CRAFTS.find((spec) => spec.item === text.toLowerCase() || spec.aliases.test(text));
  if (found) return found.item;
  const raw = text.toLowerCase().replace(/^minecraft:/, "");
  if (raw.endsWith("_planks") || CRAFTS.some((spec) => spec.item === raw)) return raw;
  return undefined;
}

export function isCraftItem(item: string): boolean {
  return Boolean(specFor(item));
}

export function nextCraftAction(options: {
  item: string;
  have: Record<string, number>;
  tableNearby: boolean;
  holdingTable: boolean;
}): CraftAction {
  return plan(options.item, options, 0);
}

function plan(item: string, options: { item: string; have: Record<string, number>; tableNearby: boolean; holdingTable: boolean }, depth: number): CraftAction {
  if (depth > 6) return { kind: "missing", label: "材料" };
  const spec = specFor(item);
  if (!spec) return { kind: "missing", label: GROUP_LABEL[item] ?? "材料" };
  if (options.item === "crafting_table" && item === "crafting_table" && options.tableNearby) {
    return { kind: "done", label: "工作台" };
  }
  if (spec.needsTable && !options.tableNearby) {
    if (options.holdingTable) return { kind: "place-table" };
    if (item !== "crafting_table") return plan("crafting_table", options, depth + 1);
  }
  for (const ingredient of spec.ingredients) {
    if (ingredient.item === "planks") {
      if (largest(PLANKS, options.have) >= ingredient.count) continue;
      const next = plankToCraft(options.have);
      if (!next) return { kind: "missing", label: "木头" };
      return plan(next, options, depth + 1);
    }
    if (haveGroup(options.have, ingredient.item) >= ingredient.count) continue;
    if (ingredient.item === "stick") return plan("stick", options, depth + 1);
    return { kind: "missing", label: GROUP_LABEL[ingredient.item] ?? "材料" };
  }
  return { kind: "craft", item: spec.item, label: spec.label, needsTable: spec.needsTable };
}

function specFor(item: string): CraftSpec | undefined {
  const found = CRAFTS.find((spec) => spec.item === item);
  if (found) return found;
  if (item.endsWith("_planks")) {
    return { item, label: "木板", needsTable: false, ingredients: [{ item: item.replace(/_planks$/, "_log"), count: 1 }], aliases: /$^/ };
  }
  return undefined;
}

function largest(names: string[], have: Record<string, number>): number {
  return names.reduce((best, name) => Math.max(best, have[name] ?? 0), 0);
}

function haveGroup(have: Record<string, number>, name: string): number {
  const names = name === "planks" ? PLANKS
    : name === "coal" ? ["coal", "charcoal"]
      : name === "cobblestone" ? ["cobblestone", "cobbled_deepslate"]
        : [name];
  return names.reduce((sum, item) => sum + (have[item] ?? 0), 0);
}

function plankToCraft(have: Record<string, number>): string | undefined {
  let best = "";
  let bestCount = 0;
  for (const name of PLANKS) {
    const count = have[name] ?? 0;
    const log = have[name.replace(/_planks$/, "_log")] ?? 0;
    if (count > bestCount && log > 0) {
      best = name;
      bestCount = count;
    }
  }
  if (best) return best;
  const log = LOGS.find((name) => (have[name] ?? 0) > 0);
  return log ? log.replace(/_log$/, "_planks") : undefined;
}
