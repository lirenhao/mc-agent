import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { commands } from "./commands.js";
import { config } from "./config.js";

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
});

bot.loadPlugin(pathfinder);

bot.once("spawn", () => {
  console.log(`已作为 ${bot.username} 进入 ${config.host}:${config.port}`);
  bot.chat("大家好，我是陪玩助手。输入 !陪玩 help 查看我能做什么。 ");
});

bot.on("chat", (sender, message) => {
  if (sender === bot.username || !message.startsWith("!陪玩")) return;
  if (config.allowedPlayers.size > 0 && !config.allowedPlayers.has(sender)) return;

  const [name = "help", ...args] = message.slice("!陪玩".length).trim().split(/\s+/);
  const command = commands[name.toLowerCase()];
  if (!command) return void bot.chat(`@${sender} 不认识 “${name}”。输入 !陪玩 help。`);
  command.run({ bot, sender, args });
});

bot.on("kicked", (reason) => console.error("被服务器踢出：", reason));
bot.on("error", (error) => console.error("连接错误：", error));
