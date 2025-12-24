import crypto from 'crypto'

interface SignatureParams {
  accessKey: string
  secretKey: string
  params?: Record<string, string | number | boolean>
}

interface SignatureResult {
  headers: Record<string, string>
  timestamp: number
  nonce: string
  sign: string
  signatureBase: string
}

export function generateSignature({ accessKey, secretKey, params = {} }: SignatureParams): SignatureResult {
  const timestamp = Date.now()
  const nonce = Math.floor(10000 + Math.random() * 990001).toString()

  // Flatten and sort parameters alphabetically
  const sortedParams = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

  // Build signature string
  const signatureBase = sortedParams
    ? `${sortedParams}&accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`
    : `accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`

  // Generate HMAC-SHA256 signature
  const sign = crypto
    .createHmac('sha256', secretKey)
    .update(signatureBase)
    .digest('hex')

  return {
    headers: {
      accessKey,
      nonce,
      timestamp: timestamp.toString(),
      sign,
      'Content-Type': 'application/json',
    },
    timestamp,
    nonce,
    sign,
    signatureBase,
  }
}
