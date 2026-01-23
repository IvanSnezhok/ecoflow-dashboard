import { Router, Request, Response } from 'express';
import { versionService } from '../services/versionService.js';
import { updateService, UpdateStatus } from '../services/updateService.js';

const router = Router();

/**
 * GET /api/system/version
 * Returns current version, latest version from GitHub, and update availability
 */
router.get('/version', async (_req: Request, res: Response) => {
  try {
    // Check if this is a git repository
    if (!versionService.isGitRepo()) {
      return res.status(400).json({
        success: false,
        error: 'Not a git repository. Updates are only available for git installations.',
      });
    }

    const versionInfo = await versionService.getVersionInfo();

    res.json({
      success: true,
      data: versionInfo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/system/update
 * Starts the update process
 */
router.post('/update', async (_req: Request, res: Response) => {
  try {
    // Check if this is a git repository
    if (!versionService.isGitRepo()) {
      return res.status(400).json({
        success: false,
        error: 'Not a git repository. Updates are only available for git installations.',
      });
    }

    // Check if update is already in progress
    if (updateService.isUpdateInProgress()) {
      return res.status(409).json({
        success: false,
        error: 'Update already in progress',
      });
    }

    // Start update in background
    updateService.startUpdate().catch((error) => {
      console.error('Update failed:', error);
    });

    res.json({
      success: true,
      message: 'Update started',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/system/update/status
 * Returns current update status (SSE stream for real-time updates)
 */
router.get('/update/status', (req: Request, res: Response) => {
  // Check for SSE request
  const acceptSSE = req.headers.accept?.includes('text/event-stream');

  if (acceptSSE) {
    // SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial status
    const sendStatus = (status: UpdateStatus) => {
      res.write(`data: ${JSON.stringify(status)}\n\n`);
    };

    sendStatus(updateService.getStatus());

    // Listen for updates
    const onStatus = (status: UpdateStatus) => {
      sendStatus(status);
    };

    updateService.on('status', onStatus);

    // Clean up on client disconnect
    req.on('close', () => {
      updateService.off('status', onStatus);
    });
  } else {
    // Regular JSON response
    res.json({
      success: true,
      data: updateService.getStatus(),
    });
  }
});

export default router;
