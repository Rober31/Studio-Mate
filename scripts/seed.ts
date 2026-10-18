// Development / demo data. Run with: npm run seed  (use --force to add another demo studio)
import { ready } from "../src/server/db";
import { seedDemo } from "../src/server/demo";

async function main() {
  await ready();
  const r = await seedDemo(process.argv.includes("--force"));
  if (!r) return console.log("Database already has data. Use --force to add another demo studio.");
  console.log(`Seeded studio ${r.studioId}: ${r.contacts} contacts, ${r.sessions} sessions, ${r.suggestions} follow-up suggestions.`);
  console.log(`Owner: ${r.owner} / ${r.password}`);
  console.log(`Staff: staff@studiomate.app / ${r.password} · Instructor: instructor@studiomate.app / ${r.password}`);
  console.log(`Public registration page: /s/${r.slug}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
