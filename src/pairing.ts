const PAIRING_STORAGE_KEY = 'husshuss.pairing.v1'
export const MIN_PAIRING_SECRET_LENGTH = 32

export function getPairingSecret(): string | null {
  try {
    return window.localStorage.getItem(PAIRING_STORAGE_KEY)
  } catch {
    return null
  }
}

export function savePairingSecret(secret: string): void {
  window.localStorage.setItem(PAIRING_STORAGE_KEY, secret.trim())
}

export function forgetPairingSecret(): void {
  try {
    window.localStorage.removeItem(PAIRING_STORAGE_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function pairingHeaders(): Record<string, string> {
  const secret = getPairingSecret()
  return secret ? { 'X-Husshuss-Pairing': secret } : {}
}