//! TLSNotary Prover — generates a .presentation.tlsn file for a given URL.
//!
//! Runs both Prover and Verifier in-process (via tokio::io::duplex),
//! connects to the target HTTPS server, and outputs a presentation file
//! that can be verified by `tlsn-verifier`.

use std::path::PathBuf;

use anyhow::{anyhow, Result};
use clap::Parser;
use http_body_util::Empty;
use hyper::{body::Bytes, Request, StatusCode};
use hyper_util::rt::TokioIo;
use spansy::Spanned;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    sync::oneshot,
};
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};

use tlsn::{
    attestation::{
        presentation::Presentation,
        request::{Request as AttestationRequest, RequestConfig},
        signing::Secp256k1Signer,
        Attestation, AttestationConfig, CryptoProvider, Secrets,
    },
    config::{
        prove::ProveConfig,
        prover::ProverConfig,
        tls::TlsClientConfig,
        tls_commit::{mpc::MpcTlsConfig, TlsCommitConfig},
        verifier::VerifierConfig,
    },
    connection::{ConnectionInfo, HandshakeData, ServerName, TranscriptLength},
    prover::{state::Committed, Prover, ProverOutput},
    transcript::{ContentType, TranscriptCommitConfig},
    verifier::VerifierOutput,
    Session,
};
use tlsn_formats::http::{DefaultHttpCommitter, HttpCommit, HttpTranscript};

#[derive(Parser)]
#[command(name = "tlsn-prove", about = "Generate a TLSNotary presentation for a URL")]
struct Cli {
    /// Target URL to fetch
    url: String,

    /// Output file path (default: presentation.tlsn)
    #[arg(short, long, default_value = "presentation.tlsn")]
    output: PathBuf,

    /// Verifier server address (e.g. localhost:7047). If omitted, runs verifier in-process.
    #[arg(short, long)]
    verifier: Option<String>,

    /// SOCKS5 proxy for target connections (e.g. socks5://127.0.0.1:9050 for Tor)
    #[arg(long)]
    socks_proxy: Option<String>,

    /// Custom HTTP header (format: "Key: Value"). Can be specified multiple times.
    #[arg(short = 'H', long = "header")]
    headers: Vec<String>,

    /// Maximum bytes of sent data for MPC-TLS circuit (default: 4096).
    #[arg(long, default_value_t = 4096)]
    max_sent_data: usize,

    /// Maximum bytes of received data for MPC-TLS circuit (default: 4096).
    /// Smaller values reduce MPC computation time. Set close to expected response size.
    #[arg(long, default_value_t = 4096)]
    max_recv_data: usize,
}

async fn connect_target(host: &str, port: u16, socks_proxy: Option<&str>) -> Result<tokio::net::TcpStream> {
    match socks_proxy {
        Some(proxy) => {
            let addr = proxy.strip_prefix("socks5://").unwrap_or(proxy);
            eprintln!("[tlsn-prove] Connecting to {}:{} via SOCKS5 ({})", host, port, addr);
            let stream = tokio_socks::tcp::Socks5Stream::connect(addr, (host, port)).await
                .map_err(|e| anyhow!("SOCKS5 connect failed: {e}"))?;
            Ok(stream.into_inner())
        }
        None => Ok(tokio::net::TcpStream::connect((host, port)).await?),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let parsed_url = url::Url::parse(&cli.url)
        .map_err(|e| anyhow!("Invalid URL: {e}"))?;
    let host = parsed_url.host_str()
        .ok_or_else(|| anyhow!("URL has no host"))?
        .to_string();
    let port = parsed_url.port_or_known_default()
        .ok_or_else(|| anyhow!("Cannot determine port"))?;
    let path = if let Some(q) = parsed_url.query() {
        format!("{}?{}", parsed_url.path(), q)
    } else {
        parsed_url.path().to_string()
    };

    eprintln!("[tlsn-prove] Target: {}:{}{}", host, port, path);

    let socks_proxy = cli.socks_proxy.as_deref();

    let custom_headers: Vec<(String, String)> = cli.headers.iter().filter_map(|h| {
        let (k, v) = h.split_once(':')?;
        Some((k.trim().to_string(), v.trim().to_string()))
    }).collect();

    let max_sent = cli.max_sent_data;
    let max_recv = cli.max_recv_data;
    eprintln!("[tlsn-prove] MPC limits: max_sent={}, max_recv={}", max_sent, max_recv);

    let (attestation, secrets) = if let Some(ref verifier_addr) = cli.verifier {
        if verifier_addr.starts_with("wss://") || verifier_addr.starts_with("ws://") {
            // WebSocket mode: connect to TLSNotary demo/extension verifier
            eprintln!("[tlsn-prove] Using WebSocket verifier: {}", verifier_addr);
            run_with_ws_verifier(verifier_addr, &host, port, &path, socks_proxy, &custom_headers, max_sent, max_recv).await?
        } else {
            // TCP mode: connect to our custom Verifier Server
            eprintln!("[tlsn-prove] Using TCP verifier: {}", verifier_addr);
            run_with_remote_verifier(verifier_addr, &host, port, &path, socks_proxy, &custom_headers, max_sent, max_recv).await?
        }
    } else {
        // Local mode: run both prover and verifier in-process
        eprintln!("[tlsn-prove] Using in-process verifier");
        run_with_local_verifier(&host, port, &path, socks_proxy, &custom_headers, max_sent, max_recv).await?
    };

    // Build presentation with full disclosure
    let presentation = build_presentation(attestation, secrets)?;

    // Save
    let bytes = bincode::serialize(&presentation)?;
    std::fs::write(&cli.output, &bytes)?;

    eprintln!("[tlsn-prove] Presentation saved to {}", cli.output.display());
    eprintln!("[tlsn-prove] Size: {} bytes", bytes.len());

    // Also print base64 to stdout for easy piping
    use std::io::Write;
    let b64 = base64_encode(&bytes);
    std::io::stdout().write_all(b64.as_bytes())?;
    std::io::stdout().write_all(b"\n")?;

    Ok(())
}

async fn run_with_local_verifier(
    host: &str,
    port: u16,
    path: &str,
    socks_proxy: Option<&str>,
    custom_headers: &[(String, String)],
    max_sent_data: usize,
    max_recv_data: usize,
) -> Result<(Attestation, Secrets)> {
    let (verifier_socket, prover_socket) = tokio::io::duplex(1 << 23);
    let (request_tx, request_rx) = oneshot::channel::<AttestationRequest>();
    let (attestation_tx, attestation_rx) = oneshot::channel::<Attestation>();

    let host_clone = host.to_string();
    tokio::spawn(async move {
        if let Err(e) = run_verifier(verifier_socket, request_rx, attestation_tx, &host_clone).await {
            eprintln!("[tlsn-prove] Verifier error: {e:#}");
        }
    });

    run_prover(prover_socket, request_tx, attestation_rx, host, port, path, socks_proxy, custom_headers, max_sent_data, max_recv_data).await
}

async fn run_with_ws_verifier(
    verifier_url: &str,
    host: &str,
    port: u16,
    path: &str,
    socks_proxy: Option<&str>,
    custom_headers: &[(String, String)],
    max_sent_data: usize,
    max_recv_data: usize,
) -> Result<(Attestation, Secrets)> {
    use async_tungstenite::tokio::connect_async;
    use async_tungstenite::tungstenite::Message;
    use futures::{SinkExt, StreamExt};

    // Step 1: Register session via /session WebSocket
    let session_ws_url = format!("{}/session", verifier_url);
    eprintln!("[tlsn-prove] Connecting to session endpoint: {}", session_ws_url);

    let (mut session_ws, _) = connect_async(&session_ws_url).await
        .map_err(|e| anyhow!("Failed to connect to session WS: {e}"))?;

    // Send register message
    let register_msg = serde_json::json!({
        "type": "register",
        "maxRecvData": max_recv_data,
        "maxSentData": max_sent_data,
        "sessionData": {}
    });
    session_ws.send(Message::Text(register_msg.to_string().into())).await?;

    // Receive session_registered response
    let resp = session_ws.next().await
        .ok_or_else(|| anyhow!("Session WS closed"))??;
    let resp_text = resp.into_text()?;
    let resp_json: serde_json::Value = serde_json::from_str(&resp_text)?;
    let session_id = resp_json["sessionId"].as_str()
        .ok_or_else(|| anyhow!("No sessionId in response: {}", resp_text))?;
    eprintln!("[tlsn-prove] Session registered: {}", session_id);

    // Step 2: Connect to /verifier?sessionId=<id> for MPC-TLS
    let verifier_ws_url = format!("{}/verifier?sessionId={}", verifier_url, session_id);
    eprintln!("[tlsn-prove] Connecting to verifier: {}", verifier_ws_url);

    let (verifier_ws, _) = connect_async(&verifier_ws_url).await
        .map_err(|e| anyhow!("Failed to connect to verifier WS: {e}"))?;

    // Wrap WebSocket as AsyncRead+AsyncWrite
    // WsStream needs the inner WebSocket, not the wrapper
    let ws_stream = ws_stream_tungstenite::WsStream::new(verifier_ws);

    // Step 3: Run MPC-TLS prover over the WebSocket stream
    // Session expects futures AsyncRead/AsyncWrite (it calls .compat() internally)
    let prover_output = run_prover_mpc_futures_stream(ws_stream, host, port, path, socks_proxy, custom_headers, max_sent_data, max_recv_data).await?;

    eprintln!("[tlsn-prove] MPC complete, waiting for session result...");

    // Wait for session_completed from server (includes verifier data for attestation)
    let resp = session_ws.next().await
        .ok_or_else(|| anyhow!("Session WS closed before completion"))??;
    let resp_text = resp.into_text()?;
    let resp_json: serde_json::Value = serde_json::from_str(&resp_text)?;

    let resp_type = resp_json["type"].as_str().unwrap_or("");
    eprintln!("[tlsn-prove] Session response type: {}", resp_type);

    if resp_type == "error" {
        return Err(anyhow!("Verifier error: {}", resp_json["message"].as_str().unwrap_or("unknown")));
    }

    if resp_type != "session_completed" {
        return Err(anyhow!("Unexpected response type: {}", resp_type));
    }

    // Check if server returned verifier data (our self-hosted server does)
    let has_verifier_data = resp_json["connectionInfo"].is_string()
        && resp_json["serverEphemeralKey"].is_string()
        && resp_json["transcriptCommitments"].is_string();

    let (attestation, secrets) = if has_verifier_data {
        eprintln!("[tlsn-prove] Building attestation from server-provided verifier data");
        build_attestation_from_server_data(prover_output, &resp_json)?
    } else {
        // External server (like demo.tlsnotary.org) that doesn't return verifier data
        return Err(anyhow!("Server did not return verifier data. Use a self-hosted Verifier Server."));
    };

    session_ws.close(None).await.ok();

    Ok((attestation, secrets))
}

/// Build attestation using verifier data returned from a self-hosted server via WS.
fn build_attestation_from_server_data(
    output: ProverMpcOutput,
    resp: &serde_json::Value,
) -> Result<(Attestation, Secrets)> {
    // Decode server-provided verifier data
    let conn_info_bytes = base64_decode(resp["connectionInfo"].as_str().unwrap_or(""))?;
    let eph_key_bytes = base64_decode(resp["serverEphemeralKey"].as_str().unwrap_or(""))?;
    let commitments_bytes = base64_decode(resp["transcriptCommitments"].as_str().unwrap_or(""))?;

    let connection_info: ConnectionInfo = bincode::deserialize(&conn_info_bytes)?;
    let server_ephemeral_key = bincode::deserialize(&eph_key_bytes)?;
    let transcript_commitments = bincode::deserialize(&commitments_bytes)?;

    // Sign attestation locally (the verifier data is from the real MPC session)
    let signing_key = k256::ecdsa::SigningKey::random(&mut rand::thread_rng());
    let signer = Box::new(Secp256k1Signer::new(&signing_key.to_bytes())?);
    let mut provider = CryptoProvider::default();
    provider.signer.set_signer(signer);

    let att_config = AttestationConfig::builder()
        .supported_signature_algs(Vec::from_iter(provider.signer.supported_algs()))
        .build()?;

    let mut builder = Attestation::builder(&att_config)
        .accept_request(output.request)?;
    builder
        .connection_info(connection_info)
        .server_ephemeral_key(server_ephemeral_key)
        .transcript_commitments(transcript_commitments);

    let attestation = builder.build(&provider)?;

    Ok((attestation, output.secrets))
}

fn base64_decode(s: &str) -> Result<Vec<u8>> {
    const TABLE: [u8; 128] = {
        let mut t = [255u8; 128];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 { t[chars[i] as usize] = i as u8; i += 1; }
        t
    };
    let bytes: Vec<u8> = s.bytes().filter(|&b| b != b'=' && b != b'\n' && b != b'\r').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut buf = [0u32; 4];
        for (i, &b) in chunk.iter().enumerate() {
            buf[i] = TABLE.get(b as usize).copied().unwrap_or(0) as u32;
        }
        let triple = (buf[0] << 18) | (buf[1] << 12) | (buf[2] << 6) | buf[3];
        out.push((triple >> 16) as u8);
        if chunk.len() > 2 { out.push((triple >> 8) as u8); }
        if chunk.len() > 3 { out.push(triple as u8); }
    }
    Ok(out)
}

/// Run the MPC-TLS prover over a futures AsyncRead+AsyncWrite stream (for WebSocket).
async fn run_prover_mpc_futures_stream<S: futures::AsyncRead + futures::AsyncWrite + Send + Unpin + 'static>(
    stream: S,
    host: &str,
    port: u16,
    path: &str,
    socks_proxy: Option<&str>,
    custom_headers: &[(String, String)],
    max_sent_data: usize,
    max_recv_data: usize,
) -> Result<ProverMpcOutput> {
    // Session::new expects futures AsyncRead+AsyncWrite
    let session = Session::new(stream);
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            TlsCommitConfig::builder()
                .protocol(
                    MpcTlsConfig::builder()
                        .max_sent_data(max_sent_data)
                        .max_recv_data(max_recv_data)
                        .build()?,
                )
                .build()?,
        )
        .await?;

    let target_tcp = connect_target(host, port, socks_proxy).await?;
    eprintln!("[tlsn-prove] Connected to {}:{}", host, port);

    let (tls_connection, prover_fut) = prover
        .connect(
            TlsClientConfig::builder()
                .server_name(ServerName::Dns(host.try_into()?))
                .root_store(tlsn::webpki::RootCertStore::mozilla())
                .build()?,
            target_tcp.compat(),
        )
        .await?;
    let tls_connection = TokioIo::new(tls_connection.compat());
    let prover_task = tokio::spawn(prover_fut);

    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(tls_connection).await?;
    tokio::spawn(connection);

    let mut request_builder = Request::builder()
        .uri(path)
        .header("Host", host)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity")
        .header("Connection", "close")
        .header("User-Agent", "anchr-tlsn-prover/0.1.0");
    for (k, v) in custom_headers {
        request_builder = request_builder.header(k.as_str(), v.as_str());
    }
    let request = request_builder.body(Empty::<Bytes>::new())?;

    eprintln!("[tlsn-prove] Sending HTTP request...");
    let response = request_sender.send_request(request).await?;
    eprintln!("[tlsn-prove] Response status: {}", response.status());

    let mut prover = prover_task.await??;

    let transcript = prover.transcript();
    let sent_len = transcript.sent().len();
    let recv_len = transcript.received().len();

    let mut builder = TranscriptCommitConfig::builder(transcript);
    builder.commit_sent(&(0..sent_len))?;
    builder.commit_recv(&(0..recv_len))?;
    let transcript_commit = builder.build()?;

    let mut req_builder = RequestConfig::builder();
    req_builder.transcript_commit(transcript_commit);
    let request_config = req_builder.build()?;

    let mut prove_builder = ProveConfig::builder(prover.transcript());
    if let Some(tc) = request_config.transcript_commit() {
        prove_builder.transcript_commit(tc.clone());
    }
    let disclosure_config = prove_builder.build()?;

    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&disclosure_config).await?;

    let transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    prover.close().await?;

    let mut att_builder = AttestationRequest::builder(&request_config);
    att_builder
        .server_name(ServerName::Dns(host.try_into()?))
        .handshake_data(HandshakeData {
            certs: tls_transcript.server_cert_chain().expect("cert chain").to_vec(),
            sig: tls_transcript.server_signature().expect("signature").clone(),
            binding: tls_transcript.certificate_binding().clone(),
        })
        .transcript(transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);

    let (request, secrets) = att_builder.build(&CryptoProvider::default())?;

    handle.close();
    driver_task.await??;

    Ok(ProverMpcOutput { request, secrets, request_config })
}

/// Run the MPC-TLS prover over any tokio AsyncRead+AsyncWrite stream (for TCP).
async fn run_prover_mpc_stream<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + Unpin + 'static>(
    stream: S,
    host: &str,
    port: u16,
    path: &str,
    socks_proxy: Option<&str>,
    custom_headers: &[(String, String)],
    max_sent_data: usize,
    max_recv_data: usize,
) -> Result<ProverMpcOutput> {
    use tokio_util::compat::TokioAsyncReadCompatExt;

    let session = Session::new(stream.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            TlsCommitConfig::builder()
                .protocol(
                    MpcTlsConfig::builder()
                        .max_sent_data(max_sent_data)
                        .max_recv_data(max_recv_data)
                        .build()?,
                )
                .build()?,
        )
        .await?;

    let target_tcp = connect_target(host, port, socks_proxy).await?;
    eprintln!("[tlsn-prove] Connected to {}:{}", host, port);

    let (tls_connection, prover_fut) = prover
        .connect(
            TlsClientConfig::builder()
                .server_name(ServerName::Dns(host.try_into()?))
                .root_store(tlsn::webpki::RootCertStore::mozilla())
                .build()?,
            target_tcp.compat(),
        )
        .await?;
    let tls_connection = TokioIo::new(tls_connection.compat());
    let prover_task = tokio::spawn(prover_fut);

    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(tls_connection).await?;
    tokio::spawn(connection);

    let mut request_builder = Request::builder()
        .uri(path)
        .header("Host", host)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity")
        .header("Connection", "close")
        .header("User-Agent", "anchr-tlsn-prover/0.1.0");
    for (k, v) in custom_headers {
        request_builder = request_builder.header(k.as_str(), v.as_str());
    }
    let request = request_builder.body(Empty::<Bytes>::new())?;

    eprintln!("[tlsn-prove] Sending HTTP request...");
    let response = request_sender.send_request(request).await?;
    eprintln!("[tlsn-prove] Response status: {}", response.status());

    let mut prover = prover_task.await??;

    let transcript = prover.transcript();
    let sent_len = transcript.sent().len();
    let recv_len = transcript.received().len();

    let mut builder = TranscriptCommitConfig::builder(transcript);
    builder.commit_sent(&(0..sent_len))?;
    builder.commit_recv(&(0..recv_len))?;
    let transcript_commit = builder.build()?;

    let mut req_builder = RequestConfig::builder();
    req_builder.transcript_commit(transcript_commit);
    let request_config = req_builder.build()?;

    let mut prove_builder = ProveConfig::builder(prover.transcript());
    if let Some(tc) = request_config.transcript_commit() {
        prove_builder.transcript_commit(tc.clone());
    }
    let disclosure_config = prove_builder.build()?;

    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&disclosure_config).await?;

    let transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    prover.close().await?;

    let mut att_builder = AttestationRequest::builder(&request_config);
    att_builder
        .server_name(ServerName::Dns(host.try_into()?))
        .handshake_data(HandshakeData {
            certs: tls_transcript.server_cert_chain().expect("cert chain").to_vec(),
            sig: tls_transcript.server_signature().expect("signature").clone(),
            binding: tls_transcript.certificate_binding().clone(),
        })
        .transcript(transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);

    let (request, secrets) = att_builder.build(&CryptoProvider::default())?;

    handle.close();
    driver_task.await??;

    Ok(ProverMpcOutput { request, secrets, request_config })
}

async fn run_with_remote_verifier(
    verifier_addr: &str,
    host: &str,
    port: u16,
    path: &str,
    socks_proxy: Option<&str>,
    custom_headers: &[(String, String)],
    max_sent_data: usize,
    max_recv_data: usize,
) -> Result<(Attestation, Secrets)> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Generate random session ID
    let session_id: [u8; 16] = rand::random();
    let sid_hex = hex::encode(&session_id[..8]);
    eprintln!("[tlsn-prove] Session ID: {}", sid_hex);

    // Connection 1: MPC Session
    let mut mpc_tcp = tokio::net::TcpStream::connect(verifier_addr).await?;
    mpc_tcp.write_all(&[b'M']).await?;
    mpc_tcp.write_all(&session_id).await?;
    mpc_tcp.flush().await?;

    eprintln!("[tlsn-prove] MPC connection established");

    // Run prover (MPC session) — no oneshot channels, we handle attestation over TCP
    let prover_output = run_prover_mpc(mpc_tcp, host, port, path, socks_proxy, custom_headers, max_sent_data, max_recv_data).await?;

    eprintln!("[tlsn-prove] MPC complete, requesting attestation...");

    // Connection 2: Attestation exchange
    let mut att_tcp = tokio::net::TcpStream::connect(verifier_addr).await?;
    att_tcp.write_all(&[b'A']).await?;
    att_tcp.write_all(&session_id).await?;

    // Send AttestationRequest
    let req_bytes = bincode::serialize(&prover_output.request)?;
    att_tcp.write_all(&(req_bytes.len() as u32).to_be_bytes()).await?;
    att_tcp.write_all(&req_bytes).await?;
    att_tcp.flush().await?;

    // Receive Attestation
    let mut len_buf = [0u8; 4];
    att_tcp.read_exact(&mut len_buf).await?;
    let att_len = u32::from_be_bytes(len_buf) as usize;
    let mut att_buf = vec![0u8; att_len];
    att_tcp.read_exact(&mut att_buf).await?;
    let attestation: Attestation = bincode::deserialize(&att_buf)?;

    // Validate
    let provider = CryptoProvider::default();
    prover_output.request.validate(&attestation, &provider)?;

    eprintln!("[tlsn-prove] Attestation received and validated");

    Ok((attestation, prover_output.secrets))
}

/// Output of the prover MPC phase (before attestation exchange).
struct ProverMpcOutput {
    request: AttestationRequest,
    secrets: Secrets,
    request_config: RequestConfig,
}

async fn run_prover_mpc(
    tcp: tokio::net::TcpStream,
    host: &str,
    port: u16,
    path: &str,
    socks_proxy: Option<&str>,
    custom_headers: &[(String, String)],
    max_sent_data: usize,
    max_recv_data: usize,
) -> Result<ProverMpcOutput> {
    let session = Session::new(tcp.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            TlsCommitConfig::builder()
                .protocol(
                    MpcTlsConfig::builder()
                        .max_sent_data(max_sent_data)
                        .max_recv_data(max_recv_data)
                        .build()?,
                )
                .build()?,
        )
        .await?;

    let target_tcp = connect_target(host, port, socks_proxy).await?;
    eprintln!("[tlsn-prove] Connected to {}:{}", host, port);

    let (tls_connection, prover_fut) = prover
        .connect(
            TlsClientConfig::builder()
                .server_name(ServerName::Dns(host.try_into()?))
                .root_store(tlsn::webpki::RootCertStore::mozilla())
                .build()?,
            target_tcp.compat(),
        )
        .await?;
    let tls_connection = TokioIo::new(tls_connection.compat());
    let prover_task = tokio::spawn(prover_fut);

    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(tls_connection).await?;
    tokio::spawn(connection);

    let mut request_builder = Request::builder()
        .uri(path)
        .header("Host", host)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity")
        .header("Connection", "close")
        .header("User-Agent", "anchr-tlsn-prover/0.1.0");
    for (k, v) in custom_headers {
        request_builder = request_builder.header(k.as_str(), v.as_str());
    }
    let request = request_builder.body(Empty::<Bytes>::new())?;

    eprintln!("[tlsn-prove] Sending HTTP request...");
    let response = request_sender.send_request(request).await?;
    eprintln!("[tlsn-prove] Response status: {}", response.status());

    let mut prover = prover_task.await??;

    // Configure commits
    let transcript = prover.transcript();
    let sent_len = transcript.sent().len();
    let recv_len = transcript.received().len();

    let mut builder = TranscriptCommitConfig::builder(transcript);
    builder.commit_sent(&(0..sent_len))?;
    builder.commit_recv(&(0..recv_len))?;
    let transcript_commit = builder.build()?;

    let mut req_builder = RequestConfig::builder();
    req_builder.transcript_commit(transcript_commit);
    let request_config = req_builder.build()?;

    // Prove phase
    let mut prove_builder = ProveConfig::builder(prover.transcript());
    if let Some(tc) = request_config.transcript_commit() {
        prove_builder.transcript_commit(tc.clone());
    }
    let disclosure_config = prove_builder.build()?;

    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&disclosure_config).await?;

    let transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    prover.close().await?;

    // Build attestation request
    let mut att_builder = AttestationRequest::builder(&request_config);
    att_builder
        .server_name(ServerName::Dns(host.try_into()?))
        .handshake_data(HandshakeData {
            certs: tls_transcript.server_cert_chain().expect("cert chain").to_vec(),
            sig: tls_transcript.server_signature().expect("signature").clone(),
            binding: tls_transcript.certificate_binding().clone(),
        })
        .transcript(transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);

    let (request, secrets) = att_builder.build(&CryptoProvider::default())?;

    handle.close();
    driver_task.await??;

    Ok(ProverMpcOutput { request, secrets, request_config })
}

fn base64_encode(data: &[u8]) -> String {
    use std::fmt::Write;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

async fn run_prover<S: AsyncWrite + AsyncRead + Send + Sync + Unpin + 'static>(
    socket: S,
    req_tx: oneshot::Sender<AttestationRequest>,
    resp_rx: oneshot::Receiver<Attestation>,
    host: &str,
    port: u16,
    path: &str,
    socks_proxy: Option<&str>,
    custom_headers: &[(String, String)],
    max_sent_data: usize,
    max_recv_data: usize,
) -> Result<(Attestation, Secrets)> {
    let session = Session::new(socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            TlsCommitConfig::builder()
                .protocol(
                    MpcTlsConfig::builder()
                        .max_sent_data(max_sent_data)
                        .max_recv_data(max_recv_data)
                        .build()?,
                )
                .build()?,
        )
        .await?;

    // Connect to the real target server
    let tcp = connect_target(host, port, socks_proxy).await?;
    eprintln!("[tlsn-prove] Connected to {}:{}", host, port);

    let (tls_connection, prover_fut) = prover
        .connect(
            TlsClientConfig::builder()
                .server_name(ServerName::Dns(host.try_into()?))
                .root_store(tlsn::webpki::RootCertStore::mozilla())
                .build()?,
            tcp.compat(),
        )
        .await?;
    let tls_connection = TokioIo::new(tls_connection.compat());
    let prover_task = tokio::spawn(prover_fut);

    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(tls_connection).await?;
    tokio::spawn(connection);

    let mut request_builder = Request::builder()
        .uri(path)
        .header("Host", host)
        .header("Accept", "application/json")
        .header("Accept-Encoding", "identity")
        .header("Connection", "close")
        .header("User-Agent", "anchr-tlsn-prover/0.1.0");
    for (k, v) in custom_headers {
        request_builder = request_builder.header(k.as_str(), v.as_str());
    }
    let request = request_builder.body(Empty::<Bytes>::new())?;

    eprintln!("[tlsn-prove] Sending HTTP request...");
    let response = request_sender.send_request(request).await?;
    eprintln!("[tlsn-prove] Response status: {}", response.status());

    let prover = prover_task.await??;

    // Configure transcript commits (reveal all sent/received data)
    let transcript = prover.transcript();
    let sent_len = transcript.sent().len();
    let recv_len = transcript.received().len();

    let mut builder = TranscriptCommitConfig::builder(transcript);
    builder.commit_sent(&(0..sent_len))?;
    builder.commit_recv(&(0..recv_len))?;
    let transcript_commit = builder.build()?;

    let mut builder = RequestConfig::builder();
    builder.transcript_commit(transcript_commit);
    let request_config = builder.build()?;

    // Run attestation protocol
    let (attestation, secrets) = attestation_protocol(prover, &request_config, host, req_tx, resp_rx).await?;

    handle.close();
    driver_task.await??;

    Ok((attestation, secrets))
}

async fn attestation_protocol(
    mut prover: Prover<Committed>,
    config: &RequestConfig,
    host: &str,
    request_tx: oneshot::Sender<AttestationRequest>,
    attestation_rx: oneshot::Receiver<Attestation>,
) -> Result<(Attestation, Secrets)> {
    let mut builder = ProveConfig::builder(prover.transcript());
    if let Some(config) = config.transcript_commit() {
        builder.transcript_commit(config.clone());
    }
    let disclosure_config = builder.build()?;

    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&disclosure_config).await?;

    let transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    prover.close().await?;

    let mut builder = AttestationRequest::builder(config);
    builder
        .server_name(ServerName::Dns(host.try_into()?))
        .handshake_data(HandshakeData {
            certs: tls_transcript
                .server_cert_chain()
                .expect("server cert chain")
                .to_vec(),
            sig: tls_transcript
                .server_signature()
                .expect("server signature")
                .clone(),
            binding: tls_transcript.certificate_binding().clone(),
        })
        .transcript(transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);

    let (request, secrets) = builder.build(&CryptoProvider::default())?;

    request_tx
        .send(request.clone())
        .map_err(|_| anyhow!("verifier not receiving"))?;

    let attestation = attestation_rx
        .await
        .map_err(|e| anyhow!("verifier did not respond: {e}"))?;

    let provider = CryptoProvider::default();
    request.validate(&attestation, &provider)?;

    eprintln!("[tlsn-prove] Attestation received and validated");

    Ok((attestation, secrets))
}

async fn run_verifier<S: AsyncWrite + AsyncRead + Send + Sync + Unpin + 'static>(
    socket: S,
    request_rx: oneshot::Receiver<AttestationRequest>,
    attestation_tx: oneshot::Sender<Attestation>,
    _host: &str,
) -> Result<()> {
    let session = Session::new(socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);

    let verifier = handle
        .new_verifier(VerifierConfig::builder()
            .root_store(tlsn::webpki::RootCertStore::mozilla())
            .build()?)?
        .commit()
        .await?
        .accept()
        .await?
        .run()
        .await?;

    let (
        VerifierOutput {
            transcript_commitments,
            ..
        },
        verifier,
    ) = verifier.verify().await?.accept().await?;

    let tls_transcript = verifier.tls_transcript().clone();
    verifier.close().await?;

    let sent_len = tls_transcript
        .sent()
        .iter()
        .filter_map(|r| {
            if let ContentType::ApplicationData = r.typ { Some(r.ciphertext.len()) } else { None }
        })
        .sum::<usize>();
    let recv_len = tls_transcript
        .recv()
        .iter()
        .filter_map(|r| {
            if let ContentType::ApplicationData = r.typ { Some(r.ciphertext.len()) } else { None }
        })
        .sum::<usize>();

    let request = request_rx.await?;

    // Generate a signing key for the attestation
    let signing_key = k256::ecdsa::SigningKey::random(&mut rand::thread_rng());
    let signer = Box::new(Secp256k1Signer::new(&signing_key.to_bytes())?);
    let mut provider = CryptoProvider::default();
    provider.signer.set_signer(signer);

    let att_config = AttestationConfig::builder()
        .supported_signature_algs(Vec::from_iter(provider.signer.supported_algs()))
        .build()?;

    let mut builder = Attestation::builder(&att_config).accept_request(request)?;
    builder
        .connection_info(ConnectionInfo {
            time: tls_transcript.time(),
            version: *tls_transcript.version(),
            transcript_length: TranscriptLength {
                sent: sent_len as u32,
                received: recv_len as u32,
            },
        })
        .server_ephemeral_key(tls_transcript.server_ephemeral_key().clone())
        .transcript_commitments(transcript_commitments);

    let attestation = builder.build(&provider)?;

    attestation_tx
        .send(attestation)
        .map_err(|_| anyhow!("prover not receiving attestation"))?;

    handle.close();
    driver_task.await??;

    Ok(())
}

fn build_presentation(attestation: Attestation, secrets: Secrets) -> Result<Presentation> {
    let transcript = secrets.transcript();
    let sent_len = transcript.sent().len();
    let recv_len = transcript.received().len();

    let mut builder = secrets.transcript_proof_builder();

    // Reveal all sent and received data
    builder.reveal_sent(&(0..sent_len))?;
    builder.reveal_recv(&(0..recv_len))?;

    let transcript_proof = builder.build()?;

    let provider = CryptoProvider::default();
    let mut builder = attestation.presentation_builder(&provider);
    builder
        .identity_proof(secrets.identity_proof())
        .transcript_proof(transcript_proof);

    let presentation = builder.build()?;
    Ok(presentation)
}
