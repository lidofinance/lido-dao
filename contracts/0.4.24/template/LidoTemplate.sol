// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

//import "@aragon/os/contracts/ens/ENSConstants.sol";
import "@aragon/templates-shared/contracts/BaseTemplate.sol";

import "../oracle/LidoOracle.sol";
import "../nos/NodeOperatorsRegistry.sol";
import "../Lido.sol";

contract LidoTemplate is BaseTemplate {
    // Configurarion errors
    string private constant ERROR_ZERO_OWNER = "TMPL_ZERO_OWNER";
    string private constant ERROR_EMPTY_HOLDERS = "TMPL_EMPTY_HOLDERS";
    string private constant ERROR_BAD_AMOUNTS_LEN = "TMPL_BAD_AMOUNTS_LEN";
    string private constant ERROR_UNEXPECTED_TOTAL_SUPPLY = "TMPL_UNEXPECTED_TOTAL_SUPPLY";

    // Operational errors
    string private constant ERROR_PERMISSION_DENIED = "TMPL_PERMISSION_DENIED";
    string private constant ERROR_DAO_NOT_FINALIZED = "TMPL_DAO_NOT_FINALIZED";
    string private constant ERROR_DAO_NOT_DEPLOYED = "TMPL_DAO_NOT_DEPLOYED";

    /* Hardcoded constants to save gas
    bytes32 internal constant LIDO_PM_NODE = keccak256(abi.encodePacked(ETH_TLD_NODE, keccak256(abi.encodePacked("lidopm"))));
    */
    // bytes32 internal constant LIDO_PM_NODE = 0xbfc3884a938047d1e93d1dbd85bfcfb929a63a4ed292efc654596c10e96a88c9; // lidopm.eth

    /* Hardcoded constant to save gas
    bytes32 internal constant LIDOORACLE_APP_ID = (
        keccak256(abi.encodePacked(LIDO_PM_NODE, keccak256(abi.encodePacked("oracle")))) // oracle.lidopm.eth
    );
    bytes32 internal constant REGISTRY_APP_ID = (
        keccak256(abi.encodePacked(LIDO_PM_NODE, keccak256(abi.encodePacked("node-operators-registry")))) // node-operators-registry.lidopm.eth
    );
    bytes32 internal constant LIDO_APP_ID = (
        keccak256(abi.encodePacked(LIDO_PM_NODE, keccak256(abi.encodePacked("lido")))) // lido.lidopm.eth
    );
    */
    bytes32 internal constant LIDOORACLE_APP_ID = 0x8b47ba2a8454ec799cd91646e7ec47168e91fd139b23f017455f3e5898aaba93;
    bytes32 internal constant REGISTRY_APP_ID = 0x7071f283424072341f856ac9e947e7ec0eb68719f757a7e785979b6b8717579d;
    bytes32 internal constant LIDO_APP_ID = 0x3ca7c3e38968823ccb4c78ea688df41356f182ae1d159e4ee608d30d68cef320;

    bool private constant TOKEN_TRANSFERABLE = true;
    uint8 private constant TOKEN_DECIMALS = uint8(18);
    uint256 private constant TOKEN_MAX_PER_ACCOUNT = uint256(0);

    uint64 private constant DEFAULT_FINANCE_PERIOD = uint64(30 days);

    struct DeployState {
        Kernel dao;
        ACL acl;
        MiniMeToken token;
        Vault agentOrVault;
        Finance finance;
        TokenManager tokenManager;
        Voting voting;
        LidoOracle oracle;
        NodeOperatorsRegistry operators;
        Lido lido;
        string id;
        address[] holders;
        uint256[] stakes;
    }

    address private owner;
    DeployState private deployState;

    modifier onlyOwner() {
        require(msg.sender == owner, ERROR_PERMISSION_DENIED);
        _;
    }

    function setOwner(address _newOwner) external onlyOwner {
        owner = _newOwner;
    }

    constructor(
        address _owner,
        DAOFactory _daoFactory,
        ENS _ens,
        MiniMeTokenFactory _miniMeFactory,
        IFIFSResolvingRegistrar _aragonID
    ) public BaseTemplate(_daoFactory, _ens, _miniMeFactory, _aragonID) {
        require(_owner != address(0), ERROR_ZERO_OWNER);
        _ensureAragonIdIsValid(_aragonID);
        _ensureMiniMeFactoryIsValid(_miniMeFactory);
        owner = _owner;
    }

    function newDAO(
        string _id,
        string _tokenName,
        string _tokenSymbol,
        uint64[3] _votingSettings,
        address _BeaconDepositContract,
        uint32[4] _beaconSpec,
        uint16[4] _feeSettings
    ) external onlyOwner {
        DeployState memory state;
        require(state.dao == address(0), ERROR_DAO_NOT_FINALIZED);

        _validateId(_id);

        state.id = _id;
        // state.holders = _holders;
        // state.stakes = _stakes;

        state.token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);
        (state.dao, state.acl) = _createDAO();

        _setupApps(state, _votingSettings, _BeaconDepositContract, _beaconSpec, _feeSettings);

        deployState = state;
    }

    function issueTokens(
        address[] _holders,
        uint256[] _amounts,
        uint64 _vestingStart,
        uint64 _vestingCliff,
        uint64 _vestingEnd,
        bool _vestingRevokable,
        uint256 _extectedFinalTotalSupply
    ) external onlyOwner {
        require(_holders.length > 0, ERROR_EMPTY_HOLDERS);
        require(_holders.length == _amounts.length, ERROR_BAD_AMOUNTS_LEN);

        DeployState memory state = deployState;

        require(state.dao != address(0), ERROR_DAO_NOT_DEPLOYED);

        _issueTokens(
            state,
            _holders,
            _amounts,
            _vestingStart,
            _vestingCliff,
            _vestingEnd,
            _vestingRevokable,
            _extectedFinalTotalSupply
        );
    }

    function finalizeDAO(
        uint256 _unvestedTokensAmount
    ) external onlyOwner {
        // read from the storage once to prevent gas spending on SLOADs
        DeployState memory state = deployState;

        require(state.dao != address(0), ERROR_DAO_NOT_DEPLOYED);

        if (_unvestedTokensAmount != 0) {
            // using issue + assign to avoid setting the additional MINT_ROLE for the template
            state.tokenManager.issue(_unvestedTokensAmount);
            state.tokenManager.assign(state.agentOrVault, _unvestedTokensAmount);
        }

        // revert the cells back to get a refund
        _resetStorage();

        _setupPermissions(state);
        _transferRootPermissionsFromTemplateAndFinalizeDAO(state.dao, state.voting);
        _registerID(state.id, state.dao);
    }

    function _setupApps(
        DeployState memory state,
        uint64[3] memory _votingSettings,
        address _BeaconDepositContract,
        uint32[4] _beaconSpec,
        uint16[4] _feeSettings
    ) internal {
        state.agentOrVault = _installDefaultAgentApp(state.dao);
        state.finance = _installFinanceApp(state.dao, state.agentOrVault, DEFAULT_FINANCE_PERIOD);
        state.tokenManager = _installTokenManagerApp(state.dao, state.token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        state.voting = _installVotingApp(state.dao, state.token, _votingSettings);

        bytes memory initializeData = new bytes(0);
        state.oracle = LidoOracle(_installNonDefaultApp(state.dao, LIDOORACLE_APP_ID, initializeData));
        state.operators = NodeOperatorsRegistry(_installNonDefaultApp(state.dao, REGISTRY_APP_ID, initializeData));

        address recoveryVault = state.dao.getRecoveryVault();
        initializeData = abi.encodeWithSelector(
            Lido(0).initialize.selector,
            _BeaconDepositContract,
            state.oracle,
            state.operators,
            recoveryVault,
            recoveryVault
        );
        state.lido = Lido(_installNonDefaultApp(state.dao, LIDO_APP_ID, initializeData));

        _grantTempPermissions(state);
        
        state.lido.setFee(
            _feeSettings[0] // totalFeeBP
        );
        state.lido.setFeeDistribution(
            _feeSettings[1], // treasuryFeeBP
            _feeSettings[2], // insuranceFeeBP
            _feeSettings[3] // operatorsFeeBP
        );

        //        state.oracle.initialize_v2(100000, 50000);
        state.oracle.initialize(
            state.lido,
            _beaconSpec[0], // epochsPerFrame
            _beaconSpec[1], // slotsPerEpoch
            _beaconSpec[2], // secondsPerSlot
            _beaconSpec[3], // genesisTime
            100000,
            50000
        );
        state.operators.initialize(state.lido);
    }

    function _issueTokens(
        DeployState memory state,
        address[] memory _holders,
        uint256[] memory _amounts,
        uint64 _vestingStart,
        uint64 _vestingCliff,
        uint64 _vestingEnd,
        bool _vestingRevokable,
        uint256 _extectedFinalTotalSupply
    ) private {
        uint256 totalAmount = 0;
        uint256 i;

        for (i = 0; i < _holders.length; ++i) {
            totalAmount += _amounts[i];
        }

        state.tokenManager.issue(totalAmount);
        require(state.token.totalSupply() == _extectedFinalTotalSupply, ERROR_UNEXPECTED_TOTAL_SUPPLY);

        for (i = 0; i < _holders.length; ++i) {
            state.tokenManager.assignVested(_holders[i], _amounts[i], _vestingStart, _vestingCliff, _vestingEnd, _vestingRevokable);
        }
    }
    function _grantTempPermissions(DeployState memory state) internal {
        // Set initial values for fee and its distribution
        _createPermissionForTemplate(state.acl, state.lido, state.lido.MANAGE_FEE());
        // used for issuing vested tokens in the next step
        _createPermissionForTemplate(state.acl, state.tokenManager, state.tokenManager.ISSUE_ROLE());
        _createPermissionForTemplate(state.acl, state.tokenManager, state.tokenManager.ASSIGN_ROLE());
    }

    function _setupPermissions(DeployState memory state) internal {
        _removePermissionFromTemplate(state.acl, state.lido, state.lido.MANAGE_FEE());
        _removePermissionFromTemplate(state.acl, state.tokenManager, state.tokenManager.ISSUE_ROLE());
        _removePermissionFromTemplate(state.acl, state.tokenManager, state.tokenManager.ASSIGN_ROLE());
        _createAgentPermissions(state.acl, Agent(state.agentOrVault), state.voting, state.voting);
        _createVaultPermissions(state.acl, state.agentOrVault, state.finance, state.voting);
        _createFinancePermissions(state.acl, state.finance, state.voting, state.voting);
        _createFinanceCreatePaymentsPermission(state.acl, state.finance, state.voting, state.voting);
        _createEvmScriptsRegistryPermissions(state.acl, state.voting, state.voting);
        _createVotingPermissions(state.acl, state.voting, state.voting, state.tokenManager, state.voting);
        _createTokenManagerPermissions(state.acl, state.tokenManager, state.voting, state.voting);

        // Oracle
        state.acl.createPermission(state.voting, state.oracle, state.oracle.MANAGE_MEMBERS(), state.voting);
        state.acl.createPermission(state.voting, state.oracle, state.oracle.MANAGE_QUORUM(), state.voting);
        state.acl.createPermission(state.voting, state.oracle, state.oracle.SET_BEACON_SPEC(), state.voting);
        state.acl.createPermission(state.voting, state.oracle, state.oracle.SET_REPORT_BOUNDARIES(), state.voting);
        state.acl.createPermission(state.voting, state.oracle, state.oracle.SET_BEACON_REPORT_RECEIVER(), state.voting);

        // NodeOperatorsRegistry
        state.acl.createPermission(state.voting, state.operators, state.operators.MANAGE_SIGNING_KEYS(), state.voting);
        state.acl.createPermission(state.voting, state.operators, state.operators.ADD_NODE_OPERATOR_ROLE(), state.voting);
        state.acl.createPermission(state.voting, state.operators, state.operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), state.voting);
        state.acl.createPermission(state.voting, state.operators, state.operators.SET_NODE_OPERATOR_NAME_ROLE(), state.voting);
        state.acl.createPermission(state.voting, state.operators, state.operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), state.voting);
        state.acl.createPermission(state.voting, state.operators, state.operators.SET_NODE_OPERATOR_LIMIT_ROLE(), state.voting);
        state.acl.createPermission(state.voting, state.operators, state.operators.REPORT_STOPPED_VALIDATORS_ROLE(), state.voting);

        // Pool
        state.acl.createPermission(state.voting, state.lido, state.lido.PAUSE_ROLE(), state.voting);
        state.acl.createPermission(state.voting, state.lido, state.lido.MANAGE_FEE(), state.voting);
        state.acl.createPermission(state.voting, state.lido, state.lido.MANAGE_WITHDRAWAL_KEY(), state.voting);
        state.acl.createPermission(state.voting, state.lido, state.lido.SET_ORACLE(), state.voting);
        state.acl.createPermission(state.voting, state.lido, state.lido.BURN_ROLE(), state.voting);
        state.acl.createPermission(state.voting, state.lido, state.lido.SET_TREASURY(), state.voting);
        state.acl.createPermission(state.voting, state.lido, state.lido.SET_INSURANCE_FUND(), state.voting);
        state.acl.createPermission(state.voting, state.lido, state.lido.DEPOSIT_ROLE(), state.voting);
    }

    function _resetStorage() internal {
        delete deployState.dao;
        delete deployState.acl;
        delete deployState.token;
        delete deployState.agentOrVault;
        delete deployState.finance;
        delete deployState.tokenManager;
        delete deployState.voting;
        delete deployState.oracle;
        delete deployState.operators;
        delete deployState.lido;
        delete deployState.id;
        delete deployState.holders;
        delete deployState.stakes;
        delete deployState;
    }
}
