// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {IAqua} from "aqua/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";

import {TuringPoolVaultFactory} from "../src/vault/TuringPoolVaultFactory.sol";
import {TuringPoolRouter} from "../src/swapvm/TuringPoolRouter.sol";

/// @notice Deploys the permissionless vault factory and its shared,
///         order-bound HumanGate v2 router against existing Aqua and
///         canonical AgentBook deployments.
contract DeployVaultFactory is Script {
    function run() external returns (TuringPoolVaultFactory factory) {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        IAqua aqua = IAqua(vm.envAddress("AQUA"));
        address agentBook = vm.envAddress("AGENT_BOOK");

        vm.startBroadcast(deployerPk);
        TuringPoolRouter router =
            new TuringPoolRouter(address(aqua), address(0), vm.addr(deployerPk), "TuringPoolVault", "2");
        factory = new TuringPoolVaultFactory(aqua, ISwapVM(address(router)), agentBook);
        vm.stopBroadcast();

        string memory json = "vaultFactory";
        vm.serializeAddress(json, "aqua", address(aqua));
        vm.serializeAddress(json, "router", address(router));
        vm.serializeAddress(json, "agentBook", agentBook);
        vm.serializeUint(json, "chainId", block.chainid);
        string memory output = vm.serializeAddress(json, "factory", address(factory));
        vm.writeJson(output, vm.envOr("VAULT_FACTORY_FILE", string("./deployments/vault-factory.json")));

        console.log("TuringPoolVaultFactory:", address(factory));
    }
}
