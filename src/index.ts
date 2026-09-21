import mineflayer from "mineflayer";
import { plugin as collectBlock } from "mineflayer-collectblock";
import pathfinderModule from "mineflayer-pathfinder";
import { Companion } from "./companion.js";
import { config } from "./config.js";
import { Skills } from "./skills.js";
import { startVoiceServer } from "./voice-server.js";

const { pathfinder } = pathfinderModule;

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  auth: config.auth as "offline",
});

bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlock);
const skills = new Skills(bot);
const companion = new Companion(bot, skills);
let spawned = false;

async function handleInstruction(text: string, playerName: string): Promise<string> {
  if (!spawned) return "我还没进入世界，等我准备好再说一次。";
  if (!playerName) return "请先在 .env 设置 MC_COMPANION_PLAYER 为孩子的游戏名。";
  return companion.instruct(text, playerName);
}

startVoiceServer((text) => handleInstruction(text, config.companionPlayer ?? ""));

bot.once("spawn", () => {
  spawned = true;
  companion.start();
  console.log(`已作为 ${bot.username} 进入 ${config.host}:${config.port}`);
  bot.chat(`大家好，我是${config.persona.name}。我会跟着你，有事直接说。`);
});

bot.on("chat", (sender, message) => {
  if (sender === bot.username || !message.startsWith("!陪玩")) return;
  if (config.allowedPlayers.size > 0 && !config.allowedPlayers.has(sender)) return;

  const text = message.slice("!陪玩".length).trim() || "状态";
  void handleInstruction(text, sender);
});

bot.on("end", () => companion.stopLoop());
bot.on("kicked", (reason) => console.error("被服务器踢出：", reason));
bot.on("error", (error) => console.error("连接错误：", error));
