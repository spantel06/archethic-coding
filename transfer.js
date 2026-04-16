/**
 * Transfert de 10 UCO sur le testnet Archethic
 *
 * Usage:
 *   SEED=<votre_seed> node transfer.js <adresse_destinataire>
 *   node transfer.js <adresse_destinataire>          (seed aléatoire généré)
 *
 * Étapes :
 *   1. Dériver l'adresse de l'expéditeur depuis la seed
 *   2. Demander des UCO au faucet testnet
 *   3. Attendre que les fonds arrivent
 *   4. Envoyer 10 UCO à l'adresse destinataire
 */

import Archethic, { Crypto, Utils } from "@archethicjs/sdk";
import { randomBytes } from "crypto";

const TESTNET_URL = "https://testnet.archethic.net";
const FAUCET_URL  = `${TESTNET_URL}/faucet`;
const AMOUNT_UCO  = 10;

// Clé d'origine logicielle par défaut pour le testnet (publique / non-secrète)
const ORIGIN_PRIVATE_KEY =
  "01019280BDB84B8F8AEDBA205FE3552689964A5626844AA6D5E7072B75A37E0D9C5F";

// ─── Utilitaires ────────────────────────────────────────────────────────────

function generateSeed() {
  return randomBytes(32).toString("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ucoToRaw(uco) {
  // 1 UCO = 100 000 000 en unité de base (bigint)
  return BigInt(Math.round(uco * 1e8));
}

// ─── Faucet ─────────────────────────────────────────────────────────────────

async function requestFaucet(address) {
  console.log(`\n[Faucet] Demande d'UCO pour ${address} ...`);

  const body = new URLSearchParams({ address }).toString();

  const response = await fetch(FAUCET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/html",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Faucet HTTP ${response.status}: ${await response.text()}`
    );
  }

  console.log("[Faucet] Requête envoyée avec succès.");
}

// ─── Attente des fonds ───────────────────────────────────────────────────────

async function waitForBalance(archethic, address, minUco = 1, timeoutMs = 90_000) {
  console.log(`\n[Balance] Attente des fonds sur ${address} ...`);
  const deadline = Date.now() + timeoutMs;
  const pollMs   = 3_000;

  while (Date.now() < deadline) {
    const { uco } = await archethic.network.getBalance(address);
    const ucoVal  = Number(uco) / 1e8;

    if (ucoVal >= minUco) {
      console.log(`[Balance] Solde reçu : ${ucoVal} UCO`);
      return ucoVal;
    }

    process.stdout.write(".");
    await sleep(pollMs);
  }

  throw new Error(
    `Timeout : aucun fonds reçu sur ${address} après ${timeoutMs / 1000}s`
  );
}

// ─── Transfert ───────────────────────────────────────────────────────────────

async function transfer(archethic, seed, recipientAddress) {
  console.log(`\n[Transfer] Préparation du transfert de ${AMOUNT_UCO} UCO ...`);

  // Index de la prochaine transaction du compte expéditeur
  const senderAddress = Crypto.deriveAddress(seed, 0);
  const index = await archethic.transaction.getTransactionIndex(senderAddress);
  console.log(`[Transfer] Index de la transaction : ${index}`);

  // Construction de la transaction
  const tx = archethic.transaction
    .new()
    .setType("transfer")
    .addUCOTransfer(recipientAddress, ucoToRaw(AMOUNT_UCO))
    .build(seed, index)
    .originSign(ORIGIN_PRIVATE_KEY);

  // Envoi et attente de validation (timeout 60 s)
  await tx.send(60);
  console.log(`[Transfer] ✓ ${AMOUNT_UCO} UCO envoyés à ${recipientAddress}`);
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

  const seed = process.env.SEED || generateSeed();

  console.log("=== Archethic UCO Transfer (testnet) ===");
  console.log(`Seed         : ${seed}`);

  const senderAddress = Crypto.deriveAddress(seed, 0);
  console.log(`Expéditeur   : ${senderAddress}`);
  console.log(`Destinataire : ${recipientAddress}`);
  console.log(`Montant      : ${AMOUNT_UCO} UCO`);
  console.log(`Réseau       : ${TESTNET_URL}`);

  // Connexion au testnet
  const archethic = new Archethic(TESTNET_URL);
  await archethic.connect();
  console.log("\n[Réseau] Connecté au testnet Archethic.");

  // 1. Demander des fonds au faucet
  await requestFaucet(senderAddress);

  // 2. Attendre que les fonds arrivent (minimum 11 UCO pour couvrir les frais)
  await waitForBalance(archethic, senderAddress, AMOUNT_UCO + 1);

  // 3. Envoyer le transfert
  await transfer(archethic, seed, recipientAddress);

  console.log("\n=== Transfert terminé avec succès ! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n[Erreur]", err.message ?? err);
  process.exit(1);
});
