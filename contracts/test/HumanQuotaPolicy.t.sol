// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {HumanQuota} from "../src/HumanQuota.sol";

contract HumanQuotaPolicyTest is Test {
    HumanQuota private quota;
    address private constant TOKEN = address(0xBEEF);
    address private constant UPDATER = address(0xA11CE);

    function setUp() public {
        quota = new HumanQuota();
        quota.configureFeeController(TOKEN, 30, 5, 100, 16, 44, 2 ether, 1 ether);
        quota.configurePolicyUpdater(TOKEN, UPDATER, 10, 100);
    }

    function test_NuthatchPolicyUpdatesSpreadWithoutResettingVolume() public {
        vm.roll(1_000);
        vm.prank(UPDATER);
        quota.applyRiskPolicy(TOKEN, 7, 34, 999, keccak256("nuthatch-window-999"));

        (uint256 tightFee, uint256 wideFee, uint256 targetFee,, uint256 tightVolume, uint256 wideVolume) =
            quota.feeSchedule(TOKEN);
        assertEq(targetFee, 30);
        assertEq(tightVolume, 2 ether);
        assertEq(wideVolume, 1 ether);
        assertEq(tightFee, 19);
        assertEq(wideFee, 52);

        (
            address updater,
            uint256 maxStep,
            uint256 maxLag,
            uint256 indexedBlock,
            bytes32 decisionHash,
            uint256 desiredTight,
            uint256 spread
        ) = quota.policyState(TOKEN);
        assertEq(updater, UPDATER);
        assertEq(maxStep, 10);
        assertEq(maxLag, 100);
        assertEq(indexedBlock, 999);
        assertEq(decisionHash, keccak256("nuthatch-window-999"));
        assertEq(desiredTight, 7);
        assertEq(spread, 34);
    }

    function test_RejectsUnauthorizedStaleAndOversizedPolicyUpdates() public {
        vm.roll(1_000);
        vm.expectRevert(HumanQuota.NotPolicyUpdater.selector);
        quota.applyRiskPolicy(TOKEN, 7, 34, 999, keccak256("unauthorized"));

        vm.prank(UPDATER);
        quota.applyRiskPolicy(TOKEN, 7, 34, 999, keccak256("accepted"));

        vm.prank(UPDATER);
        vm.expectRevert(abi.encodeWithSelector(HumanQuota.StalePolicyBlock.selector, 999, 999));
        quota.applyRiskPolicy(TOKEN, 7, 34, 999, keccak256("replay"));

        vm.prank(UPDATER);
        vm.expectRevert(abi.encodeWithSelector(HumanQuota.PolicyStepTooLarge.selector, 7, 20, 10));
        quota.applyRiskPolicy(TOKEN, 20, 34, 1_000, keccak256("too-large"));
    }

    function test_RejectsPolicyFromStaleIndexer() public {
        vm.roll(1_200);
        vm.prank(UPDATER);
        vm.expectRevert(abi.encodeWithSelector(HumanQuota.PolicyDataTooOld.selector, 1_000, 1_200, 100));
        quota.applyRiskPolicy(TOKEN, 7, 34, 1_000, keccak256("stale"));
    }
}
