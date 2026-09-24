import assert from "node:assert/strict";
import test from "node:test";
import { parseGameCommand, usernameFromChat } from "./game-commands.js";

test("game commands accept the prefix, a Chinese name, and a direct order", () => {
  assert.equal(parseGameCommand("!bot 跟着我"), "跟着我");
  assert.equal(parseGameCommand("！bot去打僵尸"), "去打僵尸");
  assert.equal(parseGameCommand("<小明> !bot 坐下"), "坐下");
  assert.equal(parseGameCommand("!bot"), "状态");
  assert.equal(parseGameCommand("阿搭，睡觉", { persona: "阿搭" }), "睡觉");
  assert.equal(parseGameCommand("跟着我", { direct: true }), "跟着我");
  assert.equal(parseGameCommand("捡起来", { direct: true }), "捡起来");
  assert.equal(parseGameCommand("做一把木镐", { direct: true }), "做一把木镐");
  assert.equal(parseGameCommand("你好呀", { direct: true }), undefined);
  assert.equal(parseGameCommand("/gamemode creative"), undefined);
});

test("chat sender uuid maps back to the player name", () => {
  const players = [{ username: "小明", uuid: "11111111-2222-3333-4444-555555555555" }];
  assert.equal(usernameFromChat(players, "11111111-2222-3333-4444-555555555555"), "小明");
  assert.equal(usernameFromChat(players, "not-a-player"), undefined);
  assert.equal(usernameFromChat(players, undefined, JSON.stringify({ text: "小明" })), "小明");
});
