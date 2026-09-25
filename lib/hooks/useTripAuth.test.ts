// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BackendClient } from "@/lib/backend";
import { useTripAuth } from "./useTripAuth";

const user = { id: "user-1", email: "ned@example.com" };

function fakeBackend(overrides: Partial<Record<"signInWithOtp" | "verifyOtp", ReturnType<typeof vi.fn>>> = {}) {
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signInWithOtp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { user, session: { user } }, error: null }),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  };
  return { auth } as unknown as BackendClient;
}

async function render(backend: BackendClient) {
  const view = renderHook(() => useTripAuth(backend));
  await waitFor(() => expect(view.result.current.authLoading).toBe(false));
  return view;
}

describe("useTripAuth email code sign-in", () => {
  it("requests a code without a redirect and waits for it to be entered", async () => {
    const backend = fakeBackend();
    const { result } = await render(backend);

    await act(() => result.current.signIn("ned@example.com"));

    // Neon Auth emails a 6-digit code; there is no magic link to redirect back from.
    expect(backend.auth.signInWithOtp).toHaveBeenCalledWith({ email: "ned@example.com" });
    expect(result.current.pendingOtpEmail).toBe("ned@example.com");
    expect(result.current.authMessageTone).toBe("info");
    expect(result.current.authMessage).toContain("6-digit code");
    expect(result.current.user).toBeNull();
  });

  it("signs the user in once the code verifies", async () => {
    const backend = fakeBackend();
    const { result } = await render(backend);
    await act(() => result.current.signIn("ned@example.com"));
    act(() => result.current.setAuthPanelOpen(true));

    await act(() => result.current.verifyCode(" 123 456 "));

    expect(backend.auth.verifyOtp).toHaveBeenCalledWith({ email: "ned@example.com", token: "123456", type: "email" });
    expect(result.current.user).toEqual(user);
    expect(result.current.pendingOtpEmail).toBeNull();
    expect(result.current.authPanelOpen).toBe(false);
  });

  it("keeps the code prompt open and reports a rejected code", async () => {
    const backend = fakeBackend({
      verifyOtp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: { message: "Invalid OTP" } }),
    });
    const { result } = await render(backend);
    await act(() => result.current.signIn("ned@example.com"));

    await act(() => result.current.verifyCode("000000"));

    expect(result.current.user).toBeNull();
    expect(result.current.pendingOtpEmail).toBe("ned@example.com");
    expect(result.current.authMessageTone).toBe("error");
    expect(result.current.authMessage).toBe("Invalid OTP");
  });

  it("does not enter the code step when sending the code fails", async () => {
    const backend = fakeBackend({
      signInWithOtp: vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: { message: "HTTP 403" } }),
    });
    const { result } = await render(backend);

    await act(() => result.current.signIn("ned@example.com"));

    expect(result.current.pendingOtpEmail).toBeNull();
    expect(result.current.authMessageTone).toBe("error");
    expect(result.current.authMessage).toBe("HTTP 403");
  });

  it("lets the user go back and change the email", async () => {
    const backend = fakeBackend();
    const { result } = await render(backend);
    await act(() => result.current.signIn("ned@example.com"));

    act(() => result.current.cancelCodeEntry());

    expect(result.current.pendingOtpEmail).toBeNull();
    expect(result.current.authMessage).toBeNull();
  });
});

describe("useTripAuth while the client is still loading", () => {
  it("stays loading until the lazily-loaded client restores the session", async () => {
    const backend = fakeBackend();
    const view = renderHook(({ client }) => useTripAuth(client, true), {
      initialProps: { client: null as BackendClient | null },
    });
    // Signed-out controls key off !authLoading, so they must not flash here.
    expect(view.result.current.authLoading).toBe(true);

    view.rerender({ client: backend });
    await waitFor(() => expect(view.result.current.authLoading).toBe(false));
    expect(backend.auth.getSession).toHaveBeenCalledTimes(1);
  });
});
