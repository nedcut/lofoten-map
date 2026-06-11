import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#e7efe8] p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200/80 bg-[rgba(255,253,246,0.96)] p-8 text-center shadow-xl">
        <Compass className="mx-auto h-10 w-10 text-teal-700" />
        <h1 className="mt-4 font-serif text-3xl font-semibold text-stone-950">Off the trail</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">This page does not exist. The whole logbook lives on the map.</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98]"
        >
          Back to the map
        </Link>
      </div>
    </main>
  );
}
