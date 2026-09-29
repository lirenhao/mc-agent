export type StorageMode = "deposit" | "withdraw";

export type StorageRequest = {
  mode: StorageMode;
  item?: string;
  label: string;
};

const NAMED: Array<{ pattern: RegExp; id: string; label: string; names: string[] }> = [
  { pattern: /木头|原木/, id: "oak_log", label: "木头", names: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"] },
  { pattern: /木板/, id: "oak_planks", label: "木板", names: ["oak_planks", "birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks"] },
  { pattern: /木棍|棍子/, id: "stick", label: "木棍", names: ["stick"] },
  { pattern: /圆石/, id: "cobblestone", label: "圆石", names: ["cobblestone", "cobbled_deepslate"] },
  { pattern: /石头/, id: "cobblestone", label: "石头", names: ["cobblestone", "cobbled_deepslate"] },
  { pattern: /煤炭|木炭|煤/, id: "coal", label: "煤", names: ["coal", "charcoal"] },
  { pattern: /铁锭/, id: "iron_ingot", label: "铁锭", names: ["iron_ingot"] },
  { pattern: /火把/, id: "torch", label: "火把", names: ["torch"] },
  { pattern: /木镐/, id: "wooden_pickaxe", label: "木镐", names: ["wooden_pickaxe"] },
  { pattern: /工作台/, id: "crafting_table", label: "工作台", names: ["crafting_table"] },
];

export function parseStorageRequest(text: string): StorageRequest | undefined {
  const depositAt = text.search(/放进箱子|放到箱子|放入箱子|存进箱子|存到箱子|存入箱子|装进箱子/);
  const withdrawAt = text.search(/从箱子里?拿|从箱子里?取|箱子里拿|箱子里取/);
  if (depositAt < 0 && withdrawAt < 0) return undefined;
  const mode: StorageMode = withdrawAt >= 0 && (depositAt < 0 || withdrawAt < depositAt) ? "withdraw" : "deposit";
  const named = NAMED.find((item) => item.pattern.test(text.replace(/箱子/g, "")));
  return {
    mode,
    ...(named ? { item: named.id } : {}),
    label: named?.label ?? (mode === "deposit" ? "背包里的东西" : "箱子里的东西"),
  };
}

export function storageLabel(mode: StorageMode, item?: string): string {
  if (!item) return mode === "deposit" ? "背包里的东西" : "箱子里的东西";
  return NAMED.find((entry) => entry.id === item)?.label ?? "东西";
}

export function storageNames(item?: string): string[] | undefined {
  if (!item) return undefined;
  return NAMED.find((entry) => entry.id === item)?.names ?? [item];
}
