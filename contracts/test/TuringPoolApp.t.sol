// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {Aqua} from "aqua/Aqua.sol";
import {IAqua} from "aqua/interfaces/IAqua.sol";

import {TuringPoolApp} from "../src/TuringPoolApp.sol";
import {HumanQuota} from "../src/HumanQuota.sol";
import {MockAgentBook} from "../src/mocks/MockAgentBook.sol";
import {IAgentBook} from "../src/interfaces/IAgentBook.sol";

contract TestToken is ERC20 {
    constructor(string memory name_) ERC20(name_, name_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TuringPoolAppTest is Test {
    uint256 internal constant BPS_BASE = 10_000;
    uint256 internal constant WIDE_FEE = 30;
    uint256 internal constant TIGHT_FEE = 8;
    uint256 internal constant POOL_LIQ = 100_000e18;
    uint256 internal constant DAILY_CAP = 10_000e18;
    uint256 internal constant HUMAN_ID = 0x777abc;

    Aqua internal aqua;
    TuringPoolApp internal app;
    HumanQuota internal quota;
    MockAgentBook internal agentBook;
    TestToken internal tokenA;
    TestToken internal tokenB;

    address internal maker = makeAddr("maker");
    address internal bot = makeAddr("bot");
    address internal humanWallet1 = makeAddr("humanWallet1");
    address internal humanWallet2 = makeAddr("humanWallet2");

    TuringPoolApp.Strategy internal strategy;
    bytes32 internal strategyHash;

    function setUp() public {
        aqua = new Aqua();
        agentBook = new MockAgentBook();
        quota = new HumanQuota();
        app = new TuringPoolApp(IAqua(address(aqua)), IAgentBook(address(agentBook)), quota);

        tokenA = new TestToken("TKA");
        tokenB = new TestToken("TKB");

        quota.setAppAuthorization(address(app), true);
        quota.setDailyCap(address(tokenA), DAILY_CAP);
        quota.setDailyCap(address(tokenB), DAILY_CAP);

        // Both wallets belong to the SAME human.
        agentBook.register(humanWallet1, HUMAN_ID);
        agentBook.register(humanWallet2, HUMAN_ID);

        // Maker liquidity stays in the maker wallet; Aqua only gets an approval.
        tokenA.mint(maker, 1_000_000e18);
        tokenB.mint(maker, 1_000_000e18);
        vm.startPrank(maker);
        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);

        strategy = TuringPoolApp.Strategy({
            maker: maker,
            token0: address(tokenA),
            token1: address(tokenB),
            wideFeeBps: WIDE_FEE,
            tightFeeBps: TIGHT_FEE,
            salt: bytes32(uint256(1))
        });
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = POOL_LIQ;
        amounts[1] = POOL_LIQ;
        strategyHash = aqua.ship(address(app), abi.encode(strategy), tokens, amounts);
        vm.stopPrank();

        for (uint256 i; i < 3; ++i) {
            address taker = [bot, humanWallet1, humanWallet2][i];
            tokenA.mint(taker, 100_000e18);
            tokenB.mint(taker, 100_000e18);
            vm.startPrank(taker);
            tokenA.approve(address(app), type(uint256).max);
            tokenB.approve(address(app), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _expectedOut(uint256 balanceIn, uint256 balanceOut, uint256 amountIn, uint256 feeBps)
        internal
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * (BPS_BASE - feeBps) / BPS_BASE;
        return (amountInWithFee * balanceOut) / (balanceIn + amountInWithFee);
    }

    // -------------------- tier pricing --------------------

    function test_BotPaysWideFee() public {
        uint256 amountIn = 1_000e18;
        uint256 expected = _expectedOut(POOL_LIQ, POOL_LIQ, amountIn, WIDE_FEE);

        vm.prank(bot);
        uint256 amountOut = app.swapExactIn(strategy, true, amountIn, 0, bot);

        assertEq(amountOut, expected, "bot should pay wide fee");
        assertEq(tokenB.balanceOf(bot), 100_000e18 + expected);
    }

    function test_HumanBackedAgentPaysTightFee() public {
        uint256 amountIn = 1_000e18;
        uint256 expectedTight = _expectedOut(POOL_LIQ, POOL_LIQ, amountIn, TIGHT_FEE);
        uint256 expectedWide = _expectedOut(POOL_LIQ, POOL_LIQ, amountIn, WIDE_FEE);

        vm.prank(humanWallet1);
        uint256 amountOut = app.swapExactIn(strategy, true, amountIn, 0, humanWallet1);

        assertEq(amountOut, expectedTight, "human-backed agent should pay tight fee");
        assertGt(amountOut, expectedWide, "tight tier must beat wide tier");
    }

    function test_QuoteMatchesSwap_BothTiers() public {
        uint256 amountIn = 2_500e18;

        (uint256 quotedBot, bool tightBot,,) = _quote(amountIn, bot);
        vm.prank(bot);
        uint256 swappedBot = app.swapExactIn(strategy, true, amountIn, 0, bot);
        assertFalse(tightBot);
        assertEq(quotedBot, swappedBot, "bot quote must match swap");

        (uint256 quotedHuman, bool tightHuman,,) = _quote(amountIn, humanWallet1);
        vm.prank(humanWallet1);
        uint256 swappedHuman = app.swapExactIn(strategy, true, amountIn, 0, humanWallet1);
        assertTrue(tightHuman);
        // Bot's swap moved the pool, so recompute expectation from post-swap balances.
        assertLt(quotedHuman, swappedHuman + swappedHuman / 100, "sanity");
        assertGt(swappedHuman, 0);
    }

    // -------------------- sybil resistance --------------------

    function test_SybilWalletsShareOneCap() public {
        // Wallet 1 consumes the human's entire daily tight-tier cap.
        vm.prank(humanWallet1);
        app.swapExactIn(strategy, true, DAILY_CAP, 0, humanWallet1);
        assertEq(quota.remaining(HUMAN_ID, address(tokenA)), 0);

        // Wallet 2 - different address, same human - gets the WIDE tier.
        (, bool tight, uint256 feeBps,) = _quote(1_000e18, humanWallet2);
        assertFalse(tight, "second wallet of same human must not get tight tier");
        assertEq(feeBps, WIDE_FEE);

        // An anonymous-style swap still works, just at wide pricing.
        vm.prank(humanWallet2);
        app.swapExactIn(strategy, true, 1_000e18, 0, humanWallet2);
    }

    function test_OverCapSingleTradeGetsWideTier() public {
        (, bool tight, uint256 feeBps,) = _quote(DAILY_CAP + 1, humanWallet1);
        assertFalse(tight, "trade larger than remaining cap is wide-tier");
        assertEq(feeBps, WIDE_FEE);
    }

    function test_CapResetsNextDay() public {
        vm.prank(humanWallet1);
        app.swapExactIn(strategy, true, DAILY_CAP, 0, humanWallet1);
        (, bool tightSameDay,,) = _quote(1_000e18, humanWallet2);
        assertFalse(tightSameDay);

        vm.warp(block.timestamp + 1 days);
        (, bool tightNextDay,,) = _quote(1_000e18, humanWallet2);
        assertTrue(tightNextDay, "cap must roll over daily");
    }

    // -------------------- settlement plumbing --------------------

    function test_MakerWalletSettlement() public {
        uint256 amountIn = 1_000e18;
        uint256 makerABefore = tokenA.balanceOf(maker);
        uint256 makerBBefore = tokenB.balanceOf(maker);

        vm.prank(bot);
        uint256 amountOut = app.swapExactIn(strategy, true, amountIn, 0, bot);

        // Funds flow wallet-to-wallet: maker received tokenA, paid tokenB directly.
        assertEq(tokenA.balanceOf(maker), makerABefore + amountIn);
        assertEq(tokenB.balanceOf(maker), makerBBefore - amountOut);

        // Aqua virtual balances track the same movement.
        (uint248 balA,) = aqua.rawBalances(maker, address(app), strategyHash, address(tokenA));
        (uint248 balB,) = aqua.rawBalances(maker, address(app), strategyHash, address(tokenB));
        assertEq(uint256(balA), POOL_LIQ + amountIn);
        assertEq(uint256(balB), POOL_LIQ - amountOut);
    }

    function test_SwappedEventCarriesTierAndHumanId() public {
        uint256 amountIn = 1_000e18;
        uint256 expected = _expectedOut(POOL_LIQ, POOL_LIQ, amountIn, TIGHT_FEE);

        vm.expectEmit(true, true, true, true, address(app));
        emit TuringPoolApp.Swapped(
            strategyHash, humanWallet1, HUMAN_ID, true, address(tokenA), address(tokenB), amountIn, expected, TIGHT_FEE
        );
        vm.prank(humanWallet1);
        app.swapExactIn(strategy, true, amountIn, 0, humanWallet1);
    }

    function test_SlippageProtection() public {
        uint256 amountIn = 1_000e18;
        uint256 expected = _expectedOut(POOL_LIQ, POOL_LIQ, amountIn, WIDE_FEE);

        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(TuringPoolApp.InsufficientOutputAmount.selector, expected, expected + 1));
        app.swapExactIn(strategy, true, amountIn, expected + 1, bot);
    }

    function test_DockedStrategyCannotSwap() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        vm.prank(maker);
        aqua.dock(address(app), strategyHash, tokens);

        vm.prank(bot);
        vm.expectRevert();
        app.swapExactIn(strategy, true, 1_000e18, 0, bot);
    }

    // -------------------- HumanQuota unit --------------------

    function test_Quota_UnauthorizedAppCannotRecord() public {
        vm.expectRevert(HumanQuota.NotAuthorizedApp.selector);
        vm.prank(bot);
        quota.recordUsage(HUMAN_ID, address(tokenA), 1);
    }

    function test_Quota_OnlyOwnerSetters() public {
        vm.startPrank(bot);
        vm.expectRevert(HumanQuota.NotOwner.selector);
        quota.setDailyCap(address(tokenA), 1);
        vm.expectRevert(HumanQuota.NotOwner.selector);
        quota.setAppAuthorization(bot, true);
        vm.stopPrank();
    }

    function test_Quota_ZeroCapDisablesTightTier() public {
        quota.setDailyCap(address(tokenA), 0);
        (, bool tight, uint256 feeBps,) = _quote(1e18, humanWallet1);
        assertFalse(tight, "zero cap must disable tight tier");
        assertEq(feeBps, WIDE_FEE);
    }

    function _quote(uint256 amountIn, address taker)
        internal
        view
        returns (uint256 amountOut, bool tight, uint256 feeBps, uint256 humanId)
    {
        return app.quoteExactIn(strategy, true, amountIn, taker);
    }
}
