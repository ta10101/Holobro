use serde::{Deserialize, Serialize};
use native_tls::TlsConnector as NativeTlsConnector;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::io::{split, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::net::TcpStream;
use tokio::sync::Mutex as AsyncMutex;
use tokio::task::JoinHandle;
use tokio_native_tls::TlsConnector as TokioTlsConnector;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcConnectReq {
    pub session_id: String,
    pub server: String,
    pub port: u16,
    pub nick: String,
    pub username: String,
    pub realname: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub use_tls: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcSendReq {
    pub session_id: String,
    pub line: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcJoinReq {
    pub session_id: String,
    pub channel: String,
    #[serde(default)]
    pub key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcPollReq {
    pub session_id: String,
    #[serde(default = "default_poll_limit")]
    pub limit: usize,
}

fn default_poll_limit() -> usize {
    120
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcConnectResult {
    pub connected: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrcPollResult {
    pub connected: bool,
    pub lines: Vec<String>,
}

struct IrcSession {
    writer: Arc<AsyncMutex<WriteHalf<DynStream>>>,
    inbox: Arc<Mutex<Vec<String>>>,
    connected: Arc<AtomicBool>,
    read_task: JoinHandle<()>,
}

trait AsyncReadWrite: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncReadWrite for T {}
type DynStream = Box<dyn AsyncReadWrite>;

static IRC_SESSIONS: OnceLock<Mutex<HashMap<String, IrcSession>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, IrcSession>> {
    IRC_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn write_line(writer: &Arc<AsyncMutex<WriteHalf<DynStream>>>, line: &str) -> Result<(), String> {
    let mut w = writer.lock().await;
    w.write_all(line.as_bytes())
        .await
        .map_err(|e| format!("IRC write failed: {e}"))?;
    w.write_all(b"\r\n")
        .await
        .map_err(|e| format!("IRC write failed: {e}"))?;
    w.flush()
        .await
        .map_err(|e| format!("IRC flush failed: {e}"))?;
    Ok(())
}

fn push_inbox(inbox: &Arc<Mutex<Vec<String>>>, line: String) {
    if let Ok(mut ib) = inbox.lock() {
        ib.push(line);
        let keep = 800usize;
        if ib.len() > keep {
            let drop_n = ib.len().saturating_sub(keep);
            ib.drain(0..drop_n);
        }
    }
}

fn spawn_reader(
    read_half: ReadHalf<DynStream>,
    writer: Arc<AsyncMutex<WriteHalf<DynStream>>>,
    inbox: Arc<Mutex<Vec<String>>>,
    connected: Arc<AtomicBool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = BufReader::new(read_half);
        let mut line = String::new();
        loop {
            line.clear();
            let n = match reader.read_line(&mut line).await {
                Ok(n) => n,
                Err(e) => {
                    push_inbox(&inbox, format!("! read error: {e}"));
                    break;
                }
            };
            if n == 0 {
                push_inbox(&inbox, "! disconnected".into());
                break;
            }
            let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
            if trimmed.starts_with("PING ") {
                let payload = trimmed.trim_start_matches("PING ");
                if let Err(e) = write_line(&writer, &format!("PONG {payload}")).await {
                    push_inbox(&inbox, format!("! {e}"));
                    break;
                }
            }
            push_inbox(&inbox, trimmed);
        }
        connected.store(false, Ordering::Relaxed);
    })
}

#[tauri::command]
pub async fn irc_connect(req: IrcConnectReq) -> Result<IrcConnectResult, String> {
    let session_id = req.session_id.trim().to_string();
    let server = req.server.trim().to_string();
    let nick = req.nick.trim().to_string();
    let username = req.username.trim().to_string();
    let realname = req.realname.trim().to_string();
    if session_id.is_empty() || server.is_empty() || nick.is_empty() || username.is_empty() {
        return Err("Session, server, nick, and username are required.".into());
    }
    let port = if req.port == 0 {
        if req.use_tls { 6697 } else { 6667 }
    } else {
        req.port
    };
    let addr = format!("{server}:{port}");

    let prev = {
        let mut map = sessions().lock().map_err(|_| "IRC state lock poisoned")?;
        map.remove(&session_id)
    };
    if let Some(old) = prev {
        old.connected.store(false, Ordering::Relaxed);
        old.read_task.abort();
    }

    let tcp = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("Connect failed ({addr}): {e}"))?;
    let stream: DynStream = if req.use_tls {
        let native = NativeTlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS init failed: {e}"))?;
        let connector = TokioTlsConnector::from(native);
        let tls = connector
            .connect(&server, tcp)
            .await
            .map_err(|e| format!("TLS connect failed ({server}): {e}"))?;
        Box::new(tls)
    } else {
        Box::new(tcp)
    };
    let (read_half, write_half) = split(stream);
    let writer = Arc::new(AsyncMutex::new(write_half));
    let inbox = Arc::new(Mutex::new(Vec::<String>::new()));
    let connected = Arc::new(AtomicBool::new(true));

    if let Some(pass) = req.password.as_ref().map(|p| p.trim()).filter(|p| !p.is_empty()) {
        write_line(&writer, &format!("PASS {pass}")).await?;
    }
    write_line(&writer, &format!("NICK {nick}")).await?;
    write_line(&writer, &format!("USER {username} 0 * :{realname}")).await?;
    push_inbox(
        &inbox,
        format!(
            "! connecting to {addr} as {nick} ({})",
            if req.use_tls { "TLS" } else { "plain TCP" }
        ),
    );

    let read_task = spawn_reader(read_half, writer.clone(), inbox.clone(), connected.clone());

    let session = IrcSession {
        writer,
        inbox,
        connected,
        read_task,
    };
    let mut map = sessions().lock().map_err(|_| "IRC state lock poisoned")?;
    map.insert(session_id, session);

    Ok(IrcConnectResult {
        connected: true,
        message: format!("Connected to {addr}."),
    })
}

#[tauri::command]
pub async fn irc_send(req: IrcSendReq) -> Result<(), String> {
    let session_id = req.session_id.trim();
    let line = req.line.trim();
    if session_id.is_empty() || line.is_empty() {
        return Err("Session and command line are required.".into());
    }
    let writer = {
        let map = sessions().lock().map_err(|_| "IRC state lock poisoned")?;
        map.get(session_id)
            .map(|s| s.writer.clone())
            .ok_or_else(|| "IRC session not found. Connect first.".to_string())?
    };
    write_line(&writer, line).await
}

#[tauri::command]
pub async fn irc_join(req: IrcJoinReq) -> Result<(), String> {
    let session_id = req.session_id.trim();
    let channel = req.channel.trim();
    if session_id.is_empty() || channel.is_empty() {
        return Err("Session and channel are required.".into());
    }
    let writer = {
        let map = sessions().lock().map_err(|_| "IRC state lock poisoned")?;
        map.get(session_id)
            .map(|s| s.writer.clone())
            .ok_or_else(|| "IRC session not found. Connect first.".to_string())?
    };
    let key = req.key.as_ref().map(|k| k.trim()).unwrap_or("");
    if key.is_empty() {
        write_line(&writer, &format!("JOIN {channel}")).await
    } else {
        write_line(&writer, &format!("JOIN {channel} {key}")).await
    }
}

#[tauri::command]
pub async fn irc_disconnect(session_id: String) -> Result<(), String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() {
        return Err("Session ID is empty.".into());
    }
    let removed = {
        let mut map = sessions().lock().map_err(|_| "IRC state lock poisoned")?;
        map.remove(&sid)
    };
    if let Some(sess) = removed {
        let _ = write_line(&sess.writer, "QUIT :bye from HoloBro").await;
        sess.connected.store(false, Ordering::Relaxed);
        sess.read_task.abort();
        return Ok(());
    }
    Err("IRC session not found.".into())
}

#[tauri::command]
pub async fn irc_poll(req: IrcPollReq) -> Result<IrcPollResult, String> {
    let sid = req.session_id.trim();
    if sid.is_empty() {
        return Err("Session ID is empty.".into());
    }
    let (connected, lines) = {
        let map = sessions().lock().map_err(|_| "IRC state lock poisoned")?;
        let sess = map
            .get(sid)
            .ok_or_else(|| "IRC session not found. Connect first.".to_string())?;
        let connected = sess.connected.load(Ordering::Relaxed);
        let mut out = Vec::new();
        if let Ok(mut ib) = sess.inbox.lock() {
            let lim = req.limit.clamp(1, 400);
            let take = ib.len().min(lim);
            out.extend(ib.drain(0..take));
        }
        (connected, out)
    };
    Ok(IrcPollResult { connected, lines })
}
