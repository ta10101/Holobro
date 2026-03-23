//! Local network diagnostics: interfaces, public IP, traceroute, rough throughput, DNS, BGP, RDAP.

use futures_util::StreamExt;
use hickory_resolver::config::{ResolverConfig, ResolverOpts};
use hickory_resolver::proto::rr::RData;
use hickory_resolver::proto::rr::RecordType;
use hickory_resolver::TokioAsyncResolver;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::Path;
use std::time::Instant;

fn hide_windows_console(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpInterfaceRow {
    pub name: String,
    pub addr: String,
    pub family: String,
    pub is_loopback: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicIpInfo {
    pub ip: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
    pub isp: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpStatsResult {
    pub hostname: String,
    pub interfaces: Vec<IpInterfaceRow>,
    pub public: Option<PublicIpInfo>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteReq {
    pub host: String,
    #[serde(default = "default_max_hops")]
    pub max_hops: u32,
}

fn default_max_hops() -> u32 {
    20
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteResult {
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestReq {
    /// Bytes to download from Cloudflare (clamped).
    #[serde(default = "default_dl_bytes")]
    pub download_bytes: u64,
    /// Bytes to POST to httpbin for upload estimate (clamped).
    #[serde(default = "default_ul_bytes")]
    pub upload_bytes: u64,
}

fn default_dl_bytes() -> u64 {
    5 * 1024 * 1024
}

fn default_ul_bytes() -> u64 {
    512 * 1024
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestResult {
    pub download_bytes: u64,
    pub download_secs: f64,
    pub download_mbps: f64,
    pub upload_bytes: u64,
    pub upload_secs: f64,
    pub upload_mbps: f64,
    pub notes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NmapScanReq {
    pub target: String,
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub ports: Option<String>,
    #[serde(default)]
    pub timing: Option<String>,
    #[serde(default)]
    pub extra_args: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NmapScanResult {
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostics {
    pub os: String,
    pub traceroute_available: bool,
    pub traceroute_tool: Option<String>,
    pub nmap_available: bool,
    pub nmap_path: Option<String>,
    pub shell_available: bool,
    pub shell_name: Option<String>,
    pub nmap_install_hint: String,
    pub traceroute_hint: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct IpWhoRoot {
    ip: Option<String>,
    success: Option<bool>,
    message: Option<String>,
    city: Option<String>,
    region: Option<String>,
    country: Option<String>,
    connection: Option<IpWhoConn>,
}

#[derive(Debug, Deserialize)]
struct IpWhoConn {
    isp: Option<String>,
}

fn collect_interfaces() -> Result<Vec<IpInterfaceRow>, String> {
    let mut out = Vec::new();
    for iface in if_addrs::get_if_addrs().map_err(|e| e.to_string())? {
        let (family, ip_s, loopback) = match &iface.addr {
            if_addrs::IfAddr::V4(v4) => (
                "ipv4".into(),
                v4.ip.to_string(),
                v4.ip.is_loopback(),
            ),
            if_addrs::IfAddr::V6(v6) => (
                "ipv6".into(),
                v6.ip.to_string(),
                v6.ip.is_loopback(),
            ),
        };
        out.push(IpInterfaceRow {
            name: iface.name.clone(),
            addr: ip_s,
            family,
            is_loopback: loopback,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.addr.cmp(&b.addr)));
    Ok(out)
}

/// Hostname + interface addresses + best-effort public IP / geo (HTTPS ipwho.is).
#[tauri::command]
pub async fn net_ip_stats() -> Result<IpStatsResult, String> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "(unknown)".into());

    let interfaces = collect_interfaces()?;

    let mut warnings = Vec::new();
    let client = reqwest::Client::builder()
        .user_agent("HoloBro-NetTools/0.1")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let public = match client.get("https://ipwho.is/").send().await {
        Ok(res) => {
            if !res.status().is_success() {
                warnings.push(format!("Public IP lookup HTTP {}", res.status()));
                None
            } else {
                match res.json::<IpWhoRoot>().await {
                    Ok(j) => {
                        if j.success == Some(false) {
                            if let Some(m) = j.message.clone() {
                                warnings.push(m);
                            }
                        }
                        Some(PublicIpInfo {
                            ip: j.ip.clone(),
                            city: j.city,
                            region: j.region,
                            country: j.country,
                            isp: j.connection.as_ref().and_then(|c| c.isp.clone()),
                        })
                    }
                    Err(e) => {
                        warnings.push(format!("Public IP JSON: {e}"));
                        None
                    }
                }
            }
        }
        Err(e) => {
            warnings.push(format!("Public IP request failed: {e}"));
            None
        }
    };

    Ok(IpStatsResult {
        hostname,
        interfaces,
        public,
        warnings,
    })
}

/// Run system traceroute (`tracert` on Windows, `traceroute` / `tracepath` elsewhere).
#[allow(unused_mut)] // `mut` only needed on non-Windows when falling back to tracepath
#[tauri::command]
pub async fn net_traceroute(req: TracerouteReq) -> Result<TracerouteResult, String> {
    let host = req.host.trim();
    if host.is_empty() {
        return Err("Host is empty".into());
    }
    if host.len() > 253 {
        return Err("Host too long".into());
    }
    let hops = req.max_hops.clamp(1, 64);

    #[cfg(windows)]
    let (mut cmd, label) = {
        let mut c = tokio::process::Command::new("tracert");
        c.arg("-d").arg("-h").arg(hops.to_string()).arg(host);
        hide_windows_console(&mut c);
        (c, format!("tracert -d -h {hops} {host}"))
    };

    #[cfg(not(windows))]
    let (mut cmd, label) = {
        let hops_s = hops.to_string();
        let mut c = tokio::process::Command::new("traceroute");
        // BSD/Linux inetutils: -n numeric, -m max hops, -q probes (omit -w for macOS portability).
        c.args(["-n", "-m", &hops_s, "-q", "1", host]);
        (c, format!("traceroute -n -m {hops} … {host}"))
    };

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(150),
        cmd.output(),
    )
    .await
    .map_err(|_| "Traceroute timed out (150s)".to_string())?
    .map_err(|e| format!("Failed to spawn traceroute: {e}"))?;

    let mut stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let mut command_line = label;
    let mut exit_code = output.status.code();

    #[cfg(not(windows))]
    {
        let se = stderr.to_lowercase();
        let missing = exit_code == Some(127)
            || se.contains("not found")
            || se.contains("no such file")
            || se.contains("command not found");
        if missing || (stdout.trim().is_empty() && !output.status.success()) {
            let mut c2 = tokio::process::Command::new("tracepath");
            c2.arg("-n").arg(host);
            match tokio::time::timeout(std::time::Duration::from_secs(120), c2.output()).await {
                Ok(Ok(output2)) => {
                    stdout = String::from_utf8_lossy(&output2.stdout).into_owned();
                    stderr = String::from_utf8_lossy(&output2.stderr).into_owned();
                    exit_code = output2.status.code();
                    command_line = format!("tracepath -n {host}");
                }
                Ok(Err(e)) => {
                    stderr = format!("tracepath spawn failed: {e}");
                }
                Err(_) => {
                    stderr = "tracepath timed out (120s)".into();
                }
            }
        }
    }

    Ok(TracerouteResult {
        command: command_line,
        stdout,
        stderr,
        exit_code,
    })
}

fn clamp_bytes(n: u64, min: u64, max: u64) -> u64 {
    n.clamp(min, max)
}

/// Rough download (Cloudflare) + upload (httpbin POST) throughput; not a lab-grade speedtest.
#[tauri::command]
pub async fn net_speed_test(req: SpeedTestReq) -> Result<SpeedTestResult, String> {
    let dl_target = clamp_bytes(req.download_bytes, 256 * 1024, 25 * 1024 * 1024);
    let ul_target = clamp_bytes(req.upload_bytes, 16 * 1024, 4 * 1024 * 1024);

    let client = reqwest::Client::builder()
        .user_agent("HoloBro-NetTools/0.1")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let mut notes = Vec::new();
    notes.push(
        "Approximate: download uses Cloudflare; upload uses httpbin.org — many factors affect results."
            .into(),
    );

    let url = format!(
        "https://speed.cloudflare.com/__down?bytes={}",
        dl_target
    );
    let t0 = Instant::now();
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download start failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Download HTTP {}", res.status()));
    }
    let mut stream = res.bytes_stream();
    let mut got: u64 = 0;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Download read: {e}"))?;
        got += chunk.len() as u64;
        if got >= dl_target {
            break;
        }
    }
    let dl_secs = t0.elapsed().as_secs_f64().max(0.001);
    let dl_mbps = (got as f64 * 8.0) / (dl_secs * 1_000_000.0);

    let body = vec![0x4bu8; ul_target as usize];
    let t1 = Instant::now();
    let ul_res = client
        .post("https://httpbin.org/post")
        .header("Content-Type", "application/octet-stream")
        .body(body)
        .send()
        .await;
    let (upload_secs, upload_mbps, ul_got) = match ul_res {
        Ok(r) => {
            if !r.status().is_success() {
                notes.push(format!("Upload HTTP {} — upload Mbps set to 0", r.status()));
                (0.0_f64, 0.0_f64, 0_u64)
            } else {
                let _ = r.bytes().await;
                let secs = t1.elapsed().as_secs_f64().max(0.001);
                let mbps = (ul_target as f64 * 8.0) / (secs * 1_000_000.0);
                (secs, mbps, ul_target)
            }
        }
        Err(e) => {
            notes.push(format!("Upload failed: {e}"));
            (0.0, 0.0, 0)
        }
    };

    Ok(SpeedTestResult {
        download_bytes: got,
        download_secs: dl_secs,
        download_mbps: dl_mbps,
        upload_bytes: ul_got,
        upload_secs: upload_secs,
        upload_mbps: upload_mbps,
        notes,
    })
}

fn nmap_profile_args(profile: &str) -> Vec<&'static str> {
    match profile {
        "ping" => vec!["-sn"],
        "quick" => vec!["-T4", "-F"],
        "syn" => vec!["-sS"],
        "udp" => vec!["-sU"],
        "version" => vec!["-sV"],
        "os" => vec!["-O"],
        "aggressive" => vec!["-A"],
        "full_tcp" => vec!["-p-", "-sV"],
        "firewalk" => vec!["-Pn", "--traceroute", "--script", "firewalk"],
        "evasion" => vec!["-Pn", "-f", "--data-length", "25", "--source-port", "53"],
        "ack_map" => vec!["-sA", "-Pn"],
        _ => vec!["-sV", "-T4"],
    }
}

fn nmap_known_paths() -> Vec<String> {
    #[cfg(windows)]
    {
        vec![
            "nmap".to_string(),
            r"C:\Program Files\Nmap\nmap.exe".to_string(),
            r"C:\Program Files (x86)\Nmap\nmap.exe".to_string(),
        ]
    }
    #[cfg(not(windows))]
    {
        vec!["nmap".to_string()]
    }
}

fn nmap_command_path() -> String {
    #[cfg(windows)]
    {
        for c in nmap_known_paths() {
            if c == "nmap" {
                continue;
            }
            if Path::new(&c).exists() {
                return c;
            }
        }
        "nmap".to_string()
    }
    #[cfg(not(windows))]
    {
        "nmap".to_string()
    }
}

async fn probe_command(command: &str, args: &[&str]) -> bool {
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args);
    hide_windows_console(&mut cmd);
    matches!(
        tokio::time::timeout(std::time::Duration::from_secs(4), cmd.output()).await,
        Ok(Ok(_))
    )
}

/// Check runtime external-tool availability and provide platform-specific hints.
#[tauri::command]
pub async fn net_runtime_diagnostics() -> Result<RuntimeDiagnostics, String> {
    #[cfg(windows)]
    let os = "windows".to_string();
    #[cfg(target_os = "macos")]
    let os = "macos".to_string();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let os = "linux".to_string();

    let mut traceroute_available = false;
    let mut traceroute_tool: Option<String> = None;
    #[cfg(windows)]
    {
        if probe_command("tracert", &["/?"]).await {
            traceroute_available = true;
            traceroute_tool = Some("tracert".into());
        }
    }
    #[cfg(not(windows))]
    {
        if probe_command("traceroute", &["--help"]).await {
            traceroute_available = true;
            traceroute_tool = Some("traceroute".into());
        } else if probe_command("tracepath", &["--help"]).await {
            traceroute_available = true;
            traceroute_tool = Some("tracepath".into());
        }
    }

    let mut nmap_available = false;
    let mut nmap_path: Option<String> = None;
    for p in nmap_known_paths() {
        if p != "nmap" && !Path::new(&p).exists() {
            continue;
        }
        if probe_command(&p, &["--version"]).await {
            nmap_available = true;
            nmap_path = Some(p);
            break;
        }
    }

    #[cfg(windows)]
    let (shell_available, shell_name) = if probe_command("cmd", &["/C", "echo", "ok"]).await {
        (true, Some("cmd".to_string()))
    } else {
        (false, None)
    };
    #[cfg(not(windows))]
    let (shell_available, shell_name) = if probe_command("sh", &["-lc", "echo ok"]).await {
        (true, Some("sh".to_string()))
    } else {
        (false, None)
    };

    #[cfg(windows)]
    let nmap_install_hint = "Install Nmap: winget install -e --id Insecure.Nmap".to_string();
    #[cfg(target_os = "macos")]
    let nmap_install_hint = "Install Nmap: brew install nmap".to_string();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let nmap_install_hint = "Install Nmap: sudo apt install nmap  (or your distro package manager)".to_string();

    #[cfg(windows)]
    let traceroute_hint = "Windows uses `tracert` (already built-in on most systems).".to_string();
    #[cfg(target_os = "macos")]
    let traceroute_hint = "macOS uses `traceroute` (preinstalled).".to_string();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let traceroute_hint = "Linux uses `traceroute` (or `tracepath` on some distros).".to_string();

    let mut notes = Vec::new();
    if !nmap_available {
        notes.push("Nmap not detected — Nmap panel will be limited until installed.".into());
    }
    if !traceroute_available {
        notes.push("No traceroute tool detected — traceroute panel may fail.".into());
    }
    if !shell_available {
        notes.push("Shell command runner unavailable — browser terminal may fail.".into());
    }

    Ok(RuntimeDiagnostics {
        os,
        traceroute_available,
        traceroute_tool,
        nmap_available,
        nmap_path,
        shell_available,
        shell_name,
        nmap_install_hint,
        traceroute_hint,
        notes,
    })
}

/// Nmap scan wrapper. Requires `nmap` available on PATH.
#[tauri::command]
pub async fn net_nmap_scan(req: NmapScanReq) -> Result<NmapScanResult, String> {
    let target = req.target.trim();
    if target.is_empty() {
        return Err("Target is empty.".into());
    }
    if target.len() > 255 {
        return Err("Target too long.".into());
    }

    let profile = req
        .profile
        .as_deref()
        .unwrap_or("default")
        .trim()
        .to_lowercase();
    let mut args: Vec<String> = nmap_profile_args(&profile)
        .iter()
        .map(|s| s.to_string())
        .collect();

    if let Some(ports) = req.ports.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        args.push("-p".into());
        args.push(ports.into());
    }
    if let Some(t) = req.timing.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let timing_ok = matches!(t, "T0" | "T1" | "T2" | "T3" | "T4" | "T5");
        if !timing_ok {
            return Err("Timing must be one of T0..T5.".into());
        }
        args.push(format!("-{t}"));
    }
    if let Some(extra) = req
        .extra_args
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        for part in extra.split_whitespace() {
            args.push(part.to_string());
        }
    }
    args.push(target.to_string());

    let nmap_bin = nmap_command_path();
    let mut cmd = tokio::process::Command::new(&nmap_bin);
    cmd.args(&args);
    hide_windows_console(&mut cmd);
    let command_line = format!("{} {}", nmap_bin, args.join(" "));

    let output = tokio::time::timeout(std::time::Duration::from_secs(600), cmd.output())
        .await
        .map_err(|_| "Nmap timed out (600s).".to_string())?
        .map_err(|e| {
            format!(
                "Failed to spawn nmap: {e}. Install Nmap and ensure `nmap` is on PATH."
            )
        })?;

    Ok(NmapScanResult {
        command: command_line,
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code(),
    })
}

fn dns_resolver() -> TokioAsyncResolver {
    TokioAsyncResolver::tokio_from_system_conf().unwrap_or_else(|_| {
        TokioAsyncResolver::tokio(ResolverConfig::cloudflare(), ResolverOpts::default())
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsLookupReq {
    pub name: String,
    pub record_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsLookupResult {
    pub query: String,
    pub record_type: String,
    pub lines: Vec<String>,
    pub notes: Vec<String>,
}

fn rdata_line(r: &RData) -> String {
    match r {
        RData::A(a) => a.to_string(),
        RData::AAAA(a) => a.to_string(),
        RData::MX(mx) => format!("{} {}", mx.preference(), mx.exchange()),
        RData::TXT(txt) => txt
            .txt_data()
            .iter()
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .collect::<Vec<_>>()
            .join(""),
        RData::NS(ns) => ns.to_string(),
        RData::CNAME(c) => c.to_string(),
        RData::PTR(ptr) => ptr.to_string(),
        _ => format!("{r:?}"),
    }
}

/// DNS lookup via the OS resolver (hickory), with Cloudflare fallback if system config fails.
#[tauri::command]
pub async fn net_dns_lookup(req: DnsLookupReq) -> Result<DnsLookupResult, String> {
    let name = req.name.trim();
    if name.is_empty() || name.len() > 253 {
        return Err("Invalid name (empty or too long).".into());
    }
    let rt = req.record_type.trim().to_uppercase();
    let resolver = dns_resolver();
    let notes = vec![
        "Resolver: system DNS when available; otherwise Cloudflare 1.1.1.1.".into(),
    ];

    let mut lines: Vec<String> = Vec::new();

    match rt.as_str() {
        "A" => {
            let l = resolver.ipv4_lookup(name).await.map_err(|e| e.to_string())?;
            for a in l.iter() {
                lines.push(a.to_string());
            }
        }
        "AAAA" => {
            let l = resolver.ipv6_lookup(name).await.map_err(|e| e.to_string())?;
            for a in l.iter() {
                lines.push(a.to_string());
            }
        }
        "MX" => {
            let l = resolver.mx_lookup(name).await.map_err(|e| e.to_string())?;
            for mx in l.iter() {
                lines.push(format!("{} {}", mx.preference(), mx.exchange()));
            }
        }
        "TXT" => {
            let l = resolver.txt_lookup(name).await.map_err(|e| e.to_string())?;
            for txt in l.iter() {
                let s: String = txt
                    .txt_data()
                    .iter()
                    .map(|b| String::from_utf8_lossy(b).into_owned())
                    .collect::<Vec<_>>()
                    .join("");
                lines.push(s);
            }
        }
        "NS" => {
            let l = resolver.ns_lookup(name).await.map_err(|e| e.to_string())?;
            for ns in l.iter() {
                lines.push(ns.to_string());
            }
        }
        "CNAME" => {
            let l = resolver
                .lookup(name, RecordType::CNAME)
                .await
                .map_err(|e| e.to_string())?;
            for rec in l.record_iter() {
                if let Some(d) = rec.data() {
                    lines.push(rdata_line(d));
                }
            }
        }
        "PTR" => {
            let ip: IpAddr = name
                .parse()
                .map_err(|_| "PTR here means reverse DNS: enter an IPv4 or IPv6 address.".to_string())?;
            let l = resolver.reverse_lookup(ip).await.map_err(|e| e.to_string())?;
            for ptr in l.iter() {
                lines.push(ptr.to_string());
            }
        }
        other => {
            return Err(format!(
                "Unsupported record type \"{other}\". Try A, AAAA, MX, TXT, NS, CNAME, or PTR."
            ));
        }
    }

    if lines.is_empty() {
        lines.push("(no records)".into());
    }

    Ok(DnsLookupResult {
        query: name.to_string(),
        record_type: rt,
        lines,
        notes,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgpLookupReq {
    pub ip: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetJsonHttpResult {
    pub url: String,
    pub status: u16,
    pub body: String,
    pub notes: Vec<String>,
}

async fn fetch_json_like(
    client: &reqwest::Client,
    url: &str,
) -> Result<(u16, String), String> {
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or(text),
        Err(_) => text,
    };
    Ok((status, body))
}

/// BGP / routing snapshot for an IP (BGPView JSON — similar to a looking-glass summary).
#[tauri::command]
pub async fn net_bgp_lookup(req: BgpLookupReq) -> Result<NetJsonHttpResult, String> {
    let ip = req.ip.trim();
    if ip.is_empty() {
        return Err("IP is empty.".into());
    }
    let _addr: IpAddr = ip
        .parse()
        .map_err(|_| "Enter a valid IPv4 or IPv6 address.".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("HoloBro-NetTools/0.1")
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| e.to_string())?;

    let providers = vec![
        format!("https://api.bgpview.io/ip/{ip}"),
        format!("https://stat.ripe.net/data/network-info/data.json?resource={ip}"),
        format!("https://stat.ripe.net/data/prefix-overview/data.json?resource={ip}"),
    ];
    let mut errs = Vec::<String>::new();

    for url in &providers {
        match fetch_json_like(&client, url).await {
            Ok((status, body)) => {
                return Ok(NetJsonHttpResult {
                    url: url.clone(),
                    status,
                    body,
                    notes: vec![
                        "BGPView can fail on some DNS/network setups; this tool now falls back to RIPE Stat endpoints."
                            .into(),
                        "Data is a public route/ASN snapshot, not an interactive looking glass shell."
                            .into(),
                    ],
                });
            }
            Err(e) => errs.push(format!("{url} -> {e}")),
        }
    }

    Err(format!(
        "All BGP providers failed for {ip}. Attempts:\n{}",
        errs.join("\n")
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdapLookupReq {
    /// Domain name (e.g. example.com) or IPv4/IPv6 for RDAP bootstrap at rdap.org.
    pub query: String,
}

/// WHOIS-style registration data via RDAP (rdap.org redirector → registry).
#[tauri::command]
pub async fn net_rdap_lookup(req: RdapLookupReq) -> Result<NetJsonHttpResult, String> {
    let q = req.query.trim();
    if q.is_empty() {
        return Err("Query is empty.".into());
    }

    let url = if let Ok(ip) = q.parse::<IpAddr>() {
        format!("https://rdap.org/ip/{ip}")
    } else if q.contains('.') && !q.contains('/') && !q.chars().any(|c| c.is_whitespace()) {
        format!("https://rdap.org/domain/{}", q.to_lowercase())
    } else {
        return Err("Enter a domain (e.g. example.com) or IPv4/IPv6 address.".into());
    };

    let client = reqwest::Client::builder()
        .user_agent("HoloBro-NetTools/0.1")
        .timeout(std::time::Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::limited(12))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;

    let body = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => serde_json::to_string_pretty(&v).unwrap_or(text),
        Err(_) => text,
    };

    Ok(NetJsonHttpResult {
        url,
        status,
        body,
        notes: vec![
            "RDAP via rdap.org (redirects to the relevant registry). JSON when the server returns it."
                .into(),
        ],
    })
}
