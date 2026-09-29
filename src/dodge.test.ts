import assert from "node:assert/strict";
import test from "node:test";
import { controlsFor, isClosing, pickDodge, strafeOf, unitAway, type DodgeCandidate } from "./dodge.js";

const zombie = (distance: number): DodgeCandidate => ({
  name: "zombie", x: distance, z: 0, distance, hostile: true, projectile: false, player: false, closing: false,
});

test("retreat points away from the attacker", () => {
  const away = unitAway({ x: 0, z: 0 }, { x: 5, z: 0 });
  assert.ok(away);
  assert.ok(away.x < -0.9);
  assert.ok(Math.abs(away.z) < 0.1);
  const side = strafeOf(away, 1);
  assert.ok(Math.abs(side.z) > Math.abs(side.x));
});

test("melee and creepers choose different dodges", () => {
  assert.equal(pickDodge({ health: 20, justHurt: false, sparring: false, candidates: [zombie(2.5)] })?.kind, "strafe");
  assert.equal(pickDodge({ health: 20, justHurt: false, sparring: false, candidates: [zombie(10)] }), undefined);
  const creeper: DodgeCandidate = { name: "creeper", x: 4, z: 0, distance: 4, hostile: true, projectile: false, player: false, closing: false };
  assert.equal(pickDodge({ health: 20, justHurt: false, sparring: false, candidates: [creeper] })?.kind, "flee");
  assert.equal(pickDodge({ health: 5, justHurt: false, sparring: false, candidates: [zombie(6)] })?.kind, "flee");
});

test("the child is only dodged while sparring or after a hit", () => {
  const child: DodgeCandidate = { name: "player", x: 2, z: 0, distance: 2, hostile: false, projectile: false, player: true, closing: false };
  assert.equal(pickDodge({ health: 20, justHurt: false, sparring: false, candidates: [child] }), undefined);
  assert.equal(pickDodge({ health: 20, justHurt: false, sparring: true, candidates: [child] })?.kind, "strafe");
  assert.equal(pickDodge({ health: 20, justHurt: true, sparring: false, candidates: [child] })?.kind, "strafe");
});

test("an arrow coming in is sidestepped", () => {
  assert.equal(isClosing({ x: 3, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 0 }), true);
  assert.equal(isClosing({ x: 3, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0 }), false);
  const arrow: DodgeCandidate = { name: "arrow", x: 3, z: 0, distance: 3, hostile: false, projectile: true, player: false, closing: true };
  assert.equal(pickDodge({ health: 20, justHurt: false, sparring: false, candidates: [arrow, zombie(12)] })?.kind, "strafe");
});

test("strafe controls follow the bot facing", () => {
  const north = controlsFor(0, { x: 0, z: -1 });
  assert.equal(north.forward, true);
  assert.equal(north.back, false);
  const east = controlsFor(0, { x: 1, z: 0 });
  assert.equal(east.right, true);
  assert.equal(east.left, false);
});
