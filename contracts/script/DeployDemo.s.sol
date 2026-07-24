// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {Aqua} from "aqua/Aqua.sol";
import {IAqua} from "aqua/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraits, MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";

import {TuringPoolApp} from "../src/TuringPoolApp.sol";
import {TuringPoolRouter} from "../src/swapvm/TuringPoolRouter.sol";
import {HumanGateArgsBuilder} from "../src/swapvm/HumanGate.sol";
import {HumanQuota} from "../src/HumanQuota.sol";
import {MockAgentBook} from "../src/mocks/MockAgentBook.sol";
import {DemoToken} from "../src/mocks/DemoToken.sol";
import {IAgentBook} from "../src/interfaces/IAgentBook.sol";

/// @notice Deploys the full Turing Pool demo stack and ships both strategies.
///         - If AQUA has code (Base fork), the REAL 1inch Aqua deployment is used.
///         - If AGENT_BOOK has code (Base fork), the REAL World AgentBook is used
///           (register demo agents via anvil_setStorageAt, see scripts/e2e.sh);
///           otherwise a MockAgentBook is deployed and demo agents are registered.
contract DeployDemo is Script {
    // Opcode indices in TuringPoolRouter (asserted by test_SwapVM_OpcodeIndexIsStable).
    uint8 internal constant OP_XYC_SWAP = 17;
    uint8 internal constant OP_SALT = 20;
    uint8 internal constant OP_HUMAN_GATE = 34;

    uint256 internal constant POOL_ETH = 1_000e18;
    uint256 internal constant POOL_USD = 4_000_000e18; // demo price: 1 tETH = 4000 tUSD
    uint256 internal constant DAILY_CAP_ETH = 10e18;
    uint256 internal constant DAILY_CAP_USD = 40_000e18;
    uint256 internal constant WIDE_BPS = 30;
    uint256 internal constant TIGHT_BPS = 8;

    function run() external {
        uint256 deployerPk = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // anvil #0
        );
        address maker = vm.addr(deployerPk);
        address bot = vm.envOr("BOT", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8)); // anvil #1
        address humanAgent = vm.envOr("HUMAN_AGENT", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC)); // anvil #2
        address sybilAgent = vm.envOr("SYBIL_AGENT", address(0x90F79bf6EB2c4f870365E785982E1f101E93b906)); // anvil #3
        uint256 demoHumanId = vm.envOr("HUMAN_ID", uint256(uint160(humanAgent)) | (1 << 200));

        vm.startBroadcast(deployerPk);

        address aquaAddr = vm.envOr("AQUA", address(0));
        if (aquaAddr.code.length == 0) {
            aquaAddr = address(new Aqua());
            console.log("Deployed local Aqua:", aquaAddr);
        } else {
            console.log("Using existing Aqua:", aquaAddr);
        }

        address agentBookAddr = vm.envOr("AGENT_BOOK", address(0));
        bool mockBook = agentBookAddr.code.length == 0;
        if (mockBook) {
            MockAgentBook mock = new MockAgentBook();
            mock.register(humanAgent, demoHumanId);
            mock.register(sybilAgent, demoHumanId); // same human, second wallet
            agentBookAddr = address(mock);
            console.log("Deployed MockAgentBook:", agentBookAddr);
        } else {
            console.log("Using existing AgentBook:", agentBookAddr);
        }

        DemoToken tETH = new DemoToken("Turing Ether", "tETH");
        DemoToken tUSD = new DemoToken("Turing USD", "tUSD");

        HumanQuota quota = new HumanQuota();
        quota.setDailyCap(address(tETH), DAILY_CAP_ETH);
        quota.setDailyCap(address(tUSD), DAILY_CAP_USD);

        TuringPoolApp app = new TuringPoolApp(IAqua(aquaAddr), IAgentBook(agentBookAddr), quota);
        TuringPoolRouter router = new TuringPoolRouter(aquaAddr, address(0), maker, "TuringPool", "1");
        quota.setAppAuthorization(address(app), true);
        quota.setAppAuthorization(address(router), true);

        // Fund everyone.
        tETH.mint(maker, 10 * POOL_ETH);
        tUSD.mint(maker, 10 * POOL_USD);
        tETH.mint(bot, 1_000e18);
        tETH.mint(humanAgent, 1_000e18);
        tETH.mint(sybilAgent, 1_000e18);
        tETH.approve(aquaAddr, type(uint256).max);
        tUSD.approve(aquaAddr, type(uint256).max);

        // --- Strategy 1: AquaApp path ---
        TuringPoolApp.Strategy memory strategy = TuringPoolApp.Strategy({
            maker: maker,
            token0: address(tETH),
            token1: address(tUSD),
            wideFeeBps: WIDE_BPS,
            tightFeeBps: TIGHT_BPS,
            salt: bytes32(uint256(1))
        });
        {
            address[] memory tokens = new address[](2);
            tokens[0] = address(tETH);
            tokens[1] = address(tUSD);
            uint256[] memory amounts = new uint256[](2);
            amounts[0] = POOL_ETH;
            amounts[1] = POOL_USD;
            IAqua(aquaAddr).ship(address(app), abi.encode(strategy), tokens, amounts);
        }
        bytes32 strategyHash = keccak256(abi.encode(strategy));

        // --- Strategy 2: SwapVM path (humanGate opcode + xyc + salt) ---
        bytes memory program = bytes.concat(
            abi.encodePacked(
                OP_HUMAN_GATE,
                uint8(48),
                HumanGateArgsBuilder.build(
                    agentBookAddr, address(quota), uint32(WIDE_BPS * 1e5), uint32(TIGHT_BPS * 1e5)
                )
            ),
            abi.encodePacked(OP_XYC_SWAP, uint8(0)),
            abi.encodePacked(OP_SALT, uint8(8), uint64(1))
        );
        ISwapVM.Order memory order = MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker,
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                receiver: address(0),
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program
            })
        );
        bytes32 orderHash;
        {
            address[] memory tokens = new address[](2);
            tokens[0] = address(tETH);
            tokens[1] = address(tUSD);
            uint256[] memory amounts = new uint256[](2);
            amounts[0] = POOL_ETH;
            amounts[1] = POOL_USD;
            orderHash = IAqua(aquaAddr).ship(address(router), abi.encode(order), tokens, amounts);
        }
        require(orderHash == router.hash(order), "order hash mismatch");

        vm.stopBroadcast();

        // --- Write deployments JSON for the server/agents/web ---
        string memory json = "deployments";
        vm.serializeAddress(json, "aqua", aquaAddr);
        vm.serializeAddress(json, "agentBook", agentBookAddr);
        vm.serializeBool(json, "mockAgentBook", mockBook);
        vm.serializeAddress(json, "quota", address(quota));
        vm.serializeAddress(json, "app", address(app));
        vm.serializeAddress(json, "router", address(router));
        vm.serializeAddress(json, "tETH", address(tETH));
        vm.serializeAddress(json, "tUSD", address(tUSD));
        vm.serializeAddress(json, "maker", maker);
        vm.serializeAddress(json, "bot", bot);
        vm.serializeAddress(json, "humanAgent", humanAgent);
        vm.serializeAddress(json, "sybilAgent", sybilAgent);
        vm.serializeUint(json, "humanId", demoHumanId);
        vm.serializeUint(json, "wideFeeBps", WIDE_BPS);
        vm.serializeUint(json, "tightFeeBps", TIGHT_BPS);
        vm.serializeBytes32(json, "strategyHash", strategyHash);
        vm.serializeBytes32(json, "orderHash", orderHash);
        vm.serializeUint(json, "strategySalt", 1);
        vm.serializeUint(json, "deployBlock", block.number);
        vm.serializeBytes(json, "orderData", order.data);
        string memory out = vm.serializeUint(json, "orderTraits", MakerTraits.unwrap(order.traits));
        vm.writeJson(out, "./deployments/demo.json");

        console.log("TuringPoolApp:", address(app));
        console.log("TuringPoolRouter:", address(router));
        console.log("HumanQuota:", address(quota));
    }
}
