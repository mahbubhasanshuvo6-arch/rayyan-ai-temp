import { test } from "node:test";
import assert from "node:assert/strict";
import { taskOutcome } from "./completion.ts";

test("zero steps fails instead of completing", () => {
  assert.equal(taskOutcome([]), "fail");
});

test("only failed steps fails instead of completing", () => {
  assert.equal(taskOutcome(["failed"]), "fail");
  assert.equal(taskOutcome(["failed", "failed"]), "fail");
});

test("all steps succeeded completes", () => {
  assert.equal(taskOutcome(["succeeded"]), "complete");
  assert.equal(taskOutcome(["succeeded", "succeeded", "succeeded"]), "complete");
});

test("partially completed steps still complete as before", () => {
  assert.equal(taskOutcome(["succeeded", "failed"]), "complete");
  assert.equal(taskOutcome(["failed", "succeeded"]), "complete");
});
