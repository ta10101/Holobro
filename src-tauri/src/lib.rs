mod network_tools;
mod irc_tools;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::webview::WebviewBuilder;
use tauri::LogicalPosition;
use tauri::LogicalSize;
use tauri::Manager;
use tauri::Url;
use tauri::WebviewUrl;

const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_SECS: u64 = 45;
const CONTENT_WEBVIEW_LABEL: &str = "content";

/// Generic desktop Chrome UA (no custom product token) — only used when user turns off stealth / engine-default UA.
const GENERIC_CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentPrivacySettings {
    /// When true, do not set a custom User-Agent (WebView2 uses its normal Edge-class string — less unique).
    #[serde(default = "default_true")]
    pub stealth_user_agent: bool,
    /// Inject WebRTC / media hardening script on all frames.
    #[serde(default = "default_true")]
    pub block_webrtc: bool,
    /// Best-effort ad/tracker request + element blocking in embedded pages.
    #[serde(default = "default_true")]
    pub block_ads: bool,
    /// NoScript-like mode: disable or suppress page JavaScript.
    #[serde(default)]
    pub block_scripts: bool,
    /// Route the embedded webview through HTTP or SOCKS5 proxy (e.g. Tor `socks5://127.0.0.1:9050`).
    #[serde(default)]
    pub use_proxy: bool,
    #[serde(default = "default_tor_socks")]
    pub proxy_url: String,
    /// Ephemeral WebView2 profile (no persisted session between recreates).
    #[serde(default = "default_true")]
    pub incognito: bool,
}

fn default_true() -> bool {
    true
}

fn default_tor_socks() -> String {
    "socks5://127.0.0.1:9050".into()
}

fn default_content_privacy() -> ContentPrivacySettings {
    ContentPrivacySettings {
        stealth_user_agent: true,
        block_webrtc: true,
        block_ads: true,
        block_scripts: false,
        use_proxy: false,
        proxy_url: default_tor_socks(),
        incognito: true,
    }
}

fn privacy_init_script(block_webrtc: bool, block_ads: bool, block_scripts: bool) -> String {
    let mut s = String::from("(function(){try{");
    if block_webrtc {
        s.push_str(r#"var REJ=function(){return Promise.reject(new DOMException("Not allowed","NotAllowedError"))};if(navigator.mediaDevices){try{navigator.mediaDevices.getUserMedia=REJ;}catch(_){ }try{navigator.mediaDevices.getDisplayMedia=REJ;}catch(_){ }try{navigator.mediaDevices.enumerateDevices=function(){return Promise.resolve([])};}catch(_){ }}try{navigator.getUserMedia=undefined;navigator.webkitGetUserMedia=undefined;navigator.mozGetUserMedia=undefined;navigator.msGetUserMedia=undefined;}catch(_){ }function hideApi(name){try{Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});}catch(_){try{window[name]=undefined;}catch(__){}}try{delete window[name];}catch(_){}}["RTCPeerConnection","webkitRTCPeerConnection","mozRTCPeerConnection","RTCIceCandidate","RTCSessionDescription","MediaStreamTrackEvent","RTCDataChannelEvent"].forEach(hideApi);"#);
    }
    if block_ads {
        // Keep ad blocking best-effort and non-breaking: hide common ad elements without intercepting fetch/XHR.
        s.push_str(r#"var css=document.createElement("style");css.textContent="[id*='ad-'],[class*='ad-'],[class*='ads-'],[class*='advert'],[id*='sponsor'],[class*='sponsor'],iframe[src*='doubleclick'],iframe[src*='googlesyndication'],iframe[src*='adservice'],iframe[src*='taboola'],iframe[src*='outbrain'],.adsbygoogle,#player-ads,.video-ads,.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-player-overlay,ytd-display-ad-renderer,ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer,ytd-in-feed-ad-layout-renderer,ytd-ad-slot-renderer{display:none!important;visibility:hidden!important;max-height:0!important;min-height:0!important;}";document.documentElement.appendChild(css);var hbKill=function(){try{document.querySelectorAll(\"iframe[src*='doubleclick'],iframe[src*='googlesyndication'],iframe[src*='adservice'],iframe[src*='taboola'],iframe[src*='outbrain'],#player-ads,.video-ads,.ytp-ad-module,.ytp-ad-overlay-container,.ytp-ad-player-overlay,ytd-display-ad-renderer,ytd-promoted-sparkles-web-renderer,ytd-promoted-video-renderer,ytd-in-feed-ad-layout-renderer,ytd-ad-slot-renderer\").forEach(function(n){n.remove();});var skip=document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.videoAdUiSkipButton');if(skip&&typeof skip.click==='function'){skip.click();}var adShowing=document.querySelector('.ad-showing,.html5-video-player.ad-showing');var v=document.querySelector('video');if(adShowing&&v){try{v.muted=true;}catch(_){ }if(isFinite(v.duration)&&v.duration>0){try{v.currentTime=Math.max(0,v.duration-0.05);}catch(_){ }} } }catch(_){}};hbKill();var obs=new MutationObserver(function(){hbKill();});obs.observe(document.documentElement||document.body,{subtree:true,childList:true,attributes:true});var hbTimer=setInterval(hbKill,350);setTimeout(function(){try{clearInterval(hbTimer);}catch(_){ }},30000);"#);
    }
    if block_scripts {
        // Best-effort NoScript fallback for engines where hard JS disable is unavailable.
        s.push_str(r#"try{var meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="script-src 'none'; object-src 'none'; worker-src 'none'";(document.head||document.documentElement).appendChild(meta);}catch(_){ }try{window.eval=undefined;window.Function=undefined;}catch(_){ }var hbNoScript=function(){try{document.querySelectorAll('script').forEach(function(n){n.type='javascript/blocked';n.remove();});}catch(_){ }};hbNoScript();var obsNoScript=new MutationObserver(function(ms){try{for(var i=0;i<ms.length;i++){var m=ms[i];if(!m.addedNodes)continue;for(var j=0;j<m.addedNodes.length;j++){var n=m.addedNodes[j];if(n&&n.tagName==='SCRIPT'){try{n.type='javascript/blocked';n.remove();}catch(_){ }}}}}catch(_){ }hbNoScript();});obsNoScript.observe(document.documentElement||document.body,{subtree:true,childList:true});"#);
    }
    s.push_str("}catch(e){}})();");
    s
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentWebviewEnsureRequest {
    pub url: String,
    pub bounds: ContentBounds,
    #[serde(default = "default_content_privacy")]
    pub privacy: ContentPrivacySettings,
}

fn privacy_fingerprint(p: &ContentPrivacySettings) -> String {
    serde_json::to_string(p).unwrap_or_default()
}

static LAST_CONTENT_PRIVACY_FP: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn last_content_privacy_fp() -> &'static Mutex<Option<String>> {
    LAST_CONTENT_PRIVACY_FP.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatRequest {
    pub base_url: String,
    pub model: String,
    pub message: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// `"ollama"` (default) or `"openai"` for `/v1/chat/completions`.
    #[serde(default)]
    pub provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaMessage,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMsg,
}

#[derive(Debug, Deserialize)]
struct OpenAiMsg {
    content: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConnectionRequest {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub provider: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmHealthResult {
    pub ok: bool,
    pub backend: String,
    pub version: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelInfo {
    pub name: String,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmListModelsResult {
    pub models: Vec<LlmModelInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentityResult {
    pub username: String,
    pub device: String,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPullRequest {
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn content_webview<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::webview::Webview<R>> {
    app.get_webview(CONTENT_WEBVIEW_LABEL)
}

/// Embeds a second WebView2 in the main window (same window as the shell UI).
#[tauri::command]
async fn content_webview_ensure(app: tauri::AppHandle, req: ContentWebviewEnsureRequest) -> Result<(), String> {
    let url = req.url;
    let bounds = req.bounds;
    let privacy = req.privacy;
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http(s) URLs are allowed.".into());
    }
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found (expected label \"main\").".to_string())?;

    let fp = privacy_fingerprint(&privacy);
    if let Some(w) = content_webview(&app) {
        let same = {
            let guard = last_content_privacy_fp()
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            guard.as_ref() == Some(&fp)
        };
        if !same {
            // Re-apply best-effort privacy script at runtime; this avoids close/recreate deadlocks.
            let js = privacy_init_script(privacy.block_webrtc, privacy.block_ads, privacy.block_scripts);
            let _ = w.eval(js);
        }
        w.navigate(parsed).map_err(|e| e.to_string())?;
        w.set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|e| e.to_string())?;
        w.set_size(LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
        w.show().map_err(|e| e.to_string())?;
        if let Ok(mut g) = last_content_privacy_fp().lock() {
            *g = Some(fp);
        }
        return Ok(());
    }

    let webview_url = WebviewUrl::External(parsed);
    let mut builder = WebviewBuilder::new(CONTENT_WEBVIEW_LABEL, webview_url);

    if privacy.stealth_user_agent {
        // Omit custom UA — WebView2 reports a normal Edge-class string (far less fingerprint noise).
    } else {
        builder = builder.user_agent(GENERIC_CHROME_UA);
    }

    if privacy.block_webrtc || privacy.block_ads || privacy.block_scripts {
        builder = builder.initialization_script_for_all_frames(&privacy_init_script(
            privacy.block_webrtc,
            privacy.block_ads,
            privacy.block_scripts,
        ));
    }

    #[cfg(windows)]
    {
        let mut args = Vec::<&str>::new();
        if privacy.block_webrtc {
            // Engine-level disable hints for WebView2 to reduce checker-detected WebRTC surface.
            args.push("--disable-webrtc");
            args.push("--webrtc-ip-handling-policy=disable_non_proxied_udp");
            args.push("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
            args.push("--enforce-webrtc-ip-permission-check");
        }
        if privacy.block_scripts {
            // Chromium/WebView2-wide JavaScript off switch.
            args.push("--disable-javascript");
        }
        if !args.is_empty() {
            builder = builder.additional_browser_args(&args.join(" "));
        }
    }

    if privacy.use_proxy {
        let pu = privacy.proxy_url.trim();
        if !pu.is_empty() {
            let proxy = Url::parse(pu).map_err(|e| format!("Invalid content proxy URL: {e}"))?;
            let scheme = proxy.scheme();
            if scheme != "http" && scheme != "socks5" {
                return Err("Content proxy must be http:// or socks5:// (Tauri requirement).".into());
            }
            builder = builder.proxy_url(proxy);
        }
    }

    if privacy.incognito {
        builder = builder.incognito(true);
    }

    window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;

    if let Ok(mut g) = last_content_privacy_fp().lock() {
        *g = Some(fp);
    }
    Ok(())
}

#[tauri::command]
async fn content_webview_set_bounds(app: tauri::AppHandle, bounds: ContentBounds) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    w.set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_webview_navigate(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http(s) URLs are allowed.".into());
    }
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_webview_back(app: tauri::AppHandle) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.eval("window.history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_webview_forward(app: tauri::AppHandle) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.eval("window.history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_webview_reload(app: tauri::AppHandle) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.reload().map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_webview_hard_reload(app: tauri::AppHandle) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.eval("location.reload(true);")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_webview_stop(app: tauri::AppHandle) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.eval("window.stop();").map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_webview_set_zoom(app: tauri::AppHandle, scale: f64) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    let s = scale.clamp(0.25, 4.0);
    match w.set_zoom(s) {
        Ok(()) => Ok(()),
        Err(_) => {
            // Fallback for environments where native zoom on child WebView2 is unreliable.
            let js = format!(
                "(function(){{\
                    var z={s};\
                    try{{document.documentElement.style.zoom=String(z);}}catch(_e){{}}\
                    try{{document.body && (document.body.style.zoom=String(z));}}catch(_e){{}}\
                    try{{document.documentElement.style.transformOrigin='0 0';}}catch(_e){{}}\
                }})();"
            );
            w.eval(js).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
async fn app_identity() -> Result<AppIdentityResult, String> {
    let username = env::var("USERNAME")
        .ok()
        .or_else(|| env::var("USER").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "friend".to_string());

    let device = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "your rig".to_string());

    let lowered = username.to_lowercase();
    let display_name = if lowered == "user" || lowered == "admin" || lowered == "administrator" {
        device.clone()
    } else {
        username.clone()
    };

    Ok(AppIdentityResult {
        username,
        device,
        display_name,
    })
}

#[tauri::command]
async fn content_webview_print(app: tauri::AppHandle) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
    match w.print() {
        Ok(()) => Ok(()),
        Err(_) => w.eval("window.print();").map_err(|e| e.to_string()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FindInPageArgs {
    query: String,
    #[serde(default)]
    case_sensitive: Option<bool>,
    #[serde(default)]
    backwards: Option<bool>,
}

/// In-page search using `window.find` (Chromium/WebView2).
#[tauri::command]
async fn content_webview_find(app: tauri::AppHandle, args: FindInPageArgs) -> Result<(), String> {
    let w = content_webview(&app).ok_or_else(|| "No embedded page yet.".to_string())?;
    let case_sensitive = args.case_sensitive.unwrap_or(false);
    let backwards = args.backwards.unwrap_or(false);
    let q = serde_json::to_string(&args.query).map_err(|e| e.to_string())?;
    let js = format!(
        "window.find({}, {}, {}, true);",
        q,
        if case_sensitive { "true" } else { "false" },
        if backwards { "true" } else { "false" },
    );
    w.eval(js).map_err(|e| e.to_string())
}

/// Move the embedded webview off-screen instead of `hide()`. On Windows, WebView2 `hide()` can leave the
/// control unable to receive clicks after `show()` when switching tabs; collapsing preserves input behavior.
#[tauri::command]
async fn content_webview_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = content_webview(&app) {
        w.show().map_err(|e| e.to_string())?;
        w.set_position(LogicalPosition::new(-32_000.0, -32_000.0))
            .map_err(|e| e.to_string())?;
        w.set_size(LogicalSize::new(1.0, 1.0))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn content_webview_show(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = content_webview(&app) {
        w.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Focus the embedded page webview (needed after show/hide so clicks hit the page, not the shell).
#[tauri::command]
async fn content_webview_focus(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = content_webview(&app) {
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchBridgeResult {
    pub body: String,
    pub status: u16,
    pub content_type: String,
    pub final_url: String,
    pub byte_length: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchBridgeRequest {
    pub url: String,
    pub proxy: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    #[serde(default)]
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExecRequest {
    pub command: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExecResult {
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Clearnet HTTP bridge: fetch a URL from the Tauri host. Optional `proxy` uses SOCKS5 for Tor, etc.
#[tauri::command]
async fn fetch_url_bridge(req: FetchBridgeRequest) -> Result<FetchBridgeResult, String> {
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err("Only http(s) URLs are allowed.".into());
    }
    let url = req.url;
    let timeout = req
        .timeout_secs
        .unwrap_or(DEFAULT_FETCH_TIMEOUT_SECS)
        .max(1)
        .min(600);
    let max_bytes = req
        .max_bytes
        .unwrap_or(MAX_FETCH_BYTES)
        .min(MAX_FETCH_BYTES)
        .max(1024);

    let mut builder = reqwest::Client::builder()
        .user_agent("HoloBro/0.1")
        .timeout(Duration::from_secs(timeout))
        .redirect(reqwest::redirect::Policy::limited(10));
    if let Some(p) = req.proxy {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let proxy = reqwest::Proxy::all(trimmed).map_err(|e| format!("Invalid proxy: {e}"))?;
            builder = builder.proxy(proxy);
        }
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let final_url = res.url().to_string();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > max_bytes {
        return Err(format!(
            "Response too large ({} bytes); max {} bytes (adjust in Settings).",
            bytes.len(),
            max_bytes
        ));
    }
    let body = String::from_utf8_lossy(bytes.as_ref()).into_owned();
    let byte_length = body.len();
    Ok(FetchBridgeResult {
        body,
        status,
        content_type,
        final_url,
        byte_length,
    })
}

/// Execute a shell command and return output for the in-app terminal panel.
#[tauri::command]
async fn shell_exec(req: ShellExecRequest) -> Result<ShellExecResult, String> {
    let command = req.command.trim();
    if command.is_empty() {
        return Err("Command is empty.".into());
    }

    let timeout = req.timeout_secs.unwrap_or(45).clamp(1, 180);
    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(command);
        #[cfg(windows)]
        {
            // Keep in-app terminal execution hidden (no flashing external console window).
            c.creation_flags(0x08000000);
        }
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-lc").arg(command);
        c
    };

    if let Some(cwd) = req.cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.current_dir(cwd);
    }

    let out = tokio::time::timeout(Duration::from_secs(timeout), cmd.output())
        .await
        .map_err(|_| format!("Command timed out ({timeout}s)."))?
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    Ok(ShellExecResult {
        command: command.to_string(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        exit_code: out.status.code(),
    })
}

fn llm_timeout(req_secs: Option<u64>) -> Duration {
    Duration::from_secs(req_secs.unwrap_or(120).clamp(5, 600))
}

fn auth_header(req: &LlmChatRequest) -> Option<String> {
    req.api_key
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|k| format!("Bearer {k}"))
}

/// Probe Ollama (`/api/version`) or OpenAI-compatible (`/v1/models`).
#[tauri::command]
async fn llm_health(req: LlmConnectionRequest) -> Result<LlmHealthResult, String> {
    let base = req.base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("Base URL is empty.".into());
    }
    let timeout = Duration::from_secs(req.timeout_secs.unwrap_or(12).clamp(1, 120));
    let provider = req.provider.as_deref().unwrap_or("ollama");

    let client = reqwest::Client::builder()
        .user_agent("HoloBro-LLM/0.1")
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    if provider == "openai" {
        let url = format!("{base}/v1/models");
        let mut r = client.get(&url);
        if let Some(ref k) = req.api_key {
            let t = k.trim();
            if !t.is_empty() {
                r = r.header("Authorization", format!("Bearer {t}"));
            }
        }
        let res = r.send().await.map_err(|e| e.to_string())?;
        if res.status().is_success() {
            return Ok(LlmHealthResult {
                ok: true,
                backend: "openai".into(),
                version: None,
                message: format!("{} reachable (HTTP {})", base, res.status()),
            });
        }
        return Ok(LlmHealthResult {
            ok: false,
            backend: "openai".into(),
            version: None,
            message: format!(
                "HTTP {} — check URL, API key, and that the server exposes /v1/models",
                res.status()
            ),
        });
    }

    let url = format!("{base}/api/version");
    let res = client.get(&url).send().await;
    match res {
        Ok(r) if r.status().is_success() => {
            let v: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            let version = v
                .get("version")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            Ok(LlmHealthResult {
                ok: true,
                backend: "ollama".into(),
                version,
                message: "Ollama responded at /api/version.".into(),
            })
        }
        Ok(r) => Ok(LlmHealthResult {
            ok: false,
            backend: "ollama".into(),
            version: None,
            message: format!(
                "HTTP {} — start Ollama or set Base URL (e.g. http://127.0.0.1:11434)",
                r.status()
            ),
        }),
        Err(e) => Ok(LlmHealthResult {
            ok: false,
            backend: "ollama".into(),
            version: None,
            message: format!("Cannot connect: {e}"),
        }),
    }
}

/// List models: Ollama `/api/tags` or OpenAI-compatible `/v1/models`.
#[tauri::command]
async fn llm_list_models(req: LlmConnectionRequest) -> Result<LlmListModelsResult, String> {
    let base = req.base_url.trim_end_matches('/');
    let timeout = Duration::from_secs(req.timeout_secs.unwrap_or(30).clamp(5, 120));
    let provider = req.provider.as_deref().unwrap_or("ollama");

    let client = reqwest::Client::builder()
        .user_agent("HoloBro-LLM/0.1")
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    if provider == "openai" {
        let url = format!("{base}/v1/models");
        let mut r = client.get(&url);
        if let Some(ref k) = req.api_key {
            let t = k.trim();
            if !t.is_empty() {
                r = r.header("Authorization", format!("Bearer {t}"));
            }
        }
        let res = r.send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("List models HTTP {}: {}", res.status(), res.text().await.unwrap_or_default()));
        }
        let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let data = v
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or_else(|| "Unexpected /v1/models JSON (missing data[]).".to_string())?;
        let mut models = Vec::new();
        for item in data {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                models.push(LlmModelInfo {
                    name: id.to_string(),
                    size_bytes: None,
                });
            }
        }
        models.sort_by(|a, b| a.name.cmp(&b.name));
        return Ok(LlmListModelsResult { models });
    }

    let url = format!("{base}/api/tags");
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!(
            "Ollama tags HTTP {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }
    let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let arr = v
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or_else(|| "Unexpected Ollama /api/tags JSON.".to_string())?;
    let mut models = Vec::new();
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        let size_bytes = item.get("size").and_then(|x| x.as_u64());
        models.push(LlmModelInfo { name, size_bytes });
    }
    models.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(LlmListModelsResult { models })
}

/// Ollama `POST /api/pull` — downloads a model (can take a long time; uses streaming response).
#[tauri::command]
async fn llm_pull_ollama(req: LlmPullRequest) -> Result<String, String> {
    let base = req.base_url.trim_end_matches('/');
    let model = req.model.trim();
    if model.is_empty() {
        return Err("Model name is empty.".into());
    }
    let url = format!("{base}/api/pull");
    let timeout = Duration::from_secs(req.timeout_secs.unwrap_or(900).clamp(60, 7200));

    let client = reqwest::Client::builder()
        .user_agent("HoloBro-LLM/0.1")
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = client
        .post(&url)
        .json(&serde_json::json!({ "name": model }));

    if let Some(ref k) = req.api_key {
        let t = k.trim();
        if !t.is_empty() {
            builder = builder.header("Authorization", format!("Bearer {t}"));
        }
    }

    let res = builder.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!(
            "Pull HTTP {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    let mut last_status = String::from("starting…");
    let mut saw_success = false;

    fn consume_line(line: &str, last: &mut String, success: &mut bool) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(s) = v.get("status").and_then(|x| x.as_str()) {
                *last = s.to_string();
            }
            if v.get("status").and_then(|x| x.as_str()) == Some("success") {
                *success = true;
            }
            if let Some(err) = v.get("error") {
                *last = format!("error: {err}");
            }
        }
    }

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].to_string();
            buf = buf[pos + 1..].to_string();
            consume_line(&line, &mut last_status, &mut saw_success);
        }
    }
    for line in buf.lines() {
        consume_line(line, &mut last_status, &mut saw_success);
    }

    if saw_success {
        Ok(format!("Pull finished successfully. Last status: {last_status}"))
    } else {
        Ok(format!(
            "Pull stream ended (verify in Ollama). Last status: {last_status}"
        ))
    }
}

fn openai_message_content(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter_map(|p| {
                p.get("text")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => v.as_str().unwrap_or(&v.to_string()).to_string(),
    }
}

/// Chat: Ollama `/api/chat` or OpenAI-compatible `/v1/chat/completions`.
#[tauri::command]
async fn llm_chat(req: LlmChatRequest) -> Result<String, String> {
    let base = req.base_url.trim_end_matches('/');
    let provider = req.provider.as_deref().unwrap_or("ollama");
    let timeout = llm_timeout(req.timeout_secs);

    let client = reqwest::Client::builder()
        .user_agent("HoloBro-LLM/0.1")
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    if provider == "openai" {
        let url = format!("{base}/v1/chat/completions");
        let body = serde_json::json!({
            "model": req.model,
            "messages": [{ "role": "user", "content": req.message }],
            "stream": false
        });
        let mut b = client.post(&url).json(&body);
        if let Some(h) = auth_header(&req) {
            b = b.header("Authorization", h);
        }
        let res = b.send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!(
                "LLM HTTP {}: {}",
                res.status(),
                res.text().await.unwrap_or_default()
            ));
        }
        let parsed: OpenAiChatResponse = res.json().await.map_err(|e| e.to_string())?;
        let content = parsed
            .choices
            .first()
            .and_then(|c| c.message.content.as_ref())
            .map(openai_message_content)
            .unwrap_or_default();
        return Ok(content);
    }

    let url = format!("{base}/api/chat");
    let body = serde_json::json!({
        "model": req.model,
        "messages": [{ "role": "user", "content": req.message }],
        "stream": false
    });
    let mut b = client.post(&url).json(&body);
    if let Some(h) = auth_header(&req) {
        b = b.header("Authorization", h);
    }
    let res = b.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!(
            "LLM HTTP {}: {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }
    let parsed: OllamaChatResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.message.content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            content_webview_ensure,
            content_webview_set_bounds,
            content_webview_navigate,
            content_webview_back,
            content_webview_forward,
            content_webview_reload,
            content_webview_hard_reload,
            content_webview_stop,
            content_webview_set_zoom,
            content_webview_print,
            content_webview_find,
            content_webview_hide,
            content_webview_show,
            content_webview_focus,
            app_identity,
            fetch_url_bridge,
            shell_exec,
            llm_health,
            llm_list_models,
            llm_pull_ollama,
            llm_chat,
            network_tools::net_ip_stats,
            network_tools::net_runtime_diagnostics,
            network_tools::net_traceroute,
            network_tools::net_speed_test,
            network_tools::net_dns_lookup,
            network_tools::net_bgp_lookup,
            network_tools::net_rdap_lookup,
            network_tools::net_nmap_scan,
            irc_tools::irc_connect,
            irc_tools::irc_send,
            irc_tools::irc_join,
            irc_tools::irc_disconnect,
            irc_tools::irc_poll
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
