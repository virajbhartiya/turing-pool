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
    error InvalidFeeConfiguration();
    error FeeVolumeOverflow();

    event AppAuthorized(address indexed app, bool authorized);
    event DailyCapSet(address indexed token, uint256 cap);
    event UsageRecorded(uint256 indexed humanId, address indexed token, uint256 amount, uint256 indexed day);
    event FeeControllerConfigured(
        address indexed token,
        uint256 targetFeeBps,
        uint256 desiredTightFeeBps,
        uint256 maxWideFeeBps,
        uint256 tightFeeBps,
        uint256 wideFeeBps,
        uint256 seedTightVolume,
        uint256 seedWideVolume
    );
    event FeeScheduleUpdated(
        address indexed token,
        uint256 tightFeeBps,
        uint256 wideFeeBps,
        uint256 tightVolume,
        uint256 wideVolume,
        uint256 humanShareBps
    );

    address public owner;

    /// @notice Apps allowed to record usage (i.e. deployed TuringPool contracts)
    mapping(address app => bool) public authorizedApps;

    /// @notice Max tight-tier input notional per human per UTC day, in token units.
    ///         A cap of 0 means the tight tier is disabled for that token.
    mapping(address token => uint256) public dailyCap;

    /// @notice used[humanId][token][day] = input notional already traded at the tight tier
    mapping(uint256 humanId => mapping(address token => mapping(uint256 day => uint256))) public used;

    struct FeeController {
        uint128 tightVolume;
        uint128 wideVolume;
        uint32 targetFeeBps;
        uint32 desiredTightFeeBps;
        uint32 maxWideFeeBps;
        uint32 tightFeeBps;
        uint32 wideFeeBps;
        bool enabled;
    }

    /// @notice Activity-priced schedule for each fixed-amount token.
    mapping(address token => FeeController) private _feeControllers;

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

    /// @notice Starts or reseeds the revenue-neutral controller for a token.
    /// @dev Seed volumes allow a migrated deployment to preserve its observed
    ///      activity mix instead of resetting its economics.
    function configureFeeController(
        address token,
        uint32 targetFeeBps,
        uint32 desiredTightFeeBps,
        uint32 maxWideFeeBps,
        uint32 initialTightFeeBps,
        uint32 initialWideFeeBps,
        uint128 seedTightVolume,
        uint128 seedWideVolume
    ) external onlyOwner {
        require(
            targetFeeBps > 0 && targetFeeBps <= 10_000 && desiredTightFeeBps <= targetFeeBps
                && targetFeeBps <= maxWideFeeBps && maxWideFeeBps <= 10_000 && desiredTightFeeBps <= initialTightFeeBps
                && initialTightFeeBps <= initialWideFeeBps && initialWideFeeBps <= maxWideFeeBps,
            InvalidFeeConfiguration()
        );
        _feeControllers[token] = FeeController({
            tightVolume: seedTightVolume,
            wideVolume: seedWideVolume,
            targetFeeBps: targetFeeBps,
            desiredTightFeeBps: desiredTightFeeBps,
            maxWideFeeBps: maxWideFeeBps,
            tightFeeBps: initialTightFeeBps,
            wideFeeBps: initialWideFeeBps,
            enabled: true
        });
        _reprice(token);
        FeeController storage controller = _feeControllers[token];
        emit FeeControllerConfigured(
            token,
            targetFeeBps,
            desiredTightFeeBps,
            maxWideFeeBps,
            controller.tightFeeBps,
            controller.wideFeeBps,
            seedTightVolume,
            seedWideVolume
        );
    }

    function feeSchedule(address token)
        external
        view
        returns (
            uint256 tightFeeBps,
            uint256 wideFeeBps,
            uint256 targetFeeBps,
            uint256 humanShareBps,
            uint256 tightVolume,
            uint256 wideVolume
        )
    {
        FeeController storage controller = _feeControllers[token];
        tightFeeBps = controller.tightFeeBps;
        wideFeeBps = controller.wideFeeBps;
        targetFeeBps = controller.targetFeeBps;
        tightVolume = controller.tightVolume;
        wideVolume = controller.wideVolume;
        uint256 totalVolume = tightVolume + wideVolume;
        humanShareBps = totalVolume == 0 ? 0 : tightVolume * 10_000 / totalVolume;
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

    /// @notice Records the tier actually executed by SwapVM and updates the fee
    ///         pair used by the next quote/trade.
    function recordTrade(uint256 humanId, address token, uint256 amount, bool tight) external {
        require(authorizedApps[msg.sender], NotAuthorizedApp());
        if (tight) {
            uint256 day = currentDay();
            used[humanId][token][day] += amount;
            emit UsageRecorded(humanId, token, amount, day);
        }

        FeeController storage controller = _feeControllers[token];
        if (!controller.enabled) return;
        require(amount <= type(uint128).max, FeeVolumeOverflow());
        if (tight) {
            uint256 nextTightVolume = uint256(controller.tightVolume) + amount;
            require(nextTightVolume <= type(uint128).max, FeeVolumeOverflow());
            controller.tightVolume = uint128(nextTightVolume);
        } else {
            uint256 nextWideVolume = uint256(controller.wideVolume) + amount;
            require(nextWideVolume <= type(uint128).max, FeeVolumeOverflow());
            controller.wideVolume = uint128(nextWideVolume);
        }
        _reprice(token);

        uint256 totalVolume = uint256(controller.tightVolume) + uint256(controller.wideVolume);
        emit FeeScheduleUpdated(
            token,
            controller.tightFeeBps,
            controller.wideFeeBps,
            controller.tightVolume,
            controller.wideVolume,
            uint256(controller.tightVolume) * 10_000 / totalVolume
        );
    }

    function _reprice(address token) private {
        FeeController storage controller = _feeControllers[token];
        uint256 tightVolume = controller.tightVolume;
        uint256 wideVolume = controller.wideVolume;
        if (!controller.enabled || tightVolume == 0 || wideVolume == 0) return;

        uint256 targetRevenueBps = (tightVolume + wideVolume) * controller.targetFeeBps;
        uint256 desiredTightFeeBps = controller.desiredTightFeeBps;
        uint256 requiredWideRevenueBps = targetRevenueBps - tightVolume * desiredTightFeeBps;
        uint256 nextWideFeeBps = (requiredWideRevenueBps + wideVolume / 2) / wideVolume;

        if (nextWideFeeBps <= controller.maxWideFeeBps) {
            controller.tightFeeBps = uint32(desiredTightFeeBps);
            controller.wideFeeBps = uint32(nextWideFeeBps);
            return;
        }

        nextWideFeeBps = controller.maxWideFeeBps;
        uint256 wideRevenueBps = wideVolume * nextWideFeeBps;
        uint256 requiredTightRevenueBps = targetRevenueBps > wideRevenueBps ? targetRevenueBps - wideRevenueBps : 0;
        uint256 nextTightFeeBps = (requiredTightRevenueBps + tightVolume / 2) / tightVolume;
        if (nextTightFeeBps < desiredTightFeeBps) nextTightFeeBps = desiredTightFeeBps;
        if (nextTightFeeBps > controller.targetFeeBps) nextTightFeeBps = controller.targetFeeBps;
        controller.tightFeeBps = uint32(nextTightFeeBps);
        controller.wideFeeBps = uint32(nextWideFeeBps);
    }
}
