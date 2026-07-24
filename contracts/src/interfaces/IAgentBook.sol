// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title IAgentBook - World's on-chain registry of human-backed agents
/// @notice Minimal interface for the AgentBook contract deployed by World (world.org).
///         Maps an agent's wallet address to the World ID nullifier hash ("humanId") of
///         the unique human who registered it. Zero means "not human-backed".
///         Base mainnet: 0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4
///         World Chain:  0xA23aB2712eA7BBa896930544C7d6636a96b944dA
interface IAgentBook {
    function lookupHuman(address agent) external view returns (uint256 humanId);
}
