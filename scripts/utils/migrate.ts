import fs from "node:fs";
import path from "node:path";

import { applyMigrationScript, log } from "lib";

type StepsFile = {
  steps: string[];
};

const loadSteps = (stepsFile: string): string[] => {
  const stepsPath = path.resolve(process.cwd(), `scripts/${stepsFile}`);
  return (JSON.parse(fs.readFileSync(stepsPath, "utf8")) as StepsFile).steps;
};

const resolveMigrationFile = (step: string): string => {
  return path.resolve(process.cwd(), `scripts/${step}`);
};

const runMigrations = async (stepsFile: string): Promise<void> => {
  const steps = loadSteps(stepsFile);
  for (const step of steps) {
    const migrationFile = resolveMigrationFile(step);
    await applyMigrationScript(migrationFile);
  }
  process.exit(0);
};

// Execute the script if it's run directly
if (require.main === module) {
  const stepsFile = process.env.STEPS_FILE;
  if (!stepsFile) {
    log.error("Please provide a STEPS_FILE environment variable!");
    process.exit(1);
  }

  runMigrations(stepsFile).catch(() => process.exit(1));
}
