import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is 3 levels up from server/src/services
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

interface VersionInfo {
  current: string;
  currentCommit: string;
  latest: string | null;
  latestCommit: string | null;
  updateAvailable: boolean;
  error?: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
  };
}

export const versionService = {
  /**
   * Get current version from package.json
   */
  getCurrentVersion(): string {
    try {
      const packageJsonPath = join(PROJECT_ROOT, 'package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  },

  /**
   * Get current git commit hash (short)
   */
  getCurrentCommit(): string {
    try {
      return execSync('git rev-parse --short HEAD', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return 'unknown';
    }
  },

  /**
   * Get git remote origin URL to determine repo owner/name
   */
  getGitHubRepo(): { owner: string; repo: string } | null {
    try {
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim();

      // Parse GitHub URL (supports both HTTPS and SSH formats)
      // HTTPS: https://github.com/owner/repo.git
      // SSH: git@github.com:owner/repo.git
      const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
      const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);

      const match = httpsMatch || sshMatch;
      if (match) {
        return { owner: match[1], repo: match[2] };
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Check latest version from GitHub
   */
  async getLatestCommit(): Promise<{ sha: string; message: string } | null> {
    const repo = this.getGitHubRepo();
    if (!repo) {
      return null;
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/main`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Ecoflow-Dashboard',
          },
        }
      );

      if (!response.ok) {
        console.error(`GitHub API error: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as GitHubCommit;
      return {
        sha: data.sha,
        message: data.commit.message,
      };
    } catch (error) {
      console.error('Failed to fetch GitHub commits:', error);
      return null;
    }
  },

  /**
   * Get full version info including update check
   */
  async getVersionInfo(): Promise<VersionInfo> {
    const current = this.getCurrentVersion();
    const currentCommit = this.getCurrentCommit();

    try {
      const latestCommit = await this.getLatestCommit();

      if (!latestCommit) {
        return {
          current,
          currentCommit,
          latest: null,
          latestCommit: null,
          updateAvailable: false,
          error: 'Could not check GitHub for updates',
        };
      }

      const latestShort = latestCommit.sha.substring(0, 7);
      const updateAvailable = currentCommit !== latestShort;

      return {
        current,
        currentCommit,
        latest: current, // Version stays same, commit changes
        latestCommit: latestShort,
        updateAvailable,
      };
    } catch (error) {
      return {
        current,
        currentCommit,
        latest: null,
        latestCommit: null,
        updateAvailable: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  /**
   * Check if running from git repository
   */
  isGitRepo(): boolean {
    return existsSync(join(PROJECT_ROOT, '.git'));
  },
};
