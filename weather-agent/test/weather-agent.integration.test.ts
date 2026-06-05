import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "weather-agent-test-"));
const packageRoot = path.resolve(import.meta.dir, "..");
const stateRoot = path.join(tempRoot, "state");

await mkdir(stateRoot, { recursive: true });

process.env.AGENT_ROOT = stateRoot;
process.env.PACKAGE_ROOT = packageRoot;
process.env.STATE_ROOT = stateRoot;

const { runtime } = await import("../../../services/agent-runtime/src/runtime.ts");

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("weather agent", () => {
  test("loads a narrow weather tool surface", async () => {
    const status = await runtime.status();

    expect(status.package.manifest?.id).toBe("weather-agent");
    expect(status.package.manifest?.name).toBe("Weather Agent");
    expect(status.tools?.some((tool) => tool.name === "weather_lookup")).toBe(true);
    expect(status.tools?.some((tool) => tool.name === "shell_exec")).toBe(false);
  });

  test("returns a current weather summary for a city", async () => {
    const result = await runtime.act({
      toolName: "weather_lookup",
      input: {
        location: "Dachau",
        mode: "current",
      },
    });

    const out = JSON.parse(JSON.stringify(result)) as {
      ok: boolean;
      output: { location: string; summary: string; current: { condition: string } };
    };

    expect(out.ok).toBe(true);
    expect(out.output.location).toContain("Dachau");
    expect(out.output.summary).toContain("Dachau");
    expect(out.output.current.condition.length).toBeGreaterThan(0);
  });

  test("resolves airport codes and keeps the reply concise", async () => {
    const result = await runtime.act({
      toolName: "weather_lookup",
      input: {
        location: "SFO",
        mode: "one_line",
      },
    });

    const out = JSON.parse(JSON.stringify(result)) as {
      ok: boolean;
      output: { location: string; summary: string };
    };

    expect(out.ok).toBe(true);
    expect(out.output.location).toContain("San Francisco");
    expect(out.output.summary).toContain("San Francisco");
    expect(out.output.summary).not.toContain("feels like");
  });

  test("returns the moon phase without requiring a location", async () => {
    const result = await runtime.act({
      toolName: "weather_lookup",
      input: {
        mode: "moon_phase",
      },
    });

    const out = JSON.parse(JSON.stringify(result)) as {
      ok: boolean;
      output: { location: string; moonPhase: string; summary: string };
    };

    expect(out.ok).toBe(true);
    expect(out.output.location).toBe("Moon");
    expect(out.output.moonPhase).not.toBe("");
    expect(out.output.summary).toContain("Moon phase");
  });

  test("fails cleanly on malformed JSON input", async () => {
    const proc = spawnSync("bun", ["tools/weather-lookup/run.js"], {
      cwd: packageRoot,
      input: "not-json",
      encoding: "utf8",
    });

    expect(proc.status).not.toBe(0);
    expect(proc.stderr).toContain("Invalid JSON input");
  });
});
