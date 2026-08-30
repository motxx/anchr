use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde_json::json;
use std::path::PathBuf;
use tlsn_attestation::presentation::{Presentation, PresentationOutput};
use tlsn_attestation::signing::{KeyAlgId, VerifyingKey};

const NOTARY_PUBLIC_KEY_ENV: &str = "ANCHR_TLSN_NOTARY_PUBLIC_KEY_HEX";

fn parse_pinned_notary_key(encoded: &str) -> Result<Vec<u8>> {
    let bytes = hex::decode(encoded.trim())
        .with_context(|| format!("{NOTARY_PUBLIC_KEY_ENV} must be hex encoded"))?;
    let key = k256::ecdsa::VerifyingKey::from_sec1_bytes(&bytes)
        .with_context(|| format!("{NOTARY_PUBLIC_KEY_ENV} must encode a valid secp256k1 public key"))?;
    Ok(key.to_encoded_point(true).as_bytes().to_vec())
}

fn load_pinned_notary_key() -> Result<Vec<u8>> {
    let encoded = std::env::var(NOTARY_PUBLIC_KEY_ENV)
        .with_context(|| format!("{NOTARY_PUBLIC_KEY_ENV} must contain the pinned notary public key"))?;
    parse_pinned_notary_key(&encoded)
}

fn ensure_pinned_notary_key(actual: &VerifyingKey, expected: &[u8]) -> Result<()> {
    if actual.alg != KeyAlgId::K256 || actual.data != expected {
        anyhow::bail!("Notary key mismatch: presentation was not signed by the configured notary");
    }
    Ok(())
}

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

    let pinned_notary_key = load_pinned_notary_key()?;
    ensure_pinned_notary_key(presentation.verifying_key(), &pinned_notary_key)?;

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
            let sent = render_with_redaction(partial.sent_unsafe());
            let recv = render_with_redaction(partial.received_unsafe());
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

/// Render transcript bytes, replacing runs of \0 (unauthed/redacted bytes) with [REDACTED].
/// This preserves the cryptographic proof — redacted regions are still committed to
/// but their content is not revealed in the presentation.
fn render_with_redaction(bytes: &[u8]) -> String {
    let mut result = String::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0 {
            // Find end of redacted run
            while i < bytes.len() && bytes[i] == 0 {
                i += 1;
            }
            result.push_str("[REDACTED]");
        } else {
            // Find end of non-redacted run
            let start_idx = i;
            while i < bytes.len() && bytes[i] != 0 {
                i += 1;
            }
            result.push_str(&String::from_utf8_lossy(&bytes[start_idx..i]));
        }
    }
    result
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

#[cfg(test)]
mod tests {
    use super::*;

    const PINNED_KEY: &str =
        "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const OTHER_KEY: &str =
        "0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    fn attestation_key(encoded: &str) -> VerifyingKey {
        VerifyingKey {
            alg: KeyAlgId::K256,
            data: parse_pinned_notary_key(encoded).expect("test key is valid"),
        }
    }

    #[test]
    fn accepts_the_pinned_notary_key() {
        let expected = parse_pinned_notary_key(PINNED_KEY).expect("test key is valid");
        ensure_pinned_notary_key(&attestation_key(PINNED_KEY), &expected)
            .expect("pinned key must be accepted");
    }

    #[test]
    fn rejects_a_non_pinned_notary_key_with_a_distinct_error() {
        let expected = parse_pinned_notary_key(PINNED_KEY).expect("test key is valid");
        let error = ensure_pinned_notary_key(&attestation_key(OTHER_KEY), &expected)
            .expect_err("another notary key must be rejected");
        assert!(error.to_string().contains("Notary key mismatch"));
    }
}
