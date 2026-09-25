// @vitest-environment jsdom
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendClient } from "@/lib/backend";
import { demoTripData } from "@/lib/demo-trip";
import type { TripData } from "@/types/trip";
import { useTripMutations } from "./useTripMutations";

const deleteObjectsMock = vi.hoisted(() => vi.fn(async () => ({ error: null as { message: string } | null })));
vi.mock("@/lib/object-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/object-store")>()),
  deleteObjects: deleteObjectsMock,
}));

type QueryResponse = { data: unknown; error: { message: string } | null };
type Call = { table: string; op: string; payload?: unknown };

/** Chainable fake of the Neon client that records the write operations issued. */
function createFakeBackend(responses: Record<string, QueryResponse> = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const respond = () => responses[table] ?? { data: [{ id: "row" }], error: null };
    const builder = {
      update: (payload: unknown) => {
        calls.push({ table, op: "update", payload });
        return builder;
      },
      insert: (payload: unknown) => {
        calls.push({ table, op: "insert", payload });
        return builder;
      },
      delete: () => {
        calls.push({ table, op: "delete" });
        return builder;
      },
      select: () => builder,
      eq: () => builder,
      then: <T>(resolve: (value: QueryResponse) => T) => Promise.resolve(respond()).then(resolve),
    };
    return builder;
  };
  return { backend: { from } as unknown as BackendClient, calls };
}

// Demo photos are inline data URIs with no storage path; the delete tests need
// a photo whose files actually live in the object store.
const storedPhoto = { ...demoTripData.photos[0], id: "photo-stored", image_path: "trip/photo.jpg", thumbnail_path: "trip/photo-thumb.jpg" };
const tripDataWithStoredPhoto: TripData = { ...demoTripData, photos: [storedPhoto, ...demoTripData.photos] };

function renderMutations(backend: BackendClient | null, initial: TripData = demoTripData, selectedDayId: string | null = null) {
  const loadData = vi.fn(async () => {});
  const setGlobalError = vi.fn();
  const selectDay = vi.fn();
  const hook = renderHook(() => {
    const [data, setData] = useState(initial);
    const mutations = useTripMutations({ backend, user: null, isAdmin: true, data, setData, loadData, selectedDayId, selectDay, setGlobalError });
    return { data, mutations };
  });
  return { ...hook, loadData, setGlobalError, selectDay };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("useTripMutations", () => {
  describe("updateNote", () => {
    const noteId = demoTripData.notes[0].id;
    const input = { day_id: null, author_name: "Maja", body: "Edited body" };

    it("writes to the backend, reports success, and reloads", async () => {
      const { backend, calls } = createFakeBackend();
      const { result, loadData, setGlobalError } = renderMutations(backend);

      await act(async () => {
        await result.current.mutations.updateNote(noteId, input);
      });

      expect(calls).toEqual([{ table: "notes", op: "update", payload: input }]);
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(result.current.mutations.status.message).toBe("Note updated.");
      expect(result.current.mutations.status.tone).toBe("info");
      expect(result.current.mutations.status.isSaving).toBe(false);
      // The global pill is cleared at the start of every operation, never set.
      expect(setGlobalError).toHaveBeenCalledWith(null);
      expect(setGlobalError).not.toHaveBeenCalledWith(expect.any(String));
      // In backend mode local state is refreshed by loadData, not patched.
      expect(result.current.data).toBe(demoTripData);
    });

    it("refuses shared-backend writes on a Vercel preview", async () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      const { backend, calls } = createFakeBackend();
      const { result, loadData, setGlobalError } = renderMutations(backend);

      await act(async () => {
        await result.current.mutations.updateNote(noteId, input);
      });

      expect(calls).toEqual([]);
      expect(loadData).not.toHaveBeenCalled();
      expect(setGlobalError).toHaveBeenLastCalledWith(
        "This preview is view-only. Open the live app to add or edit trip data.",
      );
    });

    it("surfaces a backend error and leaves local state untouched", async () => {
      const { backend } = createFakeBackend({ notes: { data: null, error: { message: "row level security" } } });
      const { result, loadData, setGlobalError } = renderMutations(backend);

      await act(async () => {
        await result.current.mutations.updateNote(noteId, input);
      });

      expect(loadData).not.toHaveBeenCalled();
      expect(setGlobalError).toHaveBeenLastCalledWith("row level security");
      expect(result.current.mutations.status.message).toBe("row level security");
      expect(result.current.mutations.status.tone).toBe("error");
      expect(result.current.mutations.status.isSaving).toBe(false);
      expect(result.current.data).toBe(demoTripData);
    });

    it("patches local state directly in demo mode", async () => {
      const { result, loadData } = renderMutations(null);

      await act(async () => {
        await result.current.mutations.updateNote(noteId, input);
      });

      expect(loadData).not.toHaveBeenCalled();
      expect(result.current.data.notes[0]).toMatchObject(input);
      expect(result.current.data.notes[0].id).toBe(noteId);
      expect(result.current.mutations.status.message).toBe("Note updated.");
    });
  });

  describe("updatePhoto", () => {
    const photo = demoTripData.photos[0];
    const input = { day_id: photo.day_id, uploader_name: photo.uploader_name, caption: "New caption", lat: photo.lat, lng: photo.lng, taken_at: photo.taken_at };

    it("updates the caption and reloads when a row was written", async () => {
      const { backend, calls } = createFakeBackend({ photos: { data: [{ id: photo.id }], error: null } });
      const { result, loadData } = renderMutations(backend);

      await act(async () => {
        await result.current.mutations.updatePhoto(photo.id, input);
      });

      expect(calls).toEqual([{ table: "photos", op: "update", payload: input }]);
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(result.current.mutations.status.message).toBe("Photo updated.");
    });

    it("treats a zero-row update as a permission failure and reloads to restore server truth", async () => {
      const { backend } = createFakeBackend({ photos: { data: [], error: null } });
      const { result, loadData, setGlobalError } = renderMutations(backend);

      await act(async () => {
        await result.current.mutations.updatePhoto(photo.id, input);
      });

      expect(loadData).toHaveBeenCalledTimes(1);
      expect(result.current.mutations.status.tone).toBe("error");
      expect(result.current.mutations.status.message).toContain("may not have permission");
      expect(setGlobalError).toHaveBeenLastCalledWith(expect.stringContaining("may not have permission"));
    });

    it("reports a backend error without reloading", async () => {
      const { backend } = createFakeBackend({ photos: { data: null, error: { message: "network down" } } });
      const { result, loadData, setGlobalError } = renderMutations(backend);

      await act(async () => {
        await result.current.mutations.updatePhoto(photo.id, input);
      });

      expect(loadData).not.toHaveBeenCalled();
      expect(setGlobalError).toHaveBeenLastCalledWith("network down");
      expect(result.current.data).toBe(demoTripData);
    });
  });

  describe("deleteDataItem", () => {
    it("deletes a photo row, removes its stored files, and reloads", async () => {
      const { backend, calls } = createFakeBackend();
      const { result, loadData } = renderMutations(backend, tripDataWithStoredPhoto);

      await act(async () => {
        await result.current.mutations.deleteDataItem("photos", storedPhoto.id);
      });

      expect(calls).toEqual([{ table: "photos", op: "delete" }]);
      expect(deleteObjectsMock).toHaveBeenCalledWith(backend, "trip-photos", ["trip/photo.jpg", "trip/photo-thumb.jpg"]);
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(result.current.mutations.status.message).toBe("Item deleted.");
    });

    it("reports a failed delete and skips file cleanup and reload", async () => {
      const { backend } = createFakeBackend({ photos: { data: null, error: { message: "delete denied" } } });
      const { result, loadData, setGlobalError } = renderMutations(backend, tripDataWithStoredPhoto);

      await act(async () => {
        await result.current.mutations.deleteDataItem("photos", storedPhoto.id);
      });

      expect(deleteObjectsMock).not.toHaveBeenCalled();
      expect(loadData).not.toHaveBeenCalled();
      expect(setGlobalError).toHaveBeenLastCalledWith("delete denied");
      expect(result.current.data).toBe(tripDataWithStoredPhoto);
    });

    it("keeps the row deleted but reports when file cleanup fails", async () => {
      deleteObjectsMock.mockResolvedValueOnce({ error: { message: "storage offline" } });
      const { backend } = createFakeBackend();
      const { result, loadData, setGlobalError } = renderMutations(backend, tripDataWithStoredPhoto);

      await act(async () => {
        await result.current.mutations.deleteDataItem("photos", storedPhoto.id);
      });

      expect(loadData).toHaveBeenCalledTimes(1);
      expect(setGlobalError).toHaveBeenLastCalledWith("Item deleted, but photo file cleanup failed: storage offline");
    });

    it("clears the selected day when that day is deleted", async () => {
      const dayId = demoTripData.days[0].id;
      const { backend } = createFakeBackend();
      const { result, selectDay, loadData } = renderMutations(backend, demoTripData, dayId);

      await act(async () => {
        await result.current.mutations.deleteDataItem("days", dayId);
      });

      expect(selectDay).toHaveBeenCalledWith(null);
      expect(deleteObjectsMock).not.toHaveBeenCalled();
      expect(loadData).toHaveBeenCalledTimes(1);
    });

    it("removes the item from local state in demo mode", async () => {
      const noteId = demoTripData.notes[0].id;
      const { result, loadData } = renderMutations(null);

      await act(async () => {
        await result.current.mutations.deleteDataItem("notes", noteId);
      });

      expect(loadData).not.toHaveBeenCalled();
      expect(result.current.data.notes.find((note) => note.id === noteId)).toBeUndefined();
      expect(result.current.mutations.status.message).toBe("Item deleted.");
    });
  });
});
