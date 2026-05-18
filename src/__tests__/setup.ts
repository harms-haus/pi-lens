import { vi } from "vitest";

// Mock typebox (used by pi-coding-agent extension API)
vi.mock("typebox", () => ({
  Type: {
    Object: vi.fn((props: Record<string, unknown>) => props),
    String: vi.fn((opts?: Record<string, unknown>) => opts ?? {}),
    Array: vi.fn((item: Record<string, unknown>, opts?: Record<string, unknown>) => ({
      items: item,
      ...(opts ?? {}),
    })),
    Optional: vi.fn((schema: Record<string, unknown>) => schema),
  },
}));

// Mock node:child_process for all tests
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));
