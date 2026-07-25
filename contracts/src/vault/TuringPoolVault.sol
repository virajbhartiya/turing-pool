// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAqua} from "aqua/interfaces/IAqua.sol";
import {ISwapVM} from "swap-vm/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "swap-vm/libs/MakerTraits.sol";

import {HumanGateArgsBuilder} from "../swapvm/HumanGate.sol";
import {HumanQuota} from "../HumanQuota.sol";

/// @title TuringPoolVault
/// @notice Two-token LP share vault that acts as the maker for one identity-priced
///         SwapVM order. Deposits and redemptions migrate Aqua's immutable strategy
///         atomically, so every outstanding share always owns the same pro-rata
///         claim on the vault's complete token inventory.
contract TuringPoolVault is ERC20, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error IdenticalTokens();
    error InvalidAddress();
    error InvalidFeeBounds();
    error InvalidLiquidityAmounts();
    error InsufficientShares(uint256 actual, uint256 minimum);
    error InsufficientRedemption(uint256 amount0, uint256 amount1);
    error UnsupportedToken(address token);
    error StrategyHashMismatch(bytes32 expected, bytes32 actual);

    event LiquidityAdded(
        address indexed provider, address indexed receiver, uint256 amount0, uint256 amount1, uint256 shares
    );
    event LiquidityRemoved(
        address indexed provider, address indexed receiver, uint256 amount0, uint256 amount1, uint256 shares
    );
    event StrategyMigrated(
        bytes32 indexed previousOrderHash,
        bytes32 indexed nextOrderHash,
        uint64 strategyNonce,
        uint256 reserve0,
        uint256 reserve1
    );

    uint8 public constant OP_XYC_SWAP = 17;
    uint8 public constant OP_SALT = 20;
    uint8 public constant OP_HUMAN_GATE = 34;
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    address public constant LOCKED_SHARES = address(0x000000000000000000000000000000000000dEaD);

    IAqua public immutable AQUA;
    ISwapVM public immutable ROUTER;
    IERC20 public immutable TOKEN0;
    IERC20 public immutable TOKEN1;
    address public immutable AGENT_BOOK;
    HumanQuota public immutable QUOTA;
    uint32 public immutable FALLBACK_TIGHT_FEE_E9;
    uint32 public immutable FALLBACK_WIDE_FEE_E9;

    uint64 public strategyNonce;
    bytes32 public currentOrderHash;
    bool public strategyActive;

    ISwapVM.Order private _currentOrder;

    constructor(
        IAqua aqua_,
        ISwapVM router_,
        address agentBook_,
        HumanQuota quota_,
        IERC20 token0_,
        IERC20 token1_,
        address manager_,
        string memory name_,
        string memory symbol_,
        uint32 fallbackTightFeeBps_,
        uint32 fallbackWideFeeBps_
    ) ERC20(name_, symbol_) Ownable(manager_) {
        if (
            address(aqua_) == address(0) || address(router_) == address(0) || agentBook_ == address(0)
                || address(quota_) == address(0) || address(token0_) == address(0) || address(token1_) == address(0)
        ) {
            revert InvalidAddress();
        }
        if (address(token0_) == address(token1_)) revert IdenticalTokens();
        if (fallbackTightFeeBps_ > fallbackWideFeeBps_ || fallbackWideFeeBps_ > 10_000) {
            revert InvalidFeeBounds();
        }

        AQUA = aqua_;
        ROUTER = router_;
        AGENT_BOOK = agentBook_;
        QUOTA = quota_;
        TOKEN0 = token0_;
        TOKEN1 = token1_;
        FALLBACK_TIGHT_FEE_E9 = fallbackTightFeeBps_ * 1e5;
        FALLBACK_WIDE_FEE_E9 = fallbackWideFeeBps_ * 1e5;

        token0_.forceApprove(address(aqua_), type(uint256).max);
        token1_.forceApprove(address(aqua_), type(uint256).max);
    }

    /// @notice Returns the complete order callers should quote or execute.
    function currentOrder() external view returns (ISwapVM.Order memory) {
        return _currentOrder;
    }

    /// @notice Actual maker-wallet inventory owned by all outstanding LP shares.
    function reserves() public view returns (uint256 reserve0, uint256 reserve1) {
        reserve0 = TOKEN0.balanceOf(address(this));
        reserve1 = TOKEN1.balanceOf(address(this));
    }

    /// @notice Preview the proportional amounts consumed from a two-sided deposit.
    ///         Excess from the non-limiting side remains in the provider's wallet.
    function previewDeposit(uint256 maxAmount0, uint256 maxAmount1)
        public
        view
        returns (uint256 shares, uint256 amount0, uint256 amount1)
    {
        if (maxAmount0 == 0 || maxAmount1 == 0) return (0, 0, 0);
        uint256 supply = totalSupply();
        (uint256 reserve0, uint256 reserve1) = reserves();

        if (supply == 0) {
            if (maxAmount0 > type(uint128).max || maxAmount1 > type(uint128).max) return (0, 0, 0);
            uint256 grossShares = Math.sqrt(maxAmount0 * maxAmount1);
            if (grossShares <= MINIMUM_LIQUIDITY) return (0, 0, 0);
            return (grossShares - MINIMUM_LIQUIDITY, maxAmount0, maxAmount1);
        }
        if (reserve0 == 0 || reserve1 == 0) return (0, 0, 0);

        shares = Math.min(Math.mulDiv(maxAmount0, supply, reserve0), Math.mulDiv(maxAmount1, supply, reserve1));
        if (shares == 0) return (0, 0, 0);
        amount0 = Math.mulDiv(shares, reserve0, supply, Math.Rounding.Ceil);
        amount1 = Math.mulDiv(shares, reserve1, supply, Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) public view returns (uint256 amount0, uint256 amount1) {
        uint256 supply = totalSupply();
        if (shares == 0 || supply == 0) return (0, 0);
        (uint256 reserve0, uint256 reserve1) = reserves();
        amount0 = Math.mulDiv(reserve0, shares, supply);
        amount1 = Math.mulDiv(reserve1, shares, supply);
    }

    /// @notice Deposit both pool assets and mint transferable LP shares.
    function deposit(uint256 maxAmount0, uint256 maxAmount1, uint256 minShares, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares, uint256 amount0, uint256 amount1)
    {
        if (receiver == address(0)) revert InvalidAddress();
        _dockCurrentStrategy();
        (shares, amount0, amount1) = previewDeposit(maxAmount0, maxAmount1);
        if (shares == 0 || amount0 == 0 || amount1 == 0) revert InvalidLiquidityAmounts();
        if (shares < minShares) revert InsufficientShares(shares, minShares);

        TOKEN0.safeTransferFrom(msg.sender, address(this), amount0);
        TOKEN1.safeTransferFrom(msg.sender, address(this), amount1);

        if (totalSupply() == 0) _mint(LOCKED_SHARES, MINIMUM_LIQUIDITY);
        _mint(receiver, shares);
        _shipCurrentInventory();
        emit LiquidityAdded(msg.sender, receiver, amount0, amount1, shares);
    }

    /// @notice Burn LP shares and receive the same fraction of both live reserves.
    function redeem(uint256 shares, uint256 minAmount0, uint256 minAmount1, address receiver)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (receiver == address(0)) revert InvalidAddress();
        if (shares == 0) revert InvalidLiquidityAmounts();
        _dockCurrentStrategy();
        (amount0, amount1) = previewRedeem(shares);
        if (amount0 < minAmount0 || amount1 < minAmount1 || amount0 == 0 || amount1 == 0) {
            revert InsufficientRedemption(amount0, amount1);
        }

        _burn(msg.sender, shares);
        TOKEN0.safeTransfer(receiver, amount0);
        TOKEN1.safeTransfer(receiver, amount1);
        if (!paused()) _shipCurrentInventory();
        emit LiquidityRemoved(msg.sender, receiver, amount0, amount1, shares);
    }

    /// @notice Emergency-stop new deposits and remove the active Aqua allocation.
    ///         Redemptions remain available while paused.
    function pause() external onlyOwner nonReentrant {
        _pause();
        _dockCurrentStrategy();
    }

    /// @notice Re-ship all remaining inventory and reopen deposits.
    function unpause() external onlyOwner nonReentrant {
        _unpause();
        _shipCurrentInventory();
    }

    /// @notice Recover unrelated tokens accidentally sent to the vault.
    function rescueToken(IERC20 token, address receiver) external onlyOwner nonReentrant {
        if (address(token) == address(TOKEN0) || address(token) == address(TOKEN1)) {
            revert UnsupportedToken(address(token));
        }
        if (receiver == address(0)) revert InvalidAddress();
        token.safeTransfer(receiver, token.balanceOf(address(this)));
    }

    function _dockCurrentStrategy() private {
        if (!strategyActive) return;
        address[] memory tokens = _tokens();
        AQUA.dock(address(ROUTER), currentOrderHash, tokens);
        QUOTA.setOrderAuthorization(address(ROUTER), currentOrderHash, false);
        strategyActive = false;
    }

    function _shipCurrentInventory() private {
        (uint256 reserve0, uint256 reserve1) = reserves();
        if (reserve0 == 0 && reserve1 == 0) return;
        if (reserve0 == 0 || reserve1 == 0) revert InvalidLiquidityAmounts();

        bytes32 previousOrderHash = currentOrderHash;
        ++strategyNonce;
        bytes memory program = bytes.concat(
            abi.encodePacked(
                OP_HUMAN_GATE,
                uint8(48),
                HumanGateArgsBuilder.build(AGENT_BOOK, address(QUOTA), FALLBACK_WIDE_FEE_E9, FALLBACK_TIGHT_FEE_E9)
            ),
            abi.encodePacked(OP_XYC_SWAP, uint8(0)),
            abi.encodePacked(OP_SALT, uint8(8), strategyNonce)
        );
        ISwapVM.Order memory order = MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: address(this),
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

        address[] memory tokens = _tokens();
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = reserve0;
        amounts[1] = reserve1;
        bytes32 routerHash = ROUTER.hash(order);
        QUOTA.setOrderAuthorization(address(ROUTER), routerHash, true);
        bytes32 nextOrderHash = AQUA.ship(address(ROUTER), abi.encode(order), tokens, amounts);
        if (nextOrderHash != routerHash) revert StrategyHashMismatch(routerHash, nextOrderHash);

        _currentOrder = order;
        currentOrderHash = nextOrderHash;
        strategyActive = true;
        emit StrategyMigrated(previousOrderHash, nextOrderHash, strategyNonce, reserve0, reserve1);
    }

    function _tokens() private view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(TOKEN0);
        tokens[1] = address(TOKEN1);
    }
}
