export interface FingerprintResult {
  fingerprintId: string
  hash: string
  submittedAt: string
}

export interface OwnershipRecord {
  fingerprintId: string
  ownerId: string | null
  ownerName: string | null
  status: 'verified' | 'unverified' | 'disputed'
  registeredAt: string | null
}

export class RightsClient {
  private baseUrl: string

  constructor(baseUrl: string = '/api/rezonate') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async submitFingerprint(
    blob: Blob,
    metadata?: { projectId?: string; padIndex?: number }
  ): Promise<FingerprintResult> {
    const form = new FormData()
    form.append('audio', blob)
    if (metadata?.projectId !== undefined) {
      form.append('projectId', metadata.projectId)
    }
    if (metadata?.padIndex !== undefined) {
      form.append('padIndex', String(metadata.padIndex))
    }

    const response = await fetch(`${this.baseUrl}/fingerprint`, {
      method: 'POST',
      body: form,
    })

    if (!response.ok) {
      throw new Error(`submitFingerprint failed: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<FingerprintResult>
  }

  async checkOwnership(fingerprintId: string): Promise<OwnershipRecord> {
    const response = await fetch(
      `${this.baseUrl}/ownership/${encodeURIComponent(fingerprintId)}`,
      { method: 'GET' }
    )

    if (!response.ok) {
      throw new Error(`checkOwnership failed: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<OwnershipRecord>
  }

  async claimOwnership(fingerprintId: string, userId: string): Promise<OwnershipRecord> {
    const response = await fetch(`${this.baseUrl}/ownership/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprintId, userId }),
    })

    if (!response.ok) {
      throw new Error(`claimOwnership failed: ${response.status} ${response.statusText}`)
    }

    return response.json() as Promise<OwnershipRecord>
  }
}

export default RightsClient
