// Run `worker` over every item with at most `limit` in flight at once.
// Workers are expected to handle their own failures; a rejection here would
// abort the whole batch, so callers collect per-item errors internally.
export async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const next = items[index++];
      await worker(next);
    }
  });
  await Promise.all(runners);
}
