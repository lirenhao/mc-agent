export type SkillName = "follow" | "find_resource" | "protect" | "build" | "stop" | "status" | "clarify";
export type ResourceName = "wood" | "stone" | "coal" | "iron";
export type BuildTemplate = "cabin" | "farm" | "camp";

export type Task = {
  skill: SkillName;
  resource?: ResourceName;
  template?: BuildTemplate;
  reply: string;
};

export type WorldState = {
  health: number;
  food: number;
  position: { x: number; y: number; z: number };
  time: "day" | "night";
  nearbyPlayers: string[];
  hostiles: Array<{ name: string; distance: number }>;
};
