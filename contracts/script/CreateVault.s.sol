// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {HumanQuota} from "../src/HumanQuota.sol";
import {TuringPoolVault} from "../src/vault/TuringPoolVault.sol";
import {TuringPoolVaultFactory} from "../src/vault/TuringPoolVaultFactory.sol";

/// @notice Creates one independently managed pool through a deployed factory.
contract CreateVault is Script {
    using SafeCast for uint256;

    function run() external returns (TuringPoolVault vault, HumanQuota quota) {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        TuringPoolVaultFactory factory = TuringPoolVaultFactory(vm.envAddress("VAULT_FACTORY"));
        address manager = vm.envOr("VAULT_MANAGER", vm.addr(deployerPk));

        TuringPoolVaultFactory.VaultConfig memory config = TuringPoolVaultFactory.VaultConfig({
            token0: IERC20(vm.envAddress("TOKEN0")),
            token1: IERC20(vm.envAddress("TOKEN1")),
            manager: manager,
            name: vm.envOr("LP_TOKEN_NAME", string("Turing Pool LP")),
            symbol: vm.envOr("LP_TOKEN_SYMBOL", string("tpLP")),
            dailyCap0: vm.envUint("DAILY_CAP0"),
            dailyCap1: vm.envUint("DAILY_CAP1"),
            targetFeeBps: _fee("TARGET_FEE_BPS", 30),
            desiredTightFeeBps: _fee("DESIRED_TIGHT_FEE_BPS", 5),
            maxWideFeeBps: _fee("MAX_WIDE_FEE_BPS", 100),
            initialTightFeeBps: _fee("INITIAL_TIGHT_FEE_BPS", 20),
            initialWideFeeBps: _fee("INITIAL_WIDE_FEE_BPS", 50),
            seedToken0TightVolume: _seed("SEED_TOKEN0_TIGHT_VOLUME"),
            seedToken0WideVolume: _seed("SEED_TOKEN0_WIDE_VOLUME"),
            seedToken1TightVolume: _seed("SEED_TOKEN1_TIGHT_VOLUME"),
            seedToken1WideVolume: _seed("SEED_TOKEN1_WIDE_VOLUME")
        });

        vm.startBroadcast(deployerPk);
        (vault, quota) = factory.createVault(config);
        vm.stopBroadcast();

        string memory json = "vault";
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "manager", manager);
        vm.serializeAddress(json, "quota", address(quota));
        vm.serializeAddress(json, "token0", address(config.token0));
        vm.serializeAddress(json, "token1", address(config.token1));
        vm.serializeUint(json, "chainId", block.chainid);
        string memory output = vm.serializeAddress(json, "vault", address(vault));
        vm.writeJson(output, vm.envOr("VAULT_FILE", string("./deployments/vault.json")));

        console.log("TuringPoolVault:", address(vault));
        console.log("HumanQuota:", address(quota));
    }

    function _fee(string memory key, uint256 defaultValue) private view returns (uint32) {
        return vm.envOr(key, defaultValue).toUint32();
    }

    function _seed(string memory key) private view returns (uint128) {
        return vm.envOr(key, uint256(0)).toUint128();
    }
}
