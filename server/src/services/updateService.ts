import { spawn, exec } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is 3 levels up from server/src/services
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const LOG_DIR = join(PROJECT_ROOT, 'server', 'data');
const LOG_FILE = join(LOG_DIR, 'update.log');

export type UpdateStep =
  | 'idle'
  | 'fetching'
  | 'resetting'
  | 'installing_root'
  | 'installing_server'
  | 'building_frontend'
  | 'building_backend'
  | 'restarting'
  | 'completed'
  | 'failed';

export interface UpdateStatus {
  step: UpdateStep;
  progress: number; // 0-100
  message: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

class UpdateService extends EventEmitter {
  private status: UpdateStatus = {
    step: 'idle',
    progress: 0,
    message: 'Ready for update',
  };

  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private isUpdating = false;

  constructor() {
    super();
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  isUpdateInProgress(): boolean {
    return this.isUpdating;
  }

  private setStatus(status: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...status };
    this.emit('status', this.status);
    this.log(`[${this.status.step}] ${this.status.message}`);
  }

  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp} ${message}\n`;
    console.log(`[UpdateService] ${message}`);

    if (this.logStream) {
      this.logStream.write(logLine);
    }
  }

  private initLogStream() {
    // Ensure log directory exists
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }

    this.logStream = createWriteStream(LOG_FILE, { flags: 'a' });
    this.log('=== Update started ===');
  }

  private closeLogStream() {
    if (this.logStream) {
      this.log('=== Update finished ===\n');
      this.logStream.end();
      this.logStream = null;
    }
  }

  private runCommand(command: string, args: string[], step: UpdateStep, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setStatus({ step, message });

      this.log(`Running: ${command} ${args.join(' ')}`);

      const child = spawn(command, args, {
        cwd: PROJECT_ROOT,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        this.log(`stdout: ${output.trim()}`);
      });

      child.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        this.log(`stderr: ${output.trim()}`);
      });

      child.on('close', (code) => {
        if (code === 0) {
          this.log(`Command completed successfully: ${command}`);
          resolve();
        } else {
          const error = `Command failed with code ${code}: ${stderr || stdout}`;
          this.log(`ERROR: ${error}`);
          reject(new Error(error));
        }
      });

      child.on('error', (error) => {
        this.log(`ERROR: ${error.message}`);
        reject(error);
      });
    });
  }

  async startUpdate(): Promise<void> {
    if (this.isUpdating) {
      throw new Error('Update already in progress');
    }

    this.isUpdating = true;
    this.initLogStream();

    try {
      this.setStatus({
        step: 'fetching',
        progress: 0,
        message: 'Starting update...',
        startedAt: new Date().toISOString(),
        error: undefined,
        completedAt: undefined,
      });

      // Step 1: Git fetch
      await this.runCommand('git', ['fetch', 'origin', 'main'], 'fetching', 'Fetching latest changes from GitHub...');
      this.setStatus({ progress: 10 });

      // Step 2: Git reset (hard reset to avoid conflicts)
      await this.runCommand('git', ['reset', '--hard', 'origin/main'], 'resetting', 'Applying latest changes...');
      this.setStatus({ progress: 20 });

      // Step 3: Install root dependencies
      await this.runCommand('npm', ['install'], 'installing_root', 'Installing root dependencies...');
      this.setStatus({ progress: 35 });

      // Step 4: Install server dependencies
      await this.runCommand('npm', ['install', '--prefix', 'server'], 'installing_server', 'Installing server dependencies...');
      this.setStatus({ progress: 50 });

      // Step 5: Build frontend
      await this.runCommand('npm', ['run', 'build'], 'building_frontend', 'Building frontend...');
      this.setStatus({ progress: 70 });

      // Step 6: Build backend
      await this.runCommand('npm', ['run', 'build:backend'], 'building_backend', 'Building backend...');
      this.setStatus({ progress: 85 });

      // Step 7: Restart service (optional - depends on deployment)
      const shouldRestart = await this.checkSystemdService();
      if (shouldRestart) {
        await this.restartService();
        this.setStatus({ progress: 100 });
      } else {
        this.setStatus({
          step: 'completed',
          progress: 100,
          message: 'Update completed! Please restart the server manually.',
          completedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.setStatus({
        step: 'failed',
        message: 'Update failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      this.closeLogStream();
      this.isUpdating = false;
    }
  }

  private async checkSystemdService(): Promise<boolean> {
    return new Promise((resolve) => {
      exec('systemctl is-active ecoflow-dashboard', (error, stdout) => {
        resolve(stdout.trim() === 'active');
      });
    });
  }

  private async restartService(): Promise<void> {
    this.setStatus({
      step: 'restarting',
      message: 'Restarting service...',
    });

    return new Promise((resolve, reject) => {
      // Use sudo to restart the service
      exec('sudo systemctl restart ecoflow-dashboard', (error, stdout, stderr) => {
        if (error) {
          this.log(`Restart error: ${stderr}`);
          // Don't fail the update if restart fails - just log it
          this.setStatus({
            step: 'completed',
            progress: 100,
            message: 'Update completed! Service restart requires manual action.',
            completedAt: new Date().toISOString(),
          });
          resolve();
        } else {
          this.setStatus({
            step: 'completed',
            progress: 100,
            message: 'Update completed! Service is restarting...',
            completedAt: new Date().toISOString(),
          });
          resolve();
        }
      });
    });
  }
}

export const updateService = new UpdateService();
