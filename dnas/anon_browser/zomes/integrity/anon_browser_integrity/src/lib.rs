use hdi::prelude::*;

/// A bookmark stored in the agent’s source chain.
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Bookmark {
    pub url: String,
    pub title: String,
    pub created_at_ms: i64,
}

/// Trusted contact: stores the peer’s agent pubkey plus optional signed invitation material.
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct TrustedContact {
    pub display_name: String,
    /// Holochain `AgentPubKey` for the other party (base64).
    pub peer_agent_pubkey_b64: String,
    /// Opaque blob proving mutual trust (e.g. signed invitation). Empty in dev.
    pub invite_proof_b64: String,
    pub created_at_ms: i64,
}

/// Chat payload: encrypt client-side for production; stored as opaque text here.
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct ChatMessage {
    pub thread_id: String,
    pub body: String,
    pub sent_at_ms: i64,
}

/// WebRTC signaling envelope (offer / answer / ICE). Peers poll or subscribe via app signals.
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct WebRtcSignal {
    pub peer_pubkey_b64: String,
    pub signal_kind: String,
    pub payload_json: String,
    pub created_at_ms: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
#[hdk_entry_types]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    Bookmark(Bookmark),
    TrustedContact(TrustedContact),
    ChatMessage(ChatMessage),
    WebRtcSignal(WebRtcSignal),
}

#[derive(Serialize, Deserialize)]
#[hdk_link_types]
pub enum LinkTypes {
    AllBookmarks,
    AllContacts,
    ThreadMessages,
    Signaling,
}

#[hdk_extern]
pub fn genesis_self_check(_data: GenesisSelfCheckData) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}

#[hdk_extern]
pub fn validate(_op: Op) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
