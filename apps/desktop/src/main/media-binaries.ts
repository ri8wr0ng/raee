import { createRequire } from "node:module";
import { join } from "node:path";
import { createDesktopEnv } from "@raee/env/desktop";

export function mediaBinaries(
  environment: NodeJS.ProcessEnv = process.env,
  resourcesPath?: string,
) {
  const env = createDesktopEnv(environment);
  const require = createRequire(import.meta.url);
  const suffix = process.platform === "win32" ? ".exe" : "";
  const ffmpeg =
    env.RAEE_FFMPEG ||
    (resourcesPath
      ? join(resourcesPath, "media", `ffmpeg${suffix}`)
      : (require("ffmpeg-static") as string | null));
  const ffprobePath =
    env.RAEE_FFPROBE ||
    (resourcesPath
      ? join(resourcesPath, "media", `ffprobe${suffix}`)
      : (require("ffprobe-static") as { path: string }).path);
  if (!ffmpeg || !ffprobePath)
    throw new Error(
      "Native media binaries are unavailable for this platform. Set RAEE_FFMPEG and RAEE_FFPROBE to installed executable paths.",
    );
  return { ffmpeg, ffprobe: ffprobePath };
}
