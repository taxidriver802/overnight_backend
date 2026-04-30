import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Dev accounts — PIN for all: `4242` (4 digits). BCRYPT cost from env or 12.
 * employee_id: 9001 admin, 9002 manager, 9003 guard
 */
const DEV_PIN = "4242";
const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

async function main(): Promise<void> {
  const existing = await prisma.property.findFirst({
    where: { name: "Default Hotel", deletedAt: null },
  });

  if (!existing) {
    await prisma.property.create({
      data: { name: "Default Hotel", timezone: "America/Chicago" },
    });
    console.log("Seeded default property.");
  } else {
    console.log("Default property already present, skipping.");
  }

  const pinHash = await bcrypt.hash(DEV_PIN, BCRYPT_COST);

  const users: Array<{ employeeId: string; name: string; role: UserRole }> = [
    { employeeId: "9001", name: "Dev Admin", role: UserRole.ADMIN },
    { employeeId: "9002", name: "Dev Manager", role: UserRole.MANAGER },
    { employeeId: "9003", name: "Dev Guard", role: UserRole.GUARD },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { employeeId: u.employeeId },
      update: {
        name: u.name,
        role: u.role,
        pinHash,
        deletedAt: null,
        lockoutUntil: null,
        failedPinAttempts: 0,
        lastFailedPinAt: null,
      },
      create: {
        employeeId: u.employeeId,
        name: u.name,
        role: u.role,
        pinHash,
      },
    });
  }

  console.log(`Seeded ${users.length} dev users (PIN=${DEV_PIN}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
