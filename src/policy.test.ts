import assert from "node:assert/strict";
import test from "node:test";
import { buildOffers, failureCooldown, filterOffers, planTrigger, preferOffer, type Offer } from "./actions.js";
import { selectJudgedOffer } from "./jev.js";

test("danger leaves only retreat and protect", () => {
  const offers = buildOffers({
    stayPut: false,
    childVisible: true,
    night: false,
    defense: true,
    canLight: false,
    canSleep: false,
    mission: { mode: "focused", title: "砍树", step: { type: "collect", block: "oak_log" } },
  });
  const filtered = filterOffers(offers, { unsafe: true, cooled: new Set() });
  assert.deepEqual(filtered.map((offer) => offer.key), ["retreat", "protect"]);
});

test("a cooled mining action is skipped", () => {
  const offers = buildOffers({
    stayPut: false,
    childVisible: true,
    night: false,
    defense: false,
    canLight: false,
    canSleep: false,
    mining: { block: "oak_log", label: "木头" },
  });
  const filtered = filterOffers(offers, { unsafe: false, cooled: new Set(["mine:oak_log"]) });
  assert.equal(filtered.some((offer) => offer.key === "mine:oak_log"), false);
  assert.equal(preferOffer(filtered).key, "follow");
});

test("night sleep is offered, and danger drops it", () => {
  const offers = buildOffers({
    stayPut: false,
    childVisible: true,
    night: true,
    defense: true,
    canLight: false,
    canSleep: true,
  });
  assert.equal(offers.some((offer) => offer.key === "sleep"), true);
  const filtered = filterOffers(offers, { unsafe: true, cooled: new Set() });
  assert.deepEqual(filtered.map((offer) => offer.key), ["retreat", "protect"]);
  assert.equal(preferOffer(offers.filter((offer) => offer.key !== "retreat" && offer.key !== "protect")).key, "follow");
});

test("Jev action keys execute directly, and an unsure stop does not", () => {
  const offers: Offer[] = [
    { key: "mission:collect:oak_log", description: "继续砍树", intent: { type: "collect", block: "oak_log" }, sustain: false },
    { key: "follow", description: "跟着孩子", intent: { type: "follow" }, sustain: true },
    { key: "stop", description: "停下", intent: { type: "stop" }, sustain: true },
  ];
  assert.equal(selectJudgedOffer(offers, "mission:collect:oak_log", 0.42, 0.85).key, "mission:collect:oak_log");
  assert.equal(selectJudgedOffer(offers, "stop", 0.4, 0.85).key, "mission:collect:oak_log");
  assert.equal(selectJudgedOffer(offers, "not-an-action", 0.99, 0.85).key, "mission:collect:oak_log");
});

test("repeated failure asks for a new plan, a fresh mission does not", () => {
  const now = 100_000;
  assert.equal(planTrigger({ hasMission: true, failures: 2, now, lastPlanAt: now - 9_000, noUseful: false }), "repeated failure");
  assert.equal(planTrigger({ hasMission: true, failures: 0, now, lastPlanAt: now - 1_000, noUseful: false }), null);
  assert.equal(failureCooldown("mine:oak_log") > failureCooldown("protect"), true);
});
