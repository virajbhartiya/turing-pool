// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {Aqua} from "aqua/Aqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraits, MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";
import {TakerTraitsLib} from "swap-vm/libs/TakerTraits.sol";

import {HumanQuota} from "../src/HumanQuota.sol";
import {MockAgentBook} from "../src/mocks/MockAgentBook.sol";
import {TuringPoolRouter} from "../src/swapvm/TuringPoolRouter.sol";
import {TuringPoolVault} from "../src/vault/TuringPoolVault.sol";
import {TuringPoolVaultFactory} from "../src/vault/TuringPoolVaultFactory.sol";

contract VaultToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TuringPoolVaultTest is Test {
    using MakerTraitsLib for MakerTraits;

    uint256 internal constant DAILY_CAP0 = 10_000e18;
    uint256 internal constant DAILY_CAP1 = 20_000e18;
    uint256 internal constant INITIAL0 = 10_000e18;
    uint256 internal constant INITIAL1 = 20_000e18;

    Aqua internal aqua;
    MockAgentBook internal agentBook;
    TuringPoolRouter internal router;
    TuringPoolVaultFactory internal factory;
    TuringPoolVault internal vault;
    HumanQuota internal quota;
    VaultToken internal token0;
    VaultToken internal token1;

    address internal manager = makeAddr("manager");
    address internal lp1 = makeAddr("lp1");
    address internal lp2 = makeAddr("lp2");
    address internal bot = makeAddr("bot");

    function setUp() public {
        aqua = new Aqua();
        agentBook = new MockAgentBook();
        router = new TuringPoolRouter(address(aqua), address(0), address(this), "TuringPool", "1");
        factory = new TuringPoolVaultFactory(aqua, ISwapVM(address(router)), address(agentBook));
        token0 = new VaultToken("Token Zero", "TK0");
        token1 = new VaultToken("Token One", "TK1");

        (vault, quota) = factory.createVault(_config(manager));

        token0.mint(lp1, 100_000e18);
        token1.mint(lp1, 200_000e18);
        token0.mint(lp2, 100_000e18);
        token1.mint(lp2, 200_000e18);

        vm.startPrank(lp1);
        token0.approve(address(vault), type(uint256).max);
        token1.approve(address(vault), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(lp2);
        token0.approve(address(vault), type(uint256).max);
        token1.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function test_FactoryCreatesIndependentlyOwnedPoolController() public view {
        assertEq(factory.vaultCount(), 1);
        assertEq(factory.vaultAt(0), address(vault));
        assertEq(factory.quotaOf(address(vault)), address(quota));
        assertTrue(factory.isVault(address(vault)));
        assertEq(vault.owner(), manager);
        assertEq(quota.owner(), manager);
        assertTrue(quota.authorizedApps(address(router)));
        assertEq(address(vault.AQUA()), address(aqua));
        assertEq(address(vault.ROUTER()), address(router));
        assertEq(vault.AGENT_BOOK(), address(agentBook));
    }

    function test_FirstDepositShipsRealHumanGateSwapVMOrder() public {
        vm.prank(lp1);
        (uint256 shares, uint256 amount0, uint256 amount1) = vault.deposit(INITIAL0, INITIAL1, 0, lp1);

        assertGt(shares, 0);
        assertEq(amount0, INITIAL0);
        assertEq(amount1, INITIAL1);
        assertEq(vault.totalSupply(), shares + vault.MINIMUM_LIQUIDITY());
        assertEq(vault.balanceOf(vault.LOCKED_SHARES()), vault.MINIMUM_LIQUIDITY());
        assertTrue(vault.strategyActive());
        assertEq(vault.strategyNonce(), 1);

        ISwapVM.Order memory order = vault.currentOrder();
        assertEq(order.maker, address(vault));
        assertTrue(order.traits.useAquaInsteadOfSignature());
        assertEq(uint8(order.data[0]), vault.OP_HUMAN_GATE());
        assertEq(uint8(order.data[1]), 48);
        assertEq(router.hash(order), vault.currentOrderHash());

        (uint256 aqua0, uint256 aqua1) = aqua.safeBalances(
            address(vault), address(router), vault.currentOrderHash(), address(token0), address(token1)
        );
        assertEq(aqua0, INITIAL0);
        assertEq(aqua1, INITIAL1);
    }

    function test_SecondDepositUsesPoolRatioAndMigratesImmutableAquaOrder() public {
        _seed();
        bytes32 previousOrderHash = vault.currentOrderHash();
        uint256 lp2Token1Before = token1.balanceOf(lp2);

        vm.prank(lp2);
        (uint256 shares, uint256 amount0, uint256 amount1) = vault.deposit(1_000e18, 10_000e18, 0, lp2);

        assertGt(shares, 0);
        assertEq(amount0, 1_000e18);
        assertEq(amount1, 2_000e18, "only proportional token1 should be consumed");
        assertEq(token1.balanceOf(lp2), lp2Token1Before - amount1);
        assertNotEq(vault.currentOrderHash(), previousOrderHash);
        assertEq(vault.strategyNonce(), 2);
        assertFalse(quota.authorizedOrders(address(router), previousOrderHash));
        assertTrue(quota.authorizedOrders(address(router), vault.currentOrderHash()));

        (uint248 oldBalance, uint8 oldTokenCount) =
            aqua.rawBalances(address(vault), address(router), previousOrderHash, address(token0));
        assertEq(oldBalance, 0);
        assertEq(oldTokenCount, type(uint8).max, "old immutable order must be docked");

        (uint256 aqua0, uint256 aqua1) = aqua.safeBalances(
            address(vault), address(router), vault.currentOrderHash(), address(token0), address(token1)
        );
        assertEq(aqua0, INITIAL0 + amount0);
        assertEq(aqua1, INITIAL1 + amount1);
    }

    function test_SharedRouterCannotRecordVolumeForAnUnrelatedOrder() public {
        _seed();
        bytes32 unrelatedOrderHash = keccak256("another vault's order");

        vm.prank(address(router));
        vm.expectRevert(HumanQuota.UnauthorizedOrder.selector);
        quota.recordTrade(unrelatedOrderHash, 0, address(token0), 100e18, false);

        (,,,, uint256 tightVolume, uint256 wideVolume) = quota.feeSchedule(address(token0));
        assertEq(tightVolume, 0);
        assertEq(wideVolume, 0);
    }

    function test_SwapSettlesAgainstVaultAndRepricesItsDedicatedController() public {
        _seed();
        uint256 amountIn = 100e18;
        token0.mint(bot, amountIn);
        vm.prank(bot);
        token0.approve(address(router), amountIn);

        ISwapVM.Order memory order = vault.currentOrder();
        bytes memory takerData = _takerData(bot);
        uint256 token1Before = token1.balanceOf(bot);
        vm.prank(bot);
        (uint256 actualIn, uint256 actualOut, bytes32 orderHash) =
            router.swap(order, address(token0), address(token1), amountIn, takerData);

        assertEq(actualIn, amountIn);
        assertGt(actualOut, 0);
        assertEq(orderHash, vault.currentOrderHash());
        assertEq(token1.balanceOf(bot), token1Before + actualOut);
        assertEq(token0.balanceOf(address(vault)), INITIAL0 + amountIn);
        assertEq(token1.balanceOf(address(vault)), INITIAL1 - actualOut);

        (,,,, uint256 tightVolume, uint256 wideVolume) = quota.feeSchedule(address(token0));
        assertEq(tightVolume, 0);
        assertEq(wideVolume, amountIn);

        (uint256 aqua0, uint256 aqua1) = aqua.safeBalances(
            address(vault), address(router), vault.currentOrderHash(), address(token0), address(token1)
        );
        assertEq(aqua0, token0.balanceOf(address(vault)));
        assertEq(aqua1, token1.balanceOf(address(vault)));
    }

    function test_RedeemReturnsProRataLiveInventoryAndKeepsPoolTradable() public {
        _seed();
        vm.prank(lp2);
        (uint256 lp2Shares,,) = vault.deposit(1_000e18, 2_000e18, 0, lp2);
        bytes32 previousOrderHash = vault.currentOrderHash();
        (uint256 expected0, uint256 expected1) = vault.previewRedeem(lp2Shares);

        uint256 balance0Before = token0.balanceOf(lp2);
        uint256 balance1Before = token1.balanceOf(lp2);
        vm.prank(lp2);
        (uint256 amount0, uint256 amount1) = vault.redeem(lp2Shares, expected0, expected1, lp2);

        assertEq(amount0, expected0);
        assertEq(amount1, expected1);
        assertEq(token0.balanceOf(lp2), balance0Before + expected0);
        assertEq(token1.balanceOf(lp2), balance1Before + expected1);
        assertEq(vault.balanceOf(lp2), 0);
        assertTrue(vault.strategyActive());
        assertNotEq(vault.currentOrderHash(), previousOrderHash);
    }

    function test_PauseDocksLiquidityButNeverBlocksRedemptions() public {
        uint256 lp1Shares = _seed();
        bytes32 activeOrderHash = vault.currentOrderHash();

        vm.prank(manager);
        vault.pause();
        assertTrue(vault.paused());
        assertFalse(vault.strategyActive());
        (, uint8 oldTokenCount) = aqua.rawBalances(address(vault), address(router), activeOrderHash, address(token0));
        assertEq(oldTokenCount, type(uint8).max);

        vm.prank(lp2);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1_000e18, 2_000e18, 0, lp2);

        uint256 redeemShares = lp1Shares / 4;
        vm.prank(lp1);
        vault.redeem(redeemShares, 0, 0, lp1);
        assertFalse(vault.strategyActive(), "paused redemption must not re-ship liquidity");

        vm.prank(manager);
        vault.unpause();
        assertFalse(vault.paused());
        assertTrue(vault.strategyActive());
    }

    function test_NewVaultGetsIndependentVolumeAndFeeState() public {
        _seed();
        (TuringPoolVault secondVault, HumanQuota secondQuota) = factory.createVault(_config(lp2));

        assertNotEq(address(secondVault), address(vault));
        assertNotEq(address(secondQuota), address(quota));
        assertEq(factory.vaultCount(), 2);

        vm.prank(manager);
        quota.configureFeeController(address(token0), 40, 10, 100, 20, 60, 1e18, 1e18);
        (uint256 firstTight, uint256 firstWide, uint256 firstTarget,,,) = quota.feeSchedule(address(token0));
        (uint256 secondTight, uint256 secondWide, uint256 secondTarget,,,) = secondQuota.feeSchedule(address(token0));
        assertEq(firstTight, 20);
        assertEq(secondTight, 20);
        assertNotEq(firstWide, secondWide);
        assertNotEq(firstTarget, secondTarget);
    }

    function test_OnlyManagerCanPauseOrChangeQuotaPolicy() public {
        _seed();
        vm.prank(lp1);
        vm.expectRevert();
        vault.pause();

        vm.prank(lp1);
        vm.expectRevert(HumanQuota.NotOwner.selector);
        quota.setDailyCap(address(token0), 1);

        vm.prank(manager);
        quota.setDailyCap(address(token0), 1);
        assertEq(quota.dailyCap(address(token0)), 1);
    }

    function _seed() private returns (uint256 shares) {
        vm.prank(lp1);
        (shares,,) = vault.deposit(INITIAL0, INITIAL1, 0, lp1);
    }

    function _config(address poolManager) private view returns (TuringPoolVaultFactory.VaultConfig memory config) {
        config = TuringPoolVaultFactory.VaultConfig({
            token0: IERC20(address(token0)),
            token1: IERC20(address(token1)),
            manager: poolManager,
            name: "Turing Pool LP",
            symbol: "tpLP",
            dailyCap0: DAILY_CAP0,
            dailyCap1: DAILY_CAP1,
            targetFeeBps: 30,
            desiredTightFeeBps: 5,
            maxWideFeeBps: 100,
            initialTightFeeBps: 20,
            initialWideFeeBps: 50,
            seedToken0TightVolume: 0,
            seedToken0WideVolume: 0,
            seedToken1TightVolume: 0,
            seedToken1WideVolume: 0
        });
    }

    function _takerData(address taker) private pure returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: taker,
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: true,
                useTransferFromAndAquaPush: true,
                threshold: "",
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }
}
