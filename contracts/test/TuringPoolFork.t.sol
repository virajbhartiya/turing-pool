// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAqua } from "aqua/interfaces/IAqua.sol";

import { TuringPoolApp } from "../src/TuringPoolApp.sol";
import { HumanQuota } from "../src/HumanQuota.sol";
import { IAgentBook } from "../src/interfaces/IAgentBook.sol";

/// @notice Integration test against the REAL deployed contracts on Base mainnet:
///         - 1inch Aqua (AquaRouter)  0x499943e74fb0ce105688beee8ef2abec5d936d31
///         - World AgentBook          0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4
///         Run with: RUN_FORK_TESTS=1 forge test --match-contract Fork -vv
///         (BASE_RPC_URL overrides the default public RPC.)
contract TuringPoolForkTest is Test {
    address internal constant AQUA = 0x499943E74FB0cE105688beeE8Ef2ABec5D936d31;
    address internal constant AGENT_BOOK = 0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    /// @dev lookupHuman is the mapping at slot 4 of AgentBook
    ///      (0: Ownable._owner, 1: Ownable2Step._pendingOwner, 2: worldIdRouter, 3: groupId).
    uint256 internal constant LOOKUP_HUMAN_SLOT = 4;

    uint256 internal constant HUMAN_ID = uint256(keccak256("turing-pool-demo-human"));

    TuringPoolApp internal app;
    HumanQuota internal quota;
    TuringPoolApp.Strategy internal strategy;
    bytes32 internal strategyHash;

    address internal maker = makeAddr("maker");
    address internal bot = makeAddr("bot");
    address internal humanAgent = makeAddr("humanAgent");

    function setUp() public {
        if (!_forkEnabled()) return;
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));

        quota = new HumanQuota();
        app = new TuringPoolApp(IAqua(AQUA), IAgentBook(AGENT_BOOK), quota);
        quota.setAppAuthorization(address(app), true);
        quota.setDailyCap(WETH, 1 ether);
        quota.setDailyCap(USDC, 4_000e6);

        // Register our demo agent in the REAL AgentBook's storage on the fork.
        vm.store(AGENT_BOOK, keccak256(abi.encode(humanAgent, LOOKUP_HUMAN_SLOT)), bytes32(HUMAN_ID));

        deal(WETH, maker, 100 ether);
        deal(USDC, maker, 400_000e6);
        deal(WETH, bot, 10 ether);
        deal(WETH, humanAgent, 10 ether);

        vm.startPrank(maker);
        IERC20(WETH).approve(AQUA, type(uint256).max);
        IERC20(USDC).approve(AQUA, type(uint256).max);
        strategy = TuringPoolApp.Strategy({
            maker: maker,
            token0: WETH,
            token1: USDC,
            wideFeeBps: 30,
            tightFeeBps: 8,
            salt: bytes32(uint256(42))
        });
        address[] memory tokens = new address[](2);
        tokens[0] = WETH;
        tokens[1] = USDC;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 50 ether;
        amounts[1] = 200_000e6;
        strategyHash = IAqua(AQUA).ship(address(app), abi.encode(strategy), tokens, amounts);
        vm.stopPrank();

        vm.prank(bot);
        IERC20(WETH).approve(address(app), type(uint256).max);
        vm.prank(humanAgent);
        IERC20(WETH).approve(address(app), type(uint256).max);
    }

    function test_Fork_RealAgentBookStorageLayoutMatches() public view {
        if (!_forkEnabled()) return;
        // Our computed slot must round-trip through the real deployed bytecode's getter.
        assertEq(IAgentBook(AGENT_BOOK).lookupHuman(humanAgent), HUMAN_ID, "slot math vs real bytecode");
        assertEq(IAgentBook(AGENT_BOOK).lookupHuman(bot), 0, "bot must be unregistered");
    }

    function test_Fork_TieredPricingOnRealAqua() public {
        if (!_forkEnabled()) return;
        uint256 amountIn = 0.5 ether;

        (uint256 botQuote, bool botTight,,) = app.quoteExactIn(strategy, true, amountIn, bot);
        (uint256 humanQuote, bool humanTight,, uint256 humanId) =
            app.quoteExactIn(strategy, true, amountIn, humanAgent);

        assertFalse(botTight);
        assertTrue(humanTight);
        assertEq(humanId, HUMAN_ID);
        assertGt(humanQuote, botQuote, "human-backed agent must be quoted more USDC");

        // Execute both swaps for real against the live Aqua deployment.
        vm.prank(bot);
        uint256 botOut = app.swapExactIn(strategy, true, amountIn, 0, bot);
        vm.prank(humanAgent);
        uint256 humanOut = app.swapExactIn(strategy, true, amountIn, 0, humanAgent);

        assertEq(botOut, botQuote, "bot quote == swap");
        assertGt(humanOut, 0);
        assertEq(IERC20(USDC).balanceOf(bot), botOut);
        assertEq(IERC20(USDC).balanceOf(humanAgent), humanOut);
    }

    function test_Fork_QuotaEnforcedOnRealStack() public {
        if (!_forkEnabled()) return;

        // Consume the whole daily WETH cap at the tight tier.
        vm.prank(humanAgent);
        app.swapExactIn(strategy, true, 1 ether, 0, humanAgent);
        assertEq(quota.remaining(HUMAN_ID, WETH), 0);

        // A sybil wallet of the same human is over-cap -> wide tier.
        address sybil = makeAddr("sybil");
        vm.store(AGENT_BOOK, keccak256(abi.encode(sybil, LOOKUP_HUMAN_SLOT)), bytes32(HUMAN_ID));
        (, bool tight, uint256 feeBps,) = app.quoteExactIn(strategy, true, 0.5 ether, sybil);
        assertFalse(tight);
        assertEq(feeBps, 30);
    }

    function _forkEnabled() internal view returns (bool) {
        return bytes(vm.envOr("RUN_FORK_TESTS", string(""))).length != 0;
    }
}
