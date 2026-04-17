import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { parse } from 'yaml';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function main() {
  const fixturesDir = join(__dirname, '../../../fixtures/projects');
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.yaml'));

  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), 'utf8');
    const def = parse(raw);

    await prisma.projectDefinition.upsert({
      where: { slug: def.slug },
      update: {
        name: def.name,
        language: def.language,
        tests_path: def.tests_path,
        runner_image_repo: def.runner_image_repo,
        runner_image_digest: def.runner_image_digest,
        hermetic: def.hermetic ?? true,
        egress_allowlist: def.egress_allowlist ?? [],
        timeout_seconds: def.timeout_seconds ?? 600,
        resource_limits: def.resource_limits,
        harness_entrypoint: def.harness_entrypoint,
      },
      create: {
        id: ulid(),
        slug: def.slug,
        name: def.name,
        language: def.language,
        tests_path: def.tests_path,
        runner_image_repo: def.runner_image_repo,
        runner_image_digest: def.runner_image_digest,
        hermetic: def.hermetic ?? true,
        egress_allowlist: def.egress_allowlist ?? [],
        timeout_seconds: def.timeout_seconds ?? 600,
        resource_limits: def.resource_limits,
        harness_entrypoint: def.harness_entrypoint,
      },
    });

    console.log(`upserted project: ${def.slug}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
