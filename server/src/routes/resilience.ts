import { Router } from 'express'
import { z } from 'zod'
import { getDeviceById, upsertResilienceSettings } from '../db/database.js'
import {
  forceRefresh,
  getResilienceCatalog,
  getResilienceGroups,
  resolveResilienceGroup,
  searchResilienceHouses,
  searchResilienceStreets,
  getSettings,
  getStatus,
} from '../services/resilienceService.js'

export const resilienceRouter = Router()

const loadPeriodSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  watts: z.number().int().min(0).max(3600),
  label: z.string().trim().max(40).optional(),
})

const settingsSchema = z.object({
  deviceId: z.number().int().positive().optional(),
  enabled: z.boolean(),
  autoAc: z.boolean(),
  regionId: z.number().int().positive().optional(),
  dsoId: z.number().int().positive().optional(),
  outageGroup: z.string().trim().max(20).optional(),
  warningLeadMinutes: z.number().int().min(5).max(360),
  recoveryDelayMinutes: z.number().int().min(0).max(180),
  minSoc: z.number().int().min(5).max(90),
  reserveSoc: z.number().int().min(0).max(50),
  batteryCapacityWh: z.number().int().min(500).max(10000),
  inverterEfficiency: z.number().min(0.5).max(1),
  loadProfile: z.array(loadPeriodSchema).max(24),
})

resilienceRouter.get('/settings', (_req, res) => res.json({ success: true, data: getSettings() }))
resilienceRouter.get('/status', (_req, res) => res.json({ success: true, data: getStatus() }))

resilienceRouter.put('/settings', (req, res) => {
  const parsed = settingsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid settings' })
    return
  }
  const value = parsed.data
  if (value.deviceId && !getDeviceById(value.deviceId)) {
    res.status(400).json({ success: false, error: 'Selected device does not exist' })
    return
  }
  if (value.enabled && (!value.deviceId || !value.regionId || !value.dsoId || !value.outageGroup)) {
    res.status(400).json({ success: false, error: 'Device, region, operator and outage group are required when enabled' })
    return
  }
  if (value.reserveSoc >= value.minSoc) {
    res.status(400).json({ success: false, error: 'Reserve SOC must be lower than minimum automation SOC' })
    return
  }
  upsertResilienceSettings({
    device_id: value.deviceId ?? null, enabled: value.enabled ? 1 : 0, auto_ac: value.autoAc ? 1 : 0,
    region_id: value.regionId ?? null, dso_id: value.dsoId ?? null, outage_group: value.outageGroup ?? null,
    warning_lead_minutes: value.warningLeadMinutes, recovery_delay_minutes: value.recoveryDelayMinutes,
    min_soc: value.minSoc, reserve_soc: value.reserveSoc, battery_capacity_wh: value.batteryCapacityWh,
    inverter_efficiency: value.inverterEfficiency, load_profile: JSON.stringify(value.loadProfile),
  })
  res.json({ success: true, data: getSettings() })
})

resilienceRouter.get('/catalog', async (_req, res) => {
  try { res.json({ success: true, data: await getResilienceCatalog() }) }
  catch (error) { res.status(502).json({ success: false, error: error instanceof Error ? error.message : String(error) }) }
})

resilienceRouter.get('/groups', async (req, res) => {
  const regionId = Number(req.query.regionId); const dsoId = Number(req.query.dsoId)
  if (!Number.isInteger(regionId) || !Number.isInteger(dsoId)) {
    res.status(400).json({ success: false, error: 'Valid regionId and dsoId are required' }); return
  }
  try { res.json({ success: true, data: await getResilienceGroups(regionId, dsoId) }) }
  catch (error) { res.status(502).json({ success: false, error: error instanceof Error ? error.message : String(error) }) }
})

resilienceRouter.get('/address/streets', async (req, res) => {
  const regionId = Number(req.query.regionId); const dsoId = Number(req.query.dsoId)
  const query = String(req.query.query ?? '').trim()
  if (!Number.isInteger(regionId) || !Number.isInteger(dsoId) || query.length < 2 || query.length > 80) {
    res.status(400).json({ success: false, error: 'Region, operator and at least 2 street characters are required' }); return
  }
  try { res.json({ success: true, data: await searchResilienceStreets(regionId, dsoId, query) }) }
  catch (error) { res.status(502).json({ success: false, error: error instanceof Error ? error.message : String(error) }) }
})

resilienceRouter.get('/address/houses', async (req, res) => {
  const regionId = Number(req.query.regionId); const dsoId = Number(req.query.dsoId); const streetId = Number(req.query.streetId)
  const query = String(req.query.query ?? '').trim()
  if (!Number.isInteger(regionId) || !Number.isInteger(dsoId) || !Number.isInteger(streetId) || query.length > 30) {
    res.status(400).json({ success: false, error: 'Region, operator and street are required' }); return
  }
  try { res.json({ success: true, data: await searchResilienceHouses(regionId, dsoId, streetId, query) }) }
  catch (error) { res.status(502).json({ success: false, error: error instanceof Error ? error.message : String(error) }) }
})

resilienceRouter.get('/address/group', async (req, res) => {
  const regionId = Number(req.query.regionId); const dsoId = Number(req.query.dsoId)
  const streetId = Number(req.query.streetId); const houseId = Number(req.query.houseId)
  if (![regionId, dsoId, streetId, houseId].every(Number.isInteger)) {
    res.status(400).json({ success: false, error: 'Complete address is required' }); return
  }
  try { res.json({ success: true, data: { group: await resolveResilienceGroup(regionId, dsoId, streetId, houseId) } }) }
  catch (error) { res.status(502).json({ success: false, error: error instanceof Error ? error.message : String(error) }) }
})

resilienceRouter.post('/refresh', async (_req, res) => {
  try { res.json({ success: true, data: await forceRefresh() }) }
  catch (error) { res.status(502).json({ success: false, error: error instanceof Error ? error.message : String(error) }) }
})
