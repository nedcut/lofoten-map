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
 *
 * A trips select with embedded tables ("*,days(*),...") is answered like
 * PostgREST: the trip row with each embedded table's rows attached, or the
 * first embedded table's error for the whole request. Set `embedError` to fail
 * every embedded request.
 */
function createFakeBackend(responses: Record<string, QueryResponse>) {
  const calls: string[] = [];
  // Column lists passed to select(), in call order, as "table:columns".
  const selects: string[] = [];
  // A pending promise here delays the next query on that table. The query
  // still reads its response up front, like a slow request that hit the DB early.
  const holds: Record<string, Promise<void> | undefined> = {};
  const flags: { embedError: QueryResponse["error"] } = { embedError: null };
  const embedded = (columns: string): QueryResponse => {
    const trip = responses.trips ?? { data: null, error: null };
    const tables = [...columns.matchAll(/(\w+)\(/g)].map((match) => match[1]);
    const failure = flags.embedError ?? trip.error ?? tables.map((table) => responses[table]?.error).find(Boolean) ?? null;
    if (failure) return { data: null, error: failure };
    if (!trip.data) return trip;
    const row: Record<string, unknown> = { ...(trip.data as object) };
    for (const table of tables) row[table] = responses[table]?.data ?? [];
    return { data: row, error: null };
  };
  const from = (table: string) => {
    calls.push(table);
    let response = responses[table] ?? { data: [], error: null };
    const hold = holds[table];
    delete holds[table];
    const respond = () => (hold ?? Promise.resolve()).then(() => response);
    const builder = {
      select: (columns: string) => {
        selects.push(`${table}:${columns}`);
        // A version check reads only data_version, like PostgREST would return it.
        if (table === "trips" && columns === "data_version" && response.data) {
          const row = response.data as { data_version?: number };
          response = row.data_version === undefined
            ? { data: null, error: { message: "column trips.data_version does not exist" } }
            : { data: { data_version: row.data_version }, error: null };
        }
        if (table === "trips" && columns.includes("(")) response = embedded(columns);
        return builder;
      },
      eq: () => builder,
      order: () => builder,
      maybeSingle: respond,
      then: <T>(resolve: (value: QueryResponse) => T) => respond().then(resolve),
    };
    return builder;
  };
  return { backend: { from } as unknown as BackendClient, calls, selects, responses, holds, flags };
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

  it("loads the whole trip in one request", async () => {
    const { backend, calls, selects } = createFakeBackend(okResponses());
    const { result } = renderTripData(backend);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toEqual(["trips"]);
    expect(selects[0]).toContain("photos(*)");
    expect(selects[0]).not.toContain("admin_requests");
    expect(result.current.data.trip).toEqual(demoTrip);
    expect(result.current.data.routeSegments).toEqual(demoRoutes);
  });

  it("embeds admin requests for a signed-in user", async () => {
    const responses = okResponses();
    responses.admin_requests = { data: [{ id: "request-1", trip_id: demoTrip.id }], error: null };
    const { backend, calls, selects } = createFakeBackend(responses);
    const { result } = renderTripData(backend, fakeUser);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toEqual(["trips"]);
    expect(selects[0]).toContain("admin_requests(*)");
    expect(result.current.data.adminRequests).toEqual([{ id: "request-1", trip_id: demoTrip.id }]);
  });

  it("falls back to one query per table when the embedded request fails", async () => {
    const fake = createFakeBackend(okResponses());
    fake.flags.embedError = { message: "Could not find a relationship between 'trips' and 'days'" };
    const { result } = renderTripData(fake.backend);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fake.calls).toEqual(expect.arrayContaining(["trips", "days", "photos", "notes", "trip_members"]));
    expect(result.current.error).toBeNull();
    expect(result.current.data.notes).toEqual(demoNotes);
  });

  it("starts the first load without waiting for the session check", async () => {
    const { backend, calls } = createFakeBackend(okResponses());
    const { result } = renderHook(() => useTripData({ backend, user: null, authLoading: true, tripSlug: demoTrip.slug, initialData: emptyTripData }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(calls).toEqual(["trips"]);
    expect(result.current.data.trip).toEqual(demoTrip);
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

  it("does not let a poll that read the database before a save overwrite the post-save reload", async () => {
    const fake = createFakeBackend(okResponses());
    const { result } = renderTripData(fake.backend);
    await waitFor(() => expect(result.current.loading).toBe(false));

    let releasePoll!: () => void;
    fake.holds.trips = new Promise((resolve) => { releasePoll = resolve; });
    let poll!: Promise<void>;
    await act(async () => {
      poll = result.current.loadData({ silent: true });
      for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
    });
    // The poll has read the old notes and is stuck in flight.
    expect(fake.holds.trips).toBeUndefined();

    // A save lands, then the mutation reloads.
    fake.responses.notes = { data: [{ ...demoNotes[0], body: "Saved" }], error: null };
    let reload!: Promise<void>;
    await act(async () => {
      reload = result.current.loadData();
      for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
    });
    await act(async () => {
      releasePoll();
      await Promise.all([poll, reload]);
    });

    expect(result.current.data.notes[0].body).toBe("Saved");
    expect(result.current.loading).toBe(false);
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

  it("polls a member's trip again after 30 seconds while the document is visible", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { backend, calls } = createFakeBackend(okResponses());
    const { result } = renderTripData(backend, fakeUser);
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

  it("polls a guest's trip every 3 minutes instead of every 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { backend, calls } = createFakeBackend(okResponses());
    renderTripData(backend);
    await flushLoad();
    const tripCalls = () => calls.filter((table) => table === "trips").length;
    expect(tripCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(179_999);
    });
    expect(tripCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flushLoad();
    expect(tripCalls()).toBe(2);
  });

  it("refreshes when the tab regains focus, but not right after a sync", async () => {
    const { backend, calls } = createFakeBackend(okResponses());
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { result } = renderTripData(backend);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const tripCalls = () => calls.filter((table) => table === "trips").length;
    expect(tripCalls()).toBe(1);

    now.mockReturnValue(1_000_000 + 5_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flushLoad();
    expect(tripCalls()).toBe(1);

    now.mockReturnValue(1_000_000 + 20_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flushLoad();
    expect(tripCalls()).toBe(2);
  });

  it("skips the full reload when trips.data_version has not changed", async () => {
    const fake = createFakeBackend(okResponses());
    fake.responses.trips = { data: { ...demoTrip, data_version: 7 }, error: null };
    const { result } = renderTripData(fake.backend);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const loaded = result.current.data;
    // The version stays out of the trip object the UI sees.
    expect(loaded.trip).toEqual(demoTrip);

    fake.calls.length = 0;
    fake.responses.notes = { data: [{ ...demoNotes[0], body: "Edited" }], error: null };
    await act(async () => {
      await result.current.loadData({ silent: true });
    });
    // Only the one-column version check ran; the stale notes were not fetched.
    expect(fake.calls).toEqual(["trips"]);
    expect(fake.selects.at(-1)).toBe("trips:data_version");
    expect(result.current.data).toBe(loaded);

    // A write bumps the version, so the next poll downloads the trip again.
    fake.responses.trips = { data: { ...demoTrip, data_version: 8 }, error: null };
    await act(async () => {
      await result.current.loadData({ silent: true });
    });
    expect(result.current.data.notes[0].body).toBe("Edited");
  });

  it("does a full reload on every poll when data_version is not deployed yet", async () => {
    const fake = createFakeBackend(okResponses());
    const { result } = renderTripData(fake.backend);
    await waitFor(() => expect(result.current.loading).toBe(false));

    fake.responses.notes = { data: [{ ...demoNotes[0], body: "Edited" }], error: null };
    await act(async () => {
      await result.current.loadData({ silent: true });
    });
    expect(fake.selects).not.toContain("trips:data_version");
    expect(result.current.data.notes[0].body).toBe("Edited");
  });

  it("reloads fully after a failed load even if the version did not change", async () => {
    const fake = createFakeBackend(okResponses());
    fake.responses.trips = { data: { ...demoTrip, data_version: 3 }, error: null };
    fake.responses.photos = { data: null, error: { message: "photos timed out" } };
    const { result } = renderTripData(fake.backend);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain("photos timed out");

    fake.responses.photos = { data: demoPhotos, error: null };
    await act(async () => {
      await result.current.loadData({ silent: true });
    });
    expect(fake.selects).toContain("photos:*");
    expect(result.current.data.photos).toHaveLength(demoPhotos.length);
  });

  it("does nothing without a backend", () => {
    const { result } = renderTripData(null);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(emptyTripData);
  });
});
