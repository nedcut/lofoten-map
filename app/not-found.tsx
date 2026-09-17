import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonClassName } from "@/components/ui/button-styles";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-mist p-6">
      <div className="w-full max-w-md rounded-panel border border-stone-200/80 bg-paper/96 p-8 text-center shadow-xl">
        <Compass className="mx-auto h-10 w-10 text-teal-700" />
        <h1 className="mt-4 font-serif text-3xl font-semibold text-stone-950">Off the trail</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">This page does not exist. The whole logbook lives on the map.</p>
        <Link href="/" className={buttonClassName({ tone: "fjord", className: "mt-6" })}>
          Back to the map
        </Link>
      </div>
    </main>
  );
}
