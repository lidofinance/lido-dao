import path from "path";

import { log } from "lib";

/**
 * Executes a migration script.
 * @param {string} migrationFile - The path to the migration file.
 * @throws {Error} If the migration file doesn't export a 'main' function or if any error occurs during migration.
 */
async function migrate(migrationFile: string): Promise<void> {
  const fullPath = path.resolve(migrationFile);
  const { main } = await import(fullPath);

  if (typeof main !== "function") {
    throw new Error(`Migration file ${migrationFile} does not export a 'main' function!`);
  }

  log.scriptStart(migrationFile);
  await main();
  log.scriptFinish(migrationFile);
}

// Execute the script if it's run directly
if (require.main === module) {
  const step = process.env.STEP;
  if (!step) {
    log.error("Please provide a STEP environment variable!");
    process.exit(1);
  }

  const migrationFile = path.resolve(process.cwd(), `scripts/${step}`);

  migrate(migrationFile)
    .then(() => process.exit(0))
    .catch((error) => {
      log.error("Migration failed:", error);
      process.exit(1);
    });
}
