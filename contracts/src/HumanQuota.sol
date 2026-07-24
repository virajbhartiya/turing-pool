// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title HumanQuota - per-human daily volume allowances for the tight fee tier
/// @notice Tracks how much notional each unique human (World ID nullifier, aka humanId)
///         has traded per token per UTC day. The cap is what makes tight-tier pricing
///         rational for LPs: adverse selection per human is bounded, and because the
///         humanId is shared across every wallet/agent a human registers, the cap
///         cannot be dodged with fresh wallets.
contract HumanQuota {
    error NotOwner();
    error NotAuthorizedApp();

    event AppAuthorized(address indexed app, bool authorized);
    event DailyCapSet(address indexed token, uint256 cap);
    event UsageRecorded(uint256 indexed humanId, address indexed token, uint256 amount, uint256 indexed day);

    address public owner;

    /// @notice Apps allowed to record usage (i.e. deployed TuringPool contracts)
    mapping(address app => bool) public authorizedApps;

    /// @notice Max tight-tier input notional per human per UTC day, in token units.
    ///         A cap of 0 means the tight tier is disabled for that token.
    mapping(address token => uint256) public dailyCap;

    /// @notice used[humanId][token][day] = input notional already traded at the tight tier
    mapping(uint256 humanId => mapping(address token => mapping(uint256 day => uint256))) public used;

    modifier onlyOwner() {
        require(msg.sender == owner, NotOwner());
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setAppAuthorization(address app, bool authorized) external onlyOwner {
        authorizedApps[app] = authorized;
        emit AppAuthorized(app, authorized);
    }

    function setDailyCap(address token, uint256 cap) external onlyOwner {
        dailyCap[token] = cap;
        emit DailyCapSet(token, cap);
    }

    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice Tight-tier notional still available today for a human in a given token
    function remaining(uint256 humanId, address token) public view returns (uint256) {
        uint256 cap = dailyCap[token];
        uint256 spent = used[humanId][token][currentDay()];
        return cap > spent ? cap - spent : 0;
    }

    /// @notice Record tight-tier usage. Only callable by authorized pool apps.
    function recordUsage(uint256 humanId, address token, uint256 amount) external {
        require(authorizedApps[msg.sender], NotAuthorizedApp());
        uint256 day = currentDay();
        used[humanId][token][day] += amount;
        emit UsageRecorded(humanId, token, amount, day);
    }
}
