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
    // Handle chunked Transfer-Encoding by stripping chunk framing
    let revealed_body = revealed_recv.as_ref().and_then(|recv| {
        recv.find("\r\n\r\n").map(|idx| {
            let raw_body = &recv[idx + 4..];
            decode_chunked_body(raw_body).unwrap_or_else(|| raw_body.to_string())
        })
    });

    // Extract HTTP response headers
    let revealed_headers = revealed_recv.as_ref().and_then(|recv| {
        recv.find("\r\n\r\n").map(|idx| recv[..idx].to_string())
    });

    // Also strip chunked framing from revealed_headers if present
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

/// Decode HTTP chunked transfer encoding.
/// Input: "19\r\n{...json...}\r\n0\r\n\r\n"
/// Output: "{...json...}"
fn decode_chunked_body(raw: &str) -> Option<String> {
    let mut result = String::new();
    let mut remaining = raw;

    loop {
        // Find chunk size line
        let crlf_pos = remaining.find("\r\n")?;
        let size_str = remaining[..crlf_pos].trim();
        let chunk_size = usize::from_str_radix(size_str, 16).ok()?;

        if chunk_size == 0 {
            break; // final chunk
        }

        let data_start = crlf_pos + 2;
        if data_start + chunk_size > remaining.len() {
            return None; // truncated
        }

        result.push_str(&remaining[data_start..data_start + chunk_size]);

        // Skip past chunk data + \r\n
        let next_start = data_start + chunk_size + 2;
        if next_start > remaining.len() {
            break;
        }
        remaining = &remaining[next_start..];
    }

    Some(result)
}
