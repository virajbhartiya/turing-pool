// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAgentBook } from "../interfaces/IAgentBook.sol";

/// @title MockAgentBook - test/demo stand-in for World's AgentBook
/// @notice Same read ABI as the real registry. Lets unit tests and the live stage demo
///         register agents without depending on Orb availability. Production deployments
///         point TuringPoolApp at the real AgentBook instead.
contract MockAgentBook is IAgentBook {
    event Registered(address indexed agent, uint256 indexed humanId);

    mapping(address agent => uint256) public lookupHuman;

    function register(address agent, uint256 humanId) external {
        lookupHuman[agent] = humanId;
        emit Registered(agent, humanId);
    }
}
