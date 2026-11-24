import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export function createDesktopEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: {
      RAEE_RENDERER_URL: z
        .url()
        .refine((value) => {
          const url = new URL(value);
          return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
        }, "RAEE_RENDERER_URL must be a local http URL.")
        .optional(),
      RAEE_FFMPEG: z.string().min(1).optional(),
      RAEE_FFPROBE: z.string().min(1).optional(),
    },
    runtimeEnv: { ...runtimeEnv },
    isServer: true,
    emptyStringAsUndefined: true,
  });
}
