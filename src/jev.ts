import { config } from "./config.js";
import type { SkillName, Task, WorldState } from "./types.js";

const allowed: SkillName[] = ["follow", "find_resource", "protect", "build", "stop", "status", "clarify"];

/** Jev is the final action gate, never a source of executable game commands. */
export async function chooseAction(task: Task, state: WorldState): Promise<SkillName> {
  if (!config.jev.apiKey) return safeRule(task, state);
  try {
    const response = await fetch(config.jev.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.jev.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        state: JSON.stringify({ task, state, policy: "只选择允许动作；危险、歧义或低血量时优先 stop、protect 或 clarify。" }),
        questions: {
          next_action: { type: "choice", options: allowed },
        },
      }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Jev ${response.status}`);
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
  const strings: string[] = [];
  const numbers: Array<{ key: string; value: number }> = [];
  const walk = (node: unknown, key = ""): void => {
    if (typeof node === "string") strings.push(node.toLowerCase());
    else if (typeof node === "number" && Number.isFinite(node)) numbers.push({ key: key.toLowerCase(), value: node });
    else if (Array.isArray(node)) node.forEach((item) => walk(item));
    else if (node && typeof node === "object") Object.entries(node).forEach(([childKey, child]) => walk(child, childKey));
  };
  walk(value);
  const action = allowed.find((item) => strings.some((text) => text === item || text.includes(`\"${item}\"`)));
  const confidence = numbers.find((item) => /(confidence|probability|prob)/.test(item.key))?.value ?? 0;
  return { action, confidence };
}
