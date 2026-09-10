import { describe, expect, it } from "vitest";
import { estimateTokens, estimateTokensFromBytes, formatTokenCount } from "../src/pack/tokens.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("uses chars/4 ceiling", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("estimateTokensFromBytes", () => {
  it("mirrors chars/4 for byte lengths", () => {
    expect(estimateTokensFromBytes(0)).toBe(0);
    expect(estimateTokensFromBytes(4)).toBe(1);
    expect(estimateTokensFromBytes(5)).toBe(2);
  });
});

describe("formatTokenCount", () => {
  it("formats compact counts", () => {
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(12_400)).toBe("12k");
  });
});
