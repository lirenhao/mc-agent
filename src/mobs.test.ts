import assert from "node:assert/strict";
import test from "node:test";
import { isHostileEntity } from "./mobs.js";

test("modern hostile mobs are recognized even when type is not mob", () => {
  assert.equal(isHostileEntity({ type: "hostile", name: "zombie", kind: "Hostile mobs" }), true);
  assert.equal(isHostileEntity({ type: "hostile", name: "creeper", kind: "Hostile mobs" }), true);
  assert.equal(isHostileEntity({ type: "mob", name: "slime", kind: "Hostile mobs" }), true);
  assert.equal(isHostileEntity({ type: "mob", name: "zombie", kind: "UNKNOWN" }), true);
});

test("players, animals, and neutral piglins are not monsters", () => {
  assert.equal(isHostileEntity({ type: "player", name: "player" }), false);
  assert.equal(isHostileEntity({ type: "animal", name: "pig", kind: "Passive mobs" }), false);
  assert.equal(isHostileEntity({ type: "mob", name: "iron_golem", kind: "Passive mobs" }), false);
  assert.equal(isHostileEntity({ type: "hostile", name: "piglin", kind: "Hostile mobs" }), false);
});
