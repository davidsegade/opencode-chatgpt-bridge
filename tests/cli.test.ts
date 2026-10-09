import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cli = ["exec", "tsx", "src/cli.ts"];

async function runCli(args: string[]): Promise<string> {
  try {
    return (await execFileAsync("pnpm", args, { timeout: 10000 })).stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return (await execFileAsync("corepack", ["pnpm", ...args], { timeout: 20000 })).stdout;
  }
}

describe("CLI", () => {
  it("prints help", async () => {
    const stdout = await runCli([...cli, "help"]);
    expect(stdout).toContain("opencode-chatgpt-bridge init");
    expect(stdout).toContain("opencode-chatgpt-bridge doctor");
  }, 60000);
});
