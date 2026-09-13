// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAqua} from "aqua/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {TuringPoolRouter} from "../src/swapvm/TuringPoolRouter.sol";
import {TuringPoolVaultFactory} from "../src/vault/TuringPoolVaultFactory.sol";
import {TuringPoolVault} from "../src/vault/TuringPoolVault.sol";
import {TuringPoolFaucet} from "../src/TuringPoolFaucet.sol";

/// @notice Local-only liquidity and faucet fixtures for a complete rehearsal.
contract DeployDemoExtras is Script {
    function run() external {
        require(block.chainid == 31337, "local Anvil only");
        string memory file = "./deployments/demo-market.json";
        string memory json = vm.readFile(file);
        require(vm.parseJsonBool(json, ".mockAgentBook"), "mock identity required");
        address aqua = vm.parseJsonAddress(json, ".aqua");
        address book = vm.parseJsonAddress(json, ".agentBook");
        IERC20 token0 = IERC20(vm.parseJsonAddress(json, ".tETH"));
        IERC20 token1 = IERC20(vm.parseJsonAddress(json, ".tUSD"));
        address human = vm.parseJsonAddress(json, ".humanAgent");
        uint256 fixtureKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address maker = vm.addr(fixtureKey);
        vm.startBroadcast(fixtureKey);
        TuringPoolRouter router = new TuringPoolRouter(aqua, address(0), maker, "TuringPoolVault", "2");
        TuringPoolVaultFactory factory = new TuringPoolVaultFactory(IAqua(aqua), ISwapVM(address(router)), book);
        TuringPoolVaultFactory.VaultConfig memory config = TuringPoolVaultFactory.VaultConfig({
            token0: token0,
            token1: token1,
            manager: maker,
            name: "Turing Demo LP",
            symbol: "tpDEMO",
            dailyCap0: 10e18,
            dailyCap1: 40_000e18,
            targetFeeBps: 30,
            desiredTightFeeBps: 5,
            maxWideFeeBps: 100,
            initialTightFeeBps: 16,
            initialWideFeeBps: 44,
            seedToken0TightVolume: 0,
            seedToken0WideVolume: 0,
            seedToken1TightVolume: 0,
            seedToken1WideVolume: 0
        });
        (TuringPoolVault vault,) = factory.createVault(config);
        token0.approve(address(vault), 10e18);
        token1.approve(address(vault), 40_000e18);
        vault.deposit(10e18, 40_000e18, 1, human);
        TuringPoolFaucet faucet = new TuringPoolFaucet(token0, token1, 1e18, 4_000e18, 1 days, maker);
        require(token0.transfer(address(faucet), 100e18), "faucet ETH funding");
        require(token1.transfer(address(faucet), 400_000e18), "faucet USD funding");
        vm.stopBroadcast();
        // Keep the primary market as the chart/trading venue. Liquidity has its own vault.
        vm.writeJson(string.concat('"', vm.toString(address(factory)), '"'), file, ".vaultFactory");
        vm.writeJson(string.concat('"', vm.toString(address(faucet)), '"'), file, ".faucet");
    }
}
