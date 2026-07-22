import { execFile, type ExecFileException } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type PythonRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

const MAX_OUTPUT_CHARS = 8000;
const TIMEOUT_MS = 10_000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS
    ? s.slice(0, MAX_OUTPUT_CHARS) + `\n…(truncated, ${s.length - MAX_OUTPUT_CHARS} more chars)`
    : s;
}

/**
 * Writes `code` to a temp .py file and runs it with `python3`, capturing
 * stdout/stderr. This is a real subprocess with a wall-clock timeout and
 * output cap — it is NOT a security sandbox. It runs with the same OS
 * permissions as the Next.js server process. Gated behind
 * ENABLE_PYTHON_TOOL in src/app/api/chat/route.ts so it's opt-in; do not
 * expose this to untrusted users without a real sandbox (container,
 * gVisor, a locked-down user account, etc.) in front of it.
 */
export async function runPythonCode(code: string): Promise<PythonRunResult> {
  const dir = await mkdtemp(join(tmpdir(), "locaul-science-py-"));
  const file = join(dir, `${randomUUID()}.py`);

  try {
    await writeFile(file, code, "utf8");

    return await new Promise<PythonRunResult>((resolve) => {
      execFile(
        "python3",
        [file],
        { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const execError = error as ExecFileException | null;
          const timedOut = execError?.killed === true && execError.signal === "SIGTERM";
          const exitCode =
            execError == null
              ? 0
              : typeof execError.code === "number"
                ? execError.code
                : null;

          resolve({
            stdout: truncate(stdout ?? ""),
            stderr: truncate(
              stderr || (execError && !timedOut ? execError.message : "") || ""
            ),
            exitCode,
            timedOut,
          });
        }
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
