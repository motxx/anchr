use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use frost_secp256k1_tr as frost;
use rand::thread_rng;
use serde_json::json;
use std::collections::BTreeMap;

#[derive(Parser)]
#[command(name = "frost-signer", about = "FROST threshold signing sidecar (BIP-340 Schnorr)")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// DKG round 1: generate secret package and public package
    DkgRound1 {
        /// Participant index (1-based)
        #[arg(long)]
        index: u16,
        /// Maximum number of signers
        #[arg(long)]
        max_signers: u16,
        /// Minimum number of signers (threshold)
        #[arg(long)]
        min_signers: u16,
    },
    /// DKG round 2: process round 1 packages
    DkgRound2 {
        /// Secret package from round 1 (JSON)
        #[arg(long)]
        secret_package: String,
        /// Map of round 1 packages from other participants (JSON)
        #[arg(long)]
        round1_packages: String,
    },
    /// DKG round 3: finalize key generation
    DkgRound3 {
        /// Secret package from round 2 (JSON)
        #[arg(long)]
        round2_secret_package: String,
        /// Map of round 1 packages from all other participants (JSON)
        #[arg(long)]
        round1_packages: String,
        /// Map of round 2 packages from all other participants (JSON)
        #[arg(long)]
        round2_packages: String,
    },
    /// Signing round 1: generate nonces and commitments
    SignRound1 {
        /// Key package from DKG (JSON)
        #[arg(long)]
        key_package: String,
    },
    /// Signing round 2: produce signature share
    SignRound2 {
        /// Key package from DKG (JSON)
        #[arg(long)]
        key_package: String,
        /// Signing nonces from round 1 (JSON)
        #[arg(long)]
        nonces: String,
        /// Map of signing commitments from all participating signers (JSON: {Identifier: SigningCommitments})
        #[arg(long)]
        commitments: String,
        /// Message to sign (hex-encoded bytes)
        #[arg(long)]
        message: String,
    },
    /// Aggregate signature shares into a final BIP-340 Schnorr signature
    Aggregate {
        /// Group public key (32-byte hex, BIP-340 x-only)
        #[arg(long)]
        group_pubkey: String,
        /// Map of signing commitments (JSON: {Identifier: SigningCommitments})
        #[arg(long)]
        commitments: String,
        /// Message (hex-encoded bytes)
        #[arg(long)]
        message: String,
        /// Map of signature shares (JSON: {Identifier: SignatureShare})
        #[arg(long)]
        signature_shares: String,
        /// Public key package from DKG (JSON)
        #[arg(long)]
        pubkey_package: String,
    },
    /// Verify a BIP-340 Schnorr signature against a group public key
    Verify {
        /// Group public key (32-byte hex, BIP-340 x-only)
        #[arg(long)]
        group_pubkey: String,
        /// Signature (64-byte hex, BIP-340 Schnorr)
        #[arg(long)]
        signature: String,
        /// Message (hex-encoded bytes)
        #[arg(long)]
        message: String,
    },
}

fn main() {
    let cli = Cli::parse();
    match run(cli) {
        Ok(output) => {
            println!("{}", serde_json::to_string(&output).unwrap());
        }
        Err(e) => {
            let output = json!({
                "error": format!("{:#}", e),
            });
            println!("{}", serde_json::to_string(&output).unwrap());
            std::process::exit(1);
        }
    }
}

fn run(cli: Cli) -> Result<serde_json::Value> {
    match cli.command {
        Command::DkgRound1 {
            index,
            max_signers,
            min_signers,
        } => dkg_round1(index, max_signers, min_signers),
        Command::DkgRound2 {
            secret_package,
            round1_packages,
        } => dkg_round2(&secret_package, &round1_packages),
        Command::DkgRound3 {
            round2_secret_package,
            round1_packages,
            round2_packages,
        } => dkg_round3(&round2_secret_package, &round1_packages, &round2_packages),
        Command::SignRound1 { key_package } => sign_round1(&key_package),
        Command::SignRound2 {
            key_package,
            nonces,
            commitments,
            message,
        } => sign_round2(&key_package, &nonces, &commitments, &message),
        Command::Aggregate {
            group_pubkey: _,
            commitments,
            message,
            signature_shares,
            pubkey_package,
        } => aggregate(&commitments, &message, &signature_shares, &pubkey_package),
        Command::Verify {
            group_pubkey,
            signature,
            message,
        } => verify(&group_pubkey, &signature, &message),
    }
}

// ---------------------------------------------------------------------------
// DKG
// ---------------------------------------------------------------------------

fn dkg_round1(index: u16, max_signers: u16, min_signers: u16) -> Result<serde_json::Value> {
    let mut rng = thread_rng();
    let identifier = frost::Identifier::try_from(index)
        .context("invalid participant index")?;

    let (secret_package, package) =
        frost::keys::dkg::part1(identifier, max_signers, min_signers, &mut rng)
            .context("DKG round 1 failed")?;

    let secret_json = serde_json::to_value(&secret_package)
        .context("failed to serialize secret package")?;
    let package_json = serde_json::to_value(&package)
        .context("failed to serialize round1 package")?;

    Ok(json!({
        "secret_package": secret_json,
        "package": package_json,
    }))
}

fn dkg_round2(secret_package_str: &str, round1_packages_str: &str) -> Result<serde_json::Value> {
    let secret_package: frost::keys::dkg::round1::SecretPackage =
        serde_json::from_str(secret_package_str)
            .context("failed to parse secret_package JSON")?;

    let round1_packages: BTreeMap<frost::Identifier, frost::keys::dkg::round1::Package> =
        serde_json::from_str(round1_packages_str)
            .context("failed to parse round1_packages JSON")?;

    let (round2_secret, round2_packages) =
        frost::keys::dkg::part2(secret_package, &round1_packages)
            .context("DKG round 2 failed")?;

    let secret_json = serde_json::to_value(&round2_secret)
        .context("failed to serialize round2 secret package")?;
    let packages_json = serde_json::to_value(&round2_packages)
        .context("failed to serialize round2 packages")?;

    Ok(json!({
        "secret_package": secret_json,
        "packages": packages_json,
    }))
}

fn dkg_round3(
    round2_secret_str: &str,
    round1_packages_str: &str,
    round2_packages_str: &str,
) -> Result<serde_json::Value> {
    let round2_secret: frost::keys::dkg::round2::SecretPackage =
        serde_json::from_str(round2_secret_str)
            .context("failed to parse round2_secret_package JSON")?;

    let round1_packages: BTreeMap<frost::Identifier, frost::keys::dkg::round1::Package> =
        serde_json::from_str(round1_packages_str)
            .context("failed to parse round1_packages JSON")?;

    let round2_packages: BTreeMap<frost::Identifier, frost::keys::dkg::round2::Package> =
        serde_json::from_str(round2_packages_str)
            .context("failed to parse round2_packages JSON")?;

    let (key_package, pubkey_package) =
        frost::keys::dkg::part3(&round2_secret, &round1_packages, &round2_packages)
            .context("DKG round 3 failed")?;

    let verifying_key = pubkey_package.verifying_key();
    let vk_bytes = verifying_key.serialize()
        .context("failed to serialize verifying key")?;
    // BIP-340 x-only: if 33 bytes (compressed), drop prefix; if 32 bytes, use as-is
    let group_pubkey_hex = if vk_bytes.len() == 33 {
        hex::encode(&vk_bytes[1..])
    } else {
        hex::encode(&vk_bytes)
    };

    let key_json = serde_json::to_value(&key_package)
        .context("failed to serialize key package")?;
    let pubkey_json = serde_json::to_value(&pubkey_package)
        .context("failed to serialize pubkey package")?;

    Ok(json!({
        "key_package": key_json,
        "pubkey_package": pubkey_json,
        "group_pubkey": group_pubkey_hex,
    }))
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

fn sign_round1(key_package_str: &str) -> Result<serde_json::Value> {
    let mut rng = thread_rng();
    let key_package: frost::keys::KeyPackage =
        serde_json::from_str(key_package_str)
            .context("failed to parse key_package JSON")?;

    let (nonces, commitments) =
        frost::round1::commit(key_package.signing_share(), &mut rng);

    let nonces_json = serde_json::to_value(&nonces)
        .context("failed to serialize nonces")?;
    let commitments_json = serde_json::to_value(&commitments)
        .context("failed to serialize commitments")?;

    Ok(json!({
        "nonces": nonces_json,
        "commitments": commitments_json,
    }))
}

fn build_signing_package(
    commitments_str: &str,
    message_hex: &str,
) -> Result<frost::SigningPackage> {
    let commitments: BTreeMap<frost::Identifier, frost::round1::SigningCommitments> =
        serde_json::from_str(commitments_str)
            .context("failed to parse commitments JSON")?;

    let message = hex::decode(message_hex)
        .context("invalid message hex")?;

    Ok(frost::SigningPackage::new(commitments, &message))
}

fn sign_round2(
    key_package_str: &str,
    nonces_str: &str,
    commitments_str: &str,
    message_hex: &str,
) -> Result<serde_json::Value> {
    let key_package: frost::keys::KeyPackage =
        serde_json::from_str(key_package_str)
            .context("failed to parse key_package JSON")?;

    let nonces: frost::round1::SigningNonces =
        serde_json::from_str(nonces_str)
            .context("failed to parse nonces JSON")?;

    let signing_package = build_signing_package(commitments_str, message_hex)?;

    let signature_share = frost::round2::sign(&signing_package, &nonces, &key_package)
        .context("signing round 2 failed")?;

    let share_json = serde_json::to_value(&signature_share)
        .context("failed to serialize signature share")?;

    Ok(json!({
        "signature_share": share_json,
    }))
}

fn aggregate(
    commitments_str: &str,
    message_hex: &str,
    signature_shares_str: &str,
    pubkey_package_str: &str,
) -> Result<serde_json::Value> {
    let signing_package = build_signing_package(commitments_str, message_hex)?;

    let shares: BTreeMap<frost::Identifier, frost::round2::SignatureShare> =
        serde_json::from_str(signature_shares_str)
            .context("failed to parse signature_shares JSON")?;

    let pubkey_package: frost::keys::PublicKeyPackage =
        serde_json::from_str(pubkey_package_str)
            .context("failed to parse pubkey_package JSON")?;

    let signature = frost::aggregate(&signing_package, &shares, &pubkey_package)
        .context("signature aggregation failed")?;

    let sig_bytes = signature.serialize()
        .context("failed to serialize signature")?;
    let signature_hex = hex::encode(sig_bytes);

    Ok(json!({
        "signature": signature_hex,
    }))
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

fn verify(group_pubkey_hex: &str, signature_hex: &str, message_hex: &str) -> Result<serde_json::Value> {
    let pubkey_bytes = hex::decode(group_pubkey_hex)
        .context("invalid group_pubkey hex")?;
    let sig_bytes = hex::decode(signature_hex)
        .context("invalid signature hex")?;
    let message = hex::decode(message_hex)
        .context("invalid message hex")?;

    // Accept both 32-byte x-only (BIP-340) and 33-byte SEC1 compressed pubkeys.
    // For 32-byte x-only, prepend 0x02 (even y) to form SEC1 compressed format.
    let pubkey_sec1 = if pubkey_bytes.len() == 32 {
        let mut buf = vec![0x02u8];
        buf.extend_from_slice(&pubkey_bytes);
        buf
    } else {
        pubkey_bytes
    };

    let verifying_key = frost::VerifyingKey::deserialize(&pubkey_sec1)
        .context("failed to deserialize verifying key")?;

    let signature = frost::Signature::deserialize(&sig_bytes)
        .context("failed to deserialize signature")?;

    match verifying_key.verify(&message, &signature) {
        Ok(()) => Ok(json!({ "valid": true })),
        Err(_) => Ok(json!({ "valid": false })),
    }
}
