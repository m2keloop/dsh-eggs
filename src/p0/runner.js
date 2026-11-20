const RUN_ID = 'p0-run'
const result = (status, code) => ({ run_id: RUN_ID, status, code })

export function safeResult(claimConfigId) {
  if (claimConfigId !== 'claim_p0') return result('failed', 'INVALID_CONFIG_ID')
  return null
}

// This deliberately does not access a website or real user credentials.
export async function runFakeClaim({ claimConfigId, readCredential, signal }) {
  signal?.throwIfAborted()
  const invalid = safeResult(claimConfigId)
  if (invalid) return invalid
  try {
    const synthetic = await readCredential()
    signal?.throwIfAborted()
    if (typeof synthetic !== 'string' || synthetic.length === 0) return result('failed', 'LOCAL_CREDENTIAL_ERROR')
    return result('verified', 'FAKE_CLAIM_VERIFIED')
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted()
    return result('failed', 'LOCAL_CREDENTIAL_ERROR')
  }
}
