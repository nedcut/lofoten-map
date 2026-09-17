"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Catches render/runtime errors below the root layout (e.g. a Mapbox GL
// failure on a quirky GPU driver) and offers a retry instead of Next's
// default crash screen.
export default function TripError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-mist p-6">
      <div className="w-full max-w-md rounded-panel border border-stone-200/80 bg-paper/96 p-8 text-center shadow-xl">
        <AlertCircle className="mx-auto h-10 w-10 text-rose-600" />
        <h1 className="mt-4 font-serif text-3xl font-semibold text-stone-950">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          The logbook hit an unexpected error. Your trip data is safe — reloading usually clears it up.
        </p>
        <Button tone="fjord" onClick={reset} className="mt-6">
          <RotateCcw className="h-4 w-4" /> Try again
        </Button>
      </div>
    </main>
  );
}
