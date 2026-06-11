"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

// Catches render/runtime errors below the root layout (e.g. a Mapbox GL
// failure on a quirky GPU driver) and offers a retry instead of Next's
// default crash screen.
export default function TripError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#e7efe8] p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200/80 bg-[rgba(255,253,246,0.96)] p-8 text-center shadow-xl">
        <AlertCircle className="mx-auto h-10 w-10 text-rose-600" />
        <h1 className="mt-4 font-serif text-3xl font-semibold text-stone-950">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          The logbook hit an unexpected error. Your trip data is safe — reloading usually clears it up.
        </p>
        <button
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98]"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    </main>
  );
}
