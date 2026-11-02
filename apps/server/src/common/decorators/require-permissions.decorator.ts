import { SetMetadata } from "@nestjs/common";

export const REQUIRE_PERMISSIONS_KEY = "requirePermissions";

/** Require all listed permission codes (AND). Empty / omitted = no check. */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, codes);
