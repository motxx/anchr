//! TLSNotary Verifier Server — accepts MPC-TLS sessions and signs attestations.
//!
//! Protocol: two TCP connections per session.
//! Connection 1 (cmd='M'): 1-byte cmd + 16-byte session_id, then MPC-TLS Session runs.
//! Connection 2 (cmd='A'): 1-byte cmd + 16-byte session_id + length-prefixed
//!   bincode(AttestationRequest), server responds with length-prefixed bincode(Attestation).

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use clap::Parser;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
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
    #[arg(short, long, default_value = "7047")]
    port: u16,
}

/// State stored between the MPC connection and the attestation connection.
struct SessionState {
    verifier_output: VerifierOutput,
    connection_info: ConnectionInfo,
    server_ephemeral_key: Vec<u8>,  // serialized
    tls_transcript_data: TlsTranscriptData,
}

struct TlsTranscriptData {
    time: u64,
    version: tlsn::connection::TlsVersion,
    sent_app_len: u32,
    recv_app_len: u32,
}

type Store = Arc<Mutex<HashMap<[u8; 16], SessionState>>>;

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let listener = TcpListener::bind(("0.0.0.0", cli.port)).await?;
    let store: Store = Arc::new(Mutex::new(HashMap::new()));

    eprintln!("[tlsn-server] Listening on 0.0.0.0:{}", cli.port);

    loop {
        let (tcp, addr) = listener.accept().await?;
        let store = store.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(tcp, store).await {
                eprintln!("[tlsn-server] Error ({}): {:#}", addr, e);
            }
        });
    }
}

async fn handle(mut tcp: tokio::net::TcpStream, store: Store) -> Result<()> {
    let mut cmd = [0u8; 1];
    tcp.read_exact(&mut cmd).await?;
    let mut sid = [0u8; 16];
    tcp.read_exact(&mut sid).await?;
    let sid_hex = hex::encode(&sid[..8]);

    match cmd[0] {
        b'M' => {
            eprintln!("[tlsn-server] MPC session {} starting", sid_hex);
            handle_mpc(tcp, sid, store).await?;
            eprintln!("[tlsn-server] MPC session {} complete", sid_hex);
        }
        b'A' => {
            eprintln!("[tlsn-server] Attest request for {}", sid_hex);
            handle_attest(tcp, sid, store).await?;
            eprintln!("[tlsn-server] Attestation {} signed", sid_hex);
        }
        _ => return Err(anyhow!("Unknown command: {}", cmd[0])),
    }
    Ok(())
}

async fn handle_mpc(tcp: tokio::net::TcpStream, sid: [u8; 16], store: Store) -> Result<()> {
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
        tls_transcript_data: TlsTranscriptData {
            time: tls_tx.time(),
            version: *tls_tx.version(),
            sent_app_len: sent_len as u32,
            recv_app_len: recv_len as u32,
        },
    };

    store.lock().await.insert(sid, state);

    handle.close();
    driver_task.await??;
    Ok(())
}

async fn handle_attest(mut tcp: tokio::net::TcpStream, sid: [u8; 16], store: Store) -> Result<()> {
    // Read length-prefixed AttestationRequest
    let mut len_buf = [0u8; 4];
    tcp.read_exact(&mut len_buf).await?;
    let req_len = u32::from_be_bytes(len_buf) as usize;
    let mut req_buf = vec![0u8; req_len];
    tcp.read_exact(&mut req_buf).await?;

    let request: AttestationRequest = bincode::deserialize(&req_buf)?;

    // Wait for MPC session to complete and store state (with timeout)
    let state = {
        let mut attempts = 0;
        loop {
            if let Some(s) = store.lock().await.remove(&sid) {
                break s;
            }
            attempts += 1;
            if attempts > 50 {
                return Err(anyhow!("Timeout waiting for MPC session to complete"));
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    };

    // Sign with random key
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
