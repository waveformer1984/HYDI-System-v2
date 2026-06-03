import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Starfield from "./Starfield";
import React from "react";

let animationCallback = null;
const mockRequestAnimationFrame = vi.fn((callback) => { animationCallback = callback; const id = Date.now(); if (callback) callback(16.67); return id; });
const mockCancelAnimationFrame = vi.fn((id) => { animationCallback = null; });

describe("Starfield Component", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(window, "requestAnimationFrame").mockImplementation(mockRequestAnimationFrame); vi.spyOn(window, "cancelAnimationFrame").mockImplementation(mockCancelAnimationFrame); vi.spyOn(window, "addEventListener").mockImplementation(() => {}); vi.spyOn(window, "removeEventListener").mockImplementation(() => {}); animationCallback = null; });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("renders with default props", () => { expect(() => React.createElement(Starfield)).not.toThrow(); });
  it("renders with custom props", () => { expect(() => React.createElement(Starfield, { starCount: 200, baseSpeed: 0.5 })).not.toThrow(); });
  it("accepts starCount prop", () => { expect(() => React.createElement(Starfield, { starCount: 50 })).not.toThrow(); });
  it("accepts baseSpeed prop", () => { expect(() => React.createElement(Starfield, { baseSpeed: 1.0 })).not.toThrow(); });
  it("attaches event listeners", () => { const spy = vi.spyOn(window, "addEventListener"); React.createElement(Starfield); expect(spy).toHaveBeenCalledWith("mousemove", expect.any(Function)); expect(spy).toHaveBeenCalledWith("resize", expect.any(Function)); });
  it("requests animation frame", () => { React.createElement(Starfield); expect(window.requestAnimationFrame).toHaveBeenCalled(); });
  it("handles edge cases", () => { expect(() => React.createElement(Starfield, { starCount: 0 })).not.toThrow(); expect(() => React.createElement(Starfield, { starCount: -10 })).not.toThrow(); expect(() => React.createElement(Starfield, { starCount: 1000 })).not.toThrow(); });
});
