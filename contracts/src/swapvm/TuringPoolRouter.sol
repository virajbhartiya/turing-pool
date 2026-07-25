// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Context} from "swap-vm/libs/VM.sol";
import {SwapVM} from "swap-vm/SwapVM.sol";
import {AquaOpcodes} from "swap-vm/opcodes/AquaOpcodes.sol";

import {HumanGate} from "./HumanGate.sol";

/// @title TuringPoolRouter - SwapVM router with the _humanGate opcode
/// @notice A redeployed SwapVM router (explicitly allowed by 1inch) whose instruction
///         set is the standard AquaOpcodes plus one new opcode: _humanGate, which
///         reprices the remainder of the program based on whether the taker is a
///         World-verified human-backed agent within its daily quota.
contract TuringPoolRouter is SwapVM, AquaOpcodes, HumanGate {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
        AquaOpcodes(aqua)
    {}

    /// @notice Opcode index of _humanGate in this router's dispatch table.
    function humanGateOpcode() external pure returns (uint256) {
        return _opcodes().length;
    }

    /// @notice Version 2 binds quota writes to the executing Aqua order hash.
    function humanGateVersion() external pure returns (uint256) {
        return 2;
    }

    function _instructions()
        internal
        pure
        override
        returns (function(Context memory, bytes calldata) internal[] memory result)
    {
        function(Context memory, bytes calldata) internal[] memory base = _opcodes();
        result = new function(Context memory, bytes calldata) internal[](base.length + 1);
        for (uint256 i; i < base.length; ++i) {
            result[i] = base[i];
        }
        result[base.length] = _humanGate;
    }
}
