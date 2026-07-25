// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IAgentBook} from "../interfaces/IAgentBook.sol";

/// @title WorldAgentBookMirror
/// @notice Base-side cache of canonical World Chain AgentBook lookups.
/// @dev An authorized relayer reads the canonical AgentBook at a finalized World
///      Chain block and publishes the value plus its source block hash here.
///      SwapVM can then resolve identity synchronously inside a Base transaction.
contract WorldAgentBookMirror is IAgentBook, Ownable {
    error InvalidAddress();
    error NotRelayer();
    error StaleSourceBlock(uint256 currentBlock, uint256 proposedBlock);

    struct Record {
        uint256 humanId;
        uint64 sourceBlock;
        bytes32 sourceBlockHash;
    }

    event RelayerAuthorized(address indexed relayer, bool authorized);
    event HumanMirrored(
        address indexed agent, uint256 indexed humanId, uint256 indexed sourceBlock, bytes32 sourceBlockHash
    );

    uint256 public immutable SOURCE_CHAIN_ID;
    address public immutable SOURCE_AGENT_BOOK;

    mapping(address relayer => bool authorized) public authorizedRelayers;
    mapping(address agent => Record record) private _records;

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender], NotRelayer());
        _;
    }

    constructor(uint256 sourceChainId, address sourceAgentBook, address owner_, address initialRelayer)
        Ownable(owner_)
    {
        if (sourceChainId == 0 || sourceAgentBook == address(0) || initialRelayer == address(0)) {
            revert InvalidAddress();
        }
        SOURCE_CHAIN_ID = sourceChainId;
        SOURCE_AGENT_BOOK = sourceAgentBook;
        authorizedRelayers[initialRelayer] = true;
        emit RelayerAuthorized(initialRelayer, true);
    }

    function setRelayerAuthorization(address relayer, bool authorized) external onlyOwner {
        if (relayer == address(0)) revert InvalidAddress();
        authorizedRelayers[relayer] = authorized;
        emit RelayerAuthorized(relayer, authorized);
    }

    /// @notice Publish a canonical AgentBook result observed at `sourceBlock`.
    ///         A zero humanId is a valid revocation or anonymous result.
    function mirrorHuman(address agent, uint256 humanId, uint64 sourceBlock, bytes32 sourceBlockHash)
        external
        onlyRelayer
    {
        if (agent == address(0) || sourceBlock == 0 || sourceBlockHash == bytes32(0)) {
            revert InvalidAddress();
        }
        Record storage current = _records[agent];
        if (sourceBlock <= current.sourceBlock) {
            revert StaleSourceBlock(current.sourceBlock, sourceBlock);
        }
        current.humanId = humanId;
        current.sourceBlock = sourceBlock;
        current.sourceBlockHash = sourceBlockHash;
        emit HumanMirrored(agent, humanId, sourceBlock, sourceBlockHash);
    }

    function lookupHuman(address agent) external view returns (uint256) {
        return _records[agent].humanId;
    }

    function recordOf(address agent) external view returns (Record memory) {
        return _records[agent];
    }
}
