# World identity on Base execution

Turing Pool keeps the canonical identity source on World Chain while executing
quotes, swaps, quota accounting, Aqua inventory changes, and LP vault actions on
Base.

## Trust and data flow

1. `scripts/sync-agentbook-mirror.mjs` reads
   `AgentBook.lookupHuman(agent)` at one World Chain block.
2. The relayer submits the human ID, World block number, and World block hash to
   `WorldAgentBookMirror` on Base.
3. The mirror accepts updates only from authorized relayers and only when the
   World block is newer than the stored record. A zero human ID is a supported
   revocation.
4. `_humanGate` opcode 34 calls the mirror through the unchanged
   `IAgentBook.lookupHuman(address)` interface.
5. `HumanQuota` applies the shared per-human cap and records executed notional;
   Aqua and SwapVM settle atomically on Base.

The relay is explicitly authenticated rather than presented as a trustless
light-client bridge. Replacing the relayer with a Hyperlane, LayerZero, CCIP, or
proof-based transport does not change the router interface.

## Live testnet addresses

| Component | Chain | Address |
|---|---:|---|
| Canonical AgentBook | World Chain 480 | `0xA23aB2712eA7BBa896930544C7d6636a96b944dA` |
| AgentBook mirror | Base Sepolia 84532 | `0x70b9FE7Bd162B0014df1E1f435dB47765Db62455` |
| Aqua | Base Sepolia 84532 | `0xFfdD1873f99EA128DED0BFc2Ae11A98f572E23Ec` |
| Primary SwapVM router | Base Sepolia 84532 | `0x02467E79C0aa8458F4552d427771D72C30F5a484` |
| Primary HumanQuota | Base Sepolia 84532 | `0x23253c0e2aF22D83859F9f0B61b2ed45ED3Bd63B` |
| Vault SwapVM router | Base Sepolia 84532 | `0x797670993d2E81266F8512C7438d5b3B1E9a49d6` |
| Vault factory | Base Sepolia 84532 | `0x6B5dA84980f3205F0a6aCc9469c7b8279575cd10` |
| Seeded vault | Base Sepolia 84532 | `0x3f0B4a7d12D368Db1F56a39F907C20Eb04809160` |

The checked-in manifest is
`contracts/deployments/base-sepolia-mirrored.json`.

Public execution receipts:

- anonymous primary fill:
  `0xb8bd8b72e2c9b36d47b6855feb8abbcbda2174c9bb3fc14baceb6405d9f35547`
- World-backed primary fill:
  `0x44458ed078c027d326edb5dd1bf0e6d1f74c4062b9be9f1a7720dc7ab58b264e`
- World-backed permissionless-vault fill:
  `0x3782f97ae7070313ba0849139b205de41a3b9844b1c9bc1d94d5cb9f747fba9a`

## Relay command

```bash
WORLD_RPC_URL=... \
BASE_RPC_URL=https://sepolia.base.org \
SOURCE_AGENT_BOOK=0xA23aB2712eA7BBa896930544C7d6636a96b944dA \
AGENT_BOOK_MIRROR=0x70b9FE7Bd162B0014df1E1f435dB47765Db62455 \
MIRROR_AGENTS=0xAgent1,0xAgent2 \
MIRROR_RELAYER_PRIVATE_KEY=... \
pnpm identity:sync
```

The terminal's self-service World verification control uses the same relay when
`WORLD_RPC_URL` and `MIRROR_RELAYER_PRIVATE_KEY` are configured server-side. It
generates World's official `agentbook-registration` request, waits for the
canonical World AgentBook registration, and then publishes that result to Base.
The sync endpoint cannot invent a human ID: it reads the canonical contract and
skips records that are already synchronized.

Never commit RPC credentials or relayer keys.
