import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { rotateLogFile } from "./rotator.js";
import { Logger } from "./logger.js";

describe("rotateLogFile", () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rotator-test-"));
    logFile = path.join(tmpDir, "cron.log");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns false if log file does not exist", () => {
    const rotated = rotateLogFile({ logFilePath: logFile, maxSizeBytes: 100 });
    expect(rotated).toBe(false);
  });

  it("returns false if maxFiles is 0 or negative", () => {
    fs.writeFileSync(logFile, "sample log content");
    const rotated = rotateLogFile({ logFilePath: logFile, maxSizeBytes: 10, maxFiles: 0 });
    expect(rotated).toBe(false);
  });

  it("returns false if log file size is below maxSizeBytes", () => {
    fs.writeFileSync(logFile, "small log");
    const rotated = rotateLogFile({
      logFilePath: logFile,
      maxSizeBytes: 1000,
      maxFiles: 3,
    });
    expect(rotated).toBe(false);
    expect(fs.readFileSync(logFile, "utf-8")).toBe("small log");
    expect(fs.existsSync(`${logFile}.1`)).toBe(false);
  });

  it("rotates log file when size exceeds maxSizeBytes (copytruncate)", () => {
    const content = "A".repeat(500);
    fs.writeFileSync(logFile, content, "utf-8");

    const logger = new Logger({ appName: "test" });
    const infoSpy = vi.spyOn(logger, "info");

    const rotated = rotateLogFile(
      {
        logFilePath: logFile,
        maxSizeBytes: 200,
        maxFiles: 3,
      },
      logger,
    );

    expect(rotated).toBe(true);
    // .1 にコピーされていること
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toBe(content);

    // 元ファイルは truncate されてサイズ 0 になっていること
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.statSync(logFile).size).toBe(0);

    expect(infoSpy).toHaveBeenCalledWith("Log rotation completed", expect.any(Object));
  });

  it("shifts generations correctly across multiple rotations", () => {
    const maxFiles = 3;
    const sizeLimit = 50;

    // 1st generation
    fs.writeFileSync(logFile, "generation-1: " + "1".repeat(60));
    expect(rotateLogFile({ logFilePath: logFile, maxSizeBytes: sizeLimit, maxFiles })).toBe(true);
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toContain("generation-1");
    expect(fs.existsSync(`${logFile}.2`)).toBe(false);

    // 2nd generation
    fs.writeFileSync(logFile, "generation-2: " + "2".repeat(60));
    expect(rotateLogFile({ logFilePath: logFile, maxSizeBytes: sizeLimit, maxFiles })).toBe(true);
    expect(fs.readFileSync(`${logFile}.2`, "utf-8")).toContain("generation-1");
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toContain("generation-2");
    expect(fs.existsSync(`${logFile}.3`)).toBe(false);

    // 3rd generation
    fs.writeFileSync(logFile, "generation-3: " + "3".repeat(60));
    expect(rotateLogFile({ logFilePath: logFile, maxSizeBytes: sizeLimit, maxFiles })).toBe(true);
    expect(fs.readFileSync(`${logFile}.3`, "utf-8")).toContain("generation-1");
    expect(fs.readFileSync(`${logFile}.2`, "utf-8")).toContain("generation-2");
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toContain("generation-3");

    // 4th generation - generation-1 should be evicted/deleted
    fs.writeFileSync(logFile, "generation-4: " + "4".repeat(60));
    expect(rotateLogFile({ logFilePath: logFile, maxSizeBytes: sizeLimit, maxFiles })).toBe(true);
    expect(fs.readFileSync(`${logFile}.3`, "utf-8")).toContain("generation-2");
    expect(fs.readFileSync(`${logFile}.2`, "utf-8")).toContain("generation-3");
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toContain("generation-4");
    expect(fs.existsSync(`${logFile}.4`)).toBe(false);
  });

  it("handles maxFiles = 1 properly", () => {
    fs.writeFileSync(logFile, "log-alpha: " + "A".repeat(50));
    expect(rotateLogFile({ logFilePath: logFile, maxSizeBytes: 30, maxFiles: 1 })).toBe(true);
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toContain("log-alpha");

    fs.writeFileSync(logFile, "log-beta: " + "B".repeat(50));
    expect(rotateLogFile({ logFilePath: logFile, maxSizeBytes: 30, maxFiles: 1 })).toBe(true);
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toContain("log-beta");
    expect(fs.existsSync(`${logFile}.2`)).toBe(false);
  });

  it("returns false and logs error gracefully when filesystem throws", () => {
    fs.writeFileSync(logFile, "content to rotate");
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const logger = new Logger({ appName: "test" });
    const errorSpy = vi.spyOn(logger, "error");

    const rotated = rotateLogFile(
      { logFilePath: logFile, maxSizeBytes: 10, maxFiles: 3 },
      logger,
    );

    expect(rotated).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith("Failed to rotate log file", expect.any(Error), expect.any(Object));
  });
});
