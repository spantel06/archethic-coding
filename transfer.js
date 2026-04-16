/**
 * Transfert de 10 UCO sur le testnet Archethic
 *
 * Usage:
 *   SEED=<votre_seed> node transfer.js <adresse_destinataire>
 *   node transfer.js <adresse_destinataire>   (seed aléatoire généré)
 *
 * Étapes :
 *   1. Dériver l'adresse expéditeur depuis la seed
 *   2. Demander des UCO au faucet testnet
 *   3. Attendre que les fonds arrivent
 *   4. Envoyer 10 UCO à l'adresse destinataire
 */

import Archethic, { Crypto, Utils } from "@archethicjs/sdk";
import { randomBytes } from "crypto";

const TESTNET_URL = "https://testnet.archethic.net";
const FAUCET_URL  = `${TESTNET_URL}/faucet`;
const AMOUNT_UCO  = 10;

// 1 UCO = 100_000_000 unités de base
const AMOUNT_RAW  = BigInt(AMOUNT_UCO) * 100_000_000n;

// ─── Utilitaires ────────────────────────────────────────────────────────────

function generateSeed() {
  return randomBytes(32).toString("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toHex(addressBytes) {
  return Utils.uint8ArrayToHex(addressBytes);
}

// ─── Faucet ─────────────────────────────────────────────────────────────────

async function requestFaucet(addressHex) {
  console.log(`\n[Faucet] Demande d'UCO pour ${addressHex} ...`);
  console.log(`[Faucet] URL : ${FAUCET_URL}`);

  const response = await fetch(FAUCET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: TESTNET_URL,
      Referer: `${FAUCET_URL}`,
    },
    body: new URLSearchParams({ address: addressHex }).toString(),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Faucet HTTP ${response.status}: ${body}`);
  }

  console.log("[Faucet] Requête envoyée avec succès.");
}

// ─── Attente des fonds ───────────────────────────────────────────────────────

async function waitForBalance(archethic, addressHex, minRaw, timeoutMs = 120_000) {
  console.log("\n[Balance] Attente des fonds ...");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { uco } = await archethic.network.getBalance(addressHex);
    // `uco` est renvoyé en unités de base par l'API GraphQL
    if (BigInt(uco) >= minRaw) {
      console.log(`\n[Balance] Solde confirmé : ${(uco / 1e8).toFixed(2)} UCO`);
      return uco;
    }
    process.stdout.write(".");
    await sleep(3_000);
  }

  throw new Error(`Timeout : aucun fonds reçu après ${timeoutMs / 1000}s`);
}

// ─── Transfert ───────────────────────────────────────────────────────────────

function sendTransaction(tx, confirmationThreshold = 100, timeout = 60) {
  return new Promise((resolve, reject) => {
    tx.on("requiredConfirmation", (nbConfirmations) => {
      console.log(`[Transfer] ✓ Confirmé (${nbConfirmations} confirmations)`);
      resolve(nbConfirmations);
    })
      .on("error", (_ctx, err) => {
        reject(new Error(`Erreur réseau : ${JSON.stringify(err)}`));
      })
      .on("timeout", (nbConfirmations) => {
        reject(
          new Error(
            `Timeout après ${timeout}s (${nbConfirmations} confirmations reçues)`
          )
        );
      })
      .send(confirmationThreshold, timeout);
  });
}

async function transfer(archethic, seed, recipientAddress) {
  console.log(`\n[Transfer] Préparation du transfert de ${AMOUNT_UCO} UCO ...`);

  const senderAddressBytes = Crypto.deriveAddress(seed, 0);
  const senderAddressHex   = toHex(senderAddressBytes);
  const index = await archethic.transaction.getTransactionIndex(senderAddressHex);
  console.log(`[Transfer] Index de la transaction : ${index}`);

  const tx = archethic.transaction
    .new()
    .setType("transfer")
    .addUCOTransfer(recipientAddress, AMOUNT_RAW)
    .build(seed, index)
    .originSign(Utils.originPrivateKey);

  await sendTransaction(tx, 100, 60);
  console.log(`[Transfer] ${AMOUNT_UCO} UCO envoyés à ${recipientAddress}`);
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

async function main() {
  const recipientAddress = process.argv[2];

  if (!recipientAddress) {
    console.error(
      "Usage : SEED=<seed> node transfer.js <adresse_destinataire>\n" +
        "Exemple : node transfer.js 0000abcdef1234..."
    );
    process.exit(1);
  }

  const seed = process.env.SEED ?? generateSeed();
  const senderAddressHex = toHex(Crypto.deriveAddress(seed, 0));

  console.log("=== Archethic UCO Transfer (testnet) ===");
  console.log(`Seed         : ${seed}`);
  console.log(`Expéditeur   : ${senderAddressHex}`);
  console.log(`Destinataire : ${recipientAddress}`);
  console.log(`Montant      : ${AMOUNT_UCO} UCO`);
  console.log(`Réseau       : ${TESTNET_URL}`);

  const archethic = new Archethic(TESTNET_URL);
  await archethic.connect();
  console.log("\n[Réseau] Connecté au testnet Archethic.");

  await requestFaucet(senderAddressHex);
  // Attendre AMOUNT_UCO + 1 UCO pour couvrir les frais de transaction
  await waitForBalance(archethic, senderAddressHex, AMOUNT_RAW + 100_000_000n);
  await transfer(archethic, seed, recipientAddress);

  console.log("\n=== Transfert terminé avec succès ! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[Erreur]", err.message ?? err);
  process.exit(1);
});
