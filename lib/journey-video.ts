export function videoFallbackDurationMs(durationSeconds: number, speed: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 30_000;
  return (durationSeconds * 1000) / Math.max(speed, 0.1);
}

type ControllableVideo = Pick<HTMLVideoElement, "pause" | "play">;

export function syncJourneyVideo(video: ControllableVideo, playing: boolean, onPlayRejected: () => void) {
  if (!playing) {
    video.pause();
    return;
  }
  void video.play().catch(onPlayRejected);
}
