// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Turing Pool Faucet
/// @notice Inventory-backed test-token dispenser with an on-chain wallet cooldown.
/// @dev The faucet cannot mint either asset. Its maximum liability is the token
///      inventory explicitly transferred into this contract.
contract TuringPoolFaucet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidConfiguration();
    error CooldownActive(uint256 nextClaimAt);
    error InsufficientInventory(address token, uint256 available, uint256 required);

    event Claimed(address indexed account, uint256 amount0, uint256 amount1, uint256 nextClaimAt);
    event InventoryRecovered(address indexed token, address indexed receiver, uint256 amount);

    IERC20 public immutable TOKEN0;
    IERC20 public immutable TOKEN1;
    uint256 public immutable CLAIM_AMOUNT0;
    uint256 public immutable CLAIM_AMOUNT1;
    uint256 public immutable COOLDOWN;

    mapping(address account => uint256 timestamp) public nextClaimAt;

    constructor(
        IERC20 token0,
        IERC20 token1,
        uint256 claimAmount0,
        uint256 claimAmount1,
        uint256 cooldown,
        address owner_
    ) Ownable(owner_) {
        if (
            address(token0) == address(0) || address(token1) == address(0) || address(token0) == address(token1)
                || claimAmount0 == 0 || claimAmount1 == 0 || cooldown == 0
        ) {
            revert InvalidConfiguration();
        }
        TOKEN0 = token0;
        TOKEN1 = token1;
        CLAIM_AMOUNT0 = claimAmount0;
        CLAIM_AMOUNT1 = claimAmount1;
        COOLDOWN = cooldown;
    }

    function claim() external nonReentrant {
        uint256 availableAt = nextClaimAt[msg.sender];
        if (block.timestamp < availableAt) revert CooldownActive(availableAt);

        uint256 balance0 = TOKEN0.balanceOf(address(this));
        uint256 balance1 = TOKEN1.balanceOf(address(this));
        if (balance0 < CLAIM_AMOUNT0) {
            revert InsufficientInventory(address(TOKEN0), balance0, CLAIM_AMOUNT0);
        }
        if (balance1 < CLAIM_AMOUNT1) {
            revert InsufficientInventory(address(TOKEN1), balance1, CLAIM_AMOUNT1);
        }

        uint256 next = block.timestamp + COOLDOWN;
        nextClaimAt[msg.sender] = next;
        TOKEN0.safeTransfer(msg.sender, CLAIM_AMOUNT0);
        TOKEN1.safeTransfer(msg.sender, CLAIM_AMOUNT1);

        emit Claimed(msg.sender, CLAIM_AMOUNT0, CLAIM_AMOUNT1, next);
    }

    function remainingClaims() external view returns (uint256) {
        uint256 claims0 = TOKEN0.balanceOf(address(this)) / CLAIM_AMOUNT0;
        uint256 claims1 = TOKEN1.balanceOf(address(this)) / CLAIM_AMOUNT1;
        return claims0 < claims1 ? claims0 : claims1;
    }

    /// @notice Returns unused inventory to a controlled treasury.
    /// @dev This cannot increase supply and is restricted to the faucet owner.
    function recover(IERC20 token, address receiver, uint256 amount) external onlyOwner {
        if (receiver == address(0)) revert InvalidConfiguration();
        token.safeTransfer(receiver, amount);
        emit InventoryRecovered(address(token), receiver, amount);
    }
}
