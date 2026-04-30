import { CanActivate, ExecutionContext, Injectable, BadRequestException } from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class IdempotencyHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const raw = request.headers["idempotency-key"];
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!key) {
      throw new BadRequestException({
        message: "Idempotency-Key header is required",
        code: "MISSING_IDEMPOTENCY_KEY",
        details: [{ path: "Idempotency-Key", message: "Required on mutating requests" }],
      });
    }
    return true;
  }
}
