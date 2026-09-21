export type SkillName = "follow" | "find_resource" | "protect" | "build" | "stop" | "status" | "clarify";
export type ResourceName = "wood" | "stone" | "coal" | "iron";
export type BuildTemplate = "cabin" | "farm" | "camp";

export const SKILL_NAMES: SkillName[] = ["follow", "find_resource", "protect", "build", "stop", "status", "clarify"];

export const DEFAULT_CRITERIA: Record<SkillName, string> = {
  follow: "孩子要机器人持续跟随。",
  find_resource: "带孩子前往附近的木头、石头、煤或铁；发现后一起采。",
  protect: "附近有怪物或孩子要求保护；苦力怕和低血量时撤离而不是硬刚。",
  build: "在空地按模板放置背包里的材料，不覆盖已有方块。",
  stop: "立即停止寻路和保护循环。",
  status: "只报告生命、饥饿和附近威胁，不采取其他动作。",
  clarify: "指令不清、材料不够或情况危险时澄清，不执行动作。",
};

/** 大模型提出的可执行意图。type 不设白名单，执行器按能力落地。 */
export type ActionIntent = {
  type: string;
  block?: string;
  entity?: string;
  item?: string;
  count?: number;
  template?: string;
  x?: number;
  y?: number;
  z?: number;
  label?: string;
};

export type Task = {
  skill: string;
  resource?: ResourceName;
  template?: BuildTemplate;
  reply: string;
  /** Jev 候选动作。由大模型自由命名；仅超时时退回 DEFAULT_CRITERIA。 */
  criteria: Record<string, string>;
  intents: Record<string, ActionIntent>;
};

export type WorldState = {
  health: number;
  food: number;
  position: { x: number; y: number; z: number };
  time: "day" | "night";
  nearbyPlayers: string[];
  hostiles: Array<{ name: string; distance: number }>;
  inventory: string[];
};
