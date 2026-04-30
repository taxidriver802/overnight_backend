import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { PrismaService } from "../prisma/prisma.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth(): Promise<{
    status: "ok" | "degraded";
    uptime_ms: number;
    checks: { database: "ok" | "down" };
    latency_ms: number;
  }> {
    const startedAt = Date.now();
    let database: "ok" | "down" = "ok";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "down";
    }

    return {
      status: database === "ok" ? "ok" : "degraded",
      uptime_ms: Math.round(process.uptime() * 1000),
      checks: { database },
      latency_ms: Date.now() - startedAt,
    };
  }
}
