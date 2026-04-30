import { randomUUID } from "node:crypto";

import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";

import "dotenv/config";

import { HttpExceptionFilter } from "../src/common/errors/http-exception.filter";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

describe("Auth (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const deviceId = "e2e-device-1";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.updateMany({
      where: { employeeId: "9003" },
      data: {
        lockoutUntil: null,
        failedPinAttempts: 0,
        lastFailedPinAt: null,
      },
    });
    await app.close();
  });

  function idem(): { "idempotency-key": string } {
    return { "idempotency-key": randomUUID() };
  }

  it("POST /auth/login returns 400 without Idempotency-Key", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ employee_id: "9003", pin: "4242", device_id: deviceId });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body.code).toBe("MISSING_IDEMPOTENCY_KEY");
  });

  it("POST /auth/login succeeds and GET /auth/me returns user", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(idem())
      .send({ employee_id: "9003", pin: "4242", device_id: deviceId });

    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeDefined();
    expect(login.body.refresh_token).toBeDefined();
    expect(login.body.user.employee_id).toBe("9003");
    expect(login.body.user.role).toBe("guard");

    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.access_token}`);

    expect(me.status).toBe(200);
    expect(me.body.employee_id).toBe("9003");
  });

  it("POST /auth/refresh rotates refresh token", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(idem())
      .send({ employee_id: "9002", pin: "4242", device_id: "e2e-device-refresh" });

    expect(login.status).toBe(200);
    const firstRefresh = login.body.refresh_token;

    const refresh1 = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set(idem())
      .send({ refresh_token: firstRefresh, device_id: "e2e-device-refresh" });

    expect(refresh1.status).toBe(200);
    expect(refresh1.body.refresh_token).not.toBe(firstRefresh);
    expect(refresh1.body.access_token).toBeDefined();

    const replay = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set(idem())
      .send({ refresh_token: firstRefresh, device_id: "e2e-device-refresh" });

    expect(replay.status).toBe(401);
  });

  it("lockout after repeated failed PIN attempts", async () => {
    await prisma.user.update({
      where: { employeeId: "9003" },
      data: { lockoutUntil: null, failedPinAttempts: 0, lastFailedPinAt: null },
    });

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .set(idem())
        .send({ employee_id: "9003", pin: "0000", device_id: "e2e-lockout" });
      expect(res.status).toBe(401);
    }

    const locked = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set(idem())
      .send({ employee_id: "9003", pin: "4242", device_id: "e2e-lockout" });

    expect(locked.status).toBe(401);
    expect(locked.body.code).toBe("AUTH_ACCOUNT_LOCKED");
  });
});
