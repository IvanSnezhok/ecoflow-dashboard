import { spawn, execFile } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { EventEmitter } from "events";
import { config } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const LOG_DIR = join(PROJECT_ROOT, "server", "data");
const LOG_FILE = join(LOG_DIR, "update.log");
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export type UpdateStep = "idle" | "fetching" | "resetting" | "installing_root" | "installing_server" | "building_frontend" | "building_backend" | "restarting" | "completed" | "failed";
export interface UpdateStatus { step: UpdateStep; progress: number; message: string; error?: string; startedAt?: string; completedAt?: string; targetCommit?: string; }

class UpdateService extends EventEmitter {
  private status: UpdateStatus = { step: "idle", progress: 0, message: "Ready for update" };
  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private isUpdating = false;
  getStatus(): UpdateStatus { return { ...this.status }; }
  isUpdateInProgress(): boolean { return this.isUpdating; }
  isEnabled(): boolean { return config.updates.enabled; }
  private setStatus(status: Partial<UpdateStatus>) { this.status = { ...this.status, ...status }; this.emit("status", this.status); this.log(`[${this.status.step}] ${this.status.message}`); }
  private log(message: string) { const line = `${new Date().toISOString()} ${message}\n`; console.log(`[UpdateService] ${message}`); this.logStream?.write(line); }
  private initLogStream() { if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true }); this.logStream = createWriteStream(LOG_FILE, { flags: "a", mode: 0o600 }); this.log("=== Update started ==="); }
  private closeLogStream() { if (this.logStream) { this.log("=== Update finished ==="); this.logStream.end(); this.logStream = null; } }
  private run(command: string, args: string[], step: UpdateStep, message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.setStatus({ step, message });
      const child = spawn(command, args, { cwd: PROJECT_ROOT, shell: false, env: { ...process.env, FORCE_COLOR: "0" } });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${command} timed out`)); }, COMMAND_TIMEOUT_MS);
      child.stdout?.on("data", (data) => { output += data.toString(); });
      child.stderr?.on("data", (data) => { output += data.toString(); });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(`${command} failed (${code}): ${output.slice(-2000)}`)); });
    });
  }
  private async targetCommit(): Promise<string> { return this.run("git", ["rev-parse", `origin/${config.updates.branch}`], "fetching", "Resolving GitHub revision..."); }
  async startUpdate(): Promise<void> {
    if (!this.isEnabled()) throw new Error("GitHub updates are disabled. Set DASHBOARD_UPDATES_ENABLED=true after following deployment documentation.");
    if (this.isUpdating) throw new Error("Update already in progress");
    this.isUpdating = true; this.initLogStream();
    try {
      this.setStatus({ step: "fetching", progress: 0, message: "Fetching latest changes from GitHub...", startedAt: new Date().toISOString(), error: undefined, completedAt: undefined });
      await this.run("git", ["fetch", "--prune", "origin", config.updates.branch], "fetching", "Fetching latest changes from GitHub...");
      const targetCommit = await this.targetCommit(); this.setStatus({ targetCommit: targetCommit.slice(0, 7), progress: 10 });
      await this.run("git", ["reset", "--hard", targetCommit], "resetting", "Applying verified GitHub revision..."); this.setStatus({ progress: 20 });
      await this.run("npm", ["ci"], "installing_root", "Installing locked frontend dependencies..."); this.setStatus({ progress: 35 });
      await this.run("npm", ["ci", "--prefix", "server"], "installing_server", "Installing locked server dependencies..."); this.setStatus({ progress: 50 });
      await this.run("npm", ["run", "build"], "building_frontend", "Building frontend..."); this.setStatus({ progress: 70 });
      await this.run("npm", ["run", "build:backend"], "building_backend", "Building backend..."); this.setStatus({ progress: 90 });
      if (config.updates.systemdService) {
        await this.run("sudo", ["-n", "systemctl", "restart", config.updates.systemdService], "restarting", "Restarting dashboard service...");
      }
      this.setStatus({ step: "completed", progress: 100, message: config.updates.systemdService ? "Update completed; service is restarting." : "Update built successfully. Restart the service manually.", completedAt: new Date().toISOString() });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.setStatus({ step: "failed", message: "Update failed; inspect server/data/update.log", error: errorMessage, completedAt: new Date().toISOString() }); throw error;
    } finally { this.closeLogStream(); this.isUpdating = false; }
  }
}
export const updateService = new UpdateService();
