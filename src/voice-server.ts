import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

export function startVoiceServer(onTranscript: (text: string) => Promise<string>): void {
  const pagePath = fileURLToPath(new URL("../voice/index.html", import.meta.url));
  createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      try {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(await readFile(pagePath));
      } catch { respond(response, 500, { message: "语音页面未找到" }); }
      return;
    }
    if (request.method === "POST" && request.url === "/transcript") {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      try {
        const text = String(JSON.parse(body).text ?? "").trim().slice(0, 160);
        if (!text) return void respond(response, 400, { message: "没有听到内容，请再试一次。" });
        respond(response, 200, { message: await onTranscript(text) });
      } catch (error) {
        console.error("处理语音文本失败：", error);
        respond(response, 503, { message: "我现在没准备好，请稍后再试。" });
      }
      return;
    }
    respond(response, 404, { message: "not found" });
  }).listen(config.voicePort, "127.0.0.1", () => console.log(`语音控制页已启动：http://127.0.0.1:${config.voicePort}`));
}

function respond(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}
