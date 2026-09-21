import { config } from "./config.js";
import type { SkillName, Task, WorldState } from "./types.js";

const allowed: SkillName[] = ["follow", "find_resource", "protect", "build", "stop", "status", "clarify"];

const criteria: Record<SkillName, string> = {
  follow: "孩子要机器人持续跟随。",
  find_resource: "带孩子前往附近的木头、石头、煤或铁；发现后一起采。",
  protect: "附近有怪物或孩子要求保护；苦力怕和低血量时撤离而不是硬刚。",
  build: "在空地按模板放置背包里的材料，不覆盖已有方块。",
  stop: "立即停止寻路和保护循环。",
  status: "只报告生命、饥饿和附近威胁，不采取其他动作。",
  clarify: "指令不清、材料不够或情况危险时澄清，不执行动作。",
};

/** Jev is the final action gate, never a source of executable game commands. */
export async function chooseAction(task: Task, state: WorldState): Promise<SkillName> {
  if (!config.jev.apiKey) return safeRule(task, state);
  try {
    const response = await fetch(config.jev.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.jev.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.jev.model,
        state: {
          task,
          world: state,
          policy: "只选择允许动作；危险、歧义或低血量时优先 stop、protect 或 clarify。",
        },
        questions: {
          next_action: {
            type: "choice",
            instructions: "根据孩子的任务和当前世界，只选择一个允许的下一步动作。",
            criteria,
          },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Jev ${response.status}: ${detail.slice(0, 500)}`);
    }
    const parsed = extractDecision(await response.json());
    if (!parsed.action || parsed.confidence < config.jev.minConfidence) return "clarify";
    return parsed.action;
  } catch (error) {
    console.error("Jev 决策失败，使用安全规则：", error);
    return safeRule(task, state);
  }
}

function safeRule(task: Task, state: WorldState): SkillName {
  if (state.health <= 6 && state.hostiles.some((hostile) => hostile.distance < 12)) return "protect";
  return task.skill;
}

function extractDecision(value: unknown): { action?: SkillName; confidence: number } {
  if (!value || typeof value !== "object") return { confidence: 0 };
  const answers = (value as { answers?: Record<string, unknown> }).answers;
  const next = answers?.next_action;
  if (!next || typeof next !== "object") return { confidence: 0 };
  const choice = (next as { choice?: unknown }).choice;
  const confidence = Number((next as { confidence?: unknown }).confidence);
  return {
    action: typeof choice === "string" && allowed.includes(choice as SkillName) ? choice as SkillName : undefined,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}
