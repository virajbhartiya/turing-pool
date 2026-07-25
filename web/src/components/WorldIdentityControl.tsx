import { createWorldBridgeStore } from '@worldcoin/idkit-core';
import { solidityEncode } from '@worldcoin/idkit-core/hashing';
import QRCode from 'qrcode';
import { decodeAbiParameters } from 'viem';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiBase } from '../hooks/useProtocol';
import { shortAddress } from '../lib/format';
import { BrandLogo } from './BrandLogo';

const WORLD_APP_ID = 'app_a7c3e2b6b83927251a0db5345bd7146a' as const;
const WORLD_ACTION = 'agentbook-registration';
const WORLD_AGENT_BOOK = '0xA23aB2712eA7BBa896930544C7d6636a96b944dA' as const;

interface IdentityStatus {
  address: string;
  worldRegistered: boolean;
  readyToTradeAsHuman: boolean;
  humanId: string;
  nextNonce: string;
  worldBlock: string;
  agentBook: string;
  chainId: number;
}

type VerificationPhase =
  | 'idle'
  | 'preparing'
  | 'awaiting-world'
  | 'registering'
  | 'complete'
  | 'error';

function normalizeProof(rawProof: string): string[] {
  if (rawProof.startsWith('[')) {
    const parsed: unknown = JSON.parse(rawProof);
    if (Array.isArray(parsed) && parsed.every((part) => typeof part === 'string')) {
      return parsed;
    }
  }
  const [decoded] = decodeAbiParameters([{ type: 'uint256[8]' }], rawProof as `0x${string}`);
  return decoded.map((value) => `0x${value.toString(16).padStart(64, '0')}`);
}

async function readStatus(address: string): Promise<IdentityStatus> {
  const response = await fetch(
    `${apiBase()}/identity/status?${new URLSearchParams({ address })}`,
  );
  const body = (await response.json()) as IdentityStatus | { error?: string };
  if (!response.ok || !('worldRegistered' in body)) {
    throw new Error('error' in body && body.error ? body.error : 'World identity is unavailable');
  }
  return body;
}

export function WorldIdentityControl({
  account,
  quotedAsHuman,
  onIdentityReady,
}: {
  account: string;
  quotedAsHuman: boolean;
  onIdentityReady: () => Promise<void>;
}) {
  const [status, setStatus] = useState<IdentityStatus>();
  const [phase, setPhase] = useState<VerificationPhase>('idle');
  const [message, setMessage] = useState('Checking canonical World AgentBook…');
  const [connectorUri, setConnectorUri] = useState<string>();
  const [qrCode, setQrCode] = useState<string>();
  const [copiedId, setCopiedId] = useState(false);
  const activeRun = useRef(0);

  const refreshStatus = useCallback(async () => {
    const next = await readStatus(account);
    setStatus(next);
    if (next.readyToTradeAsHuman) {
      setPhase('complete');
      setMessage('World ID is linked directly to this trading wallet.');
    } else {
      setPhase('idle');
      setMessage('Verify once in World App to unlock identity-priced execution.');
    }
    return next;
  }, [account]);

  useEffect(() => {
    activeRun.current += 1;
    setStatus(undefined);
    setConnectorUri(undefined);
    setQrCode(undefined);
    setCopiedId(false);
    setPhase('idle');
    void refreshStatus().catch((error: unknown) => {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'World identity lookup failed');
    });
  }, [refreshStatus]);

  async function verify() {
    const run = ++activeRun.current;
    setPhase('preparing');
    setMessage('Creating a wallet-bound AgentBook verification request…');
    try {
      const current = await readStatus(account);
      setStatus(current);
      if (current.readyToTradeAsHuman) {
        setPhase('complete');
        setMessage('World ID is linked directly to this trading wallet.');
        return;
      }

      const world = createWorldBridgeStore();
      await world.getState().createClient({
        app_id: WORLD_APP_ID,
        action: WORLD_ACTION,
        signal: solidityEncode(
          ['address', 'uint256'],
          [account, BigInt(current.nextNonce)],
        ),
      });
      if (run !== activeRun.current) return;
      const uri = world.getState().connectorURI;
      if (!uri) throw new Error('World App did not return a verification link');
      setConnectorUri(uri);
      setQrCode(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
      setPhase('awaiting-world');
      setMessage('Scan with World App and approve the wallet link.');

      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline && run === activeRun.current) {
        await world.getState().pollForUpdates();
        const result = world.getState().result;
        const errorCode = world.getState().errorCode;
        if (errorCode) throw new Error(`World App verification failed: ${errorCode}`);
        if (result) {
          setPhase('registering');
          setMessage('World verified. Registering this wallet in canonical AgentBook…');
          const registrationResponse = await fetch(`${apiBase()}/identity/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agent: account,
              root: result.merkle_root,
              nonce: current.nextNonce,
              nullifierHash: result.nullifier_hash,
              proof: normalizeProof(result.proof),
              contract: WORLD_AGENT_BOOK,
            }),
          });
          const registration = (await registrationResponse.json()) as { error?: string };
          if (!registrationResponse.ok) {
            throw new Error(registration.error ?? 'World AgentBook registration failed');
          }

          for (let attempt = 0; attempt < 45; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 2_000));
            const registered = await readStatus(account);
            setStatus(registered);
            if (registered.readyToTradeAsHuman) {
              setPhase('complete');
              setMessage('Verified by World · the retail lane is active.');
              setConnectorUri(undefined);
              setQrCode(undefined);
              await onIdentityReady();
              return;
            }
          }
          throw new Error('World registration was submitted but has not finalized yet');
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      if (run === activeRun.current) throw new Error('World verification timed out');
    } catch (error) {
      if (run !== activeRun.current) return;
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'World verification failed');
    }
  }

  const ready = quotedAsHuman || status?.readyToTradeAsHuman;
  const working = ['preparing', 'awaiting-world', 'registering'].includes(phase);

  return (
    <section className={`world-identity-control ${ready ? 'ready' : ''}`}>
      <header>
        <BrandLogo brand="world" />
        <div>
          <span>World ID verification</span>
          <strong>{ready ? 'World ID-verified retail lane active' : 'Connect wallet to World ID'}</strong>
        </div>
        <b>{ready ? 'VERIFIED' : 'VERIFY'}</b>
      </header>
      <p>{message}</p>
      {status?.worldRegistered && (
        <div className="world-id-record">
          <span>Your World ID pseudonymous identifier</span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(status.humanId);
              setCopiedId(true);
              window.setTimeout(() => setCopiedId(false), 1_500);
            }}
            title={status.humanId}
            type="button"
          >
            {status.humanId.slice(0, 14)}…{status.humanId.slice(-10)}
            <b>{copiedId ? 'Copied' : 'Copy'}</b>
          </button>
          <small>AgentBook humanId · verified at World block {status.worldBlock}</small>
        </div>
      )}
      {phase === 'awaiting-world' && connectorUri && qrCode && (
        <div className="world-verify-prompt">
          <img alt="Scan to verify this wallet in World App" src={qrCode} />
          <div>
            <strong>Approve in World App</strong>
            <span>The proof is bound to {shortAddress(account)} and cannot verify another wallet.</span>
            <a href={connectorUri}>Open World App ↗</a>
            <button
              onClick={() => {
                activeRun.current += 1;
                setPhase('idle');
                setConnectorUri(undefined);
                setQrCode(undefined);
                setMessage('Verification cancelled. No identity was changed.');
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!ready && phase !== 'awaiting-world' && (
        <button
          className="world-verify-button"
          disabled={working || status === undefined}
          onClick={() => void verify()}
          type="button"
        >
          {working
            ? 'Verifying with World…'
            : phase === 'error'
                ? 'Retry World verification'
                : 'Connect wallet to World ID'}
        </button>
      )}
    </section>
  );
}
