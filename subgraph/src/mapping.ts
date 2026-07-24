import {
  Address,
  BigInt,
  dataSource,
  ethereum,
  Value,
} from "@graphprotocol/graph-ts";
import { Swapped } from "../generated/TuringPoolApp/TuringPoolApp";
import {
  Aqua,
  Docked,
  Pulled,
  Pushed,
  Shipped,
} from "../generated/Aqua/Aqua";
import { Strategy, Swap, TierStat, Human } from "../generated/schema";

function isConfiguredApp(app: Address): boolean {
  return app.equals(dataSource.context().getBytes("appAddress"));
}

function refreshBalances(s: Strategy, aquaAddress: Address): void {
  const aqua = Aqua.bind(aquaAddress);
  const balances = aqua.try_safeBalances(
    Address.fromBytes(s.maker),
    Address.fromBytes(s.app),
    s.id,
    Address.fromBytes(s.token0),
    Address.fromBytes(s.token1)
  );
  if (balances.reverted) return;

  s.set("balance0", Value.fromBigInt(balances.value.getBalance0()));
  s.set("balance1", Value.fromBigInt(balances.value.getBalance1()));
}

export function handleShipped(event: Shipped): void {
  // Aqua is shared infrastructure. Index only strategies shipped to the
  // configured TuringPoolApp, rather than every strategy on Aqua.
  if (!isConfiguredApp(event.params.app)) return;

  const strategyBytes = event.params.strategy;
  // TuringPoolApp.Strategy = (address maker, address token0, address token1,
  //                           uint256 wideFeeBps, uint256 tightFeeBps, bytes32 salt)
  const decoded = ethereum.decode(
    "(address,address,address,uint256,uint256,bytes32)",
    strategyBytes
  );
  if (decoded === null) return;
  const tuple = decoded.toTuple();

  const s = new Strategy(event.params.strategyHash);
  s.maker = event.params.maker;
  s.app = event.params.app;
  s.set("aqua", Value.fromBytes(event.address));
  s.active = true;
  s.token0 = tuple[1].toAddress();
  s.token1 = tuple[2].toAddress();
  s.wideFeeBps = tuple[3].toBigInt();
  s.tightFeeBps = tuple[4].toBigInt();
  s.set("balance0", Value.fromBigInt(BigInt.zero()));
  s.set("balance1", Value.fromBigInt(BigInt.zero()));
  s.shippedAtBlock = event.block.number;
  s.shippedAtTimestamp = event.block.timestamp;
  refreshBalances(s, event.address);
  s.save();
}

export function handleDocked(event: Docked): void {
  if (!isConfiguredApp(event.params.app)) return;

  const s = Strategy.load(event.params.strategyHash);
  if (s === null) return;
  s.active = false;
  s.save();
}

export function handlePushed(event: Pushed): void {
  if (!isConfiguredApp(event.params.app)) return;

  const s = Strategy.load(event.params.strategyHash);
  if (s === null) return;
  refreshBalances(s, event.address);
  s.save();
}

export function handlePulled(event: Pulled): void {
  if (!isConfiguredApp(event.params.app)) return;

  const s = Strategy.load(event.params.strategyHash);
  if (s === null) return;
  refreshBalances(s, event.address);
  s.save();
}

export function handleSwapped(event: Swapped): void {
  const id = event.transaction.hash.concatI32(event.logIndex.toI32());
  const swap = new Swap(id);
  swap.strategy = event.params.strategyHash;
  swap.taker = event.params.taker;
  swap.humanId = event.params.humanId;
  swap.tight = event.params.tight;
  swap.tokenIn = event.params.tokenIn;
  swap.tokenOut = event.params.tokenOut;
  swap.amountIn = event.params.amountIn;
  swap.amountOut = event.params.amountOut;
  swap.feeBps = event.params.feeBps;
  swap.blockNumber = event.block.number;
  swap.timestamp = event.block.timestamp;
  swap.save();

  const tierKey = event.params.strategyHash.toHexString() + (event.params.tight ? "-tight" : "-wide");
  let stat = TierStat.load(tierKey);
  if (stat === null) {
    stat = new TierStat(tierKey);
    stat.strategy = event.params.strategyHash;
    stat.tight = event.params.tight;
    stat.swapCount = BigInt.zero();
    stat.volumeIn = BigInt.zero();
    stat.volumeOut = BigInt.zero();
  }
  stat.swapCount = stat.swapCount.plus(BigInt.fromI32(1));
  stat.volumeIn = stat.volumeIn.plus(event.params.amountIn);
  stat.volumeOut = stat.volumeOut.plus(event.params.amountOut);
  stat.save();

  if (event.params.humanId.notEqual(BigInt.zero())) {
    const humanKey = event.params.humanId.toString();
    let human = Human.load(humanKey);
    if (human === null) {
      human = new Human(humanKey);
      human.swapCount = BigInt.zero();
      human.volumeIn = BigInt.zero();
      human.wallets = [];
    }
    human.swapCount = human.swapCount.plus(BigInt.fromI32(1));
    human.volumeIn = human.volumeIn.plus(event.params.amountIn);
    const wallets = human.wallets;
    let seen = false;
    for (let i = 0; i < wallets.length; i++) {
      if (wallets[i].equals(event.params.taker)) {
        seen = true;
        break;
      }
    }
    if (!seen) {
      wallets.push(event.params.taker);
      human.wallets = wallets;
    }
    human.save();
  }

  const strategy = Strategy.load(event.params.strategyHash);
  if (strategy !== null) {
    const aqua = strategy.get("aqua");
    if (aqua !== null) {
      refreshBalances(strategy, Address.fromBytes(aqua.toBytes()));
      strategy.save();
    }
  }
}
