import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as yaml from "yaml";
import { minimatch } from "minimatch";
import {
  IADevProfileSchema,
  type IADevProfile,
  type PathsConfig
} from "../config/schema.js";

const CONFIG_NAME = ".ia-dev.yml";

export async function loadProfile(repoPath: string): Promise<IADevProfile> {
  if (typeof repoPath !== "string") {
    throw new TypeError(`loadProfile expects a string repoPath, received ${typeof repoPath}: ${JSON.stringify(repoPath)}`);
  }
  const configPath = resolve(repoPath, ".ia-dev.yml");
  const raw = await readFile(configPath, "utf8").catch(() => null);
  if (!raw) {
    throw new Error(`Missing .ia-dev.yml in ${repoPath}. Create it from .ia-dev.yml.example`);
  }
  const parsed = yaml.parse(raw);
  return IADevProfileSchema.parse(parsed);
}

export function validateReadAccess(profile: IADevProfile, filePath: string): boolean {
  const { context_paths, sensitive_paths } = profile.paths;
  if (matchAny(filePath, sensitive_paths)) return false;
  return matchAny(filePath, context_paths);
}

export function validateWriteAccess(profile: IADevProfile, filePath: string): boolean {
  const { write_paths, protected_paths } = profile.paths;
  if (matchAny(filePath, protected_paths)) return false;
  if (write_paths.length === 0) return false;
  return matchAny(filePath, write_paths);
}

export function validateContextPaths(profile: IADevProfile, filePaths: string[]): string[] {
  return filePaths.filter((p) => !validateReadAccess(profile, p));
}

export function validateWritePaths(profile: IADevProfile, filePaths: string[]): string[] {
  return filePaths.filter((p) => !validateWriteAccess(profile, p));
}

function matchAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(filePath, pattern, { dot: true }));
}

export function getAllowedContextPaths(profile: IADevProfile): string[] {
  return profile.paths.context_paths;
}

export function getAllowedWritePaths(profile: IADevProfile): string[] {
  return profile.paths.write_paths;
}

export function getProtectedPaths(profile: IADevProfile): string[] {
  return profile.paths.protected_paths;
}

export function getSensitivePaths(profile: IADevProfile): string[] {
  return profile.paths.sensitive_paths;
}

export function createDefaultProfile(): IADevProfile {
  return {
    version: "2.1" as const,
    profile: "code-change",
    goal: "Describe the change you want to make",
    paths: {
      context_paths: ["**/*"],
      write_paths: [],
      protected_paths: [
        ".github/**",
        ".ia-dev.yml",
        "package-lock.json",
        "pnpm-lock.yaml",
        "**/*.lock"
      ],
      sensitive_paths: [
        "**/.env*",
        "**/*.pem",
        "**/*.key",
        "**/secrets/**",
        "**/credentials/**"
      ]
    },
    models: {
      author: "mimo-v2.6-flash-free",
      reviewer: "space-bunny-free"
    },
    limits: {
      max_context_tokens: 4000,
      max_attempts: 3,
      timeout_ms: 300000
    },
    commands: {}
  };
}

export type { IADevProfile, PathsConfig } from "../config/schema.js";