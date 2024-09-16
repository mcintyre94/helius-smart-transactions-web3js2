import {
  IInstruction,
  TransactionPartialSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  getComputeUnitEstimateForTransactionMessageFactory,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  TransactionMessage,
  isWritableRole,
  MicroLamportsUnsafeBeyond2Pow53Minus1,
  isInstructionWithData,
  CompilableTransactionMessage,
  sendAndConfirmTransactionFactory,
  FullySignedTransaction,
  TransactionWithBlockhashLifetime,
  Commitment,
  isSolanaError,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
} from "@solana/web3.js";
import { HeliusDevnetRpc, HeliusMainnetRpc } from "./rpc.js";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
  identifyComputeBudgetInstruction,
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  ComputeBudgetInstruction,
} from "@solana-program/compute-budget";
import { getAbortablePromise } from "@solana/promises";

async function getPriorityFeeEstimate(
  rpc: HeliusDevnetRpc | HeliusMainnetRpc,
  transactionMessage: TransactionMessage,
  abortSignal?: AbortSignal
): Promise<number> {
  const accountKeys = [
    ...new Set([
      ...transactionMessage.instructions.flatMap((i: IInstruction) =>
        (i.accounts ?? [])
          .filter((a) => isWritableRole(a.role))
          .map((a) => a.address)
      ),
    ]),
  ];

  if (rpc.cluster === "devnet") {
    const recentFeesResponse = await rpc
      .getRecentPrioritizationFees([...accountKeys])
      .send({ abortSignal });
    const recentFeesValues = recentFeesResponse.reduce((acc, cur) => {
      if (cur.prioritizationFee > 0n) {
        return [...acc, cur.prioritizationFee];
      } else {
        return acc;
      }
    }, [] as MicroLamportsUnsafeBeyond2Pow53Minus1[]);
    // sort fees ascending order
    recentFeesValues.sort((a, b) => Number(a - b));
    // return median fee
    return Number(recentFeesValues[Math.floor(recentFeesValues.length / 2)]);
  } else {
    const { priorityFeeEstimate } = await rpc
      .getPriorityFeeEstimate({
        accountKeys,
        options: {
          recommended: true,
        },
      })
      .send({ abortSignal });

    return priorityFeeEstimate;
  }
}

async function getComputeUnitEstimate(
  rpc: HeliusDevnetRpc | HeliusMainnetRpc,
  transactionMessage: CompilableTransactionMessage,
  abortSignal?: AbortSignal
) {
  // add placeholder instruction for CU price if not already present
  // web3js estimate will add CU limit but not price
  // both take CUs, so we need both in the simulation
  const hasExistingComputeBudgetPriceInstruction =
    transactionMessage.instructions.some(
      (i) =>
        i.programAddress === COMPUTE_BUDGET_PROGRAM_ADDRESS &&
        isInstructionWithData(i) &&
        identifyComputeBudgetInstruction(i) ===
          ComputeBudgetInstruction.SetComputeUnitPrice
    );

  const transactionMessageToSimulate = hasExistingComputeBudgetPriceInstruction
    ? transactionMessage
    : appendTransactionMessageInstruction(
        getSetComputeUnitPriceInstruction({ microLamports: 0 }),
        transactionMessage
      );

  const computeUnitEstimateFn =
    getComputeUnitEstimateForTransactionMessageFactory({ rpc });
  return computeUnitEstimateFn(transactionMessageToSimulate, {
    abortSignal,
  });
}

export async function createSmartTransaction(
  rpc: HeliusDevnetRpc | HeliusMainnetRpc,
  instructions: IInstruction[],
  feePayer: TransactionPartialSigner,
  abortSignal?: AbortSignal
): Promise<FullySignedTransaction & TransactionWithBlockhashLifetime> {
  // Create a transaction message from instructions
  const { value: blockhash } = await rpc
    .getLatestBlockhash()
    .send({ abortSignal });

  let transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );

  const priorityFeeEstimatePromise = getPriorityFeeEstimate(
    rpc,
    transactionMessage,
    abortSignal
  );

  const computeUnitEstimatePromise = getComputeUnitEstimate(
    rpc,
    transactionMessage,
    abortSignal
  );

  const [priorityFeeEstimate, computeUnitEstimate] = await Promise.all([
    priorityFeeEstimatePromise,
    computeUnitEstimatePromise,
  ]);

  transactionMessage = appendTransactionMessageInstructions(
    [
      getSetComputeUnitPriceInstruction({
        microLamports: priorityFeeEstimate,
      }),
      getSetComputeUnitLimitInstruction({
        units: Math.ceil(computeUnitEstimate * 1.1),
      }),
    ],
    transactionMessage
  );

  return signTransactionMessageWithSigners(transactionMessage);
}

export async function sendTransactionWithRetry(
  rpc: Parameters<typeof sendAndConfirmTransactionFactory>[0]["rpc"],
  rpcSubscriptions: Parameters<
    typeof sendAndConfirmTransactionFactory
  >[0]["rpcSubscriptions"],
  transaction: FullySignedTransaction & TransactionWithBlockhashLifetime,
  options?: {
    retries?: number;
    abortSignal?: AbortSignal;
    commitment?: Commitment;
  }
) {
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  let retriesLeft = options?.retries ?? 4;
  while (retriesLeft > 0) {
    try {
      const txPromise = sendAndConfirm(transaction, {
        abortSignal: options?.abortSignal,
        commitment: options?.commitment ?? "confirmed",
        maxRetries: 0n,
      });

      await getAbortablePromise(txPromise, AbortSignal.timeout(15_000));
      break;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        // timeout error happens if the transaction is not confirmed in 15s
        // we can retry until we run out of retries
        console.debug("Transaction not confirmed, retrying...");
      } else if (
        isSolanaError(err, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)
      ) {
        // race condition where the transaction is processed between throwing the
        // `TimeoutError` and our next retry
        break;
      } else {
        throw err;
      }
    } finally {
      retriesLeft--;
    }
  }
}
