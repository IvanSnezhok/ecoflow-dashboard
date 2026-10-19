/** The EcoFlow API answered with a non-zero code, e.g. 1006 for a device it will not serve. */
export class EcoflowApiError extends Error {
  constructor(readonly code: string, readonly apiMessage: string) {
    super(`Ecoflow API error (code ${code}): ${apiMessage}`);
  }
}
