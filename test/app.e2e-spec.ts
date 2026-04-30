import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";

import { HttpExceptionFilter } from "../src/common/errors/http-exception.filter";
import { AppModule } from "../src/app.module";

describe("Health (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health returns ok", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toMatch(/ok|degraded/);
    expect(response.body.checks.database).toMatch(/ok|down/);
    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("GET /api/v1/missing returns RFC 7807 problem details", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/missing");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).toMatchObject({
      type: "about:blank",
      status: 404,
    });
    expect(typeof response.body.code).toBe("string");
    expect(typeof response.body.request_id).toBe("string");
  });
});
