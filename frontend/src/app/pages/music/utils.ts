export const clampProgress = (positionMs: number, durationMs: number) => {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (positionMs / durationMs) * 100));
};

export const formatTime = (milliseconds: number) => {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0:00';
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
};

export const getArtworkSource = (artworkBase64: string | null) => {
  if (!artworkBase64) return null;
  if (artworkBase64.startsWith('data:')) return artworkBase64;
  return `data:image/jpeg;base64,${artworkBase64}`;
};
