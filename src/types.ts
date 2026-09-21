export type SkillName = "follow" | "find_resource" | "protect" | "build" | "stop" | "status" | "clarify";
export type ResourceName = "wood" | "stone" | "coal" | "iron";
export type BuildTemplate = "cabin" | "farm" | "camp";
export type MissionMode = "focused" | "follow" | "guard" | "idle" | "stop";

export const SKILL_NAMES: SkillName[] = ["follow", "find_resource", "protect", "build", "stop", "status", "clarify"];

export const DEFAULT_CRITERIA: Record<SkillName, string> = {
  follow: "孩子要机器人持续跟随。",
  find_resource: "带孩子前往附近的木头、石头、煤或铁并采集。",
  protect: "附近有怪物或孩子要求保护。",
  build: "在空地按模板放置背包材料，不覆盖已有方块。",
  stop: "立即停止当前任务，留在原地。",
  status: "只报告生命、饥饿、任务进度和附近威胁。",
  clarify: "指令不清时澄清，不执行新任务。",
};

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

export type MissionBlueprint = {
  mode: MissionMode;
  title?: string;
  steps: ActionIntent[];
};

export type Plan = {
  skill: string;
  resource?: ResourceName;
  template?: BuildTemplate;
  reply: string;
  criteria: Record<string, string>;
  missions: Record<string, MissionBlueprint>;
};

export type Mission = {
  id: string;
  title: string;
  reply: string;
  mode: MissionMode;
  steps: ActionIntent[];
  stepIndex: number;
  startedAt: number;
  lastProgressAt: number;
  baseCount: number;
};

export type StepResult = {
  status: "done" | "progress" | "blocked";
  message?: string;
};

export type WorldState = {
  health: number;
  food: number;
  position: { x: number; y: number; z: number };
  time: "day" | "night";
  nearbyPlayers: string[];
  hostiles: Array<{ name: string; distance: number }>;
  inventory: string[];
  childVisible: boolean;
  childDistance?: number;
  mission?: { title: string; step: number; total: number; current?: string };
};
