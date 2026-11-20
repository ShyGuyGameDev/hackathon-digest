// CLI: `npm run ingest` (add `-- --force` to bypass per-source intervals and the page cache).
import { openDatabase, isMockDatabase } from "../server/db.ts";
import { runIngestion } from "./pipeline.ts";
import { SOURCE_PRIORITIES, SOURCES } from "./sources/index.ts";

const db = openDatabase();
if (isMockDatabase(db)) {
  console.error("Refusing to ingest real data into a mock database. Point DATABASE_PATH at a real database.");
  process.exit(1);
}
const report = await runIngestion(db, SOURCES, {
  force: process.argv.includes("--force"),
  extraPriorities: SOURCE_PRIORITIES,
  log: (m) => console.log(m),
});
console.log(JSON.stringify(report, null, 2));
const failed = report.sources.some((s) => s.error);
process.exit(failed ? 1 : 0);
