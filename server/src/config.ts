import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export interface Deployments {
  aqua: `0x${string}`;
  agentBook: `0x${string}`;
  mockAgentBook: boolean;
  quota: `0x${string}`;
  app: `0x${string}`;
  router: `0x${string}`;
  tETH: `0x${string}`;
  tUSD: `0x${string}`;
  maker: `0x${string}`;
  bot: `0x${string}`;
  humanAgent: `0x${string}`;
  sybilAgent: `0x${string}`;
  humanId: string;
  wideFeeBps: string | number;
  tightFeeBps: string | number;
  strategyHash: `0x${string}`;
  orderHash: `0x${string}`;
  orderTraits: string;
  orderData: `0x${string}`;
  strategySalt: string | number;
  deployBlock?: string | number;
}

export const DEPLOYMENTS_PATH =
  process.env.DEPLOYMENTS_PATH ?? resolve(here, '../../contracts/deployments/demo.json');

export function loadDeployments(): Deployments {
  return JSON.parse(readFileSync(DEPLOYMENTS_PATH, 'utf8'));
}

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const PORT = Number(process.env.PORT ?? 4021);
export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
// NOTE: @worldcoin/agentkit's validateAgentkitMessage derives the expected SIWE
// domain from `new URL(resourceUri).hostname` - hostname WITHOUT port - so the
// challenge domain must be the bare hostname. (Documented in FEEDBACK.md.)
export const SERVER_DOMAIN = process.env.SERVER_DOMAIN ?? 'localhost';
export const BASE_URL = process.env.BASE_URL ?? `http://${SERVER_DOMAIN}:${PORT}`;
