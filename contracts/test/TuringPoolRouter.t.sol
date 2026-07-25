// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {AquaSwapVMTest} from "swap-vm-test/base/AquaSwapVMTest.sol";
import {Program, ProgramBuilder} from "swap-vm-test/utils/ProgramBuilder.sol";

import {SwapVM} from "swap-vm/SwapVM.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {XYCSwap} from "swap-vm/instructions/XYCSwap.sol";
import {Controls} from "swap-vm/instructions/Controls.sol";
import {BPS} from "swap-vm/instructions/Fee.sol";
import {Context} from "swap-vm/libs/VM.sol";

import {TuringPoolRouter} from "../src/swapvm/TuringPoolRouter.sol";
import {HumanGate, HumanGateArgsBuilder} from "../src/swapvm/HumanGate.sol";
import {HumanQuota} from "../src/HumanQuota.sol";
import {MockAgentBook} from "../src/mocks/MockAgentBook.sol";

contract TuringPoolRouterTest is AquaSwapVMTest, HumanGate {
    using ProgramBuilder for Program;

    uint32 internal constant WIDE_FEE_E9 = 3_000_000; // 30 bps on the 1e9 scale
    uint32 internal constant TIGHT_FEE_E9 = 800_000; // 8 bps
    uint256 internal constant HUMAN_ID = 0xbeef;
    uint256 internal constant DAILY_CAP = 500e18;
    uint256 internal constant BAL_A = 10_000e18;
    uint256 internal constant BAL_B = 10_000e18;

    HumanQuota internal quota;
    MockAgentBook internal agentBook;

    function setUp() public override {
        super.setUp();
        quota = new HumanQuota();
        agentBook = new MockAgentBook();
        quota.setAppAuthorization(address(swapVM), true);
        quota.setDailyCap(address(tokenA), DAILY_CAP);
        quota.setDailyCap(address(tokenB), DAILY_CAP);

        // `taker` is the human-backed agent, `taker2` stays anonymous (the bot).
        agentBook.register(address(taker), HUMAN_ID);
    }

    function _deployRouter() internal override returns (SwapVM) {
        return new TuringPoolRouter(address(aqua), address(0), address(this), "TuringPool", "1");
    }

    /// @dev Opcode table mirroring TuringPoolRouter._instructions(): debug-injected base + _humanGate.
    function _turingOpcodes()
        internal
        pure
        returns (function(Context memory, bytes calldata) internal[] memory result)
    {
        function(Context memory, bytes calldata) internal[] memory base = _opcodes();
        result = new function(Context memory, bytes calldata) internal[](base.length + 1);
        for (uint256 i; i < base.length; ++i) {
            result[i] = base[i];
        }
        result[base.length] = _humanGate;
    }

    function _turingProgram(uint64 salt) internal view returns (bytes memory) {
        Program memory p = ProgramBuilder.init(_turingOpcodes());
        return bytes.concat(
            p.build(
                HumanGate._humanGate,
                HumanGateArgsBuilder.build(address(agentBook), address(quota), WIDE_FEE_E9, TIGHT_FEE_E9)
            ),
            p.build(XYCSwap._xycSwapXD),
            p.build(Controls._salt, abi.encodePacked(salt))
        );
    }

    function _shipTuringStrategy(uint64 salt) internal returns (ISwapVM.Order memory order, bytes32 strategyHash) {
        order = createStrategy(_turingProgram(salt));
        tokenA.mint(maker, BAL_A);
        tokenB.mint(maker, BAL_B);
        strategyHash = shipStrategy(order, tokenA, tokenB, BAL_A, BAL_B);
    }

    function _expectedOut(uint256 balIn, uint256 balOut, uint256 amountIn, uint256 feeE9)
        internal
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn - Math.ceilDiv(amountIn * feeE9, BPS);
        return (amountInWithFee * balOut) / (balIn + amountInWithFee);
    }

    function _quoteAs(address takerAddr, ISwapVM.Order memory order, uint256 amount, bool isExactIn)
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        ISwapVM viewRouter = ISwapVM(address(swapVM));
        bytes memory data = takerData(takerAddr, isExactIn);
        vm.prank(takerAddr);
        (amountIn, amountOut,) = viewRouter.quote(order, address(tokenA), address(tokenB), amount, data);
    }

    function test_SwapVM_BotPaysWideFee() public {
        (ISwapVM.Order memory order,) = _shipTuringStrategy(1);
        uint256 amountIn = 100e18;
        SwapProgram memory sp = SwapProgram(amountIn, taker2, tokenA, tokenB, true, true);
        mintTokenInToTaker(sp);

        (, uint256 amountOut) = swap(sp, order);
        assertEq(amountOut, _expectedOut(BAL_A, BAL_B, amountIn, WIDE_FEE_E9), "bot pays 30bps");
    }

    function test_SwapVM_HumanPaysTightFee() public {
        (ISwapVM.Order memory order,) = _shipTuringStrategy(2);
        uint256 amountIn = 100e18;
        SwapProgram memory sp = SwapProgram(amountIn, taker, tokenA, tokenB, true, true);
        mintTokenInToTaker(sp);

        (, uint256 amountOut) = swap(sp, order);
        assertEq(amountOut, _expectedOut(BAL_A, BAL_B, amountIn, TIGHT_FEE_E9), "human pays 8bps");
        assertGt(amountOut, _expectedOut(BAL_A, BAL_B, amountIn, WIDE_FEE_E9), "tight beats wide");
        assertEq(quota.remaining(HUMAN_ID, address(tokenA)), DAILY_CAP - amountIn, "quota consumed");
    }

    function test_SwapVM_QuoteMatchesSwap_BothTiers() public {
        (ISwapVM.Order memory order,) = _shipTuringStrategy(3);
        uint256 amountIn = 100e18;

        (, uint256 botQuoted) = _quoteAs(address(taker2), order, amountIn, true);
        SwapProgram memory spBot = SwapProgram(amountIn, taker2, tokenA, tokenB, true, true);
        mintTokenInToTaker(spBot);
        (, uint256 botSwapped) = swap(spBot, order);
        assertEq(botQuoted, botSwapped, "bot quote == swap");

        (, uint256 humanQuoted) = _quoteAs(address(taker), order, amountIn, true);
        SwapProgram memory spHuman = SwapProgram(amountIn, taker, tokenA, tokenB, true, true);
        mintTokenInToTaker(spHuman);
        (, uint256 humanSwapped) = swap(spHuman, order);
        assertEq(humanQuoted, humanSwapped, "human quote == swap");
        assertGt(humanQuoted, 0);
    }

    function test_SwapVM_QuoteIsStaticAndConsumesNoQuota() public {
        (ISwapVM.Order memory order,) = _shipTuringStrategy(4);
        _quoteAs(address(taker), order, 100e18, true);
        assertEq(quota.remaining(HUMAN_ID, address(tokenA)), DAILY_CAP, "quotes must not consume quota");
    }

    function test_SwapVM_FeesAdaptToExecutedTierVolume() public {
        quota.configureFeeController(
            address(tokenA),
            19, // blended LP target
            5, // desired tight fee
            100, // maximum wide fee
            5, // initial tight fee
            33, // initial wide fee
            0,
            0
        );
        (ISwapVM.Order memory order,) = _shipTuringStrategy(40);
        uint256 amountIn = 100e18;

        // The configured activity schedule overrides the immutable fallback
        // bytes in the order program.
        SwapProgram memory botSwap = SwapProgram({
            amount: amountIn, taker: taker2, tokenA: tokenA, tokenB: tokenB, zeroForOne: true, isExactIn: true
        });
        mintTokenInToTaker(botSwap);
        (, uint256 botOut) = swap(botSwap, order);
        assertEq(botOut, _expectedOut(BAL_A, BAL_B, amountIn, 3_300_000), "bot starts at 33bps");

        (uint256 balanceA, uint256 balanceB) = getAquaBalances(swapVM.hash(order));
        SwapProgram memory humanSwap = SwapProgram({
            amount: amountIn, taker: taker, tokenA: tokenA, tokenB: tokenB, zeroForOne: true, isExactIn: true
        });
        mintTokenInToTaker(humanSwap);
        (, uint256 humanOut) = swap(humanSwap, order);
        assertEq(humanOut, _expectedOut(balanceA, balanceB, amountIn, 500_000), "human starts at 5bps");

        (uint256 tightFee, uint256 wideFee,, uint256 humanShare, uint256 tightVolume, uint256 wideVolume) =
            quota.feeSchedule(address(tokenA));
        assertEq(tightFee, 5);
        assertEq(wideFee, 33);
        assertEq(humanShare, 5_000);
        assertEq(tightVolume, amountIn);
        assertEq(wideVolume, amountIn);
        assertEq((tightVolume * tightFee + wideVolume * wideFee) / (tightVolume + wideVolume), 19);

        // One more large human fill shifts the volume ratio to 2:1. Both lanes
        // move around the 19bps target while preserving the 28bps risk spread:
        // (2 × 10 + 1 × 37) / 3 = 19.
        mintTokenInToTaker(humanSwap);
        swap(humanSwap, order);
        (tightFee, wideFee,, humanShare, tightVolume, wideVolume) = quota.feeSchedule(address(tokenA));
        assertEq(tightFee, 10);
        assertEq(wideFee, 37);
        assertEq(humanShare, 6_666);
        assertEq(tightVolume, amountIn * 2);
        assertEq(wideVolume, amountIn);

        (balanceA, balanceB) = getAquaBalances(swapVM.hash(order));
        (, uint256 repricedBotQuote) = _quoteAs(address(taker2), order, amountIn, true);
        assertEq(
            repricedBotQuote,
            _expectedOut(balanceA, balanceB, amountIn, 3_700_000),
            "next bot quote uses volume-priced fee"
        );
    }

    function test_SwapVM_QuotesDoNotChangeActivityVolumes() public {
        quota.configureFeeController(address(tokenA), 19, 5, 100, 5, 33, 10e18, 20e18);
        (ISwapVM.Order memory order,) = _shipTuringStrategy(41);

        _quoteAs(address(taker), order, 100e18, true);
        _quoteAs(address(taker2), order, 1_000e18, true);

        (,,,, uint256 tightVolume, uint256 wideVolume) = quota.feeSchedule(address(tokenA));
        assertEq(tightVolume, 10e18, "static human quote must not alter volume");
        assertEq(wideVolume, 20e18, "static bot quote must not alter volume");
    }

    function test_SwapVM_SingleLaneStillMeetsLpTarget() public {
        quota.configureFeeController(address(tokenA), 19, 5, 100, 5, 33, 100e18, 0);
        (uint256 tightFee, uint256 wideFee,,,,) = quota.feeSchedule(address(tokenA));
        assertEq(tightFee, 19, "human-only flow must fund the LP target");
        assertEq(wideFee, 47, "unused bot lane preserves the risk spread");

        quota.configureFeeController(address(tokenA), 19, 5, 100, 5, 33, 0, 100e18);
        (tightFee, wideFee,,,,) = quota.feeSchedule(address(tokenA));
        assertEq(tightFee, 5, "unused human lane keeps the discount floor");
        assertEq(wideFee, 19, "bot-only flow must fund the LP target");
    }

    function test_SwapVM_UsesNotionalVolumeRatherThanSwapCount() public {
        quota.configureFeeController(address(tokenA), 19, 5, 100, 5, 33, 0, 0);
        (ISwapVM.Order memory order,) = _shipTuringStrategy(42);

        // Exactly one fill per lane, but the human fill is twice the size.
        // A count-based controller would see 50/50 and stay at 5/33. The
        // executed notional is 2:1, so the balanced curve moves to 10/37.
        SwapProgram memory botSwap = SwapProgram({
            amount: 100e18, taker: taker2, tokenA: tokenA, tokenB: tokenB, zeroForOne: true, isExactIn: true
        });
        mintTokenInToTaker(botSwap);
        swap(botSwap, order);

        SwapProgram memory humanSwap = SwapProgram({
            amount: 200e18, taker: taker, tokenA: tokenA, tokenB: tokenB, zeroForOne: true, isExactIn: true
        });
        mintTokenInToTaker(humanSwap);
        swap(humanSwap, order);

        (uint256 tightFee, uint256 wideFee,, uint256 humanShare, uint256 tightVolume, uint256 wideVolume) =
            quota.feeSchedule(address(tokenA));
        assertEq(tightFee, 10);
        assertEq(wideFee, 37);
        assertEq(humanShare, 6_666);
        assertEq(tightVolume, 200e18);
        assertEq(wideVolume, 100e18);
    }

    function test_SwapVM_SybilWalletSharesCap() public {
        (ISwapVM.Order memory order,) = _shipTuringStrategy(5);

        // Human's first wallet consumes the entire cap at the tight tier.
        SwapProgram memory sp = SwapProgram(DAILY_CAP, taker, tokenA, tokenB, true, true);
        mintTokenInToTaker(sp);
        swap(sp, order);
        assertEq(quota.remaining(HUMAN_ID, address(tokenA)), 0);

        // Second wallet, same human: registered but over-cap => wide tier.
        agentBook.register(address(taker2), HUMAN_ID);
        uint256 amountIn = 50e18;
        (uint256 balA, uint256 balB) = getAquaBalances(swapVM.hash(order));
        SwapProgram memory sp2 = SwapProgram(amountIn, taker2, tokenA, tokenB, true, true);
        mintTokenInToTaker(sp2);
        (, uint256 amountOut) = swap(sp2, order);
        assertEq(amountOut, _expectedOut(balA, balB, amountIn, WIDE_FEE_E9), "sybil wallet gets wide tier");
    }

    function test_SwapVM_ExactOutQuotaOnTokenOut() public {
        (ISwapVM.Order memory order,) = _shipTuringStrategy(6);
        uint256 amountOut = 100e18;

        SwapProgram memory sp = SwapProgram(amountOut, taker, tokenA, tokenB, true, false);
        mintTokenInToTaker(sp, 200e18);
        (uint256 amountIn,) = swap(sp, order);

        assertGt(amountIn, 0);
        assertEq(quota.remaining(HUMAN_ID, address(tokenB)), DAILY_CAP - amountOut, "exactOut quota on tokenOut");
        // Tight exactOut must need less input than wide would.
        uint256 wideAmountInNoFee = Math.ceilDiv(amountOut * BAL_A, BAL_B - amountOut);
        uint256 wideAmountIn = wideAmountInNoFee + Math.ceilDiv(wideAmountInNoFee * WIDE_FEE_E9, BPS - WIDE_FEE_E9);
        assertLt(amountIn, wideAmountIn, "tight exactOut cheaper than wide");
    }

    function test_SwapVM_HumanGatedEventEmitted() public {
        (ISwapVM.Order memory order, bytes32 strategyHash) = _shipTuringStrategy(7);
        uint256 amountIn = 100e18;
        SwapProgram memory sp = SwapProgram(amountIn, taker, tokenA, tokenB, true, true);
        mintTokenInToTaker(sp);

        vm.expectEmit(true, true, true, true, address(swapVM));
        emit HumanGate.HumanGated(strategyHash, address(taker), HUMAN_ID, true, TIGHT_FEE_E9);
        swap(sp, order);
    }

    function test_SwapVM_OpcodeIndexIsStable() public view {
        assertEq(TuringPoolRouter(payable(address(swapVM))).humanGateOpcode(), 34, "humanGate opcode index");
    }
}
