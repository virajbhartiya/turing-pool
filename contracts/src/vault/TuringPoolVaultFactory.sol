// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAqua} from "aqua/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";

import {HumanQuota} from "../HumanQuota.sol";
import {TuringPoolVault} from "./TuringPoolVault.sol";

interface ITuringPoolRouter {
    function humanGateOpcode() external pure returns (uint256);
    function humanGateVersion() external pure returns (uint256);
}

/// @title TuringPoolVaultFactory
/// @notice Permissionless factory for isolated LP vaults that share one
///         TuringPoolRouter while retaining independent quota and fee state.
contract TuringPoolVaultFactory {
    error InvalidAddress();
    error UnexpectedHumanGateOpcode(uint256 opcode);
    error UnexpectedHumanGateVersion(uint256 version);

    struct VaultConfig {
        IERC20 token0;
        IERC20 token1;
        address manager;
        string name;
        string symbol;
        uint256 dailyCap0;
        uint256 dailyCap1;
        uint32 targetFeeBps;
        uint32 desiredTightFeeBps;
        uint32 maxWideFeeBps;
        uint32 initialTightFeeBps;
        uint32 initialWideFeeBps;
        uint128 seedToken0TightVolume;
        uint128 seedToken0WideVolume;
        uint128 seedToken1TightVolume;
        uint128 seedToken1WideVolume;
    }

    event VaultCreated(
        address indexed creator,
        address indexed manager,
        address indexed vault,
        address quota,
        address token0,
        address token1
    );

    IAqua public immutable AQUA;
    ISwapVM public immutable ROUTER;
    address public immutable AGENT_BOOK;

    address[] private _vaults;
    mapping(address vault => address quota) public quotaOf;
    mapping(address vault => bool registered) public isVault;

    constructor(IAqua aqua_, ISwapVM router_, address agentBook_) {
        if (address(aqua_) == address(0) || address(router_) == address(0) || agentBook_ == address(0)) {
            revert InvalidAddress();
        }
        uint256 opcode = ITuringPoolRouter(address(router_)).humanGateOpcode();
        if (opcode != 34) revert UnexpectedHumanGateOpcode(opcode);
        uint256 version = ITuringPoolRouter(address(router_)).humanGateVersion();
        if (version != 2) revert UnexpectedHumanGateVersion(version);
        AQUA = aqua_;
        ROUTER = router_;
        AGENT_BOOK = agentBook_;
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function allVaults() external view returns (address[] memory) {
        return _vaults;
    }

    function createVault(VaultConfig calldata config) external returns (TuringPoolVault vault, HumanQuota quota) {
        if (
            address(config.token0) == address(0) || address(config.token1) == address(0) || config.manager == address(0)
        ) {
            revert InvalidAddress();
        }

        quota = new HumanQuota();
        quota.setDailyCap(address(config.token0), config.dailyCap0);
        quota.setDailyCap(address(config.token1), config.dailyCap1);
        quota.configureFeeController(
            address(config.token0),
            config.targetFeeBps,
            config.desiredTightFeeBps,
            config.maxWideFeeBps,
            config.initialTightFeeBps,
            config.initialWideFeeBps,
            config.seedToken0TightVolume,
            config.seedToken0WideVolume
        );
        quota.configureFeeController(
            address(config.token1),
            config.targetFeeBps,
            config.desiredTightFeeBps,
            config.maxWideFeeBps,
            config.initialTightFeeBps,
            config.initialWideFeeBps,
            config.seedToken1TightVolume,
            config.seedToken1WideVolume
        );

        vault = new TuringPoolVault(
            AQUA,
            ROUTER,
            AGENT_BOOK,
            quota,
            config.token0,
            config.token1,
            config.manager,
            config.name,
            config.symbol,
            config.initialTightFeeBps,
            config.initialWideFeeBps
        );
        quota.setAppAuthorization(address(ROUTER), true);
        quota.setOrderRegistrar(address(vault), true);
        quota.transferOwnership(config.manager);

        _vaults.push(address(vault));
        quotaOf[address(vault)] = address(quota);
        isVault[address(vault)] = true;
        emit VaultCreated(
            msg.sender, config.manager, address(vault), address(quota), address(config.token0), address(config.token1)
        );
    }
}
