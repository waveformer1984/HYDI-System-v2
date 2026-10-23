import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import Starfield from "./Starfield";
import React from "react";

// These tests must actually MOUNT the component: React.createElement only
// builds an element object and never runs effects, so no listeners or rAF
// would ever be observed. render() flushes effects under jsdom.
describe("Starfield Component", () => {
  beforeEach(() => {
    // rAF records the request but does not invoke the callback — calling it
    // synchronously would recurse forever (each frame re-requests the next).
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(window, "addEventListener");
    vi.spyOn(window, "removeEventListener");
    // jsdom reports zero layout size; give elements a box so the component's
    // dimensions effect reaches its canvas branch.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("renders with default props", () => {
    const { container } = render(<Starfield />);
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("renders with custom props", () => {
    expect(() => render(<Starfield starCount={200} baseSpeed={0.5} />)).not.toThrow();
  });

  it("accepts starCount prop", () => {
    expect(() => render(<Starfield starCount={50} />)).not.toThrow();
  });

  it("accepts baseSpeed prop", () => {
    expect(() => render(<Starfield baseSpeed={1.0} />)).not.toThrow();
  });

  it("attaches event listeners", () => {
    render(<Starfield />);
    expect(window.addEventListener).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("requests animation frame", () => {
    render(<Starfield />);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it("handles edge cases", () => {
    expect(() => render(<Starfield starCount={0} />)).not.toThrow();
    expect(() => render(<Starfield starCount={-10} />)).not.toThrow();
    expect(() => render(<Starfield starCount={1000} />)).not.toThrow();
  });
});
