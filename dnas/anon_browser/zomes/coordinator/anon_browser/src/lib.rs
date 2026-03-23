use anon_browser_integrity::{Bookmark, ChatMessage, EntryTypes, LinkTypes, TrustedContact, WebRtcSignal};
use hdk::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct BookmarkRow {
    pub action_hash: ActionHash,
    pub url: String,
    pub title: String,
    pub created_at_ms: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ContactRow {
    pub action_hash: ActionHash,
    pub author: AgentPubKey,
    pub display_name: String,
    pub peer_agent_pubkey_b64: String,
    pub invite_proof_b64: String,
    pub created_at_ms: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ChatMessageRow {
    pub action_hash: ActionHash,
    pub author: AgentPubKey,
    pub thread_id: String,
    pub body: String,
    pub sent_at_ms: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct WebRtcSignalRow {
    pub action_hash: ActionHash,
    pub author: AgentPubKey,
    pub peer_pubkey_b64: String,
    pub signal_kind: String,
    pub payload_json: String,
    pub created_at_ms: i64,
}

#[hdk_extern]
pub fn create_bookmark(input: Bookmark) -> ExternResult<ActionHash> {
    let ah = create_entry(&EntryTypes::Bookmark(input.clone()))?;
    let path = Path::from("bookmarks");
    create_link(
        path.path_entry_hash()?,
        ah.clone(),
        LinkTypes::AllBookmarks,
        (),
    )?;
    Ok(ah)
}

#[hdk_extern]
pub fn list_bookmarks(_: ()) -> ExternResult<Vec<BookmarkRow>> {
    let path = Path::from("bookmarks");
    let links = get_links(
        LinkQuery::new(
            path.path_entry_hash()?,
            LinkTypes::AllBookmarks.try_into_filter()?,
        ),
        GetStrategy::default(),
    )?;
    let mut out = Vec::new();
    for link in links {
        let ah = link
            .target
            .into_action_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "bookmark link missing action hash".into()
            )))?;
        let record = get(ah.clone(), GetOptions::default())?.ok_or(wasm_error!(
            WasmErrorInner::Guest("bookmark not found".into())
        ))?;
        let b: Bookmark = record.entry.to_app_option()?.ok_or(wasm_error!(
            WasmErrorInner::Guest("invalid bookmark entry".into())
        ))?;
        out.push(BookmarkRow {
            action_hash: ah,
            url: b.url,
            title: b.title,
            created_at_ms: b.created_at_ms,
        });
    }
    Ok(out)
}

#[hdk_extern]
pub fn delete_bookmark(action_hash: ActionHash) -> ExternResult<()> {
    delete_entry(DeleteInput {
        deletes_action_hash: action_hash,
        chain_top_ordering: ChainTopOrdering::default(),
    })?;
    Ok(())
}

#[hdk_extern]
pub fn create_trusted_contact(input: TrustedContact) -> ExternResult<ActionHash> {
    let ah = create_entry(&EntryTypes::TrustedContact(input.clone()))?;
    let path = Path::from("contacts");
    create_link(
        path.path_entry_hash()?,
        ah.clone(),
        LinkTypes::AllContacts,
        (),
    )?;
    Ok(ah)
}

#[hdk_extern]
pub fn list_trusted_contacts(_: ()) -> ExternResult<Vec<ContactRow>> {
    let path = Path::from("contacts");
    let links = get_links(
        LinkQuery::new(
            path.path_entry_hash()?,
            LinkTypes::AllContacts.try_into_filter()?,
        ),
        GetStrategy::default(),
    )?;
    let mut out = Vec::new();
    for link in links {
        let ah = link
            .target
            .into_action_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "contact link missing action hash".into()
            )))?;
        let record = get(ah.clone(), GetOptions::default())?.ok_or(wasm_error!(
            WasmErrorInner::Guest("contact not found".into())
        ))?;
        let author = record.action().author().clone();
        let c: TrustedContact = record.entry.to_app_option()?.ok_or(wasm_error!(
            WasmErrorInner::Guest("invalid contact entry".into())
        ))?;
        out.push(ContactRow {
            action_hash: ah,
            author,
            display_name: c.display_name,
            peer_agent_pubkey_b64: c.peer_agent_pubkey_b64,
            invite_proof_b64: c.invite_proof_b64,
            created_at_ms: c.created_at_ms,
        });
    }
    Ok(out)
}

#[hdk_extern]
pub fn send_chat_message(input: ChatMessage) -> ExternResult<ActionHash> {
    let ah = create_entry(&EntryTypes::ChatMessage(input.clone()))?;
    let path = Path::from(format!("thread/{}", input.thread_id));
    create_link(
        path.path_entry_hash()?,
        ah.clone(),
        LinkTypes::ThreadMessages,
        (),
    )?;
    Ok(ah)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ListThreadInput {
    pub thread_id: String,
}

#[hdk_extern]
pub fn list_thread_messages(input: ListThreadInput) -> ExternResult<Vec<ChatMessageRow>> {
    let path = Path::from(format!("thread/{}", input.thread_id));
    let links = get_links(
        LinkQuery::new(
            path.path_entry_hash()?,
            LinkTypes::ThreadMessages.try_into_filter()?,
        ),
        GetStrategy::default(),
    )?;
    let mut out = Vec::new();
    for link in links {
        let ah = link
            .target
            .into_action_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "thread link missing action hash".into()
            )))?;
        let record = get(ah.clone(), GetOptions::default())?.ok_or(wasm_error!(
            WasmErrorInner::Guest("message not found".into())
        ))?;
        let author = record.action().author().clone();
        let m: ChatMessage = record.entry.to_app_option()?.ok_or(wasm_error!(
            WasmErrorInner::Guest("invalid chat entry".into())
        ))?;
        out.push(ChatMessageRow {
            action_hash: ah,
            author,
            thread_id: m.thread_id,
            body: m.body,
            sent_at_ms: m.sent_at_ms,
        });
    }
    Ok(out)
}

#[hdk_extern]
pub fn post_webrtc_signal(input: WebRtcSignal) -> ExternResult<ActionHash> {
    let ah = create_entry(&EntryTypes::WebRtcSignal(input.clone()))?;
    let path = Path::from("signaling");
    create_link(
        path.path_entry_hash()?,
        ah.clone(),
        LinkTypes::Signaling,
        (),
    )?;
    Ok(ah)
}

#[hdk_extern]
pub fn list_recent_signals(_: ()) -> ExternResult<Vec<WebRtcSignalRow>> {
    let path = Path::from("signaling");
    let links = get_links(
        LinkQuery::new(
            path.path_entry_hash()?,
            LinkTypes::Signaling.try_into_filter()?,
        ),
        GetStrategy::default(),
    )?;
    let mut out = Vec::new();
    for link in links {
        let ah = link
            .target
            .into_action_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "signal link missing action hash".into()
            )))?;
        let record = get(ah.clone(), GetOptions::default())?.ok_or(wasm_error!(
            WasmErrorInner::Guest("signal not found".into())
        ))?;
        let author = record.action().author().clone();
        let s: WebRtcSignal = record.entry.to_app_option()?.ok_or(wasm_error!(
            WasmErrorInner::Guest("invalid signal entry".into())
        ))?;
        out.push(WebRtcSignalRow {
            action_hash: ah,
            author,
            peer_pubkey_b64: s.peer_pubkey_b64,
            signal_kind: s.signal_kind,
            payload_json: s.payload_json,
            created_at_ms: s.created_at_ms,
        });
    }
    Ok(out)
}
