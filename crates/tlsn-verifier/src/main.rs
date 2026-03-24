use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde_json::json;
use std::path::PathBuf;
use tlsn_attestation::presentation::{Presentation, PresentationOutput};

#[derive(Parser)]
#[command(name = "tlsn-verifier", about = "Verify TLSNotary presentation files")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Verify a .presentation.tlsn file and output JSON result
    Verify {
        /// Path to the presentation file
        path: PathBuf,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Verify { path } => {
            match verify_presentation(&path) {
                Ok(output) => {
                    println!("{}", serde_json::to_string(&output).unwrap());
                }
                Err(e) => {
                    let output = json!({
                        "valid": false,
                        "server_name": null,
                        "time": null,
                        "revealed_sent": null,
                        "revealed_recv": null,
                        "error": format!("{:#}", e),
                    });
                    println!("{}", serde_json::to_string(&output).unwrap());
                    std::process::exit(1);
                }
            }
        }
    }
}

fn verify_presentation(path: &PathBuf) -> Result<serde_json::Value> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("Failed to read {}", path.display()))?;

    let presentation: Presentation = bincode::deserialize(&bytes)
        .context("Failed to deserialize presentation (expected bincode format)")?;

    let provider = tlsn_attestation::CryptoProvider::default();

    let PresentationOutput {
        server_name,
        connection_info,
        transcript,
        ..
    } = presentation
        .verify(&provider)
        .map_err(|e| anyhow::anyhow!("Verification failed: {}", e))?;

    let server_name_str: Option<String> = server_name.map(|s| format!("{}", s));

    let time = connection_info.time;

    let (revealed_sent, revealed_recv) = match transcript {
        Some(mut partial) => {
            partial.set_unauthed(0u8);
            let sent = String::from_utf8_lossy(partial.sent_unsafe()).to_string();
            let recv = String::from_utf8_lossy(partial.received_unsafe()).to_string();
            (Some(sent), Some(recv))
        }
        None => (None, None),
    };

    // Extract HTTP response body from revealed_recv (after \r\n\r\n)
    let revealed_body = revealed_recv.as_ref().and_then(|recv| {
        recv.find("\r\n\r\n").map(|idx| recv[idx + 4..].to_string())
    });

    // Extract HTTP response headers
    let revealed_headers = revealed_recv.as_ref().and_then(|recv| {
        recv.find("\r\n\r\n").map(|idx| recv[..idx].to_string())
    });

    Ok(json!({
        "valid": true,
        "server_name": server_name_str,
        "time": time,
        "revealed_body": revealed_body,
        "revealed_headers": revealed_headers,
        "revealed_sent": revealed_sent,
        "revealed_recv": revealed_recv,
        "error": null,
    }))
}
