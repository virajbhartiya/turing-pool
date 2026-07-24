// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TuringPoolAsset
/// @notice Fixed-supply ERC-20 used by the public Turing Pool demonstration.
///         There is no privileged mint path after deployment.
contract TuringPoolAsset is ERC20 {
    constructor(string memory name_, string memory symbol_, address holder_, uint256 supply_) ERC20(name_, symbol_) {
        _mint(holder_, supply_);
    }
}
