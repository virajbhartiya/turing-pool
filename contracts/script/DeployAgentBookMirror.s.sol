// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {WorldAgentBookMirror} from "../src/identity/WorldAgentBookMirror.sol";

/// @notice Deploys the Base-side mirror for the canonical World Chain AgentBook.
contract DeployAgentBookMirror is Script {
    function run() external returns (WorldAgentBookMirror mirror) {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address owner = vm.envOr("MIRROR_OWNER", vm.addr(deployerPk));
        address relayer = vm.envOr("MIRROR_RELAYER", vm.addr(deployerPk));
        uint256 sourceChainId = vm.envOr("SOURCE_CHAIN_ID", uint256(480));
        address sourceAgentBook = vm.envAddress("SOURCE_AGENT_BOOK");

        vm.startBroadcast(deployerPk);
        mirror = new WorldAgentBookMirror(sourceChainId, sourceAgentBook, owner, relayer);
        vm.stopBroadcast();

        string memory json = "agentBookMirror";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "owner", owner);
        vm.serializeAddress(json, "relayer", relayer);
        vm.serializeUint(json, "sourceChainId", sourceChainId);
        vm.serializeAddress(json, "sourceAgentBook", sourceAgentBook);
        string memory output = vm.serializeAddress(json, "mirror", address(mirror));
        vm.writeJson(output, vm.envOr("MIRROR_FILE", string("./deployments/agentbook-mirror.json")));

        console.log("WorldAgentBookMirror:", address(mirror));
    }
}
