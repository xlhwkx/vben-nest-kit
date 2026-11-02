import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export type AuthUser = {
  userId: string;
  username: string;
  tokenVersion: number;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return req.user;
  },
);
