// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/introspection/ERC165Checker.sol";

import "../interfaces/IBeaconReportReceiver.sol";
import "../interfaces/ILido.sol";
import "../interfaces/ILidoOracle.sol";

import "./ReportUtils.sol";


/**
 * @title Implementation of an ETH 2.0 -> ETH oracle
 *
 * The goal of the oracle is to inform other parts of the system about balances controlled by the
 * DAO on the ETH 2.0 side. The balances can go up because of reward accumulation and can go down
 * because of slashing.
 *
 * The timeline is divided into consecutive frames. Every oracle member may push its report once
 * per frame. When the equal reports reach the configurable 'quorum' value, this frame is
 * considered finalized and the resulting report is pushed to Lido.
 *
 * Not all frames may come to a quorum. Oracles may report only to the first epoch of the frame and
 * only if no quorum is reached for this epoch yet.
 */
contract LidoOracle is ILidoOracle, AragonApp {
    using SafeMath for uint256;
    using ReportUtils for uint256;
    using ERC165Checker for address;

    struct BeaconSpec {
        uint64 epochsPerFrame;
        uint64 slotsPerEpoch;
        uint64 secondsPerSlot;
        uint64 genesisTime;
    }

    /// ACL
    bytes32 constant public MANAGE_MEMBERS =
        0xbf6336045918ae0015f4cdb3441a2fdbfaa4bcde6558c8692aac7f56c69fb067; // keccak256("MANAGE_MEMBERS")
    bytes32 constant public MANAGE_QUORUM =
        0xa5ffa9f45fa52c446078e834e1914561bd9c2ab1e833572d62af775da092ccbc; // keccak256("MANAGE_QUORUM")
    bytes32 constant public SET_BEACON_SPEC =
        0x16a273d48baf8111397316e6d961e6836913acb23b181e6c5fb35ec0bd2648fc; // keccak256("SET_BEACON_SPEC")
    bytes32 constant public SET_REPORT_BOUNDARIES =
        0x44adaee26c92733e57241cb0b26ffaa2d182ed7120ba3ecd7e0dce3635c01dc1; // keccak256("SET_REPORT_BOUNDARIES")
    bytes32 constant public SET_BEACON_REPORT_RECEIVER =
        0xe22a455f1bfbaf705ac3e891a64e156da92cb0b42cfc389158e6e82bd57f37be; // keccak256("SET_BEACON_REPORT_RECEIVER")

    /// Maximum number of oracle committee members
    uint256 public constant MAX_MEMBERS = 256;

    /// Eth1 denomination is 18 digits, while Eth2 has 9 digits. Because we work with Eth2
    /// balances and to support old interfaces expecting eth1 format, we multiply by this
    /// coefficient.
    uint128 internal constant DENOMINATION_OFFSET = 1e9;

    uint256 internal constant MEMBER_NOT_FOUND = uint256(-1);

    /// Number of exactly the same reports needed to finalize the epoch
    bytes32 internal constant QUORUM_POSITION =
        0xd43b42c1ba05a1ab3c178623a49b2cdb55f000ec70b9ccdba5740b3339a7589e; // keccak256("lido.LidoOracle.quorum")

    /// Address of the Lido contract
    bytes32 internal constant LIDO_POSITION =
        0xf6978a4f7e200f6d3a24d82d44c48bddabce399a3b8ec42a480ea8a2d5fe6ec5; // keccak256("lido.LidoOracle.lido")

    /// Storage for the actual beacon chain specification
    bytes32 internal constant BEACON_SPEC_POSITION =
        0x805e82d53a51be3dfde7cfed901f1f96f5dad18e874708b082adb8841e8ca909; // keccak256("lido.LidoOracle.beaconSpec")

    /// Version of the initialized contract data
    /// NB: Contract versioning starts from 1.
    /// The version stored in CONTRACT_VERSION_POSITION equals to
    /// - 0 right after deployment when no initializer is invoked yet
    /// - N after calling initialize() during deployment from scratch, where N is the current contract version
    /// - N after upgrading contract from the previous version (after calling finalize_vN())
    bytes32 internal constant CONTRACT_VERSION_POSITION =
        0x75be19a3f314d89bd1f84d30a6c84e2f1cd7afc7b6ca21876564c265113bb7e4; // keccak256("lido.LidoOracle.contractVersion")

    /// Epoch that we currently collect reports
    bytes32 internal constant EXPECTED_EPOCH_ID_POSITION =
        0x65f1a0ee358a8a4000a59c2815dc768eb87d24146ca1ac5555cb6eb871aee915; // keccak256("lido.LidoOracle.expectedEpochId")

    /// The bitmask of the oracle members that pushed their reports
    bytes32 internal constant REPORTS_BITMASK_POSITION =
        0xea6fa022365e4737a3bb52facb00ddc693a656fb51ffb2b4bd24fb85bdc888be; // keccak256("lido.LidoOracle.reportsBitMask")

    /// Historic data about 2 last completed reports and their times
    bytes32 internal constant POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0xaa8433b13d2b111d4f84f6f374bc7acbe20794944308876aa250fa9a73dc7f53; // keccak256("lido.LidoOracle.postCompletedTotalPooledEther")
    bytes32 internal constant PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION =
        0x1043177539af09a67d747435df3ff1155a64cd93a347daaac9132a591442d43e; // keccak256("lido.LidoOracle.preCompletedTotalPooledEther")
    bytes32 internal constant LAST_COMPLETED_EPOCH_ID_POSITION =
        0xdad15c0beecd15610092d84427258e369d2582df22869138b4c5265f049f574c; // keccak256("lido.LidoOracle.lastCompletedEpochId")
    bytes32 internal constant TIME_ELAPSED_POSITION =
        0x8fe323f4ecd3bf0497252a90142003855cc5125cee76a5b5ba5d508c7ec28c3a; // keccak256("lido.LidoOracle.timeElapsed")

    /// Receiver address to be called when the report is pushed to Lido
    bytes32 internal constant BEACON_REPORT_RECEIVER_POSITION =
        0xb59039ed37776bc23c5d272e10b525a957a1dfad97f5006c84394b6b512c1564; // keccak256("lido.LidoOracle.beaconReportReceiver")

    /// Upper bound of the reported balance possible increase in APR, controlled by the governance
    bytes32 internal constant ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION =
        0x613075ab597bed8ce2e18342385ce127d3e5298bc7a84e3db68dc64abd4811ac; // keccak256("lido.LidoOracle.allowedBeaconBalanceAnnualRelativeIncrease")

    /// Lower bound of the reported balance possible decrease, controlled by the governance
    ///
    /// @notice When slashing happens, the balance may decrease at a much faster pace. Slashing are
    /// one-time events that decrease the balance a fair amount - a few percent at a time in a
    /// realistic scenario. Thus, instead of sanity check for an APR, we check if the plain relative
    /// decrease is within bounds.  Note that it's not annual value, its just one-jump value.
    bytes32 internal constant ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION =
        0x92ba7776ed6c5d13cf023555a94e70b823a4aebd56ed522a77345ff5cd8a9109; // keccak256("lido.LidoOracle.allowedBeaconBalanceDecrease")

    /// This is a dead variable: it was used only in v1 and in upgrade v1 --> v2
    /// Just keep in mind that storage at this position is occupied but with no actual usage
    bytes32 internal constant V1_LAST_REPORTED_EPOCH_ID_POSITION =
        0xfe0250ed0c5d8af6526c6d133fccb8e5a55dd6b1aa6696ed0c327f8e517b5a94; // keccak256("lido.LidoOracle.lastReportedEpochId")

    /// Contract structured storage
    address[] private members;                /// slot 0: oracle committee members
    uint256[] private currentReportVariants;  /// slot 1: reporting storage


    /**
     * @notice Return the Lido contract address
     */
    function getLido() public view returns (ILido) {
        return ILido(LIDO_POSITION.getStorageAddress());
    }

    /**
     * @notice Return the number of exactly the same reports needed to finalize the epoch
     */
    function getQuorum() public view returns (uint256) {
        return QUORUM_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the upper bound of the reported balance possible increase in APR
     */
    function getAllowedBeaconBalanceAnnualRelativeIncrease() external view returns (uint256) {
        return ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the lower bound of the reported balance possible decrease
     */
    function getAllowedBeaconBalanceRelativeDecrease() external view returns (uint256) {
        return ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.getStorageUint256();
    }

    /**
     * @notice Set the upper bound of the reported balance possible increase in APR to `_value`
     */
    function setAllowedBeaconBalanceAnnualRelativeIncrease(uint256 _value) external auth(SET_REPORT_BOUNDARIES) {
        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.setStorageUint256(_value);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_value);
    }

    /**
     * @notice Set the lower bound of the reported balance possible decrease to `_value`
     */
    function setAllowedBeaconBalanceRelativeDecrease(uint256 _value) external auth(SET_REPORT_BOUNDARIES) {
        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.setStorageUint256(_value);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_value);
    }

    /**
     * @notice Return the receiver contract address to be called when the report is pushed to Lido
     */
    function getBeaconReportReceiver() external view returns (address) {
        return address(BEACON_REPORT_RECEIVER_POSITION.getStorageUint256());
    }

    /**
     * @notice Set the receiver contract address to `_addr` to be called when the report is pushed
     * @dev Specify 0 to disable this functionality
     */
    function setBeaconReportReceiver(address _addr) external auth(SET_BEACON_REPORT_RECEIVER) {
        if(_addr != address(0)) {
            IBeaconReportReceiver iBeacon;
            require(
                _addr._supportsInterface(iBeacon.processLidoOracleReport.selector),
                "BAD_BEACON_REPORT_RECEIVER"
            );
        }

        BEACON_REPORT_RECEIVER_POSITION.setStorageUint256(uint256(_addr));
        emit BeaconReportReceiverSet(_addr);
    }

    /**
     * @notice Return the current reporting bitmap, representing oracles who have already pushed
     * their version of report during the expected epoch
     * @dev Every oracle bit corresponds to the index of the oracle in the current members list
     */
    function getCurrentOraclesReportStatus() external view returns (uint256) {
        return REPORTS_BITMASK_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the current reporting variants array size
     */
    function getCurrentReportVariantsSize() external view returns (uint256) {
        return currentReportVariants.length;
    }

    /**
     * @notice Return the current reporting array element with index `_index`
     */
    function getCurrentReportVariant(uint256 _index)
        external
        view
        returns (
            uint64 beaconBalance,
            uint32 beaconValidators,
            uint16 count
        )
    {
        return currentReportVariants[_index].decodeWithCount();
    }

    /**
     * @notice Returns epoch that can be reported by oracles
     */
    function getExpectedEpochId() external view returns (uint256) {
        return EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
    }

    /**
     * @notice Return the current oracle member committee list
     */
    function getOracleMembers() external view returns (address[]) {
        return members;
    }

    /**
     * @notice Return the initialized version of this contract starting from 0
     */
    function getVersion() external view returns (uint256) {
        return CONTRACT_VERSION_POSITION.getStorageUint256();
    }

    /**
     * @notice Return beacon specification data
     */
    function getBeaconSpec()
        external
        view
        returns (
            uint64 epochsPerFrame,
            uint64 slotsPerEpoch,
            uint64 secondsPerSlot,
            uint64 genesisTime
        )
    {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        return (
            beaconSpec.epochsPerFrame,
            beaconSpec.slotsPerEpoch,
            beaconSpec.secondsPerSlot,
            beaconSpec.genesisTime
        );
    }

    /**
     * @notice Update beacon specification data
     */
    function setBeaconSpec(
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        external
        auth(SET_BEACON_SPEC)
    {
        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );
    }

    /**
     * @notice Return the epoch calculated from current timestamp
     */
    function getCurrentEpochId() external view returns (uint256) {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        return _getCurrentEpochId(beaconSpec);
    }

    /**
     * @notice Return currently reportable epoch (the first epoch of the current frame) as well as
     * its start and end times in seconds
     */
    function getCurrentFrame()
        external
        view
        returns (
            uint256 frameEpochId,
            uint256 frameStartTime,
            uint256 frameEndTime
        )
    {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint64 genesisTime = beaconSpec.genesisTime;
        uint64 secondsPerEpoch = beaconSpec.secondsPerSlot * beaconSpec.slotsPerEpoch;

        frameEpochId = _getFrameFirstEpochId(_getCurrentEpochId(beaconSpec), beaconSpec);
        frameStartTime = frameEpochId * secondsPerEpoch + genesisTime;
        frameEndTime = (frameEpochId + beaconSpec.epochsPerFrame) * secondsPerEpoch + genesisTime - 1;
    }

    /**
     * @notice Return last completed epoch
     */
    function getLastCompletedEpochId() external view returns (uint256) {
        return LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256();
    }

    /**
     * @notice Report beacon balance and its change during the last frame
     */
    function getLastCompletedReportDelta()
        external
        view
        returns (
            uint256 postTotalPooledEther,
            uint256 preTotalPooledEther,
            uint256 timeElapsed
        )
    {
        postTotalPooledEther = POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.getStorageUint256();
        preTotalPooledEther = PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.getStorageUint256();
        timeElapsed = TIME_ELAPSED_POSITION.getStorageUint256();
    }

    /**
     * @notice Initialize the contract (version 3 for now) from scratch
     * @dev For details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
     * @param _lido Address of Lido contract
     * @param _epochsPerFrame Number of epochs per frame
     * @param _slotsPerEpoch Number of slots per epoch
     * @param _secondsPerSlot Number of seconds per slot
     * @param _genesisTime Genesis time
     * @param _allowedBeaconBalanceAnnualRelativeIncrease Allowed beacon balance annual relative increase (e.g. 1000 means 10% increase)
     * @param _allowedBeaconBalanceRelativeDecrease Allowed beacon balance instantaneous decrease (e.g. 500 means 5% decrease)
     */
    function initialize(
        address _lido,
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime,
        uint256 _allowedBeaconBalanceAnnualRelativeIncrease,
        uint256 _allowedBeaconBalanceRelativeDecrease
    )
        external onlyInit
    {
        assert(1 == ((1 << (MAX_MEMBERS - 1)) >> (MAX_MEMBERS - 1)));  // static assert

        // We consider storage state right after deployment (no initialize() called yet) as version 0

        // Initializations for v0 --> v1
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 0, "BASE_VERSION_MUST_BE_ZERO");

        _setBeaconSpec(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime
        );

        LIDO_POSITION.setStorageAddress(_lido);

        QUORUM_POSITION.setStorageUint256(1);
        emit QuorumChanged(1);

        // Initializations for v1 --> v2
        ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceAnnualRelativeIncrease);
        emit AllowedBeaconBalanceAnnualRelativeIncreaseSet(_allowedBeaconBalanceAnnualRelativeIncrease);

        ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION
            .setStorageUint256(_allowedBeaconBalanceRelativeDecrease);
        emit AllowedBeaconBalanceRelativeDecreaseSet(_allowedBeaconBalanceRelativeDecrease);

        // set expected epoch to the first epoch for the next frame
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint256 expectedEpoch = _getFrameFirstEpochId(0, beaconSpec) + beaconSpec.epochsPerFrame;
        EXPECTED_EPOCH_ID_POSITION.setStorageUint256(expectedEpoch);
        emit ExpectedEpochIdUpdated(expectedEpoch);

        // Initializations for v2 --> v3
        _initialize_v3();

        // Needed to finish the Aragon part of initialization (otherwise auth() modifiers will fail)
        initialized();
    }

    /**
     * @notice A function to finalize upgrade to v3 (from v1). Can be called only once
     * @dev Value 2 in CONTRACT_VERSION_POSITION is skipped due to change in numbering
     * For more details see https://github.com/lidofinance/lido-improvement-proposals/blob/develop/LIPS/lip-10.md
     */
    function finalizeUpgrade_v3() external {
        require(CONTRACT_VERSION_POSITION.getStorageUint256() == 1, "WRONG_BASE_VERSION");

        _initialize_v3();
    }

    /**
     * @notice A dummy incremental v1/v2 --> v3 initialize function. Just corrects version number in storage
     * @dev This function is introduced just to set in correspondence version number in storage,
     * semantic version of the contract and number N used in naming of _initialize_nN/finalizeUpgrade_vN.
     * NB, that thus version 2 is skipped
     */
    function _initialize_v3() internal {
        CONTRACT_VERSION_POSITION.setStorageUint256(3);
        emit ContractVersionSet(3);
    }

    /**
     * @notice Add `_member` to the oracle member committee list
     */
    function addOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        require(address(0) != _member, "BAD_ARGUMENT");
        require(MEMBER_NOT_FOUND == _getMemberId(_member), "MEMBER_EXISTS");
        require(members.length < MAX_MEMBERS, "TOO_MANY_MEMBERS");

        members.push(_member);

        emit MemberAdded(_member);
    }

    /**
     * @notice Remove '_member` from the oracle member committee list
     */
    function removeOracleMember(address _member) external auth(MANAGE_MEMBERS) {
        uint256 index = _getMemberId(_member);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 last = members.length - 1;
        if (index != last) members[index] = members[last];
        members.length--;
        emit MemberRemoved(_member);

        // delete the data for the last epoch, let remained oracles report it again
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        delete currentReportVariants;
    }

    /**
     * @notice Set the number of exactly the same reports needed to finalize the epoch to `_quorum`
     */
    function setQuorum(uint256 _quorum) external auth(MANAGE_QUORUM) {
        require(0 != _quorum, "QUORUM_WONT_BE_MADE");
        uint256 oldQuorum = QUORUM_POSITION.getStorageUint256();
        QUORUM_POSITION.setStorageUint256(_quorum);
        emit QuorumChanged(_quorum);

        // If the quorum value lowered, check existing reports whether it is time to push
        if (oldQuorum > _quorum) {
            (bool isQuorum, uint256 report) = _getQuorumReport(_quorum);
            if (isQuorum) {
                (uint64 beaconBalance, uint32 beaconValidators) = report.decode();
                _push(
                     EXPECTED_EPOCH_ID_POSITION.getStorageUint256(),
                     DENOMINATION_OFFSET * uint128(beaconBalance),
                     beaconValidators,
                     _getBeaconSpec()
                );
            }
        }
    }

    /**
     * @notice Accept oracle committee member reports from the ETH 2.0 side
     * @param _epochId Beacon chain epoch
     * @param _beaconBalance Balance in gwei on the ETH 2.0 side (9-digit denomination)
     * @param _beaconValidators Number of validators visible in this epoch
     */
    function reportBeacon(uint256 _epochId, uint64 _beaconBalance, uint32 _beaconValidators) external {
        BeaconSpec memory beaconSpec = _getBeaconSpec();
        uint256 expectedEpoch = EXPECTED_EPOCH_ID_POSITION.getStorageUint256();
        require(_epochId >= expectedEpoch, "EPOCH_IS_TOO_OLD");

        // if expected epoch has advanced, check that this is the first epoch of the current frame
        // and clear the last unsuccessful reporting
        if (_epochId > expectedEpoch) {
            require(_epochId == _getFrameFirstEpochId(_getCurrentEpochId(beaconSpec), beaconSpec), "UNEXPECTED_EPOCH");
            _clearReportingAndAdvanceTo(_epochId);
        }

        uint128 beaconBalanceEth1 = DENOMINATION_OFFSET * uint128(_beaconBalance);
        emit BeaconReported(_epochId, beaconBalanceEth1, _beaconValidators, msg.sender);

        // make sure the oracle is from members list and has not yet voted
        uint256 index = _getMemberId(msg.sender);
        require(index != MEMBER_NOT_FOUND, "MEMBER_NOT_FOUND");
        uint256 bitMask = REPORTS_BITMASK_POSITION.getStorageUint256();
        uint256 mask = 1 << index;
        require(bitMask & mask == 0, "ALREADY_SUBMITTED");
        REPORTS_BITMASK_POSITION.setStorageUint256(bitMask | mask);

        // push this report to the matching kind
        uint256 report = ReportUtils.encode(_beaconBalance, _beaconValidators);
        uint256 quorum = getQuorum();
        uint256 i = 0;

        // iterate on all report variants we already have, limited by the oracle members maximum
        while (i < currentReportVariants.length && currentReportVariants[i].isDifferent(report)) ++i;
        if (i < currentReportVariants.length) {
            if (currentReportVariants[i].getCount() + 1 >= quorum) {
                _push(_epochId, beaconBalanceEth1, _beaconValidators, beaconSpec);
            } else {
                ++currentReportVariants[i]; // increment report counter, see ReportUtils for details
            }
        } else {
            if (quorum == 1) {
                _push(_epochId, beaconBalanceEth1, _beaconValidators, beaconSpec);
            } else {
                currentReportVariants.push(report + 1);
            }
        }
    }

    /**
     * @notice Return beacon specification data
     */
    function _getBeaconSpec()
        internal
        view
        returns (BeaconSpec memory beaconSpec)
    {
        uint256 data = BEACON_SPEC_POSITION.getStorageUint256();
        beaconSpec.epochsPerFrame = uint64(data >> 192);
        beaconSpec.slotsPerEpoch = uint64(data >> 128);
        beaconSpec.secondsPerSlot = uint64(data >> 64);
        beaconSpec.genesisTime = uint64(data);
        return beaconSpec;
    }

    /**
     * @notice Return whether the `_quorum` is reached and the final report
     */
    function _getQuorumReport(uint256 _quorum) internal view returns (bool isQuorum, uint256 report) {
        // check most frequent cases first: all reports are the same or no reports yet
        if (currentReportVariants.length == 1) {
            return (currentReportVariants[0].getCount() >= _quorum, currentReportVariants[0]);
        } else if (currentReportVariants.length == 0) {
            return (false, 0);
        }

        // if more than 2 kind of reports exist, choose the most frequent
        uint256 maxind = 0;
        uint256 repeat = 0;
        uint16 maxval = 0;
        uint16 cur = 0;
        for (uint256 i = 0; i < currentReportVariants.length; ++i) {
            cur = currentReportVariants[i].getCount();
            if (cur >= maxval) {
                if (cur == maxval) {
                    ++repeat;
                } else {
                    maxind = i;
                    maxval = cur;
                    repeat = 0;
                }
            }
        }
        return (maxval >= _quorum && repeat == 0, currentReportVariants[maxind]);
    }

    /**
     * @notice Set beacon specification data
     */
    function _setBeaconSpec(
        uint64 _epochsPerFrame,
        uint64 _slotsPerEpoch,
        uint64 _secondsPerSlot,
        uint64 _genesisTime
    )
        internal
    {
        require(_epochsPerFrame > 0, "BAD_EPOCHS_PER_FRAME");
        require(_slotsPerEpoch > 0, "BAD_SLOTS_PER_EPOCH");
        require(_secondsPerSlot > 0, "BAD_SECONDS_PER_SLOT");
        require(_genesisTime > 0, "BAD_GENESIS_TIME");

        uint256 data = (
            uint256(_epochsPerFrame) << 192 |
            uint256(_slotsPerEpoch) << 128 |
            uint256(_secondsPerSlot) << 64 |
            uint256(_genesisTime)
        );
        BEACON_SPEC_POSITION.setStorageUint256(data);
        emit BeaconSpecSet(
            _epochsPerFrame,
            _slotsPerEpoch,
            _secondsPerSlot,
            _genesisTime);
    }

    /**
     * @notice Push the given report to Lido and performs accompanying accounting
     * @param _epochId Beacon chain epoch, proven to be >= expected epoch and <= current epoch
     * @param _beaconBalanceEth1 Validators balance in eth1 (18-digit denomination)
     * @param _beaconSpec current beacon specification data
     */
    function _push(
        uint256 _epochId,
        uint128 _beaconBalanceEth1,
        uint128 _beaconValidators,
        BeaconSpec memory _beaconSpec
    )
        internal
    {
        emit Completed(_epochId, _beaconBalanceEth1, _beaconValidators);

        // now this frame is completed, so the expected epoch should be advanced to the first epoch
        // of the next frame
        _clearReportingAndAdvanceTo(_epochId + _beaconSpec.epochsPerFrame);

        // report to the Lido and collect stats
        ILido lido = getLido();
        uint256 prevTotalPooledEther = lido.totalSupply();
        lido.handleOracleReport(_beaconValidators, _beaconBalanceEth1);
        uint256 postTotalPooledEther = lido.totalSupply();

        PRE_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(prevTotalPooledEther);
        POST_COMPLETED_TOTAL_POOLED_ETHER_POSITION.setStorageUint256(postTotalPooledEther);
        uint256 timeElapsed = (_epochId - LAST_COMPLETED_EPOCH_ID_POSITION.getStorageUint256()) *
            _beaconSpec.slotsPerEpoch * _beaconSpec.secondsPerSlot;
        TIME_ELAPSED_POSITION.setStorageUint256(timeElapsed);
        LAST_COMPLETED_EPOCH_ID_POSITION.setStorageUint256(_epochId);

        // rollback on boundaries violation
        _reportSanityChecks(postTotalPooledEther, prevTotalPooledEther, timeElapsed);

        // emit detailed statistics and call the quorum delegate with this data
        emit PostTotalShares(postTotalPooledEther, prevTotalPooledEther, timeElapsed, lido.getTotalShares());
        IBeaconReportReceiver receiver = IBeaconReportReceiver(BEACON_REPORT_RECEIVER_POSITION.getStorageUint256());
        if (address(receiver) != address(0)) {
            receiver.processLidoOracleReport(postTotalPooledEther, prevTotalPooledEther, timeElapsed);
        }
    }

    /**
     * @notice Remove the current reporting progress and advances to accept the later epoch `_epochId`
     */
    function _clearReportingAndAdvanceTo(uint256 _epochId) internal {
        REPORTS_BITMASK_POSITION.setStorageUint256(0);
        EXPECTED_EPOCH_ID_POSITION.setStorageUint256(_epochId);
        delete currentReportVariants;
        emit ExpectedEpochIdUpdated(_epochId);
    }

    /**
     * @notice Performs logical consistency check of the Lido changes as the result of reports push
     * @dev To make oracles less dangerous, we limit rewards report by 10% _annual_ increase and 5%
     * _instant_ decrease in stake, with both values configurable by the governance in case of
     * extremely unusual circumstances.
     **/
    function _reportSanityChecks(
        uint256 _postTotalPooledEther,
        uint256 _preTotalPooledEther,
        uint256 _timeElapsed)
        internal
        view
    {
        if (_postTotalPooledEther >= _preTotalPooledEther) {
            // increase                 = _postTotalPooledEther - _preTotalPooledEther,
            // relativeIncrease         = increase / _preTotalPooledEther,
            // annualRelativeIncrease   = relativeIncrease / (timeElapsed / 365 days),
            // annualRelativeIncreaseBp = annualRelativeIncrease * 10000, in basis points 0.01% (1e-4)
            uint256 allowedAnnualRelativeIncreaseBp =
                ALLOWED_BEACON_BALANCE_ANNUAL_RELATIVE_INCREASE_POSITION.getStorageUint256();
            // check that annualRelativeIncreaseBp <= allowedAnnualRelativeIncreaseBp
            require(uint256(10000 * 365 days).mul(_postTotalPooledEther - _preTotalPooledEther) <=
                    allowedAnnualRelativeIncreaseBp.mul(_preTotalPooledEther).mul(_timeElapsed),
                    "ALLOWED_BEACON_BALANCE_INCREASE");
        } else {
            // decrease           = _preTotalPooledEther - _postTotalPooledEther
            // relativeDecrease   = decrease / _preTotalPooledEther
            // relativeDecreaseBp = relativeDecrease * 10000, in basis points 0.01% (1e-4)
            uint256 allowedRelativeDecreaseBp =
                ALLOWED_BEACON_BALANCE_RELATIVE_DECREASE_POSITION.getStorageUint256();
            // check that relativeDecreaseBp <= allowedRelativeDecreaseBp
            require(uint256(10000).mul(_preTotalPooledEther - _postTotalPooledEther) <=
                    allowedRelativeDecreaseBp.mul(_preTotalPooledEther),
                    "ALLOWED_BEACON_BALANCE_DECREASE");
        }
    }

    /**
     * @notice Return `_member` index in the members list or MEMBER_NOT_FOUND
     */
    function _getMemberId(address _member) internal view returns (uint256) {
        uint256 length = members.length;
        for (uint256 i = 0; i < length; ++i) {
            if (members[i] == _member) {
                return i;
            }
        }
        return MEMBER_NOT_FOUND;
    }

    /**
     * @notice Return the epoch calculated from current timestamp
     */
    function _getCurrentEpochId(BeaconSpec memory _beaconSpec) internal view returns (uint256) {
        return (_getTime() - _beaconSpec.genesisTime) / (_beaconSpec.slotsPerEpoch * _beaconSpec.secondsPerSlot);
    }

    /**
     * @notice Return the first epoch of the frame that `_epochId` belongs to
     */
    function _getFrameFirstEpochId(uint256 _epochId, BeaconSpec memory _beaconSpec) internal view returns (uint256) {
        return _epochId / _beaconSpec.epochsPerFrame * _beaconSpec.epochsPerFrame;
    }

    /**
     * @notice Return the current timestamp
     */
    function _getTime() internal view returns (uint256) {
        return block.timestamp; // solhint-disable-line not-rely-on-time
    }
}
