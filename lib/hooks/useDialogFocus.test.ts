// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement, StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

// jsdom has no layout, so offsetParent is always null; treat every element as
// visible so the hook's focusable filter sees the dialog's controls.
Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.parentNode; } });

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref, { onClose });
  return createElement(
    "div",
    // eslint-disable-next-line react-hooks/refs -- this is JSX's ref prop written as createElement (vitest only collects .test.ts files).
    { ref, role: "dialog" },
    createElement("button", { type: "button" }, "Close"),
    createElement("input", { "aria-label": "Code" }),
  );
}

// Mirrors app/page.tsx: StrictMode in dev, and the page behind an open dialog
// can't take focus (there it is `inert`; jsdom lacks inert, so the opener is
// disabled instead).
function Page({ open, onClose }: { open: boolean; onClose: () => void }) {
  return createElement(
    StrictMode,
    null,
    createElement("button", { type: "button", disabled: open }, "Sign in"),
    open ? createElement(Dialog, { onClose }) : null,
  );
}

afterEach(cleanup);

describe("useDialogFocus", () => {
  it("keeps focus where the user put it when the parent re-renders with a new onClose", () => {
    const view = render(createElement(Page, { open: false, onClose: () => {} }));
    const opener = view.getByRole("button", { name: "Sign in" });
    opener.focus();

    view.rerender(createElement(Page, { open: true, onClose: () => {} }));
    expect(document.activeElement).toBe(view.getByRole("button", { name: "Close" }));

    const input = view.getByLabelText("Code");
    input.focus();
    view.rerender(createElement(Page, { open: true, onClose: () => {} }));
    expect(document.activeElement).toBe(input);
  });

  it("calls the latest onClose on Escape and returns focus to the opener on close", () => {
    const view = render(createElement(Page, { open: false, onClose: () => {} }));
    const opener = view.getByRole("button", { name: "Sign in" });
    opener.focus();

    const firstOnClose = vi.fn();
    const latestOnClose = vi.fn();
    view.rerender(createElement(Page, { open: true, onClose: firstOnClose }));
    view.getByLabelText("Code").focus();
    view.rerender(createElement(Page, { open: true, onClose: latestOnClose }));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(firstOnClose).not.toHaveBeenCalled();
    expect(latestOnClose).toHaveBeenCalledTimes(1);

    view.rerender(createElement(Page, { open: false, onClose: latestOnClose }));
    expect(document.activeElement).toBe(opener);
  });
});
