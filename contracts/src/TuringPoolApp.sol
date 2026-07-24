// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAqua} from "aqua/interfaces/IAqua.sol";
import {AquaApp} from "aqua/AquaApp.sol";

import {IAgentBook} from "./interfaces/IAgentBook.sol";
import {HumanQuota} from "./HumanQuota.sol";

/// @title TuringPoolApp - a constant-product Aqua app that prices personhood
/// @notice One pool, one liquidity balance, two spreads. Takers whose wallet is
///         registered in World's AgentBook (i.e. provably backed by a unique human)
///         and who are within their per-human daily quota get the tight fee tier;
///         everyone else pays the wide tier. Quotas are keyed by World ID nullifier
///         (humanId), so they are shared across every wallet a human controls -
///         sybil wallets cannot buy extra tight-tier capacity.
contract TuringPoolApp is AquaApp {
    using Math for uint256;
    using SafeERC20 for IERC20;

    error InsufficientOutputAmount(uint256 amountOut, uint256 amountOutMin);
    error InvalidFees(uint256 wideFeeBps, uint256 tightFeeBps);

    /// @notice Emitted on every swap; `tight` + `humanId` are what the subgraph and
    ///         the strategist agent consume to measure per-tier flow toxicity.
    event Swapped(
        bytes32 indexed strategyHash,
        address indexed taker,
        uint256 indexed humanId,
        bool tight,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeBps
    );

    /// @notice Immutable pool parameters; hash of the abi-encoded struct is the Aqua strategyHash.
    /// @param maker        liquidity provider (funds stay in their wallet)
    /// @param token0/1     the pair
    /// @param wideFeeBps   fee for anonymous / over-quota flow
    /// @param tightFeeBps  fee for human-backed flow within quota
    /// @param salt         uniqueness
    struct Strategy {
        address maker;
        address token0;
        address token1;
        uint256 wideFeeBps;
        uint256 tightFeeBps;
        bytes32 salt;
    }

    uint256 internal constant BPS_BASE = 10_000;

    IAgentBook public immutable AGENT_BOOK;
    HumanQuota public immutable QUOTA;

    constructor(IAqua aqua_, IAgentBook agentBook_, HumanQuota quota_) AquaApp(aqua_) {
        AGENT_BOOK = agentBook_;
        QUOTA = quota_;
    }

    /// @notice Quote for a specific taker. Returns which tier the taker would get right now.
    function quoteExactIn(Strategy calldata strategy, bool zeroForOne, uint256 amountIn, address taker)
        external
        view
        returns (uint256 amountOut, bool tight, uint256 feeBps, uint256 humanId)
    {
        bytes32 strategyHash = keccak256(abi.encode(strategy));
        (,, uint256 balanceIn, uint256 balanceOut) = _getInAndOut(strategy, strategyHash, zeroForOne);
        address tokenIn = zeroForOne ? strategy.token0 : strategy.token1;
        (feeBps, humanId, tight) = _resolveTier(strategy, taker, tokenIn, amountIn);
        amountOut = _quoteExactIn(balanceIn, balanceOut, amountIn, feeBps);
    }

    /// @notice Swap exact input. Taker is msg.sender and must have approved tokenIn to this app.
    ///         Flow: collect tokenIn from taker -> push to maker via Aqua -> pull tokenOut to `to`.
    function swapExactIn(
        Strategy calldata strategy,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOutMin,
        address to
    ) external nonReentrantStrategy(strategy.maker, keccak256(abi.encode(strategy))) returns (uint256 amountOut) {
        require(
            strategy.tightFeeBps <= strategy.wideFeeBps && strategy.wideFeeBps < BPS_BASE,
            InvalidFees(strategy.wideFeeBps, strategy.tightFeeBps)
        );

        bytes32 strategyHash = keccak256(abi.encode(strategy));
        (address tokenIn, address tokenOut, uint256 balanceIn, uint256 balanceOut) =
            _getInAndOut(strategy, strategyHash, zeroForOne);

        (uint256 feeBps, uint256 humanId, bool tight) = _resolveTier(strategy, msg.sender, tokenIn, amountIn);
        amountOut = _quoteExactIn(balanceIn, balanceOut, amountIn, feeBps);
        require(amountOut >= amountOutMin, InsufficientOutputAmount(amountOut, amountOutMin));

        if (tight) {
            QUOTA.recordUsage(humanId, tokenIn, amountIn);
        }

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(AQUA), amountIn);
        AQUA.push(strategy.maker, address(this), strategyHash, tokenIn, amountIn);
        AQUA.pull(strategy.maker, strategyHash, tokenOut, amountOut, to);

        emit Swapped(strategyHash, msg.sender, humanId, tight, tokenIn, tokenOut, amountIn, amountOut, feeBps);
    }

    /// @dev Tier resolution - identical logic for quote and swap so quotes are always honest.
    function _resolveTier(Strategy calldata strategy, address taker, address tokenIn, uint256 amountIn)
        internal
        view
        returns (uint256 feeBps, uint256 humanId, bool tight)
    {
        humanId = AGENT_BOOK.lookupHuman(taker);
        if (humanId != 0 && QUOTA.remaining(humanId, tokenIn) >= amountIn) {
            return (strategy.tightFeeBps, humanId, true);
        }
        return (strategy.wideFeeBps, humanId, false);
    }

    /// @dev Constant product with fee, same math as 1inch's reference XYCSwap.
    function _quoteExactIn(uint256 balanceIn, uint256 balanceOut, uint256 amountIn, uint256 feeBps)
        internal
        pure
        returns (uint256 amountOut)
    {
        uint256 amountInWithFee = amountIn * (BPS_BASE - feeBps) / BPS_BASE;
        amountOut = (amountInWithFee * balanceOut) / (balanceIn + amountInWithFee);
    }

    function _getInAndOut(Strategy calldata strategy, bytes32 strategyHash, bool zeroForOne)
        private
        view
        returns (address tokenIn, address tokenOut, uint256 balanceIn, uint256 balanceOut)
    {
        tokenIn = zeroForOne ? strategy.token0 : strategy.token1;
        tokenOut = zeroForOne ? strategy.token1 : strategy.token0;
        (balanceIn, balanceOut) = AQUA.safeBalances(strategy.maker, address(this), strategyHash, tokenIn, tokenOut);
    }
}
