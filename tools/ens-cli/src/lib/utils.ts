import { normalize } from 'viem/ens'

export function validateName(name: string): string {
  if (!name || !name.trim()) {
    throw new Error('Name cannot be empty.')
  }
  try {
    const normalized = normalize(name)
    if (!normalized.includes('.')) {
      throw new Error(
        `Invalid ENS name: "${normalized}". Expected a fully qualified name (e.g. name.eth).`,
      )
    }
    return normalized
  } catch (error) {
    throw new Error(`Invalid ENS name: "${name}". Could not normalize name.`)
  }
}

export function extractLabel(name: string): string {
  const normalized = validateName(name)
  const parts = normalized.split('.')
  if (parts.length !== 2 || parts[1] !== 'eth') {
    throw new Error(`Registration only supports 2LDs (e.g. name.eth). Got: ${normalized}`)
  }
  const label = parts[0]!
  if (label.length < 3) {
    throw new Error(
      `Name "${label}.eth" is too short. The registrar requires labels of at least 3 characters.`,
    )
  }
  return label
}
