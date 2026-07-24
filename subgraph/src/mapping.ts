import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Swapped } from "../generated/TuringPoolApp/TuringPoolApp";
import { Shipped, Docked } from "../generated/Aqua/Aqua";
import { Strategy, Swap, TierStat, Human } from "../generated/schema";

export function handleShipped(event: Shipped): void {
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
  s.active = true;
  s.token0 = tuple[1].toAddress();
  s.token1 = tuple[2].toAddress();
  s.wideFeeBps = tuple[3].toBigInt();
  s.tightFeeBps = tuple[4].toBigInt();
  s.shippedAtBlock = event.block.number;
  s.shippedAtTimestamp = event.block.timestamp;
  s.save();
}

export function handleDocked(event: Docked): void {
  const s = Strategy.load(event.params.strategyHash);
  if (s === null) return;
  s.active = false;
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
}
