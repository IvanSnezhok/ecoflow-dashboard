import crypto from "crypto";

interface SignatureParams {
  accessKey: string;
  secretKey: string;
  params?: Record<string, unknown>;
}

interface SignatureResult {
  headers: Record<string, string>;
  timestamp: number;
  nonce: string;
  sign: string;
  signatureBase: string;
}

/**
 * Recursively flatten nested objects into dot-notation key-value pairs
 * Arrays use bracket notation: ids[0], ids[1], etc.
 * Example: { params: { id: 66, enabled: 1 } } => "params.enabled=1&params.id=66"
 */
function flattenParams(
  obj: Record<string, unknown>,
  prefix = "",
): Array<[string, string | number | boolean]> {
  const result: Array<[string, string | number | boolean]> = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      // Handle arrays with bracket notation
      value.forEach((item, index) => {
        if (typeof item === "object" && item !== null) {
          result.push(
            ...flattenParams(
              item as Record<string, unknown>,
              `${fullKey}[${index}]`,
            ),
          );
        } else {
          result.push([
            `${fullKey}[${index}]`,
            item as string | number | boolean,
          ]);
        }
      });
    } else if (typeof value === "object") {
      // Recursively flatten nested objects
      result.push(...flattenParams(value as Record<string, unknown>, fullKey));
    } else {
      // Primitive value
      result.push([fullKey, value as string | number | boolean]);
    }
  }

  return result;
}

export function generateSignature({
  accessKey,
  secretKey,
  params = {},
}: SignatureParams): SignatureResult {
  const timestamp = Date.now();
  const nonce = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit random number

  // Flatten and sort parameters by ASCII value (alphabetically)
  const flattenedParams = flattenParams(params);
  const sortedParams = flattenedParams
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  // Build signature string: params (if any) + accessKey + nonce + timestamp
  const signatureBase = sortedParams
    ? `${sortedParams}&accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`
    : `accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`;

  // Generate HMAC-SHA256 signature
  const sign = crypto
    .createHmac("sha256", secretKey)
    .update(signatureBase)
    .digest("hex");

  return {
    headers: {
      accessKey,
      nonce,
      timestamp: timestamp.toString(),
      sign,
      "Content-Type": "application/json;charset=UTF-8",
    },
    timestamp,
    nonce,
    sign,
    signatureBase,
  };
}
