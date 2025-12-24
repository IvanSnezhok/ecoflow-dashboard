import { Router, Request, Response } from 'express'
import { getLogs, getDeviceBySn } from '../db/database.js'

const router = Router()

// Get operation logs
router.get('/', (req: Request, res: Response) => {
  try {
    const { deviceSn, type, limit = '100', offset = '0' } = req.query

    let deviceId: number | undefined
    if (deviceSn && typeof deviceSn === 'string') {
      const device = getDeviceBySn(deviceSn) as { id: number } | undefined
      deviceId = device?.id
    }

    const logs = getLogs({
      deviceId,
      operationType: type as string | undefined,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    })

    res.json(logs)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ error: message })
  }
})

export default router
