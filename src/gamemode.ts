export type GameModeName = "survival" | "creative" | "adventure" | "spectator";

const MODES: Array<{ pattern: RegExp; mode: GameModeName; label: string }> = [
  { pattern: /旁观|spectator/i, mode: "spectator", label: "旁观" },
  { pattern: /冒险|adventure/i, mode: "adventure", label: "冒险" },
  { pattern: /创造|creative/i, mode: "creative", label: "创造" },
  { pattern: /生存|survival/i, mode: "survival", label: "生存" },
];

export function parseGameMode(text: string): { mode: GameModeName; label: string; target: "self" | "child" } | "ask" | undefined {
  const named = MODES.find((entry) => entry.pattern.test(text));
  const asks = /模式|切换|改成|换成|调成|gamemode/i.test(text);
  const only = /^(请)?(你|机器人)?(帮我)?(切换|改成|换成|调成)?(到|成)?(生存|创造|冒险|旁观)(模式)?[。！!]?$/.test(text.trim());
  if (/切换模式|改模式|换模式/.test(text) && !named) return "ask";
  if (!named || (!asks && !only)) return undefined;
  const target = /把我|给我|我的模式|帮我/.test(text) ? "child" : "self";
  return { mode: named.mode, label: named.label, target };
}
