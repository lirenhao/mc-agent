import assert from "node:assert/strict";
import test from "node:test";
import { parseGameMode } from "./gamemode.js";

test("game mode phrases name survival, creative, adventure, or spectator", () => {
  assert.deepEqual(parseGameMode("切换创造模式"), { mode: "creative", label: "创造", target: "self" });
  assert.deepEqual(parseGameMode("把我改成生存"), { mode: "survival", label: "生存", target: "child" });
  assert.equal(parseGameMode("切换模式"), "ask");
  assert.equal(parseGameMode("帮我创造一个房子"), undefined);
});
