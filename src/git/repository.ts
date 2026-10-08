import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { realpath, readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

type ExecResult = {
  stdout: string;
  stderr: string;
};

async function git(repoPath: string, args: string[]): Promise<ExecResult> {
  const result = await execFileAsync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export type GitStatus = {
  repoPath: string;
  topLevel: string;
  branch: string;
  head: string;
  clean: boolean;
  porcelain: string;
  untracked: string[];
  modified: string[];
  staged: string[];
};

export type GitDiff = {
  repoPath: string;
  topLevel: string;
  diff: string;
  stagedDiff: string;
  untracked: Array<{ path: string; readable: boolean; error?: string }>;
  hasChanges: boolean;
};

export type GitRepoInfo = {
  repoPath: string;
  topLevel: string;
  branch: string;
  head: string;
  isMainBranch: boolean;
};

export async function validateGitRepo(repoPath: string): Promise<GitRepoInfo> {
  const resolvedRepo = await realpath(resolve(repoPath));
  const topLevelResult = await git(resolvedRepo, ["rev-parse", "--show-toplevel"]);
  const topLevel = await realpath(resolve(topLevelResult.stdout));

  if (topLevel !== resolvedRepo) {
    throw new Error(`Repository path ${resolvedRepo} does not match Git top-level ${topLevel}`);
  }

  const [branchResult, headResult] = await Promise.all([
    git(resolvedRepo, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(resolvedRepo, ["rev-parse", "HEAD"])
  ]);

  const branch = branchResult.stdout;
  const head = headResult.stdout;
  const isMainBranch = branch === "main" || branch === "master";

  return { repoPath: resolvedRepo, topLevel, branch, head, isMainBranch };
}

export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  const info = await validateGitRepo(repoPath);
  const porcelainResult = await git(info.topLevel, ["status", "--porcelain=v1", "--branch"]);
  const porcelain = porcelainResult.stdout;

  const lines = porcelain.split("\n").filter((line) => line.length > 0);
  const branchLine = lines.find((line) => line.startsWith("##"));
  const fileLines = lines.filter((line) => !line.startsWith("##"));

  const untracked: string[] = [];
  const modified: string[] = [];
  const staged: string[] = [];

  for (const line of fileLines) {
    const status = line.slice(0, 2);
    const file = line.slice(3);
    if (status === "??") {
      untracked.push(file);
    } else {
      if (status[1] === "M" || status[1] === "D" || status[1] === "R") {
        modified.push(file);
      }
      if (status[0] === "M" || status[0] === "A" || status[0] === "D" || status[0] === "R") {
        staged.push(file);
      }
    }
  }

  const clean = fileLines.length === 0;

  return {
    repoPath: info.repoPath,
    topLevel: info.topLevel,
    branch: info.branch,
    head: info.head,
    clean,
    porcelain,
    untracked,
    modified,
    staged
  };
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const realRepoPath = await realpath(resolve(repoPath));
  const result = await git(realRepoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.stdout;
}

export async function getHead(repoPath: string): Promise<string> {
  const realRepoPath = await realpath(resolve(repoPath));
  const result = await git(realRepoPath, ["rev-parse", "HEAD"]);
  return result.stdout;
}

export async function getWorktreeTopLevel(repoPath: string): Promise<string> {
  const realRepoPath = await realpath(resolve(repoPath));
  const result = await git(realRepoPath, ["rev-parse", "--show-toplevel"]);
  return await realpath(resolve(result.stdout));
}

export async function getGitDiff(repoPath: string): Promise<GitDiff> {
  const info = await validateGitRepo(repoPath);
  const diffResult = await git(info.topLevel, ["diff", "--no-color"]);
  const diff = diffResult.stdout;
  const hasChanges = diff.length > 0;

  return {
    repoPath: info.repoPath,
    topLevel: info.topLevel,
    diff,
    stagedDiff: "",
    untracked: [],
    hasChanges
  };
}

export async function assertClean(repoPath: string): Promise<void> {
  const status = await getGitStatus(repoPath);
  if (!status.clean) {
    throw new Error(`Repository ${repoPath} has uncommitted changes. Commit or stash them first.`);
  }
}

export async function assertNotMain(repoPath: string): Promise<void> {
  const info = await validateGitRepo(repoPath);
  if (info.isMainBranch) {
    throw new Error(`Cannot modify protected branch '${info.branch}' in ${repoPath}. Create a feature branch first.`);
  }
}

export async function getGitDiffIncludingUntracked(repoPath: string): Promise<GitDiff> {
  const info = await validateGitRepo(repoPath);
  const status = await getGitStatus(info.topLevel);

  const diffResult = await git(info.topLevel, ["diff", "--no-color"]);
  const diff = diffResult.stdout;

  const stagedDiffResult = await git(info.topLevel, ["diff", "--no-color", "--staged"]);
  const stagedDiff = stagedDiffResult.stdout;

  const untracked: Array<{ path: string; readable: boolean; error?: string }> = [];

  for (const file of status.untracked) {
    const filePath = join(info.topLevel, file);
    try {
      await readFile(filePath, "utf8");
      untracked.push({ path: file, readable: true });
    } catch (error) {
      untracked.push({ path: file, readable: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const hasChanges = diff.length > 0 || stagedDiff.length > 0 || untracked.length > 0;

  return {
    repoPath: info.repoPath,
    topLevel: info.topLevel,
    diff,
    stagedDiff,
    untracked,
    hasChanges
  };
}