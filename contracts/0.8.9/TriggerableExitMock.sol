// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

contract TriggerableExitMock {
    address constant VALIDATOR_EXIT_PRECOMPILE_ADDRESS = 0x1234567890123456789012345678901234567890;

    uint256 private constant EXCESS_EXITS_STORAGE_SLOT = 0;
    uint256 private constant EXIT_COUNT_STORAGE_SLOT = 1;
    uint256 private constant EXIT_MESSAGE_QUEUE_HEAD_STORAGE_SLOT = 2;
    uint256 private constant EXIT_MESSAGE_QUEUE_TAIL_STORAGE_SLOT = 3;
    uint256 private constant EXIT_MESSAGE_QUEUE_STORAGE_OFFSET = 4;

    uint256 private constant MIN_EXIT_FEE = 1;
    uint256 private constant EXIT_FEE_UPDATE_FRACTION = 17;
    uint256 private constant EXCESS_RETURN_GAS_STIPEND = 2300;

    uint256 private constant TARGET_EXITS_PER_BLOCK = 2;

    event TriggerableExit(bytes indexed validatorPubkey);

    uint256 lastProcessedBlock;

    function triggerExit(bytes memory validatorPubkey) external payable {
        checkExitFee(msg.value);
        incrementExitCount();
        insertExitToQueue(validatorPubkey);
        returnExcessPayment(msg.value, msg.sender);

        emit TriggerableExit(validatorPubkey);
    }

    // 0x009145CCE52D386f254917e481eB44e9943F39138d9145CCE52D386f254917e481eB44e9943F39138e9943F391382345
    function insertExitToQueue(bytes memory validatorPubkey) private {
        require(validatorPubkey.length == 48, "Validator public key must contain 48 bytes");

        address srcAddr = msg.sender;
        bytes32 position = getSlotReference(EXIT_MESSAGE_QUEUE_TAIL_STORAGE_SLOT);

        uint256 queueTailIndex;
        assembly {
            queueTailIndex := sload(position)
        }

        uint256 queueStorageSlot = EXIT_MESSAGE_QUEUE_STORAGE_OFFSET + queueTailIndex * 3;

        bytes32 slotForSourceAdr = getSlotReference(queueStorageSlot);
        assembly {
            sstore(slotForSourceAdr, srcAddr)
        }

        bytes32 slotForValPubKeyPart1 = getSlotReference(queueStorageSlot + 1);
        bytes32 slotForValPubKeyPart2 = getSlotReference(queueStorageSlot + 2);

        assembly {
            let _part1 := mload(validatorPubkey)
            let _part2 := mload(add(validatorPubkey, 0x10))

            sstore(slotForValPubKeyPart1, _part1)
            sstore(slotForValPubKeyPart2, _part2)
        }

        bytes32 tailAdr = getSlotReference(EXIT_MESSAGE_QUEUE_TAIL_STORAGE_SLOT);
        uint256 tailValue = queueTailIndex + 1;

        assembly {
            sstore(tailAdr, tailValue)
        }
    }

    function getSlotReference(uint256 index) private pure returns (bytes32) {
        bytes32 slotAddress = bytes32(uint256(uint160(VALIDATOR_EXIT_PRECOMPILE_ADDRESS)));
        bytes32 slotIndex = bytes32(index);

        return keccak256(abi.encodePacked(slotAddress, slotIndex));
    }

    function dummy() public pure returns (uint256) {
        return 1;
    }

    function checkExitFee(uint256 feeSent) internal view {
        uint256 exitFee = getExitFee();
        require(feeSent >= exitFee, 'Insufficient exit fee');
    }

    function getExitFee() public view returns (uint256) {
        bytes32 position = getSlotReference(EXCESS_EXITS_STORAGE_SLOT);

        uint256 excessExits;
        assembly {
            excessExits := sload(position)
        }
        return fakeExponential(
            MIN_EXIT_FEE,
            excessExits,
            EXIT_FEE_UPDATE_FRACTION);
    }

    function fakeExponential(uint256 factor, uint256 numerator, uint256 denominator) private pure returns (uint256) {
        uint256 i = 1;
        uint256 output = 0;

        uint256 numeratorAccum = factor * denominator;

        while (numeratorAccum > 0) {
            output += numeratorAccum;
            numeratorAccum = (numeratorAccum * numerator) / (denominator * i);
            i += 1;
        }

        return output / denominator;
    }

    function incrementExitCount() private {
        bytes32 position = getSlotReference(EXIT_COUNT_STORAGE_SLOT);

        uint256 exitCount;
        assembly {
            exitCount := sload(position)
        }

        exitCount += 1;
        assembly {
            sstore(position, exitCount)
        }
    }

    function returnExcessPayment(uint256 feeSent, address sourceAddress) internal {
        uint256 excessPayment = feeSent - getExitFee();
        if (excessPayment > 0) {
            (bool sent, /*bytes memory data*/) = sourceAddress.call{value: excessPayment, gas: EXCESS_RETURN_GAS_STIPEND}("");
            require(sent, "Failed to return excess fee payment");
        }
    }

    //block processing
    function updateExcessExits() internal {
        bytes32 positionExceessExits = getSlotReference(EXCESS_EXITS_STORAGE_SLOT);
        bytes32 positionExitsCount = getSlotReference(EXIT_COUNT_STORAGE_SLOT);

        uint256 previousExcessExits;
        uint256 exitCount;
        assembly {
            previousExcessExits := sload(positionExceessExits)
            exitCount := sload(positionExitsCount)
        }

        uint256 newExcessExits = 0;
        if (previousExcessExits + exitCount > TARGET_EXITS_PER_BLOCK) {
            newExcessExits = previousExcessExits + exitCount - TARGET_EXITS_PER_BLOCK;
            assembly {
                sstore(positionExceessExits, newExcessExits)
            }
        }
    }

    function resetExitCount() internal {
        bytes32 position = getSlotReference(EXIT_COUNT_STORAGE_SLOT);
        assembly {
            sstore(position, 0)
        }
    }

    function blockProcessing() public {
        if (block.number != lastProcessedBlock) {
            lastProcessedBlock = block.number;
            updateExcessExits();
            resetExitCount();
        }
    }
}
