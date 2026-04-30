import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";

import type { User } from "@prisma/client";

import type { Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginBody, RefreshBody } from "./dto/auth.schemas";
import type { AuthTokensResponse, JwtPayload, PublicUser } from "./auth.types";
import { toPublicUser } from "./auth.types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private hashRefresh(raw: string): string {
    return createHash("sha256").update(raw, "utf8").digest("hex");
  }

  private refreshExpiresAt(): Date {
    const days = this.config.get("REFRESH_TOKEN_DAYS", { infer: true });
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private async signAccess(user: User, sessionId: string): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      employee_id: user.employeeId,
      role: user.role,
      sid: sessionId,
    };
    const expiresSec = this.config.get("JWT_ACCESS_EXPIRES_SEC", { infer: true });
    return this.jwt.sign(payload as object, { expiresIn: expiresSec });
  }

  private async recordFailedPin(user: User): Promise<void> {
    const now = new Date();
    const windowMinutes = this.config.get("LOCKOUT_WINDOW_MINUTES", { infer: true });
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = new Date(now.getTime() - windowMs);

    const inWindow =
      user.lastFailedPinAt !== null && user.lastFailedPinAt >= windowStart;

    const maxAttempts = this.config.get("MAX_PIN_ATTEMPTS", { infer: true });
    const lockoutMinutes = this.config.get("LOCKOUT_DURATION_MINUTES", { infer: true });

    if (!inWindow) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: 1, lastFailedPinAt: now },
      });
      return;
    }

    const next = user.failedPinAttempts + 1;
    if (next >= maxAttempts) {
      const lockoutUntil = new Date(now.getTime() + lockoutMinutes * 60 * 1000);
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedPinAttempts: next,
          lastFailedPinAt: now,
          lockoutUntil,
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: next, lastFailedPinAt: now },
      });
    }
  }

  async login(dto: LoginBody): Promise<AuthTokensResponse> {
    const user = await this.prisma.user.findFirst({
      where: { employeeId: dto.employee_id, deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException({
        message: "Invalid credentials",
        code: "AUTH_INVALID_CREDENTIALS",
      });
    }

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      throw new UnauthorizedException({
        message: "Account temporarily locked",
        code: "AUTH_ACCOUNT_LOCKED",
        details: [{ path: "pin", message: "Too many failed attempts. Try again later." }],
      });
    }

    const ok =
      dto.pin.length >= 4 &&
      dto.pin.length <= 6 &&
      /^\d+$/.test(dto.pin) &&
      (await bcrypt.compare(dto.pin, user.pinHash));

    if (!ok) {
      await this.recordFailedPin(user);
      throw new UnauthorizedException({
        message: "Invalid credentials",
        code: "AUTH_INVALID_CREDENTIALS",
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedPinAttempts: 0, lastFailedPinAt: null },
    });

    let session = await this.prisma.deviceSession.findFirst({
      where: { userId: user.id, deviceId: dto.device_id, revokedAt: null },
    });

    if (session) {
      await this.prisma.refreshToken.updateMany({
        where: { sessionId: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      session = await this.prisma.deviceSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    } else {
      session = await this.prisma.deviceSession.create({
        data: { userId: user.id, deviceId: dto.device_id },
      });
    }

    const refreshRaw = randomBytes(48).toString("base64url");
    const tokenHash = this.hashRefresh(refreshRaw);
    const expiresAt = this.refreshExpiresAt();

    await this.prisma.refreshToken.create({
      data: { sessionId: session.id, tokenHash, expiresAt },
    });

    const access_token = await this.signAccess(user, session.id);

    return {
      access_token,
      refresh_token: refreshRaw,
      user: toPublicUser(user),
    };
  }

  async refresh(dto: RefreshBody): Promise<AuthTokensResponse> {
    const tokenHash = this.hashRefresh(dto.refresh_token);
    const now = new Date();

    const rows = await this.prisma.refreshToken.findMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      take: 5,
      include: { session: { include: { user: true } } },
    });

    const row = rows.find(
      (r) =>
        r.session.deviceId === dto.device_id &&
        r.session.revokedAt === null &&
        r.session.user.deletedAt === null,
    );

    if (!row) {
      throw new UnauthorizedException({
        message: "Invalid or expired refresh token",
        code: "AUTH_INVALID_REFRESH",
      });
    }

    const user = row.session.user;

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      throw new UnauthorizedException({
        message: "Account temporarily locked",
        code: "AUTH_ACCOUNT_LOCKED",
      });
    }

    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    await this.prisma.deviceSession.update({
      where: { id: row.sessionId },
      data: { lastSeenAt: new Date() },
    });

    const refreshRaw = randomBytes(48).toString("base64url");
    const newHash = this.hashRefresh(refreshRaw);
    const expiresAt = this.refreshExpiresAt();

    await this.prisma.refreshToken.create({
      data: { sessionId: row.sessionId, tokenHash: newHash, expiresAt },
    });

    const access_token = await this.signAccess(user, row.sessionId);

    return {
      access_token,
      refresh_token: refreshRaw,
      user: toPublicUser(user),
    };
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.deviceSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
    if (!session) {
      return;
    }
    await this.prisma.refreshToken.updateMany({
      where: { sessionId: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.deviceSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException({
        message: "User not found",
        code: "AUTH_USER_NOT_FOUND",
      });
    }
    return toPublicUser(user);
  }
}
