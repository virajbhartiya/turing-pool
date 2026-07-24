// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Context, ContextLib} from "swap-vm/libs/VM.sol";
import {BPS} from "swap-vm/instructions/Fee.sol";

import {IAgentBook} from "../interfaces/IAgentBook.sol";
import {HumanQuota} from "../HumanQuota.sol";

/// @dev Builds the 48-byte immutable args for the _humanGate instruction:
///      agentBook(20) | quota(20) | wideFeeE9(4) | tightFeeE9(4).
///      Fees use SwapVM's fee scale where 1e9 = 100% (so 1 bps = 1e5).
library HumanGateArgsBuilder {
    function build(address agentBook, address quota, uint32 wideFeeE9, uint32 tightFeeE9)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(agentBook, quota, wideFeeE9, tightFeeE9);
    }
}

/// @title HumanGate - a SwapVM instruction that prices personhood
/// @notice Continuation-style instruction (same shape as Fee._flatFeeAmountInXD): it
///         resolves whether the taker is an agent backed by a unique human via World's
///         AgentBook, checks the human's remaining daily quota, applies the tight or
///         wide fee to the REST of the program, and (swap context only) records quota
///         usage. Quotes and swaps share this exact code path, so quotes are honest.
/// @dev Must be the first pricing instruction in the program, before any swap-math opcode.
abstract contract HumanGate {
    using ContextLib for Context;

    error HumanGateInvalidArgs(uint256 length);
    error HumanGateMustRunBeforeSwapComputation();

    /// @notice Emitted during swaps (not quotes); the subgraph reads tiers from this.
    event HumanGated(
        bytes32 indexed orderHash, address indexed taker, uint256 indexed humanId, bool tight, uint256 feeE9
    );

    uint256 private constant ARGS_LENGTH = 48;

    function _humanGate(Context memory ctx, bytes calldata args) internal {
        require(args.length == ARGS_LENGTH, HumanGateInvalidArgs(args.length));
        require(ctx.swap.amountIn == 0 || ctx.swap.amountOut == 0, HumanGateMustRunBeforeSwapComputation());

        IAgentBook agentBook = IAgentBook(address(bytes20(args[0:20])));
        HumanQuota quota = HumanQuota(address(bytes20(args[20:40])));
        uint256 feeE9 = uint32(bytes4(args[40:44])); // wide by default

        uint256 humanId = agentBook.lookupHuman(ctx.query.taker);
        bool tight;
        if (humanId != 0) {
            // Quota is denominated in the token whose amount the taker fixed.
            (address quotaToken, uint256 quotaAmount) =
                ctx.query.isExactIn ? (ctx.query.tokenIn, ctx.swap.amountIn) : (ctx.query.tokenOut, ctx.swap.amountOut);
            if (quota.remaining(humanId, quotaToken) >= quotaAmount) {
                tight = true;
                feeE9 = uint32(bytes4(args[44:48]));
                if (!ctx.vm.isStaticContext) {
                    quota.recordUsage(humanId, quotaToken, quotaAmount);
                }
            }
        }

        if (!ctx.vm.isStaticContext) {
            emit HumanGated(ctx.query.orderHash, ctx.query.taker, humanId, tight, feeE9);
        }

        // Apply the resolved fee continuation-style, mirroring Fee._flatFeeAmountInXD.
        if (ctx.query.isExactIn) {
            uint256 takerDefinedAmountIn = ctx.swap.amountIn;
            ctx.swap.amountIn -= Math.ceilDiv(ctx.swap.amountIn * feeE9, BPS);
            ctx.runLoop();
            ctx.swap.amountIn = takerDefinedAmountIn;
        } else {
            ctx.runLoop();
            ctx.swap.amountIn += Math.ceilDiv(ctx.swap.amountIn * feeE9, BPS - feeE9);
        }
    }
}
