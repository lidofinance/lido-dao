// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "forge-std/Test.sol";
import { PausableUntil } from "contracts/0.8.9/utils/PausableUntil.sol";

contract ExposedPausableUntil is PausableUntil {

    function infinity() public pure returns (uint256) {
        return PAUSE_INFINITELY;
    }    

    function setPausedState(uint256 _resumeSince) public {
        _setPausedState(_resumeSince);
    }

    function pauseUntil(uint256 _pauseUntilInclusive) public {
        _pauseUntil(_pauseUntilInclusive);
    }

    function pauseFor(uint256 _duration) public {
        _pauseFor(_duration);
    }

    function resume() public {
        _resume();
    }

    function checkResumed() public view {
        _checkResumed();
    }

    function checkPaused() public view {
        _checkPaused();
    }
}

contract PausableUntilTest is Test {
    ExposedPausableUntil public pausableUntil;
    ExposedPausableUntil public pausableUntilTwo;

    function setUp() public {
        pausableUntil = new ExposedPausableUntil();
        pausableUntilTwo = new ExposedPausableUntil();
    }

    function testIsNotPausedByDefault() public {
        assertEq(pausableUntil.isPaused(), false);
        assertEq(pausableUntilTwo.isPaused(), false);
    }

    function testSetPausedState(uint256 _resumeSince, uint256 _randomTime) public {
        // ignore obvious 1 state and underflow condition
        vm.assume(_resumeSince != 1);
        vm.assume(_resumeSince >= block.timestamp);

        // make sure we're not already paused
        assertEq(pausableUntil.isPaused(), false);

        // pause until _resumeSince
        pausableUntil.setPausedState(_resumeSince);
        assertEq(pausableUntil.isPaused(), true);

        // check a random point in time (either before or after _resumeSince)
        vm.warp(_randomTime);
        if (_randomTime < _resumeSince) {
            assertEq(pausableUntil.isPaused(), true);
        } else {
            assertEq(pausableUntil.isPaused(), false);  
        }

        // go forward in time to _resumeSince - 1 block, check edge
        vm.warp(_resumeSince - 1);
        assertEq(pausableUntil.isPaused(), true);

        // go forward in time to _resumeSince block, check edge
        vm.warp(_resumeSince);
        assertEq(pausableUntil.isPaused(), false);
    }

    function testPauseUntil(uint256 _pauseUntilInclusive, uint256 _randomTime) public {
        vm.assume(_pauseUntilInclusive != 0);
        vm.assume(_randomTime != 0);
        vm.assume(_randomTime != _pauseUntilInclusive);
                
        if (_pauseUntilInclusive < block.timestamp) {
            vm.expectRevert();
            pausableUntil.pauseUntil(_pauseUntilInclusive);
            assertEq(pausableUntil.isPaused(), false);
        } else {
            pausableUntil.pauseUntil(_pauseUntilInclusive);
            assertEq(pausableUntil.isPaused(), true);

            // check a random point in time (either before or after _pauseUntilInclusive)
            vm.warp(_randomTime);
            if (_randomTime < _pauseUntilInclusive) {
                assertEq(pausableUntil.isPaused(), true);
            } else {
                assertEq(pausableUntil.isPaused(), false);  
            }
        }
    }

    function testPauseUntilInfinity(uint256 _randomTime) public {
        assertEq(pausableUntil.isPaused(), false);
        pausableUntil.pauseUntil(pausableUntil.infinity());
        assertEq(pausableUntil.isPaused(), true);

        // check a random point in time
        vm.warp(_randomTime);

        if (_randomTime == pausableUntil.infinity()) {
            assertEq(pausableUntil.isPaused(), false);
        } else {
            assertEq(pausableUntil.isPaused(), true);  
        }
    }

    function testPauseFor(uint256 _duration, uint256 _randomTime) public {
        assertEq(pausableUntil.isPaused(), false);

        uint256 originBlockTime = block.timestamp;

        if (_duration == 0) {
            vm.expectRevert();
            pausableUntil.pauseFor(_duration);
        } else {
            pausableUntil.pauseFor(_duration);
            assertEq(pausableUntil.isPaused(), true);

            // check a random point in time (either before or after _pauseUntilInclusive)
            vm.warp(_randomTime);

            // make sure the test logic itself doesn't overflow
            unchecked {
                vm.assume(originBlockTime + _duration >= originBlockTime);
            }

            if (_randomTime < (originBlockTime + _duration)) {
                assertEq(pausableUntil.isPaused(), true);
            } else {
                assertEq(pausableUntil.isPaused(), false);  
            }
        }
    }

    function testPauseForInfinity(uint256 _randomTime) public {
        assertEq(pausableUntil.isPaused(), false);
        pausableUntil.pauseFor(pausableUntil.infinity());
        assertEq(pausableUntil.isPaused(), true);

        // check a random point in time
        vm.warp(_randomTime);

        if (_randomTime == pausableUntil.infinity()) {
            assertEq(pausableUntil.isPaused(), false);
        } else {
            assertEq(pausableUntil.isPaused(), true);  
        }
    }

    // Make sure the boundaries are respected exactly
    function testPauseForUtilParity(uint256 _randomDuration) public {
        // protect the test itself from overflowing
        unchecked{ vm.assume(block.timestamp + _randomDuration >= _randomDuration); }

        // intentionally avoid the zero duration setting
        vm.assume(_randomDuration != 0);

        pausableUntil.pauseFor(_randomDuration);
        pausableUntilTwo.pauseUntil(block.timestamp + _randomDuration - 1);
        assertEq(pausableUntil.getResumeSinceTimestamp(), pausableUntilTwo.getResumeSinceTimestamp());
    }

    function testResumeWhenPaused(uint256 _randomDuration) public {
        assertEq(pausableUntil.isPaused(), false);

        // make sure the test logic itself doesn't overflow
        unchecked {
            vm.assume(block.timestamp + _randomDuration >= block.timestamp);
            vm.assume(block.timestamp + _randomDuration >= _randomDuration);
        }

        if (_randomDuration == 0) {
            // pause for zero seconds
            pausableUntil.setPausedState(block.timestamp);
            assertEq(pausableUntil.isPaused(), false);
        } else {
            pausableUntil.setPausedState(block.timestamp + _randomDuration);
            assertEq(pausableUntil.isPaused(), true);

            // override the pause state with a resume
            pausableUntil.resume();
        }

        assertEq(pausableUntil.isPaused(), false);
    }

    function testResumeWhenNotPaused() public {
        assertEq(pausableUntil.isPaused(), false);

        // attempt to resume while not in a paused state
        vm.expectRevert();
        pausableUntil.resume();
    }

    function testGetResumeSinceTimestamp(uint256 _resumeSince, uint256 _randomTime) public {
        vm.assume(_resumeSince >= _randomTime);
        vm.warp(_randomTime);
        pausableUntil.setPausedState(_resumeSince);
        assertEq(pausableUntil.getResumeSinceTimestamp(), _resumeSince);
    }

    function testCheckResumed(uint256 _randomTime) public {
        // set paused for 3 seconds
        uint256 originalTimestamp = block.timestamp;
        pausableUntil.setPausedState(block.timestamp + 3);

        // pick a random time
        vm.warp(_randomTime);

        if (_randomTime < (originalTimestamp + 3)) {
            vm.expectRevert();
        }
        
        pausableUntil.checkResumed();
    }

    function testCheckPaused(uint256 _randomTime, uint256 _randomDuration) public {
        // make sure the test logic itself doesn't overflow
        unchecked {
            vm.assume(block.timestamp + _randomDuration >= _randomTime);
            vm.assume(_randomTime != 0);
        }

        // set paused for random seconds
        uint256 originalTimestamp = block.timestamp;
        pausableUntil.setPausedState(block.timestamp + _randomDuration);

        // pick a random time
        vm.warp(_randomTime);

        if (block.timestamp >= (originalTimestamp + _randomDuration)) {
            vm.expectRevert();
            pausableUntil.checkPaused();
        } else {
            pausableUntil.checkPaused();
        }
    }

}