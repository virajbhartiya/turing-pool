// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {IAqua} from "aqua/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraits, MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";

import {HumanGateArgsBuilder} from "../src/swapvm/HumanGate.sol";
import {HumanQuota} from "../src/HumanQuota.sol";
import {TuringPoolRouter} from "../src/swapvm/TuringPoolRouter.sol";

/// @notice Migrates an immutable Aqua order to a router whose _humanGate fee
///         schedule reprices on every mined fill from executed tier notional.
/// @dev Maker assets never leave Aqua custody: the script docks the old
///      namespace and ships its exact virtual balances to the new router.
contract DeployAdaptiveRouter is Script {
    uint8 internal constant OP_XYC_SWAP = 17;
    uint8 internal constant OP_SALT = 20;
    uint8 internal constant OP_HUMAN_GATE = 34;

    uint32 internal constant TARGET_FEE_BPS = 30;
    uint32 internal constant DESIRED_TIGHT_FEE_BPS = 5;
    uint32 internal constant MAX_WIDE_FEE_BPS = 100;
    uint32 internal constant INITIAL_TIGHT_FEE_BPS = 16;
    uint32 internal constant INITIAL_WIDE_FEE_BPS = 44;
    uint256 internal constant DAILY_CAP_ETH = 10e18;
    uint256 internal constant DAILY_CAP_USD = 40_000e18;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address maker = vm.addr(deployerPk);
        IAqua aqua = IAqua(vm.envAddress("AQUA"));
        address agentBook = vm.envAddress("AGENT_BOOK");
        address oldRouter = vm.envAddress("OLD_ROUTER");
        bytes32 oldOrderHash = vm.envBytes32("OLD_ORDER_HASH");
        address token0 = vm.envAddress("TOKEN0");
        address token1 = vm.envAddress("TOKEN1");
        uint128 seedToken0TightVolume = uint128(
            vm.envExists("SEED_TOKEN0_TIGHT_VOLUME")
                ? vm.envUint("SEED_TOKEN0_TIGHT_VOLUME")
                : vm.envUint("SEED_TIGHT_VOLUME")
        );
        uint128 seedToken0WideVolume = uint128(
            vm.envExists("SEED_TOKEN0_WIDE_VOLUME")
                ? vm.envUint("SEED_TOKEN0_WIDE_VOLUME")
                : vm.envUint("SEED_WIDE_VOLUME")
        );
        uint128 seedToken1TightVolume = uint128(vm.envOr("SEED_TOKEN1_TIGHT_VOLUME", uint256(0)));
        uint128 seedToken1WideVolume = uint128(vm.envOr("SEED_TOKEN1_WIDE_VOLUME", uint256(0)));
        uint64 salt = uint64(vm.envUint("ORDER_SALT"));

        (uint256 balance0, uint256 balance1) = aqua.safeBalances(maker, oldRouter, oldOrderHash, token0, token1);
        require(balance0 > 0 && balance1 > 0, "old order has no Aqua liquidity");

        vm.startBroadcast(deployerPk);

        HumanQuota quota = new HumanQuota();
        quota.setDailyCap(token0, DAILY_CAP_ETH);
        quota.setDailyCap(token1, DAILY_CAP_USD);
        quota.configureFeeController(
            token0,
            TARGET_FEE_BPS,
            DESIRED_TIGHT_FEE_BPS,
            MAX_WIDE_FEE_BPS,
            INITIAL_TIGHT_FEE_BPS,
            INITIAL_WIDE_FEE_BPS,
            seedToken0TightVolume,
            seedToken0WideVolume
        );
        quota.configureFeeController(
            token1,
            TARGET_FEE_BPS,
            DESIRED_TIGHT_FEE_BPS,
            MAX_WIDE_FEE_BPS,
            INITIAL_TIGHT_FEE_BPS,
            INITIAL_WIDE_FEE_BPS,
            seedToken1TightVolume,
            seedToken1WideVolume
        );

        TuringPoolRouter router = new TuringPoolRouter(address(aqua), address(0), maker, "TuringPool", "1");
        quota.setAppAuthorization(address(router), true);
        require(router.humanGateOpcode() == OP_HUMAN_GATE, "unexpected human gate opcode");

        bytes memory program = bytes.concat(
            abi.encodePacked(
                OP_HUMAN_GATE,
                uint8(48),
                HumanGateArgsBuilder.build(
                    agentBook, address(quota), uint32(INITIAL_WIDE_FEE_BPS * 1e5), uint32(INITIAL_TIGHT_FEE_BPS * 1e5)
                )
            ),
            abi.encodePacked(OP_XYC_SWAP, uint8(0)),
            abi.encodePacked(OP_SALT, uint8(8), salt)
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

        address[] memory tokens = new address[](2);
        tokens[0] = token0;
        tokens[1] = token1;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = balance0;
        amounts[1] = balance1;

        aqua.dock(oldRouter, oldOrderHash, tokens);
        bytes32 orderHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);

        vm.stopBroadcast();

        require(orderHash == router.hash(order), "order hash mismatch");

        string memory json = "adaptive";
        vm.serializeAddress(json, "quota", address(quota));
        vm.serializeAddress(json, "router", address(router));
        vm.serializeBytes32(json, "oldOrderHash", oldOrderHash);
        vm.serializeBytes32(json, "orderHash", orderHash);
        vm.serializeUint(json, "orderTraits", MakerTraits.unwrap(order.traits));
        vm.serializeBytes(json, "orderData", order.data);
        vm.serializeUint(json, "strategySalt", salt);
        vm.serializeUint(json, "tightFeeBps", INITIAL_TIGHT_FEE_BPS);
        vm.serializeUint(json, "wideFeeBps", INITIAL_WIDE_FEE_BPS);
        vm.serializeUint(json, "targetFeeBps", TARGET_FEE_BPS);
        vm.serializeUint(json, "seedToken0TightVolume", seedToken0TightVolume);
        vm.serializeUint(json, "seedToken0WideVolume", seedToken0WideVolume);
        vm.serializeUint(json, "seedToken1TightVolume", seedToken1TightVolume);
        vm.serializeUint(json, "seedToken1WideVolume", seedToken1WideVolume);
        vm.serializeUint(json, "seedTightVolume", seedToken0TightVolume);
        vm.serializeUint(json, "seedWideVolume", seedToken0WideVolume);
        vm.serializeUint(json, "balance0", balance0);
        vm.serializeUint(json, "balance1", balance1);
        string memory out = vm.serializeUint(json, "deployBlock", block.number);
        vm.writeJson(out, vm.envOr("ADAPTIVE_FILE", string("./deployments/world-mainnet-adaptive.json")));

        console.log("Adaptive HumanQuota:", address(quota));
        console.log("Adaptive TuringPoolRouter:", address(router));
        console.log("Aqua order:");
        console.logBytes32(orderHash);
    }
}
