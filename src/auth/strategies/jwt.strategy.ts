import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

import type { Env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import type { JwtPayload } from "../auth.types";
import type { JwtUser } from "../auth.types";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get("JWT_ACCESS_SECRET", { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUser> {
    const session = await this.prisma.deviceSession.findFirst({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null },
    });
    if (!session) {
      throw new UnauthorizedException({
        message: "Session invalid or revoked",
        code: "AUTH_SESSION_INVALID",
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException({
        message: "User not found",
        code: "AUTH_USER_NOT_FOUND",
      });
    }

    if (user.employeeId !== payload.employee_id || user.role !== payload.role) {
      throw new UnauthorizedException({
        message: "Token no longer valid",
        code: "AUTH_TOKEN_STALE",
      });
    }

    return {
      userId: user.id,
      employeeId: user.employeeId,
      role: user.role,
      sessionId: session.id,
    };
  }
}
