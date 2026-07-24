// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {IAqua} from "aqua/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraits, MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";

import {HumanGateArgsBuilder} from "../src/swapvm/HumanGate.sol";
import {TuringPoolRouter} from "../src/swapvm/TuringPoolRouter.sol";

/// @notice Re-prices the active SwapVM order without moving maker-owned assets.
///         Aqua strategies are immutable, so adjustment is an atomic lifecycle:
///         read current virtual balances, dock the old order, and ship a new order.
contract RepriceRouter is Script {
    uint8 internal constant OP_XYC_SWAP = 17;
    uint8 internal constant OP_SALT = 20;
    uint8 internal constant OP_HUMAN_GATE = 34;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address maker = vm.addr(deployerPk);
        IAqua aqua = IAqua(vm.envAddress("AQUA"));
        address agentBook = vm.envAddress("AGENT_BOOK");
        address quota = vm.envAddress("QUOTA");
        TuringPoolRouter router = TuringPoolRouter(payable(vm.envAddress("ROUTER")));
        address token0 = vm.envAddress("TOKEN0");
        address token1 = vm.envAddress("TOKEN1");
        bytes32 oldOrderHash = vm.envBytes32("OLD_ORDER_HASH");
        uint256 wideFeeBps = vm.envUint("WIDE_FEE_BPS");
        uint256 tightFeeBps = vm.envUint("TIGHT_FEE_BPS");
        uint64 salt = uint64(vm.envUint("ORDER_SALT"));

        require(router.humanGateOpcode() == OP_HUMAN_GATE, "unexpected human gate opcode");
        require(wideFeeBps <= type(uint32).max / 1e5, "wide fee overflow");
        require(tightFeeBps <= type(uint32).max / 1e5, "tight fee overflow");

        (uint256 balance0, uint256 balance1) = aqua.safeBalances(maker, address(router), oldOrderHash, token0, token1);

        bytes memory program = bytes.concat(
            abi.encodePacked(
                OP_HUMAN_GATE,
                uint8(48),
                HumanGateArgsBuilder.build(agentBook, quota, uint32(wideFeeBps * 1e5), uint32(tightFeeBps * 1e5))
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

        vm.startBroadcast(deployerPk);
        aqua.dock(address(router), oldOrderHash, tokens);
        bytes32 newOrderHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopBroadcast();

        require(newOrderHash == router.hash(order), "order hash mismatch");

        string memory json = "reprice";
        vm.serializeBytes32(json, "oldOrderHash", oldOrderHash);
        vm.serializeBytes32(json, "orderHash", newOrderHash);
        vm.serializeUint(json, "orderTraits", MakerTraits.unwrap(order.traits));
        vm.serializeBytes(json, "orderData", order.data);
        vm.serializeUint(json, "strategySalt", salt);
        vm.serializeUint(json, "wideFeeBps", wideFeeBps);
        vm.serializeUint(json, "tightFeeBps", tightFeeBps);
        vm.serializeUint(json, "balance0", balance0);
        string memory out = vm.serializeUint(json, "balance1", balance1);
        vm.writeJson(out, vm.envOr("REPRICE_FILE", string("./deployments/world-mainnet-reprice.json")));

        console.log("Docked order:");
        console.logBytes32(oldOrderHash);
        console.log("Shipped order:");
        console.logBytes32(newOrderHash);
    }
}
