import {
  AdminWebsocket,
  AppWebsocket,
  type AppAuthenticationToken,
} from '@holochain/client'

export type HoloConnectResult =
  | { ok: true; client: AppWebsocket; signingNote: string | null }
  | { ok: false; reason: string }

function parseAppToken(raw: string): AppAuthenticationToken {
  const t = raw.trim()
  if (t.startsWith('[')) {
    const parsed: unknown = JSON.parse(t)
    if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === 'number')) {
      throw new Error('VITE_HC_APP_TOKEN JSON must be a number[]')
    }
    return parsed as AppAuthenticationToken
  }
  return [...new TextEncoder().encode(t)]
}

async function authorizeZomeSigningIfConfigured(client: AppWebsocket): Promise<string | null> {
  const adminUrl = import.meta.env.VITE_HC_ADMIN_WS?.trim()
  if (!adminUrl) return null

  const role = import.meta.env.VITE_HC_ROLE_NAME ?? 'anon_browser'
  let admin: AdminWebsocket | undefined
  try {
    admin = await AdminWebsocket.connect({
      url: new URL(adminUrl),
      defaultTimeout: 12_000,
    })
    const appInfo = await client.appInfo()
    const cellId = client.getCellIdFromRoleName(role, appInfo)
    await admin.authorizeSigningCredentials(cellId)
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `Admin signing setup failed (${msg}). Zome calls may fail until credentials are authorized.`
  } finally {
    await admin?.client.close()
  }
}

export async function tryConnectHolo(): Promise<HoloConnectResult> {
  const urlStr = import.meta.env.VITE_HC_APP_WS as string | undefined
  const tokenRaw = import.meta.env.VITE_HC_APP_TOKEN as string | undefined

  if (!urlStr?.trim() || !tokenRaw?.trim()) {
    return {
      ok: false,
      reason:
        'Set VITE_HC_APP_WS and VITE_HC_APP_TOKEN (from your conductor / hc spin output).',
    }
  }

  let token: AppAuthenticationToken
  try {
    token = parseAppToken(tokenRaw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `Bad VITE_HC_APP_TOKEN: ${msg}` }
  }

  try {
    const client = await AppWebsocket.connect({
      url: new URL(urlStr),
      token,
      defaultTimeout: 8000,
    })
    await client.appInfo()
    const signingNote = await authorizeZomeSigningIfConfigured(client)
    if (signingNote) console.warn(signingNote)
    return { ok: true, client, signingNote }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg }
  }
}
