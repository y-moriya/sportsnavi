import fs from "node:fs";
import type { Logger } from "./logger.js";

export interface RotateLogOptions {
  logFilePath: string;
  maxSizeBytes?: number;
  maxFiles?: number;
}

/**
 * ログファイルのサイズをチェックし、閾値を超えている場合は copytruncate 方式でローテーションを行う。
 * 外部シェルプロセス等が追記モード（>>）でファイル記述子を保持している場合でも
 * ファイル記述子の不整合を起こさずに安全にサイズを 0 にリセットできる。
 */
export function rotateLogFile(
  options: RotateLogOptions,
  log?: Logger,
): boolean {
  const { logFilePath, maxSizeBytes = 5 * 1024 * 1024, maxFiles = 3 } = options;

  if (!logFilePath || maxFiles <= 0) {
    return false;
  }

  try {
    if (!fs.existsSync(logFilePath)) {
      return false;
    }

    const stat = fs.statSync(logFilePath);
    if (stat.size < maxSizeBytes) {
      return false;
    }

    // 世代シフト: 最も古いファイルを削除し、1世代ずつ繰り下げ
    for (let i = maxFiles; i >= 1; i--) {
      const current = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
      const next = `${logFilePath}.${i}`;

      if (i === maxFiles && fs.existsSync(next)) {
        try {
          fs.unlinkSync(next);
        } catch {
          // ignore
        }
      }

      if (i > 1 && fs.existsSync(current)) {
        fs.renameSync(current, next);
      }
    }

    // 最新ログを .1 にコピーし、元ファイルを truncate
    const targetPath = `${logFilePath}.1`;
    fs.copyFileSync(logFilePath, targetPath);
    fs.truncateSync(logFilePath, 0);

    log?.info("Log rotation completed", {
      logFilePath,
      rotatedSize: stat.size,
      maxFiles,
    });

    return true;
  } catch (err) {
    log?.error("Failed to rotate log file", err, { logFilePath });
    return false;
  }
}
