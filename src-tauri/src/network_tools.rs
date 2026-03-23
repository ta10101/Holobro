//! Local network diagnostics: interfaces, public IP, traceroute, rough throughput.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Instant;

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
