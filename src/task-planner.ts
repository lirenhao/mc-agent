import { config } from "./config.js";
import type { BuildTemplate, ResourceName, SkillName, Task, WorldState } from "./types.js";

const skills: SkillName[] = ["follow", "find_resource", "protect", "build", "stop", "status", "clarify"];
const resources: ResourceName[] = ["wood", "stone", "coal", "iron"];
const templates: BuildTemplate[] = ["cabin", "farm", "camp"];

export async function planTask(transcript: string, state: WorldState): Promise<Task> {
  if (!config.llm.baseUrl || !config.llm.apiKey || !config.llm.model) return localPlan(transcript);
  try {
    const result = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.llm.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `你是 Minecraft 陪玩 ${config.persona.name}。风格：${config.persona.style}。把孩子语音转为 JSON：{skill,resource?,template?,reply}。skill 只能是 ${skills.join(",")}；resource 只能是 ${resources.join(",")}；template 只能是 ${templates.join(",")}。不能确定时 skill=clarify。reply 不超过 35 个汉字。` },
          { role: "user", content: JSON.stringify({ transcript, state }) },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!result.ok) throw new Error(`LLM ${result.status}`);
    const content = (await result.json() as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
    return validatePlan(JSON.parse(content ?? "{}"));
  } catch (error) {
    console.error("大模型规划失败，使用本地规则：", error);
    return localPlan(transcript);
  }
}

function validatePlan(value: unknown): Task {
  if (!value || typeof value !== "object") return localPlan("");
  const candidate = value as Partial<Task>;
  if (!candidate.skill || !skills.includes(candidate.skill)) return localPlan("");
  return {
    skill: candidate.skill,
    resource: resources.includes(candidate.resource as ResourceName) ? candidate.resource as ResourceName : undefined,
    template: templates.includes(candidate.template as BuildTemplate) ? candidate.template as BuildTemplate : undefined,
    reply: typeof candidate.reply === "string" && candidate.reply.length <= 70 ? candidate.reply : "好，我来陪你一起做。",
  };
}

function localPlan(text: string): Task {
  if (/(停|别动|停止)/.test(text)) return { skill: "stop", reply: "好，我停在这里等你。" };
  if (/(跟着|跟我|跟随)/.test(text)) return { skill: "follow", reply: "好，我跟着你。" };
  if (/(保护|打怪|怪物|救我)/.test(text)) return { skill: "protect", reply: "我会留意怪物，保护你。" };
  if (/(木头|树木)/.test(text)) return { skill: "find_resource", resource: "wood", reply: "好，我带你去找木头。" };
  if (/(石头|圆石)/.test(text)) return { skill: "find_resource", resource: "stone", reply: "好，我们一起找石头。" };
  if (/煤/.test(text)) return { skill: "find_resource", resource: "coal", reply: "好，我带你去找煤矿。" };
  if (/(铁|铁矿)/.test(text)) return { skill: "find_resource", resource: "iron", reply: "好，我们一起找铁矿。" };
  if (/(小木屋|房子)/.test(text)) return { skill: "build", template: "cabin", reply: "好，我们找块空地盖小木屋。" };
  if (/(农场|围栏)/.test(text)) return { skill: "build", template: "farm", reply: "好，我们来围一个小农场。" };
  if (/(篝火|营地)/.test(text)) return { skill: "build", template: "camp", reply: "好，我们布置一个篝火营地。" };
  if (/(状态|血量|饿)/.test(text)) return { skill: "status", reply: "我来报告状态。" };
  return { skill: "clarify", reply: "我没听明白。可以说跟着我、带我找煤，或盖小木屋。" };
}
