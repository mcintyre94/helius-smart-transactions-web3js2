import {
  Address,
  Base64EncodedBytes,
  Base64EncodedWireTransaction,
  Rpc,
  RpcApi,
  RpcSubscriptions,
  SolanaRpcApiDevnet,
  SolanaRpcApiMainnet,
  SolanaRpcSubscriptionsApi,
  createDefaultRpcTransport,
  createRpc,
  createSolanaRpc,
  createSolanaRpcApi,
  createSolanaRpcSubscriptions,
} from "@solana/web3.js";
import { getDefaultResponseTransformerForSolanaRpc } from "@solana/rpc-transformers";

// just the subset of params we need
type GetPriorityFeeEstimateParams = {
  accountKeys: Address[];
  options: {
    recommended: true;
  };
};

// just the response for recommended: true
type GetPriorityFeeEstimateResponse = {
  priorityFeeEstimate: number;
};

type HeliusDevnetApi = SolanaRpcApiDevnet;

type HeliusMainnetApi = SolanaRpcApiMainnet & {
  getPriorityFeeEstimate(
    params: GetPriorityFeeEstimateParams
  ): GetPriorityFeeEstimateResponse;
};

const HELIUS_API_RESPONSE_TRANSFORMER =
  getDefaultResponseTransformerForSolanaRpc({
    allowedNumericKeyPaths: {
      getPriorityFeeEstimate: [["priorityFeeEstimate"]],
    },
  });

type HeliusDevnetRpc = Rpc<HeliusDevnetApi> & {
  cluster: "devnet";
};

type HeliusDevnetRpcAndSubscriptions = {
  rpc: HeliusDevnetRpc;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
};

type HeliusMainnetRpc = Rpc<HeliusMainnetApi> & {
  cluster: "mainnet";
};

type HeliusMainnetRpcAndSubscriptions = {
  rpc: HeliusMainnetRpc;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
};

type CreateHeliusRpcParams =
  | {
      heliusApiKey: string;
    }
  | {
      endpoint: string;
    };

function createHeliusDevnetRpc(params: CreateHeliusRpcParams): HeliusDevnetRpc {
  const endpoint =
    "heliusApiKey" in params
      ? `https://devnet.helius-rpc.com/?api-key=${params.heliusApiKey}`
      : params.endpoint;

  const solanaRpc = createSolanaRpc(endpoint);

  return new Proxy(solanaRpc, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(target, p, receiver) {
      if (p === "cluster") {
        return "devnet";
      }
      return Reflect.get(target, p, receiver);
    },
  }) as HeliusDevnetRpc;
}

function createHeliusDevnetRpcSubscriptions(
  params: CreateHeliusRpcParams
): RpcSubscriptions<SolanaRpcSubscriptionsApi> {
  const endpoint =
    "heliusApiKey" in params
      ? `wss://devnet.helius-rpc.com/?api-key=${params.heliusApiKey}`
      : params.endpoint;

  return createSolanaRpcSubscriptions(endpoint);
}

export function createHeliusDevnetRpcAndSubscriptions(
  params: CreateHeliusRpcParams
): HeliusDevnetRpcAndSubscriptions {
  return {
    rpc: createHeliusDevnetRpc(params),
    rpcSubscriptions: createHeliusDevnetRpcSubscriptions(params),
  };
}

function getHeliusMainnetEndpoint(heliusApiKey: string) {
  return `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
}

function createHeliusMainnetRpc(
  params: CreateHeliusRpcParams
): HeliusMainnetRpc {
  const endpoint =
    "heliusApiKey" in params
      ? getHeliusMainnetEndpoint(params.heliusApiKey)
      : params.endpoint;
  const solanaRpcApi = createSolanaRpcApi<SolanaRpcApiMainnet>();

  const heliusApi = new Proxy(solanaRpcApi, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(target, p, receiver) {
      const methodName = p.toString();
      const originalMethod = Reflect.get(target, p, receiver);
      if (methodName !== "getPriorityFeeEstimate") {
        return originalMethod;
      }
      return (...args) => {
        const requestPlan = originalMethod(...args);
        return {
          ...requestPlan,
          responseTransformer: HELIUS_API_RESPONSE_TRANSFORMER,
        };
      };
    },
  }) as RpcApi<HeliusMainnetApi>;

  const rpc = createRpc({
    api: heliusApi,
    transport: createDefaultRpcTransport({ url: endpoint }),
  });

  return new Proxy(rpc, {
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    get(target, p, receiver) {
      if (p === "cluster") {
        return "mainnet";
      }
      return Reflect.get(target, p, receiver);
    },
  }) as HeliusMainnetRpc;
}

function createHeliusMainnetRpcSubscriptions(
  params: CreateHeliusRpcParams
): RpcSubscriptions<SolanaRpcSubscriptionsApi> {
  const endpoint =
    "heliusApiKey" in params
      ? `wss://mainnet.helius-rpc.com/?api-key=${params.heliusApiKey}`
      : params.endpoint;

  return createSolanaRpcSubscriptions(endpoint);
}

export function createHeliusMainnetRpcAndSubscriptions(
  params: CreateHeliusRpcParams
): HeliusMainnetRpcAndSubscriptions {
  return {
    rpc: createHeliusMainnetRpc(params),
    rpcSubscriptions: createHeliusMainnetRpcSubscriptions(params),
  };
}
