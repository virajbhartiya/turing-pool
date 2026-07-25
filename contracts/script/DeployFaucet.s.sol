// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {TuringPoolFaucet} from "../src/TuringPoolFaucet.sol";

/// @notice Deploys and funds the inventory-backed public test-token faucet.
contract DeployFaucet is Script {
    uint256 internal constant CLAIM_TETH = 1e18;
    uint256 internal constant CLAIM_TUSD = 4_000e18;
    uint256 internal constant INITIAL_TETH = 100e18;
    uint256 internal constant INITIAL_TUSD = 400_000e18;
    uint256 internal constant COOLDOWN = 1 days;

    function run() external returns (TuringPoolFaucet faucet) {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address owner = vm.envOr("FAUCET_OWNER", vm.addr(deployerPk));
        IERC20 tokenEth = IERC20(vm.envAddress("TETH"));
        IERC20 tokenUsd = IERC20(vm.envAddress("TUSD"));

        vm.startBroadcast(deployerPk);
        faucet = new TuringPoolFaucet(tokenEth, tokenUsd, CLAIM_TETH, CLAIM_TUSD, COOLDOWN, owner);
        require(tokenEth.transfer(address(faucet), INITIAL_TETH), "tETH funding failed");
        require(tokenUsd.transfer(address(faucet), INITIAL_TUSD), "tUSD funding failed");
        vm.stopBroadcast();

        string memory json = "faucet";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "owner", owner);
        vm.serializeAddress(json, "token0", address(tokenEth));
        vm.serializeAddress(json, "token1", address(tokenUsd));
        vm.serializeUint(json, "claimAmount0", CLAIM_TETH);
        vm.serializeUint(json, "claimAmount1", CLAIM_TUSD);
        vm.serializeUint(json, "cooldown", COOLDOWN);
        vm.serializeUint(json, "initialToken0", INITIAL_TETH);
        vm.serializeUint(json, "initialToken1", INITIAL_TUSD);
        string memory output = vm.serializeAddress(json, "faucet", address(faucet));
        vm.writeJson(output, vm.envOr("FAUCET_FILE", string("./deployments/faucet.json")));

        console.log("TuringPoolFaucet:", address(faucet));
    }
}
