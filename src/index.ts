import mineflayer, { type Bot } from "mineflayer";
import { plugin as collectBlock } from "mineflayer-collectblock";
import pathfinderModule from "mineflayer-pathfinder";
import { Companion } from "./companion.js";
import { config } from "./config.js";
import { Skills } from "./skills.js";
import { startVoiceServer } from "./voice-server.js";

const { pathfinder } = pathfinderModule;
const RETRY_START_MS = 3_000;
const RETRY_MAX_MS = 30_000;

let bot: Bot | undefined;
let companion: Companion | undefined;
let spawned = false;
let reconnecting = false;
let closing = false;
let greeted = false;
let retryMs = RETRY_START_MS;
let retryTimer: NodeJS.Timeout | undefined;

async function handleInstruction(text: string, playerName: string): Promise<string> {
  if (!spawned || !companion) {
    return reconnecting ? "我掉线了，正在重新连接，等我回到游戏里再说一次。" : "我还没进入世界，等我准备好再说一次。";
  }
  if (!playerName) return "请先在 .env 设置 MC_COMPANION_PLAYER 为孩子的游戏名。";
  return companion.instruct(text, playerName);
}

startVoiceServer((text) => handleInstruction(text, config.companionPlayer ?? ""));

function connect(): void {
  if (closing) return;
  const next = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth as "offline",
  });
  bot = next;
  next.loadPlugin(pathfinder);
  next.loadPlugin(collectBlock);
  const skills = new Skills(next);
  const current = new Companion(next, skills);
  companion = current;

  next.once("spawn", () => {
    if (bot !== next) return;
    spawned = true;
    reconnecting = false;
    retryMs = RETRY_START_MS;
    current.start();
    console.log(`已作为 ${next.username} 进入 ${config.host}:${config.port}`);
    const line = greeted ? "我回来了。" : `大家好，我是${config.persona.name}。我会跟着你，有事直接说。`;
    greeted = true;
    next.chat(line);
  });

  next.on("chat", (sender, message) => {
    if (sender === next.username || !message.startsWith("!陪玩")) return;
    if (config.allowedPlayers.size > 0 && !config.allowedPlayers.has(sender)) return;
    const text = message.slice("!陪玩".length).trim() || "状态";
    void handleInstruction(text, sender);
  });

  next.on("kicked", (reason) => console.error("被服务器踢出：", reason));
  next.on("error", (error) => console.error("连接错误：", error));
  next.on("end", (reason) => {
    if (bot === next) {
      spawned = false;
      bot = undefined;
      if (companion === current) companion = undefined;
    }
    current.stopLoop();
    if (closing) return;
    reconnecting = true;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    console.log(`连接断开（${formatReason(reason)}），${Math.round(wait / 1000)} 秒后重连`);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, wait);
  });
}

function formatReason(reason: unknown): string {
  if (typeof reason === "string" && reason.trim()) return reason.trim().slice(0, 180);
  if (reason == null) return "未知原因";
  try {
    return JSON.stringify(reason).slice(0, 180);
  } catch {
    return "未知原因";
  }
}

function shutdown(): void {
  if (closing) return;
  closing = true;
  if (retryTimer) clearTimeout(retryTimer);
  console.log("正在退出，不再重连。");
  const current = bot;
  if (!current) {
    process.exit(0);
    return;
  }
  try {
    current.quit("离开");
  } catch {
    process.exit(0);
    return;
  }
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
connect();
