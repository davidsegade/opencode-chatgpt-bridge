import { describe, expect, it, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createBridgeMcpServer } from "../src/mcp/tools.js";
import type { BridgeConfig } from "../src/types.js";
import { OpencodeProcessManager } from "../src/opencode/process.js";
import { StateStore } from "../src/state/store.js";
import { validateRepoPath, validateProfileExists } from "../src/security/paths.js";
import * as gitModule from "../src/git/repository.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/security/paths.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    validateRepoPath: vi.fn(),
    listProjects: vi.fn(),
    validateProfileExists: vi.fn()
  };
});

vi.mock("../src/git/repository.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    captureGitSnapshot: vi.fn(async (_path, diff, head) => ({ head, diff: diff.diff, stagedDiff: diff.stagedDiff, untracked: diff.untracked })),
    validateGitRepo: vi.fn(),
    getGitStatus: vi.fn(),
    getGitDiffIncludingUntracked: vi.fn(),
    assertClean: vi.fn(),
    assertNotMain: vi.fn()
  };
});

function createMockContext(overrides: Partial<{
  config: BridgeConfig;
  processManager: Partial<OpencodeProcessManager>;
  state: Partial<StateStore>;
  gitMocks?: {
    validateGitRepo?: ReturnType<typeof vi.fn>;
    getGitStatus?: ReturnType<typeof vi.fn>;
    getGitDiffIncludingUntracked?: ReturnType<typeof vi.fn>;
    assertClean?: ReturnType<typeof vi.fn>;
    assertNotMain?: ReturnType<typeof vi.fn>;
  };
}> = {}) {
  const config: BridgeConfig = {
    host: "127.0.0.1",
    port: 8787,
    autoPort: true,
    allowedHosts: ["127.0.0.1"],
    allowedRoots: ["/tmp/test"],
    bridgeToken: "test-token",
    opencodeBin: "opencode",
    opencodeHost: "127.0.0.1",
    opencodePortStart: 4096,
    opencodeUsername: "opencode",
    stateDir: "/tmp/test-state",
    tunnel: "none",
    tailscaleBin: "tailscale",
    cloudflaredBin: "cloudflared",
    ...overrides.config
  };

  const mockClient = {
    health: vi.fn().mockResolvedValue({ healthy: true, version: "1.0.0" }),
    createSession: vi.fn().mockResolvedValue({ id: "ses_test123", title: "Test Session" }),
    getSessionStatus: vi.fn().mockResolvedValue({ ses_test123: { status: "idle" } }),
    sendMessage: vi.fn().mockResolvedValue({ info: {}, parts: [{ type: "text", text: "Response" }] }),
    getMessages: vi.fn().mockResolvedValue([{ info: {}, parts: [{ type: "text", text: "Hello" }] }]),
    getDiff: vi.fn().mockResolvedValue([{ path: "test.ts", diff: "+ console.log('hello')" }]),
    listAgents: vi.fn().mockResolvedValue([]),
    listCommands: vi.fn().mockResolvedValue([]),
    listProviders: vi.fn().mockResolvedValue([]),
    getProviderAuthMethods: vi.fn().mockResolvedValue({}),
    getConfigProviders: vi.fn().mockResolvedValue({}),
    abortSession: vi.fn().mockResolvedValue(true),
    respondPermission: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue({ content: "test" }),
    findFiles: vi.fn().mockResolvedValue(["test.ts"]),
    fileStatus: vi.fn().mockResolvedValue([]),
    vcs: vi.fn().mockResolvedValue({}),
    getSession: vi.fn(async (sessionId: string) => ({ id: sessionId, directory: "/tmp/test/repo" }))
  };

  const processManager = {
    ensure: vi.fn().mockResolvedValue({
      repoPath: "/tmp/test/repo",
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "test-password",
      startedAt: new Date().toISOString()
    }),
    clientFor: vi.fn().mockReturnValue(mockClient),
    stop: vi.fn().mockResolvedValue({ stopped: [] }),
    list: vi.fn().mockReturnValue([]),
    ...overrides.processManager
  };

  const mockSession = {
    bridgeSessionId: "bridge_test123",
    opencodeSessionId: "ses_test123",
    repoPath: "/tmp/test/repo",
    baseUrl: "http://127.0.0.1:4096",
    title: "Test Session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const state = {
    createSession: vi.fn().mockResolvedValue(mockSession),
    getSession: vi.fn().mockResolvedValue(mockSession),
    listSessions: vi.fn().mockResolvedValue([mockSession]),
    updateSession: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({ ...mockSession, ...patch })),
    ...overrides.state
  };

  // Set up git module mocks with defaults
  gitModule.validateGitRepo.mockResolvedValue({
    repoPath: "/tmp/test/repo",
    topLevel: "/tmp/test/repo",
    branch: "feature-branch",
    head: "abc123",
    isMainBranch: false
  });
  gitModule.getGitStatus.mockResolvedValue({
    repoPath: "/tmp/test/repo",
    topLevel: "/tmp/test/repo",
    branch: "feature-branch",
    head: "abc123",
    clean: true,
    porcelain: "## feature-branch",
    untracked: [],
    modified: [],
    staged: []
  });
  gitModule.getGitDiffIncludingUntracked.mockResolvedValue({
    repoPath: "/tmp/test/repo",
    topLevel: "/tmp/test/repo",
    diff: "",
    stagedDiff: "",
    untracked: [],
    hasChanges: false
  });
  gitModule.assertClean.mockResolvedValue(undefined);
  gitModule.assertNotMain.mockResolvedValue(undefined);

  (validateProfileExists as any).mockResolvedValue({
    version: "2.1",
    profile: "code-change",
    goal: "Test profile used by MCP tool tests",
    paths: {
      context_paths: ["**/*"],
      write_paths: ["src/**/*"],
      protected_paths: [".github/**"],
      sensitive_paths: ["**/.env*"]
    },
    models: { author: "mimo-v2.6-flash-free", reviewer: "space-bunny-free" },
    limits: { max_context_tokens: 4000, max_attempts: 3, timeout_ms: 300000 },
    commands: {}
  });

  // Override with test-specific mocks if provided
  if (overrides.gitMocks) {
    if (overrides.gitMocks.validateGitRepo) gitModule.validateGitRepo.mockImplementation(overrides.gitMocks.validateGitRepo);
    if (overrides.gitMocks.getGitStatus) gitModule.getGitStatus.mockImplementation(overrides.gitMocks.getGitStatus);
    if (overrides.gitMocks.getGitDiffIncludingUntracked) gitModule.getGitDiffIncludingUntracked.mockImplementation(overrides.gitMocks.getGitDiffIncludingUntracked);
    if (overrides.gitMocks.assertClean) gitModule.assertClean.mockImplementation(overrides.gitMocks.assertClean);
    if (overrides.gitMocks.assertNotMain) gitModule.assertNotMain.mockImplementation(overrides.gitMocks.assertNotMain);
  }

  return { config, processManager, state, mockClient, mockSession };
}

function createMockContextWithMismatch(overrides: Partial<{
  config: BridgeConfig;
  processManager: Partial<OpencodeProcessManager>;
  state: Partial<StateStore>;
}> = {}) {
  const { config, processManager, state, mockClient } = createMockContext(overrides);

  const oldBaseUrl = "http://127.0.0.1:4096";
  const newBaseUrl = "http://127.0.0.1:4097";
  const projectDir = process.cwd();

  const sessionRecord = (patch: Record<string, unknown> = {}) => ({
    bridgeSessionId: "bridge_test123",
    opencodeSessionId: "ses_test123",
    repoPath: projectDir,
    baseUrl: oldBaseUrl,
    title: "Test Session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch
  });

  const oldSession = {
    ...state,
    getSession: vi.fn().mockResolvedValue(sessionRecord()),
    updateSession: vi.fn(async (_id: string, patch: Record<string, unknown>) => sessionRecord(patch))
  };

  mockClient.getSession.mockResolvedValue({ id: "ses_test123", directory: projectDir });

  const newProcessManager = {
    ...processManager,
    ensure: vi.fn().mockResolvedValue({
      repoPath: projectDir,
      baseUrl: newBaseUrl,
      username: "opencode",
      password: "test-password",
      startedAt: new Date().toISOString()
    })
  };

  return { config, processManager: newProcessManager, state: oldSession, mockClient };
}

describe("MCP Tools - wait_for_session", () => {
  it("polls until session is idle and returns final status with messages and diff", async () => {
    const { config, processManager, state, mockClient } = createMockContext();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const mockStatuses = [
      { ses_test123: { status: "running" } },
      { ses_test123: { status: "running" } },
      { ses_test123: { status: "idle" } }
    ];
    let callCount = 0;
    mockClient.getSessionStatus.mockImplementation(() => Promise.resolve(mockStatuses[callCount++] || { ses_test123: { status: "idle" } }));

    const tool = (server as any)._registeredTools?.opencode_wait_for_session;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      includeDiff: true,
      messageLimit: 10
    });

    expect(result.structuredContent).toBeDefined();
    const content = result.structuredContent as any;
    expect(content.timedOut).toBe(false);
    expect(content.finalStatus).toEqual({ status: "idle" });
    expect(content.messages).toBeDefined();
    expect(content.diff).toBeDefined();
    expect(mockClient.getSessionStatus).toHaveBeenCalledTimes(3);
  });

  it("times out if session does not reach terminal state", async () => {
    const { config, processManager, state, mockClient } = createMockContext();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "running" } });

    const tool = (server as any)._registeredTools?.opencode_wait_for_session;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      timeoutMs: 50,
      pollIntervalMs: 10,
      includeMessages: false,
      includeDiff: false
    });

    const content = result.structuredContent as any;
    expect(content.timedOut).toBe(true);
    expect(content.finalStatus).toEqual({ status: "running" });
    expect(content.messages).toBeUndefined();
    expect(content.diff).toBeUndefined();
  });

  it("handles error status as terminal", async () => {
    const { config, processManager, state, mockClient } = createMockContext();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const mockStatuses = [
      { ses_test123: { status: "running" } },
      { ses_test123: { status: "error", error: "Something failed" } }
    ];
    let callCount = 0;
    mockClient.getSessionStatus.mockImplementation(() => Promise.resolve(mockStatuses[callCount++] || { ses_test123: { status: "error" } }));

    const tool = (server as any)._registeredTools?.opencode_wait_for_session;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      timeoutMs: 10000,
      pollIntervalMs: 10
    });

    const content = result.structuredContent as any;
    expect(content.timedOut).toBe(false);
    expect(content.finalStatus).toEqual({ status: "error", error: "Something failed" });
  });
});

describe("MCP Tools - launch_task", () => {
  let allowedRoot: string;
  let outsideRoot: string;

  beforeEach(async () => {
    allowedRoot = await mkdtemp(join(tmpdir(), "bridge-allowed-"));
    outsideRoot = await mkdtemp(join(tmpdir(), "bridge-outside-"));
    await mkdtemp(join(allowedRoot, "repo-"));
    (validateRepoPath as any).mockImplementation(async (repoPath: string, allowedRoots: string[]) => {
      const resolved = repoPath;
      const allowed = allowedRoots[0] === "/allowed/root" ? [allowedRoot] : allowedRoots;
      if (!allowed.some((root: string) => resolved.startsWith(root))) {
        throw new Error(`Repo path is outside allowed roots: ${resolved}`);
      }
      return resolved;
    });
  });

  it("creates session, sends async message, waits for completion, returns diff", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      config: { allowedRoots: [allowedRoot] }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const mockStatuses = [
      { ses_test123: { status: "running" } },
      { ses_test123: { status: "idle" } }
    ];
    let callCount = 0;
    mockClient.getSessionStatus.mockImplementation(() => Promise.resolve(mockStatuses[callCount++] || { ses_test123: { status: "idle" } }));

    const tool = (server as any)._registeredTools?.opencode_launch_task;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      repoPath: join(allowedRoot, "repo-test"),
      prompt: "Create a hello world file",
      title: "Test Task",
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      messageLimit: 10
    });

    const content = result.structuredContent as any;
    expect(content.timedOut).toBe(false);
    expect(content.bridgeSession).toBeDefined();
    expect(content.opencodeSession).toBeDefined();
    expect(content.finalStatus).toEqual({ status: "idle" });
    expect(content.messages).toBeDefined();
    expect(content.diff).toBeDefined();

    expect(processManager.ensure).toHaveBeenCalled();
    expect(state.createSession).toHaveBeenCalled();
    expect(mockClient.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "ses_test123",
      text: "Create a hello world file",
      async: true
    }));
  });

  it("passes provider/model/agent options to sendMessage", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      config: { allowedRoots: [allowedRoot] }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "idle" } });

    const tool = (server as any)._registeredTools?.opencode_launch_task;
    await tool.handler({
      repoPath: join(allowedRoot, "repo-test"),
      prompt: "Test prompt",
      providerID: "anthropic",
      modelID: "claude-3-haiku",
      agent: "coder",
      system: "You are a helpful assistant"
    });

    expect(mockClient.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      providerID: "anthropic",
      modelID: "claude-3-haiku",
      agent: "coder",
      system: "You are a helpful assistant"
    }));
  });

  it("times out and returns partial results", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      config: { allowedRoots: [allowedRoot] }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "running" } });

    const tool = (server as any)._registeredTools?.opencode_launch_task;
    const result = await tool.handler({
      repoPath: join(allowedRoot, "repo-test"),
      prompt: "Long running task",
      timeoutMs: 50,
      pollIntervalMs: 10
    });

    const content = result.structuredContent as any;
    expect(content.timedOut).toBe(true);
    expect(content.finalStatus).toEqual({ status: "running" });
    expect(content.diff).toBeDefined();
  });

  it("validates repo path against allowed roots", async () => {
    const { config, processManager, state } = createMockContext({
      config: { allowedRoots: ["/allowed/root"] }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const tool = (server as any)._registeredTools?.opencode_launch_task;
    const result = await tool.handler({
      repoPath: outsideRoot,
      prompt: "Test"
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.error).toContain("outside allowed roots");
  });
});

describe("MCP Tools - session server recovery", () => {
  it("recovers a session after a managed server restart when identity and project match", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "idle" } });

    const tool = (server as any)._registeredTools?.opencode_get_session_status;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123"
    });

    const content = result.structuredContent as any;
    expect(content.code).toBeUndefined();
    expect(content.managedServer).toBe("http://127.0.0.1:4097");
    expect(mockClient.getSession).toHaveBeenCalledWith("ses_test123");
    expect(state.updateSession).toHaveBeenCalledWith("bridge_test123", { baseUrl: "http://127.0.0.1:4097" });
  });

  it("sends messages to the current managed server after recovery", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const tool = (server as any)._registeredTools?.opencode_send_message;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      text: "Test message"
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(true);
    expect(content.managedServer).toBe("http://127.0.0.1:4097");
    expect(mockClient.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "ses_test123" }));
  });

  it("rejects recovery when the recovered session belongs to a different project", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSession.mockResolvedValue({ id: "ses_test123", directory: tmpdir() });

    const tool = (server as any)._registeredTools?.opencode_get_messages;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123"
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.code).toBe("SESSION_PROJECT_MISMATCH");
    expect(state.updateSession).not.toHaveBeenCalled();
  });

  it("keeps the managed server error when the session no longer exists", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSession.mockRejectedValue(new Error("session not found on managed server"));

    const tool = (server as any)._registeredTools?.opencode_get_diff;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123"
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.error).toContain("session not found on managed server");
    expect(state.updateSession).not.toHaveBeenCalled();
  });

  it("allows repo-level operations (opencode_read_file) even with baseUrl mismatch", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.readFile.mockResolvedValue({ content: "test file" });

    const tool = (server as any)._registeredTools?.opencode_read_file;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      path: "test.txt"
    });

    const content = result.structuredContent as any;
    expect(content).toBeDefined();
    expect(content.file).toEqual({ content: "test file" });
    expect(mockClient.getSession).not.toHaveBeenCalled();
  });

  it("denies opencode_read_file for sensitive_paths", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const tool = (server as any)._registeredTools?.opencode_read_file;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      path: ".env.production"
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.error).toContain("Read denied by .ia-dev.yml");
    expect(mockClient.readFile).not.toHaveBeenCalled();
  });

  it("denies opencode_read_file for absolute paths outside the repo", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const tool = (server as any)._registeredTools?.opencode_read_file;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      path: "/etc/passwd"
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.error).toContain("Read denied by .ia-dev.yml");
    expect(mockClient.readFile).not.toHaveBeenCalled();
  });

  it("denies opencode_read_file for parent-directory traversal", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const tool = (server as any)._registeredTools?.opencode_read_file;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      path: "../outside/secret.ts"
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.error).toContain("Read denied by .ia-dev.yml");
    expect(mockClient.readFile).not.toHaveBeenCalled();
  });

  it("allows repo-level operations (opencode_find_files) even with baseUrl mismatch", async () => {
    const { config, processManager, state, mockClient } = createMockContextWithMismatch();
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.findFiles.mockResolvedValue(["test.txt"]);

    const tool = (server as any)._registeredTools?.opencode_find_files;
    const result = await tool.handler({
      bridgeSessionId: "bridge_test123",
      query: "test"
    });

    const content = result.structuredContent as any;
    expect(content).toBeDefined();
    expect(content.files).toEqual(["test.txt"]);
    expect(mockClient.getSession).not.toHaveBeenCalled();
  });
});

describe("MCP Tools - ia_dev_run_task", () => {
  it("returns success true when requireClean default=true and Git shows real changes", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn()
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "abc123",
            clean: true,
            porcelain: "## feature-branch",
            untracked: [],
            modified: [],
            staged: []
          })
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "def456",
            clean: false,
            porcelain: "## feature-branch\n M newfile.txt",
            untracked: ["newfile.txt"],
            modified: [],
            staged: []
          }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "diff --git a/newfile.txt b/newfile.txt\nnew file mode 100644\n--- /dev/null\n+++ b/newfile.txt\n@@ -0,0 +1 @@\n+new content",
          stagedDiff: "",
          untracked: [{ path: "newfile.txt", readable: true }],
          hasChanges: true
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const mockStatuses = [
      { ses_test123: { status: "running" } },
      { ses_test123: { status: "idle" } }
    ];
    let callCount = 0;
    mockClient.getSessionStatus.mockImplementation(() => Promise.resolve(mockStatuses[callCount++] || { ses_test123: { status: "idle" } }));

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    expect(tool).toBeDefined();

    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Create a test file",
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      messageLimit: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
    expect(content.gitVerification.gitChanged).toBe(true);
    expect(content.gitVerification.initialClean).toBe(true);
  });

  it("returns success false when OpenCode completes but Git shows no changes", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          clean: true,
          porcelain: "## feature-branch",
          untracked: [],
          modified: [],
          staged: []
        }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "",
          stagedDiff: "",
          untracked: [],
          hasChanges: false
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "idle" } });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Do nothing",
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      messageLimit: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(false);
    expect(content.error).toContain("no Git changes detected");
  });

  it("returns success false when task times out", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          clean: true,
          porcelain: "## feature-branch",
          untracked: [],
          modified: [],
          staged: []
        }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "",
          stagedDiff: "",
          untracked: [],
          hasChanges: false
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "running" } });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Long running task",
      timeoutMs: 50,
      pollIntervalMs: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(false);
    expect(content.timedOut).toBe(true);
    expect(content.error).toContain("timed out");
  });

  it("blocks main branch when allowMain is false (default)", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "main",
          head: "abc123",
          isMainBranch: true
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockRejectedValue(new Error("Cannot modify protected branch 'main' in /tmp/test/repo. Create a feature branch first."))
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Test",
      allowMain: false
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.error).toContain("protected branch");
  });

  it("allows main branch when allowMain is true", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn()
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "main",
            head: "abc123",
            clean: true,
            porcelain: "## main",
            untracked: [],
            modified: [],
            staged: []
          })
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "main",
            head: "def456",
            clean: false,
            porcelain: "## main\n M newfile.txt",
            untracked: ["newfile.txt"],
            modified: [],
            staged: []
          }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "diff --git a/newfile.txt b/newfile.txt\nnew file mode 100644\n--- /dev/null\n+++ b/newfile.txt\n@@ -0,0 +1 @@\n+new content",
          stagedDiff: "",
          untracked: [{ path: "newfile.txt", readable: true }],
          hasChanges: true
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "main",
          head: "abc123",
          isMainBranch: true
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const mockStatuses = [
      { ses_test123: { status: "running" } },
      { ses_test123: { status: "idle" } }
    ];
    let callCount = 0;
    mockClient.getSessionStatus.mockImplementation(() => Promise.resolve(mockStatuses[callCount++] || { ses_test123: { status: "idle" } }));

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Test on main",
      allowMain: true,
      timeoutMs: 10000,
      pollIntervalMs: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
  });

  it("requires clean repo when requireClean is true (default)", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        assertClean: vi.fn().mockRejectedValue(new Error("Repository /tmp/test/repo has uncommitted changes. Commit or stash them first."))
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Test",
      requireClean: true
    });

    const content = result.structuredContent as any;
    expect(content.ok).toBe(false);
    expect(content.error).toContain("uncommitted changes");
  });

  it("skips clean check when requireClean is false", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn()
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "abc123",
            clean: false,
            porcelain: "## feature-branch\n M existing.txt",
            untracked: [],
            modified: ["existing.txt"],
            staged: []
          })
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "def456",
            clean: false,
            porcelain: "## feature-branch\n M existing.txt\n M newfile.txt",
            untracked: ["newfile.txt"],
            modified: ["existing.txt"],
            staged: []
          }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "diff --git a/newfile.txt b/newfile.txt\nnew file mode 100644\n--- /dev/null\n+++ b/newfile.txt\n@@ -0,0 +1 @@\n+new content",
          stagedDiff: "",
          untracked: [{ path: "newfile.txt", readable: true }],
          hasChanges: true
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    const mockStatuses = [
      { ses_test123: { status: "running" } },
      { ses_test123: { status: "idle" } }
    ];
    let callCount = 0;
    mockClient.getSessionStatus.mockImplementation(() => Promise.resolve(mockStatuses[callCount++] || { ses_test123: { status: "idle" } }));

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Test with dirty repo",
      requireClean: false,
      timeoutMs: 10000,
      pollIntervalMs: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
  });
});

describe("MCP Tools - ia_dev_run_task additional scenarios", () => {
  it("returns success false when OpenCode reports error status even with Git changes", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn()
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "abc123",
            clean: true,
            porcelain: "## feature-branch",
            untracked: [],
            modified: [],
            staged: []
          })
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "def456",
            clean: false,
            porcelain: "## feature-branch\n M newfile.txt",
            untracked: ["newfile.txt"],
            modified: [],
            staged: []
          }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "diff --git a/newfile.txt b/newfile.txt\nnew file mode 100644\n--- /dev/null\n+++ b/newfile.txt\n@@ -0,0 +1 @@\n+new content",
          stagedDiff: "",
          untracked: [{ path: "newfile.txt", readable: true }],
          hasChanges: true
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "error", error: "Something failed" } });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Create a test file",
      allowMain: true,
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      messageLimit: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(false);
    expect(content.error).toContain("error");
  });

  it("returns success false when OpenCode reports cancelled status even with Git changes", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn()
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "abc123",
            clean: true,
            porcelain: "## feature-branch",
            untracked: [],
            modified: [],
            staged: []
          })
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "def456",
            clean: false,
            porcelain: "## feature-branch\n M newfile.txt",
            untracked: ["newfile.txt"],
            modified: [],
            staged: []
          }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "diff --git a/newfile.txt b/newfile.txt\nnew file mode 100644\n--- /dev/null\n+++ b/newfile.txt\n@@ -0,0 +1 @@\n+new content",
          stagedDiff: "",
          untracked: [{ path: "newfile.txt", readable: true }],
          hasChanges: true
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "cancelled" } });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Create a test file",
      allowMain: true,
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      messageLimit: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(false);
    expect(content.error).toContain("cancelled");
  });

  it("returns success true when OpenCode reports completed status with Git changes", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn()
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "abc123",
            clean: true,
            porcelain: "## feature-branch",
            untracked: [],
            modified: [],
            staged: []
          })
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "def456",
            clean: false,
            porcelain: "## feature-branch\n M newfile.txt",
            untracked: ["newfile.txt"],
            modified: [],
            staged: []
          }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "diff --git a/newfile.txt b/newfile.txt\nnew file mode 100644\n--- /dev/null\n+++ b/newfile.txt\n@@ -0,0 +1 @@\n+new content",
          stagedDiff: "",
          untracked: [{ path: "newfile.txt", readable: true }],
          hasChanges: true
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "completed" } });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Create a test file",
      allowMain: true,
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      messageLimit: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(true);
    expect(content.gitVerification.gitChanged).toBe(true);
  });

  it("returns success false when repo initially dirty, requireClean:false, and task produces no new changes", async () => {
    const { config, processManager, state, mockClient } = createMockContext({
      gitMocks: {
        getGitStatus: vi.fn()
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "abc123",
            clean: false,
            porcelain: "## feature-branch\n M existing.txt",
            untracked: [],
            modified: ["existing.txt"],
            staged: []
          })
          .mockResolvedValueOnce({
            repoPath: "/tmp/test/repo",
            topLevel: "/tmp/test/repo",
            branch: "feature-branch",
            head: "abc123",
            clean: false,
            porcelain: "## feature-branch\n M existing.txt",
            untracked: [],
            modified: ["existing.txt"],
            staged: []
          }),
        getGitDiffIncludingUntracked: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          diff: "",
          stagedDiff: "",
          untracked: [],
          hasChanges: false
        }),
        validateGitRepo: vi.fn().mockResolvedValue({
          repoPath: "/tmp/test/repo",
          topLevel: "/tmp/test/repo",
          branch: "feature-branch",
          head: "abc123",
          isMainBranch: false
        }),
        assertClean: vi.fn().mockResolvedValue(undefined),
        assertNotMain: vi.fn().mockResolvedValue(undefined)
      }
    });
    const server = createBridgeMcpServer({ config, processManager: processManager as any, state: state as any });

    mockClient.getSessionStatus.mockResolvedValue({ ses_test123: { status: "idle" } });

    const tool = (server as any)._registeredTools?.ia_dev_run_task;
    const result = await tool.handler({
      repoPath: "/tmp/test/repo",
      prompt: "Do nothing",
      requireClean: false,
      allowMain: true,
      timeoutMs: 10000,
      pollIntervalMs: 10,
      includeMessages: true,
      messageLimit: 10
    });

    const content = result.structuredContent as any;
    expect(content.success).toBe(false);
    expect(content.error).toContain("no Git changes detected");
  });
});