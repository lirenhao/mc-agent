import mineflayer from "mineflayer";
import pathfinderModule from "mineflayer-pathfinder";
import { config } from "./config.js";
import { chooseAction } from "./jev.js";
import { SkillController } from "./skills.js";
import { planTask } from "./task-planner.js";
import { startVoiceServer } from "./voice-server.js";
import { getWorldState } from "./world-state.js";

const { pathfinder } = pathfinderModule;

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  auth: config.auth as "offline",
});

bot.loadPlugin(pathfinder);
const skills = new SkillController(bot);
let spawned = false;

async function handleInstruction(text: string, playerName: string): Promise<string> {
  if (!spawned) return "我还没进入世界，等我准备好再说一次。";
  if (!playerName) return "请先在 .env 设置 MC_COMPANION_PLAYER 为孩子的游戏名。";
  const state = getWorldState(bot);
  const task = await planTask(text, state);
  const action = await chooseAction(task, state);
  const outcome = await skills.run(action, playerName, task.resource, task.template, state);
  const message = action === "clarify" ? task.reply : outcome;
  bot.chat(message);
  return message;
}

startVoiceServer((text) => handleInstruction(text, config.companionPlayer ?? ""));

bot.once("spawn", () => {
  spawned = true;
  console.log(`已作为 ${bot.username} 进入 ${config.host}:${config.port}`);
  bot.chat(`大家好，我是${config.persona.name}。需要我就说一声。`);
});

bot.on("chat", (sender, message) => {
  if (sender === bot.username || !message.startsWith("!陪玩")) return;
  if (config.allowedPlayers.size > 0 && !config.allowedPlayers.has(sender)) return;

  const text = message.slice("!陪玩".length).trim() || "状态";
  void handleInstruction(text, sender);
});

bot.on("kicked", (reason) => console.error("被服务器踢出：", reason));
bot.on("error", (error) => console.error("连接错误：", error));
