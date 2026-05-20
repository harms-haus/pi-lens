import { describe, it, expect } from "vitest";
import { isRecord } from "../helpers.js";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ foo: "bar" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it("returns true for class instances", () => {
    expect(isRecord(new Date())).toBe(true);
    expect(isRecord(new Error("test"))).toBe(true);
  });

  it("returns false for functions", () => {
    expect(isRecord(() => {})).toBe(false);
    expect(isRecord(function () {})).toBe(false);
  });
});
