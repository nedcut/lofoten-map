// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusPill } from "./StatusPill";

afterEach(cleanup);

describe("StatusPill", () => {
  it("announces errors assertively and info politely", () => {
    const { rerender } = render(<StatusPill tone="error">Save failed</StatusPill>);
    expect(screen.getByRole("alert").textContent).toBe("Save failed");

    rerender(<StatusPill>Saved</StatusPill>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("only offers a dismiss button when it can be dismissed", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<StatusPill>Saved</StatusPill>);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();

    rerender(<StatusPill onDismiss={onDismiss}>Saved</StatusPill>);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
