import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Deliberately uses a plain, unextended PrismaClient — bootstrapping the very first super_admin
// (organizationId: null) is a one-off script, not a web request, so it has no need for the
// tenant-scoping extension in lib/prisma.js.
const prisma = new PrismaClient();

async function main() {
  const name = process.env.SEED_SUPER_ADMIN_NAME || 'Cazone GS&M Admin';
  const username = (process.env.SEED_SUPER_ADMIN_USERNAME || 'superadmin').toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  if (!password) {
    console.error('Set SEED_SUPER_ADMIN_PASSWORD in your .env before seeding.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`super_admin "${username}" already exists — nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name, username, passwordHash, role: 'super_admin', organizationId: null },
  });
  console.log(`Created super_admin "${username}". Sign in at /login.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
