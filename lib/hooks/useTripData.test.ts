// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendClient, BackendUser } from "@/lib/backend";
import { demoDays, demoNotes, demoPhotos, demoPlaces, demoRoutes, demoTrip, emptyTripData } from "@/lib/demo-trip";
import { useTripData } from "./useTripData";

type QueryResponse = { data: unknown; error: { message: string } | null };

/**
 * Minimal stand-in for the Neon/PostgREST client: every `from(table)` call
 * returns a chainable builder whose terminal `await` resolves to the response
 * configured for that table. Records the tables touched so tests can count
 * loads without caring about the exact filter chain.
 */
function createFakeBackend(responses: Record<string, QueryResponse>) {
  const calls: string[] = [];
  const from = (table: string) => {
    calls.push(table);
    const respond = () => responses[table] ?? { data: [], error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(respond()),
      then: <T>(resolve: (value: QueryResponse) => T) => Promise.resolve(respond()).then(resolve),
    };
    return builder;
  };
  return { backend: { from } as unknown as BackendClient, calls, responses };
}

const okResponses = (): Record<string, QueryResponse> => ({
  trips: { data: demoTrip, error: null },
  days: { data: demoDays, error: null },
  route_segments: { data: demoRoutes, error: null },
  photos: { data: demoPhotos, error: null },
  notes: { data: demoNotes, error: null },
  places: { data: demoPlaces, error: null },
  trip_members: { data: [], error: null },
  admin_requests: { data: [], error: null },
});

const fakeUser = { id: "user-1" } as unknown as BackendUser;

function renderTripData(backend: BackendClient | null, user: BackendUser | null = null) {
  return renderHook(() => useTripData({ backend, user, authLoading: false, tripSlug: demoTrip.slug, initialData: emptyTripData }));
}

/**
 * Drain the microtask chain behind one loadData call inside act. Used where
 * fake timers are on: React's jsdom scheduler falls back to setTimeout, so
 * testing-library's waitFor would never see the committed state.
 */
async function flushLoad() {
  await act(async () => {
    for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTripData", () => {
  it("loads the trip on mount and clears the loading flag", async () => {
    const { backend, calls } = createFakeBackend(okResponses());
    const { result } = renderTripData(backend);

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.data.trip).toEqual(demoTrip);
    expect(result.current.data.days).toEqual(demoDays);
    expect(result.current.data.notes).toEqual(demoNotes);
    expect(result.current.data.photos.map((photo) => photo.id)).toEqual(demoPhotos.map((photo) => photo.id));
    // Anonymous visitors never query admin requests.
    expect(calls).not.toContain("admin_requests");
  });

  it("surfaces a trip query failure as an error message", async () => {
    const responses = okResponses();
    responses.trips = { data: null, error: { message: "permission denied" } };
    const { backend } = createFakeBackend(responses);
    const { result } = renderTripData(backend);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("could not load the trip");
    expect(result.current.error).toContain("permission denied");
    expect(result.current.data).toBe(emptyTripData);
  });

  it("keeps the same data object and existing messages across a silent poll with identical rows", async () => {
    const { backend } = createFakeBackend(okResponses());
    const { result } = renderTripData(backend);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const loaded = result.current.data;

    act(() => {
      result.current.setError("Save failed.");
      result.current.setNotice("Heads up.");
    });
    await act(async () => {
      await result.current.loadData({ silent: true });
    });

    expect(result.current.data).toBe(loaded);
    expect(result.current.error).toBe("Save failed.");
    expect(result.current.notice).toBe("Heads up.");
    expect(result.current.loading).toBe(false);

    // A normal (non-silent) reload does clear stale messages.
    await act(async () => {
      await result.current.loadData();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBeNull();
    expect(result.current.data).toBe(loaded);
  });

  it("replaces the data object when a silent poll returns changed rows", async () => {
    const fake = createFakeBackend(okResponses());
    const { result } = renderTripData(fake.backend);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const loaded = result.current.data;

    fake.responses.notes = { data: [{ ...demoNotes[0], body: "Edited" }], error: null };
    await act(async () => {
      await result.current.loadData({ silent: true });
    });

    expect(result.current.data).not.toBe(loaded);
    expect(result.current.data.notes[0].body).toBe("Edited");
    expect(result.current.data.photos).toBe(loaded.photos);
    expect(result.current.data.routeSegments).toBe(loaded.routeSegments);
    expect(result.current.data.days).toBe(loaded.days);
  });

  it("degrades gracefully when the admin_requests table is missing", async () => {
    const responses = okResponses();
    responses.admin_requests = { data: null, error: { message: "Could not find the table 'public.admin_requests' in the schema cache" } };
    const { backend, calls } = createFakeBackend(responses);
    const { result } = renderTripData(backend, fakeUser);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toContain("admin_requests");
    expect(result.current.adminRequestsAvailable).toBe(false);
    expect(result.current.profilesAvailable).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toContain("Admin access requests are temporarily unavailable");
    expect(result.current.data.trip).toEqual(demoTrip);
    expect(result.current.data.adminRequests).toEqual([]);
  });

  it("reports a failed section without replacing the current data", async () => {
    const responses = okResponses();
    responses.photos = { data: null, error: { message: "photos timed out" } };
    const { backend } = createFakeBackend(responses);
    const { result } = renderTripData(backend);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("one section could not sync");
    expect(result.current.error).toContain("photos timed out");
    expect(result.current.data).toBe(emptyTripData);
  });

  it("polls again after 30 seconds while the document is visible", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { backend, calls } = createFakeBackend(okResponses());
    const { result } = renderTripData(backend);
    await flushLoad();
    expect(result.current.loading).toBe(false);
    expect(result.current.data.trip).toEqual(demoTrip);
    expect(calls.filter((table) => table === "trips")).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(calls.filter((table) => table === "trips")).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flushLoad();
    expect(calls.filter((table) => table === "trips")).toHaveLength(2);
    // The poll is silent: no loading flicker.
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    // The next poll is scheduled only after the previous one finished.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await flushLoad();
    expect(calls.filter((table) => table === "trips")).toHaveLength(3);
  });

  it("does not schedule a poll while the document is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { backend, calls } = createFakeBackend(okResponses());
    const { result } = renderTripData(backend);
    await flushLoad();
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flushLoad();
    expect(calls.filter((table) => table === "trips")).toHaveLength(1);
  });

  it("does nothing without a backend", () => {
    const { result } = renderTripData(null);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(emptyTripData);
  });
});
