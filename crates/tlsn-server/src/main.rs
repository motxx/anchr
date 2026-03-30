//! TLSNotary Verifier Server
//!
//! TCP (port 7047): CLI prover protocol
//! HTTP/WS (port 7048): Browser extension protocol (same as official tlsn-extension verifier)
//!
//! /verifier and /proxy use ws_stream_tungstenite::WsStream (same as official)
//! /session uses axum WebSocket for JSON message exchange

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use clap::Parser;
use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot};
use tokio_util::compat::TokioAsyncReadCompatExt;

use tlsn::{
    attestation::{
        request::Request as AttestationRequest,
        signing::Secp256k1Signer,
        Attestation, AttestationConfig, CryptoProvider,
    },
    config::verifier::VerifierConfig,
    connection::{ConnectionInfo, TranscriptLength},
    transcript::ContentType,
    verifier::VerifierOutput,
    webpki::RootCertStore,
    Session,
};

#[derive(Parser)]
#[command(name = "tlsn-server", about = "TLSNotary Verifier Server")]
struct Cli {
    #[arg(long, default_value = "7047")]
    tcp_port: u16,
    #[arg(long, default_value = "7048")]
    ws_port: u16,
    #[arg(long)]
    webhook_url: Option<String>,
}

// --- Shared state ---

struct SessionState {
    verifier_output: VerifierOutput,
    connection_info: ConnectionInfo,
    server_ephemeral_key: Vec<u8>,
}

#[derive(Clone)]
struct WsSessionEntry {
    max_sent_data: usize,
    max_recv_data: usize,
}

struct WsVerificationResult {
    server_name: Option<String>,
    sent_transcript: String,
    recv_transcript: String,
    connection_info: ConnectionInfo,
    server_ephemeral_key: Vec<u8>,
    transcript_commitments: Vec<u8>,
}

#[derive(Clone)]
struct AppState {
    tcp_sessions: Arc<Mutex<HashMap<[u8; 16], SessionState>>>,
    ws_sessions: Arc<Mutex<HashMap<String, WsSessionEntry>>>,
    ws_results: Arc<Mutex<HashMap<String, oneshot::Sender<WsVerificationResult>>>>,
    webhook_url: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let state = AppState {
        tcp_sessions: Arc::new(Mutex::new(HashMap::new())),
        ws_sessions: Arc::new(Mutex::new(HashMap::new())),
        ws_results: Arc::new(Mutex::new(HashMap::new())),
        webhook_url: cli.webhook_url.clone(),
    };

    // TCP listener (CLI protocol)
    let tcp_state = state.clone();
    let tcp_port = cli.tcp_port;
    tokio::spawn(async move {
        if let Err(e) = run_tcp_server(tcp_port, tcp_state).await {
            eprintln!("[tlsn-server] TCP server error: {:#}", e);
        }
    });

    // WS listener (Browser extension protocol)
    // We handle /verifier and /proxy with raw async-tungstenite (same as official)
    // and /session, /health, /info with axum
    let ws_port = cli.ws_port;
    let ws_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = run_ws_server(ws_port, ws_state).await {
            eprintln!("[tlsn-server] WS server error: {:#}", e);
        }
    });

    eprintln!("[tlsn-server] TCP  on 0.0.0.0:{}", cli.tcp_port);
    eprintln!("[tlsn-server] HTTP/WS on 0.0.0.0:{}", cli.ws_port);

    // Keep main alive
    loop { tokio::time::sleep(std::time::Duration::from_secs(3600)).await; }
}

// --- WS server using raw hyper + tungstenite ---

async fn run_ws_server(port: u16, state: AppState) -> Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    loop {
        let (tcp, addr) = listener.accept().await?;
        let state = state.clone();

        tokio::spawn(async move {
            // Parse the HTTP request to determine the path, then upgrade to WS
            // using async-tungstenite directly (same as official tlsn-extension verifier)
            use async_tungstenite::tokio::TokioAdapter;
            use async_tungstenite::tungstenite::handshake::server::{Request, Response, ErrorResponse};

            let mut path = String::new();
            let mut query = String::new();

            let ws = match async_tungstenite::tokio::accept_hdr_async(
                tcp,
                |req: &Request, resp: Response| -> std::result::Result<Response, ErrorResponse> {
                    path = req.uri().path().to_string();
                    query = req.uri().query().unwrap_or("").to_string();

                    // For non-WS paths, we'd need a different approach
                    // But the extension only connects via WS to all endpoints
                    Ok(resp)
                },
            ).await {
                Ok(ws) => ws,
                Err(e) => {
                    // Not a WS request — handle as HTTP
                    // For simplicity, we only support WS on this port
                    // /health and /info can be checked via the TCP port or curl
                    eprintln!("[ws] non-WS connection from {}: {}", addr, e);
                    return;
                }
            };

            match path.as_str() {
                "/session" => handle_session_ws_raw(ws, state).await,
                "/verifier" => {
                    let sid = parse_query_param(&query, "sessionId").unwrap_or_default();
                    handle_verifier_ws_raw(ws, sid, state).await;
                }
                "/proxy" => {
                    let host = parse_query_param(&query, "token")
                        .or_else(|| parse_query_param(&query, "host"))
                        .unwrap_or_default();
                    handle_proxy_ws_raw(ws, host).await;
                }
                _ => {
                    eprintln!("[ws] unknown path: {}", path);
                }
            }
        });
    }
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        let v = parts.next()?;
        if k == key { Some(v.to_string()) } else { None }
    })
}

// --- /session handler (JSON over WS, using tungstenite directly) ---

async fn handle_session_ws_raw(
    mut ws: async_tungstenite::WebSocketStream<async_tungstenite::tokio::TokioAdapter<tokio::net::TcpStream>>,
    state: AppState,
) {
    use async_tungstenite::tungstenite::Message;

    // Wait for register message
    let msg = match ws.next().await {
        Some(Ok(Message::Text(t))) => t,
        _ => return,
    };
    let register: serde_json::Value = match serde_json::from_str(&msg) {
        Ok(v) => v,
        Err(_) => return,
    };
    if register["type"].as_str() != Some("register") { return; }

    let max_sent = register["maxSentData"].as_u64().unwrap_or(4096) as usize;
    let max_recv = register["maxRecvData"].as_u64().unwrap_or(16384) as usize;
    let session_id = uuid::Uuid::new_v4().to_string();

    state.ws_sessions.lock().await.insert(session_id.clone(), WsSessionEntry {
        max_sent_data: max_sent,
        max_recv_data: max_recv,
    });

    // Create result channel
    let (result_tx, result_rx) = oneshot::channel::<WsVerificationResult>();
    state.ws_results.lock().await.insert(session_id.clone(), result_tx);

    // Send session_registered
    let resp = serde_json::json!({ "type": "session_registered", "sessionId": session_id });
    if ws.send(Message::Text(resp.to_string())).await.is_err() { return; }
    eprintln!("[tlsn-server] WS session registered: {}", &session_id[..8]);

    // Wait for MPC verification result
    let result = match tokio::time::timeout(std::time::Duration::from_secs(120), result_rx).await {
        Ok(Ok(r)) => r,
        _ => {
            let resp = serde_json::json!({ "type": "error", "message": "Verification timed out" });
            let _ = ws.send(Message::Text(resp.to_string())).await;
            return;
        }
    };

    eprintln!("[tlsn-server] WS MPC done for {}, waiting for reveal_config...", &session_id[..8]);

    // Wait for reveal_config from extension (with timeout)
    // The extension sends reveal_config after prove() extracts transcript ranges
    let reveal_config = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(Ok(msg)) = ws.next().await {
            if let async_tungstenite::tungstenite::Message::Text(text) = msg {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if json["type"].as_str() == Some("reveal_config") {
                        return Some(json);
                    }
                }
            }
        }
        None
    }).await;

    // Build results based on reveal_config ranges
    let mut results = Vec::new();

    if let Ok(Some(config)) = reveal_config {
        eprintln!("[tlsn-server] Received reveal_config for {}", &session_id[..8]);

        // Process sent ranges
        if let Some(sent_ranges) = config["sent"].as_array() {
            for range in sent_ranges {
                let start = range["start"].as_u64().unwrap_or(0) as usize;
                let end = range["end"].as_u64().unwrap_or(0) as usize;
                let handler_type = range.get("handler").and_then(|h| h["type"].as_str()).unwrap_or("SENT");
                let handler_part = range.get("handler").and_then(|h| h["part"].as_str()).unwrap_or("ALL");

                // Extract the range from the sent transcript
                let value = if end <= result.sent_transcript.len() && start < end {
                    result.sent_transcript[start..end].to_string()
                } else {
                    result.sent_transcript.clone()
                };

                results.push(serde_json::json!({
                    "type": handler_type,
                    "part": handler_part,
                    "value": value,
                }));
            }
        }

        // Process recv ranges
        if let Some(recv_ranges) = config["recv"].as_array() {
            for range in recv_ranges {
                let start = range["start"].as_u64().unwrap_or(0) as usize;
                let end = range["end"].as_u64().unwrap_or(0) as usize;
                let handler_type = range.get("handler").and_then(|h| h["type"].as_str()).unwrap_or("RECV");
                let handler_part = range.get("handler").and_then(|h| h["part"].as_str()).unwrap_or("ALL");

                let value = if end <= result.recv_transcript.len() && start < end {
                    result.recv_transcript[start..end].to_string()
                } else {
                    result.recv_transcript.clone()
                };

                results.push(serde_json::json!({
                    "type": handler_type,
                    "part": handler_part,
                    "value": value,
                }));
            }
        }
    } else {
        eprintln!("[tlsn-server] No reveal_config received for {}, returning full transcript", &session_id[..8]);
        results.push(serde_json::json!({ "type": "SENT", "part": "ALL", "value": result.sent_transcript }));
        results.push(serde_json::json!({ "type": "RECV", "part": "ALL", "value": result.recv_transcript }));
    }

    let resp = serde_json::json!({
        "type": "session_completed",
        "serverName": result.server_name,
        "sent": result.sent_transcript,
        "recv": result.recv_transcript,
        "results": results,
        "connectionInfo": base64_encode(&bincode::serialize(&result.connection_info).unwrap_or_default()),
        "serverEphemeralKey": base64_encode(&result.server_ephemeral_key),
        "transcriptCommitments": base64_encode(&result.transcript_commitments),
    });
    let _ = ws.send(Message::Text(resp.to_string())).await;
    eprintln!("[tlsn-server] WS session {} completed with {} results", &session_id[..8], results.len());
}

// --- /verifier handler (MPC-TLS via WsStream, same as official) ---

async fn handle_verifier_ws_raw(
    ws: async_tungstenite::WebSocketStream<async_tungstenite::tokio::TokioAdapter<tokio::net::TcpStream>>,
    session_id: String,
    state: AppState,
) {
    let entry = state.ws_sessions.lock().await.remove(&session_id);
    if entry.is_none() {
        eprintln!("[tlsn-server] WS session {} not found", &session_id[..8]);
        return;
    }

    eprintln!("[tlsn-server] WS MPC starting for {}", &session_id[..8]);

    // Use WsStream (same as official tlsn-extension verifier)
    let ws_stream = ws_stream_tungstenite::WsStream::new(ws);

    // Run Session directly (same as official)
    let session = Session::new(ws_stream);
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let result = async {
        let verifier = handle
            .new_verifier(
                VerifierConfig::builder()
                    .root_store(RootCertStore::mozilla())
                    .build()?,
            )?
            .commit().await?
            .accept().await?
            .run().await?;

        let (output, verifier) = verifier.verify().await?.accept().await?;

        let server_name = output.server_name.map(|s| format!("{}", s));
        eprintln!("[ws-verifier] server_name: {:?}, has_transcript: {}", server_name, output.transcript.is_some());
        let transcript = output.transcript.map(|mut t| {
            t.set_unauthed(0u8);
            let sent = String::from_utf8_lossy(t.sent_unsafe()).to_string();
            let recv = String::from_utf8_lossy(t.received_unsafe()).to_string();
            eprintln!("[ws-verifier] sent: {} bytes, recv: {} bytes", sent.len(), recv.len());
            eprintln!("[ws-verifier] sent preview: {}", &sent[..std::cmp::min(100, sent.len())]);
            eprintln!("[ws-verifier] recv preview: {}", &recv[..std::cmp::min(100, recv.len())]);
            (sent, recv)
        });

        let tls_tx = verifier.tls_transcript().clone();
        let sent_len = tls_tx.sent().iter()
            .filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None })
            .sum::<usize>();
        let recv_len = tls_tx.recv().iter()
            .filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None })
            .sum::<usize>();

        let conn_info = ConnectionInfo {
            time: tls_tx.time(),
            version: *tls_tx.version(),
            transcript_length: TranscriptLength { sent: sent_len as u32, received: recv_len as u32 },
        };
        let eph_key = bincode::serialize(tls_tx.server_ephemeral_key())?;
        let commitments = bincode::serialize(&output.transcript_commitments)?;

        verifier.close().await?;

        let (sent, recv) = transcript.unwrap_or_default();

        Ok::<_, anyhow::Error>(WsVerificationResult {
            server_name,
            sent_transcript: sent,
            recv_transcript: recv,
            connection_info: conn_info,
            server_ephemeral_key: eph_key,
            transcript_commitments: commitments,
        })
    }.await;

    handle.close();
    let _ = driver_task.await;

    match result {
        Ok(vr) => {
            eprintln!("[tlsn-server] WS MPC complete for {}", &session_id[..8]);
            if let Some(tx) = state.ws_results.lock().await.remove(&session_id) {
                let _ = tx.send(vr);
            }
        }
        Err(e) => {
            eprintln!("[tlsn-server] WS MPC error for {}: {:#}", &session_id[..8], e);
        }
    }
}

async fn connect_proxy_target(host: &str, port: u16) -> std::io::Result<tokio::net::TcpStream> {
    if let Ok(proxy) = std::env::var("SOCKS_PROXY") {
        let addr = proxy.strip_prefix("socks5://").unwrap_or(&proxy);
        eprintln!("[tlsn-server] Proxy {}:{} via SOCKS5 ({})", host, port, addr);
        tokio_socks::tcp::Socks5Stream::connect(addr, (host, port)).await
            .map(|s| s.into_inner())
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::ConnectionRefused, e))
    } else {
        tokio::net::TcpStream::connect((host, port)).await
    }
}

// --- /proxy handler (WS-to-TCP bridge, same approach as official) ---

async fn handle_proxy_ws_raw(
    ws: async_tungstenite::WebSocketStream<async_tungstenite::tokio::TokioAdapter<tokio::net::TcpStream>>,
    host: String,
) {
    let (host_part, port) = if host.contains(':') {
        let parts: Vec<&str> = host.splitn(2, ':').collect();
        (parts[0].to_string(), parts[1].parse::<u16>().unwrap_or(443))
    } else {
        (host.clone(), 443)
    };

    eprintln!("[tlsn-server] Proxy connecting to {}:{}", host_part, port);

    let tcp = match connect_proxy_target(&host_part, port).await {
        Ok(tcp) => tcp,
        Err(e) => {
            eprintln!("[tlsn-server] Proxy connect failed: {}", e);
            return;
        }
    };

    // Message-based relay (same approach as official tlsn-extension verifier)
    // WS Binary messages <-> raw TCP bytes
    let (mut ws_sink, mut ws_stream) = ws.split();
    let (mut tcp_read, mut tcp_write) = tokio::io::split(tcp);

    let host1 = host.clone();
    let ws_to_tcp = tokio::spawn(async move {
        let mut total = 0u64;
        loop {
            match ws_stream.next().await {
                Some(Ok(msg)) => match msg {
                    async_tungstenite::tungstenite::Message::Binary(data) => {
                        total += data.len() as u64;
                        eprintln!("[proxy] WS→TCP: {} bytes (total {})", data.len(), total);
                        if tcp_write.write_all(&data).await.is_err() {
                            eprintln!("[proxy] WS→TCP write error");
                            break;
                        }
                    }
                    async_tungstenite::tungstenite::Message::Close(reason) => {
                        eprintln!("[proxy] WS close: {:?}", reason);
                        break;
                    }
                    other => {
                        eprintln!("[proxy] WS other msg: {:?}", std::mem::discriminant(&other));
                    }
                },
                Some(Err(e)) => {
                    eprintln!("[proxy] WS error: {}", e);
                    break;
                }
                None => {
                    eprintln!("[proxy] WS stream ended");
                    break;
                }
            }
        }
        eprintln!("[proxy] WS→TCP {} bytes for {}", total, host1);
        let _ = tcp_write.shutdown().await;
    });

    let host2 = host.clone();
    let tcp_to_ws = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        let mut total = 0u64;
        loop {
            match tcp_read.read(&mut buf).await {
                Ok(0) => {
                    let _ = ws_sink.send(async_tungstenite::tungstenite::Message::Close(None)).await;
                    break;
                }
                Ok(n) => {
                    total += n as u64;
                    eprintln!("[proxy] TCP→WS: {} bytes (total {})", n, total);
                    if ws_sink.send(async_tungstenite::tungstenite::Message::Binary(buf[..n].to_vec())).await.is_err() {
                        eprintln!("[proxy] TCP→WS send error");
                        break;
                    }
                }
                Err(_) => {
                    let _ = ws_sink.send(async_tungstenite::tungstenite::Message::Close(None)).await;
                    break;
                }
            }
        }
        eprintln!("[proxy] TCP→WS {} bytes for {}", total, host2);
    });

    let _ = tokio::join!(ws_to_tcp, tcp_to_ws);
    eprintln!("[tlsn-server] Proxy closed for {}", host);
}

// --- TCP protocol (CLI prover, unchanged) ---

async fn run_tcp_server(port: u16, state: AppState) -> Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    loop {
        let (tcp, addr) = listener.accept().await?;
        let store = state.tcp_sessions.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_tcp(tcp, store).await {
                eprintln!("[tlsn-server] TCP error ({}): {:#}", addr, e);
            }
        });
    }
}

async fn handle_tcp(mut tcp: tokio::net::TcpStream, store: Arc<Mutex<HashMap<[u8; 16], SessionState>>>) -> Result<()> {
    let mut cmd = [0u8; 1];
    tcp.read_exact(&mut cmd).await?;
    let mut sid = [0u8; 16];
    tcp.read_exact(&mut sid).await?;
    let sid_hex = hex::encode(&sid[..8]);

    match cmd[0] {
        b'M' => {
            eprintln!("[tlsn-server] TCP MPC {} starting", sid_hex);
            handle_tcp_mpc(tcp, sid, store).await?;
            eprintln!("[tlsn-server] TCP MPC {} complete", sid_hex);
        }
        b'A' => {
            eprintln!("[tlsn-server] TCP attest {}", sid_hex);
            handle_tcp_attest(tcp, sid, store).await?;
            eprintln!("[tlsn-server] TCP attest {} signed", sid_hex);
        }
        _ => return Err(anyhow!("Unknown command: {}", cmd[0])),
    }
    Ok(())
}

async fn handle_tcp_mpc(tcp: tokio::net::TcpStream, sid: [u8; 16], store: Arc<Mutex<HashMap<[u8; 16], SessionState>>>) -> Result<()> {
    let session = Session::new(tcp.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let verifier = handle
        .new_verifier(VerifierConfig::builder().root_store(RootCertStore::mozilla()).build()?)?
        .commit().await?.accept().await?.run().await?;

    let (verifier_output, verifier) = verifier.verify().await?.accept().await?;
    let tls_tx = verifier.tls_transcript().clone();
    verifier.close().await?;

    let sent_len = tls_tx.sent().iter().filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None }).sum::<usize>();
    let recv_len = tls_tx.recv().iter().filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None }).sum::<usize>();

    store.lock().await.insert(sid, SessionState {
        verifier_output,
        connection_info: ConnectionInfo { time: tls_tx.time(), version: *tls_tx.version(), transcript_length: TranscriptLength { sent: sent_len as u32, received: recv_len as u32 } },
        server_ephemeral_key: bincode::serialize(tls_tx.server_ephemeral_key())?,
    });

    handle.close();
    driver_task.await??;
    Ok(())
}

async fn handle_tcp_attest(mut tcp: tokio::net::TcpStream, sid: [u8; 16], store: Arc<Mutex<HashMap<[u8; 16], SessionState>>>) -> Result<()> {
    let mut len_buf = [0u8; 4];
    tcp.read_exact(&mut len_buf).await?;
    let req_len = u32::from_be_bytes(len_buf) as usize;
    let mut req_buf = vec![0u8; req_len];
    tcp.read_exact(&mut req_buf).await?;

    let request: AttestationRequest = bincode::deserialize(&req_buf)?;

    let state = {
        let mut attempts = 0;
        loop {
            if let Some(s) = store.lock().await.remove(&sid) { break s; }
            attempts += 1;
            if attempts > 50 { return Err(anyhow!("Timeout waiting for MPC session")); }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    };

    let signing_key = k256::ecdsa::SigningKey::random(&mut rand::thread_rng());
    let signer = Box::new(Secp256k1Signer::new(&signing_key.to_bytes())?);
    let mut provider = CryptoProvider::default();
    provider.signer.set_signer(signer);

    let att_config = AttestationConfig::builder()
        .supported_signature_algs(Vec::from_iter(provider.signer.supported_algs()))
        .build()?;

    let ephemeral_key = bincode::deserialize(&state.server_ephemeral_key)?;
    let mut builder = Attestation::builder(&att_config).accept_request(request)?;
    builder.connection_info(state.connection_info).server_ephemeral_key(ephemeral_key)
        .transcript_commitments(state.verifier_output.transcript_commitments);
    let attestation = builder.build(&provider)?;

    let att_bytes = bincode::serialize(&attestation)?;
    tcp.write_all(&(att_bytes.len() as u32).to_be_bytes()).await?;
    tcp.write_all(&att_bytes).await?;
    tcp.flush().await?;
    Ok(())
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(triple & 0x3F) as usize] as char); } else { result.push('='); }
    }
    result
}
