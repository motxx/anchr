//! TLSNotary Verifier Server
//!
//! Supports two modes:
//! - **TCP** (port 7047): CLI prover protocol — attestation returned to prover
//! - **HTTP/WS** (port 7048): Browser extension protocol — session registration +
//!   MPC-TLS over WebSocket + webhook to Anchr Oracle
//!
//! TCP Protocol (CLI):
//!   Connection 1: cmd='M' + 16-byte session_id → MPC-TLS Session
//!   Connection 2: cmd='A' + 16-byte session_id + len-prefixed AttestationRequest
//!                 → len-prefixed Attestation response
//!
//! WebSocket Protocol (Browser Extension):
//!   GET /health → "ok"
//!   GET /info → version info
//!   WS /session → register session, receive results
//!   WS /verifier?sessionId=<id> → MPC-TLS session

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use axum::{
    extract::{ws::WebSocket, Query, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use clap::Parser;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, oneshot};
use tokio_util::compat::TokioAsyncReadCompatExt;
use tower_http::cors::CorsLayer;

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
    /// TCP port for CLI prover protocol
    #[arg(long, default_value = "7047")]
    tcp_port: u16,

    /// HTTP/WS port for browser extension protocol
    #[arg(long, default_value = "7048")]
    ws_port: u16,

    /// Anchr Oracle webhook URL (e.g. http://localhost:3000)
    #[arg(long)]
    webhook_url: Option<String>,
}

// --- Shared state ---

struct SessionState {
    verifier_output: VerifierOutput,
    connection_info: ConnectionInfo,
    server_ephemeral_key: Vec<u8>,
}

struct WsSession {
    max_sent_data: usize,
    max_recv_data: usize,
    /// Sends the prover's WebSocket to the verifier task
    prover_tx: oneshot::Sender<WebSocket>,
}

struct WsVerificationResult {
    server_name: Option<String>,
    sent_transcript: String,
    recv_transcript: String,
    /// Signed attestation (bincode, for CLI provers that need to build presentations)
    attestation_bytes: Option<Vec<u8>>,
    /// Secrets needed to build presentation (bincode)
    connection_info: ConnectionInfo,
    server_ephemeral_key: Vec<u8>,
    transcript_commitments: Vec<u8>,
}

#[derive(Clone)]
struct AppState {
    /// TCP session store (CLI protocol)
    tcp_sessions: Arc<Mutex<HashMap<[u8; 16], SessionState>>>,
    /// WebSocket session store (browser extension protocol)
    ws_sessions: Arc<Mutex<HashMap<String, WsSession>>>,
    webhook_url: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let state = AppState {
        tcp_sessions: Arc::new(Mutex::new(HashMap::new())),
        ws_sessions: Arc::new(Mutex::new(HashMap::new())),
        webhook_url: cli.webhook_url.clone(),
    };

    // Start TCP listener (CLI protocol)
    let tcp_state = state.clone();
    let tcp_port = cli.tcp_port;
    tokio::spawn(async move {
        if let Err(e) = run_tcp_server(tcp_port, tcp_state).await {
            eprintln!("[tlsn-server] TCP server error: {:#}", e);
        }
    });

    // Start HTTP/WS server (browser extension protocol)
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/info", get(info_handler))
        .route("/session", get(session_ws_handler))
        .route("/verifier", get(verifier_ws_handler))
        .route("/proxy", get(proxy_ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let ws_listener = tokio::net::TcpListener::bind(("0.0.0.0", cli.ws_port)).await?;
    eprintln!("[tlsn-server] TCP  on 0.0.0.0:{}", cli.tcp_port);
    eprintln!("[tlsn-server] HTTP/WS on 0.0.0.0:{}", cli.ws_port);

    axum::serve(ws_listener, app).await?;
    Ok(())
}

async fn info_handler() -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "version": "0.1.0",
        "tlsn_version": "0.1.0-alpha.14",
        "protocols": ["tcp", "ws"]
    }))
}

// --- WebSocket protocol (browser extension compatible) ---

#[derive(Deserialize)]
struct VerifierQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Deserialize)]
struct ProxyQuery {
    /// Target hostname (e.g. "api.coingecko.com" or "api.coingecko.com:443")
    token: Option<String>,
    host: Option<String>,
}

async fn session_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_session_ws(socket, state))
}

async fn handle_session_ws(mut ws: WebSocket, state: AppState) {
    // Wait for register message
    let msg = match ws.recv().await {
        Some(Ok(msg)) => msg,
        _ => return,
    };

    let text = match msg.into_text() {
        Ok(t) => t,
        Err(_) => return,
    };

    let register: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return,
    };

    if register["type"].as_str() != Some("register") {
        return;
    }

    let max_sent = register["maxSentData"].as_u64().unwrap_or(4096) as usize;
    let max_recv = register["maxRecvData"].as_u64().unwrap_or(16384) as usize;
    let session_id = uuid::Uuid::new_v4().to_string();

    // Create oneshot channels for prover connection and result
    let (prover_tx, prover_rx) = oneshot::channel::<WebSocket>();
    let (result_tx, result_rx) = oneshot::channel::<WsVerificationResult>();

    state.ws_sessions.lock().await.insert(session_id.clone(), WsSession {
        max_sent_data: max_sent,
        max_recv_data: max_recv,
        prover_tx,
    });

    // Send session_registered
    let resp = serde_json::json!({
        "type": "session_registered",
        "sessionId": session_id,
    });
    if ws.send(axum::extract::ws::Message::Text(resp.to_string().into())).await.is_err() {
        return;
    }

    eprintln!("[tlsn-server] WS session registered: {}", &session_id[..8]);

    // Spawn verifier task (waits for prover to connect)
    let sid = session_id.clone();
    let webhook_url = state.webhook_url.clone();
    tokio::spawn(async move {
        // Wait for prover to connect (30s timeout)
        let prover_ws = match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            prover_rx,
        ).await {
            Ok(Ok(ws)) => ws,
            _ => {
                eprintln!("[tlsn-server] WS session {} timed out", &sid[..8]);
                return;
            }
        };

        eprintln!("[tlsn-server] WS MPC starting for {}", &sid[..8]);

        // Run MPC-TLS verifier over WebSocket
        match run_ws_verifier(prover_ws, max_sent, max_recv).await {
            Ok(result) => {
                eprintln!("[tlsn-server] WS MPC complete for {}", &sid[..8]);
                let _ = result_tx.send(result);
            }
            Err(e) => {
                eprintln!("[tlsn-server] WS MPC error for {}: {:#}", &sid[..8], e);
            }
        }
    });

    // Wait for result (or reveal_config from extension)
    // For now, wait for the verifier to complete and send results
    match tokio::time::timeout(std::time::Duration::from_secs(120), result_rx).await {
        Ok(Ok(result)) => {
            let att_b64 = result.attestation_bytes.as_ref().map(|b| base64_encode(b));
            let resp = serde_json::json!({
                "type": "session_completed",
                "serverName": result.server_name,
                "sent": result.sent_transcript,
                "recv": result.recv_transcript,
                "attestation": att_b64,
                "connectionInfo": base64_encode(&bincode::serialize(&result.connection_info).unwrap_or_default()),
                "serverEphemeralKey": base64_encode(&result.server_ephemeral_key),
                "transcriptCommitments": base64_encode(&result.transcript_commitments),
            });
            let _ = ws.send(axum::extract::ws::Message::Text(resp.to_string().into())).await;
            eprintln!("[tlsn-server] WS session {} completed", &session_id[..8]);

            // Fire webhook if configured
            if let Some(ref url) = state.webhook_url {
                let payload = serde_json::json!({
                    "session_id": session_id,
                    "server_name": result.server_name,
                    "recv_transcript": result.recv_transcript,
                });
                if let Err(e) = reqwest::Client::new()
                    .post(url)
                    .json(&payload)
                    .send()
                    .await
                {
                    eprintln!("[tlsn-server] Webhook error: {}", e);
                }
            }
        }
        _ => {
            let resp = serde_json::json!({ "type": "error", "message": "Verification timed out" });
            let _ = ws.send(axum::extract::ws::Message::Text(resp.to_string().into())).await;
        }
    }
}

async fn verifier_ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<VerifierQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_verifier_ws(socket, query.session_id, state))
}

async fn handle_verifier_ws(ws: WebSocket, session_id: String, state: AppState) {
    let session = state.ws_sessions.lock().await.remove(&session_id);
    match session {
        Some(s) => {
            let _ = s.prover_tx.send(ws);
        }
        None => {
            eprintln!("[tlsn-server] WS session {} not found", &session_id[..8]);
        }
    }
}

// --- WebSocket-to-TCP Proxy (for browser extensions) ---

async fn proxy_ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<ProxyQuery>,
    State(_state): State<AppState>,
) -> impl IntoResponse {
    let host = query.token.or(query.host).unwrap_or_default();
    ws.on_upgrade(move |socket| handle_proxy_ws(socket, host))
}

async fn handle_proxy_ws(ws: WebSocket, host: String) {
    let (host_part, port) = if host.contains(':') {
        let parts: Vec<&str> = host.splitn(2, ':').collect();
        (parts[0].to_string(), parts[1].parse::<u16>().unwrap_or(443))
    } else {
        (host.clone(), 443)
    };

    eprintln!("[tlsn-server] Proxy connecting to {}:{}", host_part, port);

    let tcp = match tokio::net::TcpStream::connect((&*host_part, port)).await {
        Ok(tcp) => tcp,
        Err(e) => {
            eprintln!("[tlsn-server] Proxy connect failed: {}", e);
            return;
        }
    };

    let (tcp_read, tcp_write) = tcp.into_split();
    let (ws_sink, ws_stream) = ws.split();

    // WS → TCP
    let ws_to_tcp = tokio::spawn({
        let mut ws_stream = ws_stream;
        let mut tcp_write = tcp_write;
        async move {
            while let Some(Ok(msg)) = ws_stream.next().await {
                match msg {
                    axum::extract::ws::Message::Binary(data) => {
                        if tcp_write.write_all(&data).await.is_err() { break; }
                        if tcp_write.flush().await.is_err() { break; }
                    }
                    axum::extract::ws::Message::Close(_) => break,
                    _ => {}
                }
            }
            let _ = tcp_write.shutdown().await;
        }
    });

    // TCP → WS
    let tcp_to_ws = tokio::spawn({
        let mut ws_sink = ws_sink;
        let mut tcp_read = tcp_read;
        async move {
            let mut buf = vec![0u8; 65536];
            loop {
                match tcp_read.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if ws_sink.send(axum::extract::ws::Message::Binary(buf[..n].to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });

    let _ = tokio::join!(ws_to_tcp, tcp_to_ws);
    eprintln!("[tlsn-server] Proxy closed for {}", host);
}

async fn run_ws_verifier(
    ws: WebSocket,
    max_sent: usize,
    max_recv: usize,
) -> Result<WsVerificationResult> {
    // Convert axum WebSocket to a futures::AsyncRead + AsyncWrite stream
    // using ws_stream_tungstenite-compatible approach: each WS binary message = one stream chunk
    let ws_stream = AxumWsStream::new(ws);

    // Run Session directly over the WS stream (no duplex relay)
    let session = Session::new(ws_stream);
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

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
    let transcript = output.transcript.map(|mut t| {
        t.set_unauthed(0u8);
        let sent = String::from_utf8_lossy(t.sent_unsafe()).to_string();
        let recv = String::from_utf8_lossy(t.received_unsafe()).to_string();
        (sent, recv)
    });

    let tls_tx = verifier.tls_transcript().clone();

    let sent_app_len = tls_tx.sent().iter()
        .filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None })
        .sum::<usize>();
    let recv_app_len = tls_tx.recv().iter()
        .filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None })
        .sum::<usize>();

    let connection_info = ConnectionInfo {
        time: tls_tx.time(),
        version: *tls_tx.version(),
        transcript_length: TranscriptLength { sent: sent_app_len as u32, received: recv_app_len as u32 },
    };
    let server_ephemeral_key = bincode::serialize(tls_tx.server_ephemeral_key())?;
    let transcript_commitments = bincode::serialize(&output.transcript_commitments)?;

    verifier.close().await?;
    handle.close();
    driver_task.await??;

    let (sent, recv) = transcript.unwrap_or_default();

    Ok(WsVerificationResult {
        server_name,
        sent_transcript: sent,
        recv_transcript: recv,
        attestation_bytes: None, // Will be signed by prover with returned data
        connection_info,
        server_ephemeral_key,
        transcript_commitments,
    })
}

// --- TCP protocol (CLI prover) ---

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

async fn handle_tcp(
    mut tcp: tokio::net::TcpStream,
    store: Arc<Mutex<HashMap<[u8; 16], SessionState>>>,
) -> Result<()> {
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

async fn handle_tcp_mpc(
    tcp: tokio::net::TcpStream,
    sid: [u8; 16],
    store: Arc<Mutex<HashMap<[u8; 16], SessionState>>>,
) -> Result<()> {
    let session = Session::new(tcp.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let verifier = handle
        .new_verifier(
            VerifierConfig::builder()
                .root_store(RootCertStore::mozilla())
                .build()?,
        )?
        .commit().await?
        .accept().await?
        .run().await?;

    let (verifier_output, verifier) = verifier.verify().await?.accept().await?;

    let tls_tx = verifier.tls_transcript().clone();
    verifier.close().await?;

    let sent_len = tls_tx.sent().iter()
        .filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None })
        .sum::<usize>();
    let recv_len = tls_tx.recv().iter()
        .filter_map(|r| match r.typ { ContentType::ApplicationData => Some(r.ciphertext.len()), _ => None })
        .sum::<usize>();

    let state = SessionState {
        verifier_output,
        connection_info: ConnectionInfo {
            time: tls_tx.time(),
            version: *tls_tx.version(),
            transcript_length: TranscriptLength { sent: sent_len as u32, received: recv_len as u32 },
        },
        server_ephemeral_key: bincode::serialize(tls_tx.server_ephemeral_key())?,
    };

    store.lock().await.insert(sid, state);

    handle.close();
    driver_task.await??;
    Ok(())
}

async fn handle_tcp_attest(
    mut tcp: tokio::net::TcpStream,
    sid: [u8; 16],
    store: Arc<Mutex<HashMap<[u8; 16], SessionState>>>,
) -> Result<()> {
    let mut len_buf = [0u8; 4];
    tcp.read_exact(&mut len_buf).await?;
    let req_len = u32::from_be_bytes(len_buf) as usize;
    let mut req_buf = vec![0u8; req_len];
    tcp.read_exact(&mut req_buf).await?;

    let request: AttestationRequest = bincode::deserialize(&req_buf)?;

    // Wait for MPC state with retry
    let state = {
        let mut attempts = 0;
        loop {
            if let Some(s) = store.lock().await.remove(&sid) {
                break s;
            }
            attempts += 1;
            if attempts > 50 {
                return Err(anyhow!("Timeout waiting for MPC session"));
            }
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
    builder
        .connection_info(state.connection_info)
        .server_ephemeral_key(ephemeral_key)
        .transcript_commitments(state.verifier_output.transcript_commitments);

    let attestation = builder.build(&provider)?;

    let att_bytes = bincode::serialize(&attestation)?;
    tcp.write_all(&(att_bytes.len() as u32).to_be_bytes()).await?;
    tcp.write_all(&att_bytes).await?;
    tcp.flush().await?;

    Ok(())
}

// --- AxumWsStream: Convert axum WebSocket to futures AsyncRead + AsyncWrite ---

use std::pin::Pin;
use std::task::{Context, Poll};
use std::collections::VecDeque;

struct AxumWsStream {
    ws: axum::extract::ws::WebSocket,
    read_buf: VecDeque<u8>,
    closed: bool,
}

impl AxumWsStream {
    fn new(ws: axum::extract::ws::WebSocket) -> Self {
        Self { ws, read_buf: VecDeque::new(), closed: false }
    }
}

impl futures::AsyncRead for AxumWsStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut [u8],
    ) -> Poll<std::io::Result<usize>> {
        // Drain buffered data first
        if !self.read_buf.is_empty() {
            let n = std::cmp::min(buf.len(), self.read_buf.len());
            for i in 0..n {
                buf[i] = self.read_buf.pop_front().unwrap();
            }
            return Poll::Ready(Ok(n));
        }

        if self.closed {
            return Poll::Ready(Ok(0));
        }

        // Poll WebSocket for next message
        match Pin::new(&mut self.ws).poll_next(cx) {
            Poll::Ready(Some(Ok(msg))) => {
                match msg {
                    axum::extract::ws::Message::Binary(data) => {
                        let n = std::cmp::min(buf.len(), data.len());
                        buf[..n].copy_from_slice(&data[..n]);
                        // Buffer remaining
                        for &b in &data[n..] {
                            self.read_buf.push_back(b);
                        }
                        Poll::Ready(Ok(n))
                    }
                    axum::extract::ws::Message::Close(_) => {
                        self.closed = true;
                        Poll::Ready(Ok(0))
                    }
                    _ => {
                        // Text or Ping/Pong — skip
                        cx.waker().wake_by_ref();
                        Poll::Pending
                    }
                }
            }
            Poll::Ready(Some(Err(e))) => Poll::Ready(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
            Poll::Ready(None) => {
                self.closed = true;
                Poll::Ready(Ok(0))
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

impl futures::AsyncWrite for AxumWsStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let msg = axum::extract::ws::Message::Binary(buf.to_vec().into());
        match Pin::new(&mut self.ws).poll_ready(cx) {
            Poll::Ready(Ok(())) => {
                match Pin::new(&mut self.ws).start_send(msg) {
                    Ok(()) => Poll::Ready(Ok(buf.len())),
                    Err(e) => Poll::Ready(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
                }
            }
            Poll::Ready(Err(e)) => Poll::Ready(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
            Poll::Pending => Poll::Pending,
        }
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        match Pin::new(&mut self.ws).poll_flush(cx) {
            Poll::Ready(Ok(())) => Poll::Ready(Ok(())),
            Poll::Ready(Err(e)) => Poll::Ready(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
            Poll::Pending => Poll::Pending,
        }
    }

    fn poll_close(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        match Pin::new(&mut self.ws).poll_close(cx) {
            Poll::Ready(Ok(())) => Poll::Ready(Ok(())),
            Poll::Ready(Err(e)) => Poll::Ready(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
            Poll::Pending => Poll::Pending,
        }
    }
}

// Need to implement Stream + Sink traits for AxumWsStream to use poll_next/poll_ready etc.
// Actually axum::extract::ws::WebSocket already implements Stream + Sink, so we can use it directly.
use futures::Stream;
use futures::Sink;

impl Unpin for AxumWsStream {}

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
