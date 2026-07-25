// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {WorldAgentBookMirror} from "../src/identity/WorldAgentBookMirror.sol";

contract WorldAgentBookMirrorTest is Test {
    address internal constant WORLD_AGENT_BOOK = 0xA23aB2712eA7BBa896930544C7d6636a96b944dA;
    address internal agent = makeAddr("agent");
    address internal relayer = makeAddr("relayer");
    address internal stranger = makeAddr("stranger");

    WorldAgentBookMirror internal mirror;

    function setUp() public {
        mirror = new WorldAgentBookMirror(480, WORLD_AGENT_BOOK, address(this), relayer);
    }

    function test_MirrorsCanonicalLookupWithSourceProvenance() public {
        bytes32 sourceHash = keccak256("world block");
        vm.prank(relayer);
        mirror.mirrorHuman(agent, 1234, 32_821_500, sourceHash);

        assertEq(mirror.lookupHuman(agent), 1234);
        WorldAgentBookMirror.Record memory record = mirror.recordOf(agent);
        assertEq(record.humanId, 1234);
        assertEq(record.sourceBlock, 32_821_500);
        assertEq(record.sourceBlockHash, sourceHash);
        assertEq(mirror.SOURCE_CHAIN_ID(), 480);
        assertEq(mirror.SOURCE_AGENT_BOOK(), WORLD_AGENT_BOOK);
    }

    function test_RejectsUnauthorizedOrOutOfOrderUpdates() public {
        vm.prank(stranger);
        vm.expectRevert(WorldAgentBookMirror.NotRelayer.selector);
        mirror.mirrorHuman(agent, 1234, 100, keccak256("100"));

        vm.prank(relayer);
        mirror.mirrorHuman(agent, 1234, 100, keccak256("100"));

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(WorldAgentBookMirror.StaleSourceBlock.selector, 100, 99));
        mirror.mirrorHuman(agent, 9999, 99, keccak256("99"));
    }

    function test_NewerWorldResultCanRevokeMirroredIdentity() public {
        vm.startPrank(relayer);
        mirror.mirrorHuman(agent, 1234, 100, keccak256("100"));
        mirror.mirrorHuman(agent, 0, 101, keccak256("101"));
        vm.stopPrank();

        assertEq(mirror.lookupHuman(agent), 0);
    }
}
