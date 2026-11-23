import { HttpError } from "./types";

export function validateInstallHash(v: unknown): string {
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) {
    throw new HttpError(400, "invalid_install_hash");
  }
  return v;
}
