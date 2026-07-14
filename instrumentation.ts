// Next.js server-startup hook — boots the local CSV data recorder
// (lib/recorder.ts) so live market data is persisted to D:\Newissue Data
// whenever the app is running.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRecorder } = await import("./lib/recorder");
    startRecorder();
  }
}
