import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "./decorators/current-user.decorator";
import type { JwtUser } from "./auth.types";
import { AuthService } from "./auth.service";
import { loginBodySchema, refreshBodySchema } from "./dto/auth.schemas";
import { IdempotencyHeaderGuard } from "./guards/idempotency-header.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @UseGuards(IdempotencyHeaderGuard)
  login(@Body() body: unknown) {
    const parsed = loginBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join(".") || "(root)",
          message: i.message,
        })),
      });
    }
    return this.auth.login(parsed.data);
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(IdempotencyHeaderGuard)
  refresh(@Body() body: unknown) {
    const parsed = refreshBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join(".") || "(root)",
          message: i.message,
        })),
      });
    }
    return this.auth.refresh(parsed.data);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(IdempotencyHeaderGuard, JwtAuthGuard)
  @ApiBearerAuth()
  async logout(@CurrentUser() user: JwtUser): Promise<void> {
    await this.auth.logout(user.sessionId, user.userId);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: JwtUser) {
    return this.auth.getMe(user.userId);
  }
}
