// ============================================================
// PI Web Platform - Self-update orchestration
// ============================================================
// Thin Node-side wrapper around scripts/self-update.sh. All the risky work
// (checkout, build, restart, health-gate, rollback) lives in the script,
// deliberately: the script must outlive the very process it is restarting, so
// it cannot be implemented as in-process logic here.
//
// The two responsibilities kept on this side are:
//   - reporting  — read the status file the script writes at each phase
//   - triggering — spawn the script fully detached, so `systemctl restart`
//                  killing this process does not kill the update midway

import { spawn, execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("updater");

export type UpdatePhase =
  | "idle"
  | "available"
  | "fetching"
  | "backup"
  | "building"
  | "restarting"
  | "verifying"
  | "rolling-back"
  | "failed";

export interface UpdateStatus {
  phase: UpdatePhase;
  ok: boolean;
  message: string;
  fromCommit: string;
  toCommit: string;
  branch: string;
  updatedAt: string;
  pid?: number;
}

export interface UpdaterOptions {
  appRoot?: string;
  branch?: string;
  /** Health URL the script polls after restart. Defaults to this server's own. */
  healthUrl?: string;
  serviceName?: string;
}

/** Phases where an update is actively in flight — a second trigger must be refused. */
const IN_FLIGHT: ReadonlySet<UpdatePhase> = new Set<UpdatePhase>([
  "fetching",
  "backup",
  "building",
  "restarting",
  "verifying",
  "rolling-back",
]);

/**
 * Treat an in-flight status older than this as abandoned.
 *
 * Without it, a run killed mid-build (OOM, SIGKILL) would leave the status file
 * pinned at "building" and block every future update permanently.
 */
const STALE_IN_FLIGHT_MS = 60 * 60 * 1000;

export class Updater {
  private readonly appRoot: string;
  private readonly branch: string;
  private readonly serviceName: string;
  private readonly healthUrl: string;
  private readonly dataDir: string;

  constructor(options: UpdaterOptions = {}) {
    this.appRoot = options.appRoot ?? path.resolve(process.cwd(), "..");
    this.branch = options.branch ?? process.env.UPDATE_BRANCH ?? "main";
    this.serviceName = options.serviceName ?? process.env.SERVICE_NAME ?? "hy-webagent";
    this.healthUrl = options.healthUrl ?? `http://127.0.0.1:${config.port}/health`;
    this.dataDir = path.dirname(path.resolve(config.databasePath));
  }

  private get statusPath(): string {
    return path.join(this.dataDir, "update-status.json");
  }

  private get scriptPath(): string {
    return path.join(this.appRoot, "scripts", "self-update.sh");
  }

  /** Short commit of the running build. Best-effort: absent in a tarball deploy. */
  async currentCommit(): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: this.appRoot,
        timeout: 5_000,
      });
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  async readStatus(): Promise<UpdateStatus | null> {
    try {
      const raw = await fs.readFile(this.statusPath, "utf-8");
      return JSON.parse(raw) as UpdateStatus;
    } catch {
      return null;
    }
  }

  /**
   * Is an update running right now?
   *
   * Age-bounded so a killed run cannot wedge updates forever, and PID-checked
   * where possible so a genuinely long build is not misread as abandoned.
   */
  async isInFlight(): Promise<boolean> {
    const status = await this.readStatus();
    if (!status || !IN_FLIGHT.has(status.phase)) return false;

    if (status.pid) {
      try {
        process.kill(status.pid, 0);
        return true; // Process is alive — genuinely in flight.
      } catch {
        log.warn(`update status claims phase "${status.phase}" but pid ${status.pid} is gone`);
        return false;
      }
    }

    const age = Date.now() - Date.parse(status.updatedAt);
    return Number.isFinite(age) && age < STALE_IN_FLIGHT_MS;
  }

  /**
   * Check whether origin/<branch> is ahead, without changing the working tree.
   *
   * `git fetch` is intentionally avoided in favour of `ls-remote` so a
   * read-only check can never mutate local refs.
   */
  async checkForUpdate(): Promise<{
    updateAvailable: boolean;
    currentCommit: string;
    remoteCommit: string;
    branch: string;
    error?: string;
  }> {
    const current = await this.currentCommit();
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-remote", "origin", `refs/heads/${this.branch}`],
        { cwd: this.appRoot, timeout: 20_000 },
      );
      const remote = stdout.trim().split(/\s+/)[0] ?? "";
      return {
        updateAvailable: Boolean(remote) && remote !== current,
        currentCommit: current,
        remoteCommit: remote,
        branch: this.branch,
      };
    } catch (err) {
      return {
        updateAvailable: false,
        currentCommit: current,
        remoteCommit: "",
        branch: this.branch,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Launch the update script.
   *
   * `setsid` + `detached` + `unref` + fully redirected stdio is what lets the
   * child survive its parent: the script restarts this service, so anything
   * still tied to this process group would be torn down mid-update. The script
   * logs to data/logs/self-update.log and reports through the status file, so
   * losing the pipes costs no observability.
   */
  async triggerUpdate(options: { dryRun?: boolean } = {}): Promise<
    { started: true; pid?: number } | { started: false; reason: string }
  > {
    if (await this.isInFlight()) {
      return { started: false, reason: "An update is already in progress" };
    }

    try {
      await fs.access(this.scriptPath);
    } catch {
      return { started: false, reason: `Update script not found at ${this.scriptPath}` };
    }

    const env = {
      ...process.env,
      APP_ROOT: this.appRoot,
      BRANCH: this.branch,
      SERVICE_NAME: this.serviceName,
      HEALTH_URL: this.healthUrl,
      DATA_DIR: this.dataDir,
      PORT: String(config.port),
      DRY_RUN: options.dryRun ? "1" : "0",
    };

    // Prefer setsid so the child leads a new session and survives the restart;
    // fall back to bare bash + detached where setsid is unavailable (macOS dev).
    const useSetsid = process.platform === "linux";
    const command = useSetsid ? "setsid" : "bash";
    const args = useSetsid ? ["bash", this.scriptPath] : [this.scriptPath];

    try {
      const child = spawn(command, args, {
        cwd: this.appRoot,
        env,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      log.info(`self-update started (pid ${child.pid}, branch ${this.branch}, dryRun=${Boolean(options.dryRun)})`);
      return { started: true, pid: child.pid };
    } catch (err) {
      log.error(`failed to start self-update: ${(err as Error).message}`);
      return { started: false, reason: (err as Error).message };
    }
  }
}
