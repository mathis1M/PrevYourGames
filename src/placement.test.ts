import { describe, expect, test } from "bun:test";
import { getTargetIndex } from "./placement";

describe("getTargetIndex", () => {
  test("targets the first existing game", () => {
    expect(getTargetIndex(8, "first")).toBe(0);
  });

  test("targets an existing game at random", () => {
    expect(getTargetIndex(4, "random", () => 0.5)).toBe(2);
    expect(getTargetIndex(4, "random", () => 0.999)).toBe(3);
    expect(getTargetIndex(0, "random", () => 0.9)).toBe(0);
  });
});
