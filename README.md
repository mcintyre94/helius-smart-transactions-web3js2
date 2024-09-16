# Helius smart transaction sending with Web3js 2.0

This repo provides a simple example of optimising transaction sending with Helius using web3js 2.0

It provides an alternative to using the [Helius SDK](https://docs.helius.dev/solana-rpc-nodes/sending-transactions-on-solana#node.js-sdk), which relies on web3js 1.x

It implements the optimisations discussed in the [Helius docs](https://docs.helius.dev/solana-rpc-nodes/sending-transactions-on-solana#sending-transactions-without-the-sdk)


## Example usage

An example usage is provided in `index.ts`

```ts
const { rpc, rpcSubscriptions } = createHeliusMainnetRpcAndSubscriptions({
  heliusApiKey,
});

const transaction = await createSmartTransaction(rpc, [instruction], signer);

await sendTransactionWithRetry(rpc, rpcSubscriptions, transaction, {
  retries: 4,
});
```

## RPC

`rpc.ts` provides a Solana RPC client, that for mainnet includes [Helius' custom `getPriorityFeeEstimate` method](https://docs.helius.dev/solana-rpc-nodes/priority-fee-api). Note that this API is not available on devnet.

Two functions are exported: `createHeliusDevnetRpcAndSubscriptions` and `createHeliusMainnetRpcAndSubscriptions`.

Both return `{rpc, rpcSubscriptions}`.

Both take as input `{ heliusApiKey: string }` or `{ endpoint: string }`. If an API key is provided then the default Helius devnet/mainnet endpoint is used.

## Smart transaction

`smart-transaction.ts` provides a function to create an optimised transaction, and another to send a transaction with retry logic.

### Creating an optimised transaction

`createSmartTransaction` is similar to the equivalently named method in the Helius SDK. It takes as input:

- `rpc`: A Helius RPC
- `instructions`: A list of web3js 2.0 instructions
- `feePayer`: A web3js 2.0 transaction signer that will be the fee payer for the transaction
- `abortSignal`: An optional abort signal that can be used to cancel the operation

Note that the transaction instructions can include any [signers](https://github.com/solana-labs/solana-web3.js/tree/master/packages/signers#solanasigners), and these will be used to sign the transaction.

It does the following:

- Creates a versioned transaction message including the provided instructions
- Fetches the latest blockhash and sets the transaction's lifetime using it
- Sets the transaction's fee payer to the provided fee payer
- Fetches a priority fee estimate, using Helius' `getPriorityFeeEstimate` method on mainnet
- Fetches a compute unit (CU) estimate, by simulating the transaction.
- Creates priority fee instructions and adds them to the transaction
- Signs the transaction using the provided fee payer + any other signers included in the instructions

### Sending a transaction with retry logic

`sendTransactionWithRetry` is similar to the Helius SDK `sendSmartTransaction` method. It will send a web3js 2.0 transaction and handle the retry logic for you.

This is useful because Helius only allows access to its staked connections when `maxRetries` is set to 0. This requires the app to handle retry logic itself.

It takes as input:

- `rpc`: A Helius RPC
- `rpcSubscriptions`: A Solana RPC subscriptions client
- `transaction`: A fully signed transaction with a lifetime set using a recent blockhash
- Optional `options`:
  - `retries`: The number of retries to attempt. Defaults to 4.
  - `abortSignal`: An optional abort signal that can be used to cancel the operation
  - `commitment`: The commitment to use when confirming the transaction. Defaults to `confirmed`.

It sends the transaction and waits 15 seconds for a confirmation. If the transaction is not confirmed, it will be resent. This is repeated until the number of retries is reached or the transaction is confirmed.
