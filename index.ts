import {
  createKeyPairSignerFromBytes,
  getBase58Encoder,
  getSignatureFromTransaction,
} from "@solana/web3.js";
import {
  createHeliusDevnetRpcAndSubscriptions,
  createHeliusMainnetRpcAndSubscriptions,
} from "./rpc.js";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  createSmartTransaction,
  sendTransactionWithRetry,
} from "./smart-transaction.js";

const heliusApiKey = process.env.HELIUS_API_KEY;
if (!heliusApiKey) {
  throw new Error("No HELIUS_API_KEY environment variable");
}

const solanaPrivateKeyBase58 = process.env.SOLANA_PRIVATE_KEY;
if (!solanaPrivateKeyBase58) {
  throw new Error("No SOLANA_PRIVATE_KEY environment variable");
}

const { rpc, rpcSubscriptions } = createHeliusMainnetRpcAndSubscriptions({
  heliusApiKey,
});

const signer = await createKeyPairSignerFromBytes(
  getBase58Encoder().encode(solanaPrivateKeyBase58)
);

const LAMPORTS_PER_SOL = 1_000_000_000n;

const instruction = getTransferSolInstruction({
  source: signer,
  destination: signer.address,
  amount: LAMPORTS_PER_SOL / 1000n,
});

const transaction = await createSmartTransaction(rpc, [instruction], signer);
const signature = getSignatureFromTransaction(transaction);

console.log("Sending transaction...", signature);

await sendTransactionWithRetry(rpc, rpcSubscriptions, transaction, {
  retries: 4,
});

console.log("Transaction sent!", signature);
