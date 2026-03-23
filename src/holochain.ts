import {
  AppWebsocket,
  type ActionHash,
  type AgentPubKey,
} from '@holochain/client'

/** Matches `workdir/happ.yaml` role name. */
export const HC_ROLE_NAME = import.meta.env.VITE_HC_ROLE_NAME ?? 'anon_browser'
export const HC_ZOME_NAME = 'anon_browser'

export type BookmarkRow = {
  action_hash: ActionHash
  url: string
  title: string
  created_at_ms: number
}

export type ContactRow = {
  action_hash: ActionHash
  author: AgentPubKey
  display_name: string
  peer_agent_pubkey_b64: string
  invite_proof_b64: string
  created_at_ms: number
}

export type ChatMessageRow = {
  action_hash: ActionHash
  author: AgentPubKey
  thread_id: string
  body: string
  sent_at_ms: number
}

export type WebRtcSignalRow = {
  action_hash: ActionHash
  author: AgentPubKey
  peer_pubkey_b64: string
  signal_kind: string
  payload_json: string
  created_at_ms: number
}

export async function hcListBookmarks(client: AppWebsocket): Promise<BookmarkRow[]> {
  const raw = (await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'list_bookmarks',
    payload: null,
  })) as unknown
  if (!Array.isArray(raw)) throw new Error('list_bookmarks: unexpected response')
  return raw as BookmarkRow[]
}

export async function hcCreateBookmark(
  client: AppWebsocket,
  input: { url: string; title: string; created_at_ms: number },
): Promise<void> {
  await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'create_bookmark',
    payload: input,
  })
}

export async function hcDeleteBookmark(client: AppWebsocket, actionHash: ActionHash): Promise<void> {
  await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'delete_bookmark',
    payload: actionHash,
  })
}

export async function hcListContacts(client: AppWebsocket): Promise<ContactRow[]> {
  const raw = (await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'list_trusted_contacts',
    payload: null,
  })) as unknown
  if (!Array.isArray(raw)) throw new Error('list_trusted_contacts: unexpected response')
  return raw as ContactRow[]
}

export async function hcCreateContact(
  client: AppWebsocket,
  input: {
    display_name: string
    peer_agent_pubkey_b64: string
    invite_proof_b64: string
    created_at_ms: number
  },
): Promise<void> {
  await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'create_trusted_contact',
    payload: input,
  })
}

export async function hcSendChat(
  client: AppWebsocket,
  input: { thread_id: string; body: string; sent_at_ms: number },
): Promise<void> {
  await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'send_chat_message',
    payload: input,
  })
}

export async function hcListThread(
  client: AppWebsocket,
  threadId: string,
): Promise<ChatMessageRow[]> {
  const raw = (await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'list_thread_messages',
    payload: { thread_id: threadId },
  })) as unknown
  if (!Array.isArray(raw)) throw new Error('list_thread_messages: unexpected response')
  return raw as ChatMessageRow[]
}

export async function hcPostSignal(
  client: AppWebsocket,
  input: {
    peer_pubkey_b64: string
    signal_kind: string
    payload_json: string
    created_at_ms: number
  },
): Promise<void> {
  await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'post_webrtc_signal',
    payload: input,
  })
}

export async function hcListSignals(client: AppWebsocket): Promise<WebRtcSignalRow[]> {
  const raw = (await client.callZome({
    role_name: HC_ROLE_NAME,
    zome_name: HC_ZOME_NAME,
    fn_name: 'list_recent_signals',
    payload: null,
  })) as unknown
  if (!Array.isArray(raw)) throw new Error('list_recent_signals: unexpected response')
  return raw as WebRtcSignalRow[]
}
