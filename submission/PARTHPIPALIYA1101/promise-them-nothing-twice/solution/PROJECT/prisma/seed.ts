import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding initial plans and customers...');

  // Seed Plans
  const basicPlan = await prisma.plan.upsert({
    where: { name: 'BASIC' },
    update: {
      rpmLimit: 100,
      burstLimit: 100,
    },
    create: {
      name: 'BASIC',
      rpmLimit: 100,
      burstLimit: 100,
    },
  });

  const premiumPlan = await prisma.plan.upsert({
    where: { name: 'PREMIUM' },
    update: {
      rpmLimit: 300,
      burstLimit: 300,
    },
    create: {
      name: 'PREMIUM',
      rpmLimit: 300,
      burstLimit: 300,
    },
  });

  const enterprisePlan = await prisma.plan.upsert({
    where: { name: 'ENTERPRISE' },
    update: {
      rpmLimit: 1000,
      burstLimit: 1000,
    },
    create: {
      name: 'ENTERPRISE',
      rpmLimit: 1000,
      burstLimit: 1000,
    },
  });

  console.log('Plans seeded successfully:', {
    basic: basicPlan.id,
    premium: premiumPlan.id,
    enterprise: enterprisePlan.id,
  });

  // Seed Demo Customers
  const customerBasic = await prisma.customer.upsert({
    where: { email: 'alice.basic@example.com' },
    update: {},
    create: {
      name: 'Alice Basic',
      email: 'alice.basic@example.com',
      planId: basicPlan.id,
      queueEnabled: true,
    },
  });

  const customerPremium = await prisma.customer.upsert({
    where: { email: 'bob.premium@example.com' },
    update: {},
    create: {
      name: 'Bob Premium',
      email: 'bob.premium@example.com',
      planId: premiumPlan.id,
      queueEnabled: true,
    },
  });

  const customerEnterprise = await prisma.customer.upsert({
    where: { email: 'charlie.enterprise@example.com' },
    update: {},
    create: {
      name: 'Charlie Enterprise',
      email: 'charlie.enterprise@example.com',
      planId: enterprisePlan.id,
      customRpmLimit: 1200,
      customBurstLimit: 1500,
      queueEnabled: true,
    },
  });

  console.log('Customers seeded successfully:', [
    customerBasic.email,
    customerPremium.email,
    customerEnterprise.email,
  ]);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
