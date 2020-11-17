pragma solidity 0.4.24;

//import "@aragon/os/contracts/ens/ENSConstants.sol";
import "@aragon/templates-shared/contracts/BaseTemplate.sol";

import "../StETH.sol";
import "../oracle/LidoOracle.sol";
import "../nos/NodeOperatorsRegistry.sol";
import "../Lido.sol";


contract LidoTemplate is BaseTemplate {
    /* Hardcoded constants to save gas
    bytes32 internal constant LIDO_PM_NODE = keccak256(abi.encodePacked(ETH_TLD_NODE, keccak256(abi.encodePacked("lido"))));
    */
    bytes32 internal constant LIDO_PM_NODE = 0xbc171924c4ea138304db6886c0c786d160c88b76e94f9f89453a6ca2dbf6316f;

    /* Hardcoded constant to save gas
    bytes32 internal constant STETH_APP_ID = (
        keccak256(abi.encodePacked(LIDO_PM_NODE, keccak256(abi.encodePacked("steth")))) // steth.lido.eth
    );
    bytes32 internal constant LIDOORACLE_APP_ID = (
        keccak256(abi.encodePacked(LIDO_PM_NODE, keccak256(abi.encodePacked("lidooracle")))) // lidooracle.lido.eth
    );
    bytes32 internal constant REGISTRY_APP_ID = (
        keccak256(abi.encodePacked(LIDO_PM_NODE, keccak256(abi.encodePacked("node-operators-registry")))) // node-operators-registry.lido.eth
    );
    bytes32 internal constant LIDO_APP_ID = (
        keccak256(abi.encodePacked(LIDO_PM_NODE, keccak256(abi.encodePacked("lido")))) // lido.lido.eth
    );
    */
    bytes32 constant internal STETH_APP_ID = 0x7a155a469b6e893b1e5d8f992f066474a74daf5ece6715948667ef3565e34ec2;
    bytes32 constant internal LIDOORACLE_APP_ID = 0xc62f68e3a6f657e08c27afe0f11d03375e5255f5845055d81c1281dbf139ce18;
    bytes32 internal constant REGISTRY_APP_ID = 0x9a09c6bc9551dd5e194dc3f814ce4725494966d9cdc90ff6cb49fc94d8a034ab;
    bytes32 constant internal LIDO_APP_ID = 0xe5c0c15280069e08354c1c1d5b6706edcc4e849e76ec9822afa35d4d66bbbe06;

    bool constant private TOKEN_TRANSFERABLE = true;
    uint8 constant private TOKEN_DECIMALS = uint8(18);
    uint256 constant private TOKEN_MAX_PER_ACCOUNT = uint256(0);

    uint64 constant private DEFAULT_FINANCE_PERIOD = uint64(30 days);

    struct DeployState {
        Kernel dao;
        ACL acl;
        MiniMeToken token;
        Vault agentOrVault;
        Finance finance;
        TokenManager tokenManager;
        Voting voting;
        StETH steth;
        LidoOracle oracle;
        NodeOperatorsRegistry operators;
        Lido lido;
        string id;
        address[] holders;
        uint256[] stakes;

    }

    DeployState private deployState;

    constructor(
        DAOFactory _daoFactory,
        ENS _ens,
        MiniMeTokenFactory _miniMeFactory,
        IFIFSResolvingRegistrar _aragonID
    )
        public
        BaseTemplate(_daoFactory, _ens, _miniMeFactory, _aragonID)
    {
        _ensureAragonIdIsValid(_aragonID);
        _ensureMiniMeFactoryIsValid(_miniMeFactory);
    }

    function newDAO(
        string _id,
        string _tokenName,
        string _tokenSymbol,
        address[] _holders,
        uint256[] _stakes,
        uint64[3] _votingSettings,
        address _BeaconDepositContract,
        uint256 _depositIterationLimit
    )
        external
    {
        require(deployState.dao == address(0), "PREVIOUS_DEPLOYMENT_NOT_FINALIZED");
        require(_holders.length > 0, "COMPANY_EMPTY_HOLDERS");
        require(_holders.length == _stakes.length, "COMPANY_BAD_HOLDERS_STAKES_LEN");

        _validateId(_id);

        DeployState memory state;
        state.id = _id;
        state.holders = _holders;
        state.stakes = _stakes;

        state.token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);
        (state.dao, state.acl) = _createDAO();

        _setupApps(state, _votingSettings, _BeaconDepositContract, _depositIterationLimit);

        deployState = state;
    }

    function finalizeDAO() external {
        // read from the storage once to prevent gas spending on SLOADs
        DeployState memory state = deployState;

        require(state.dao != address(0), "DAO_NOT_DEPLOYED");

        // revert the cells back to get a refund
        _resetStorage();

        _mintTokens(state.acl, state.tokenManager, state.holders, state.stakes);
        _setupPermissions(state);
        _transferRootPermissionsFromTemplateAndFinalizeDAO(state.dao, state.voting);
        _registerID(state.id, state.dao);
    }

    function _setupApps(
        DeployState memory state,
        uint64[3] memory _votingSettings,
        address _BeaconDepositContract,
        uint256 _depositIterationLimit
    )
        internal
    {
        state.agentOrVault = _installDefaultAgentApp(state.dao);
        state.finance = _installFinanceApp(state.dao, state.agentOrVault, DEFAULT_FINANCE_PERIOD);
        state.tokenManager = _installTokenManagerApp(state.dao, state.token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        state.voting = _installVotingApp(state.dao, state.token, _votingSettings);

        // skipping StETH initialization for now, will call it manually later since we need the pool
        bytes memory initializeData = new bytes(0);
        state.steth = StETH(_installNonDefaultApp(state.dao, STETH_APP_ID, initializeData));
        state.oracle = LidoOracle(_installNonDefaultApp(state.dao, LIDOORACLE_APP_ID, initializeData));
        state.operators = NodeOperatorsRegistry(_installNonDefaultApp(state.dao, REGISTRY_APP_ID, initializeData));

        initializeData = abi.encodeWithSelector(
            Lido(0).initialize.selector,
            state.steth,
            _BeaconDepositContract,
            state.oracle,
            state.operators,
            _depositIterationLimit
        );
        state.lido = Lido(_installNonDefaultApp(state.dao, LIDO_APP_ID, initializeData));

        state.steth.initialize(state.lido);
        state.oracle.initialize(
            state.lido,
            uint64(225),  // epochsPerFrame
            uint64(32),  // slotsPerEpoch
            uint64(12),  // secondsPerSlot
            uint64(1606824000)  // genesisTime
        );
        state.operators.initialize(state.lido);
    }

    function _setupPermissions(DeployState memory state) internal {
        _createAgentPermissions(state.acl, Agent(state.agentOrVault), state.voting, state.voting);
        _createVaultPermissions(state.acl, state.agentOrVault, state.finance, state.voting);
        _createFinancePermissions(state.acl, state.finance, state.voting, state.voting);
        _createFinanceCreatePaymentsPermission(state.acl, state.finance, state.voting, state.voting);
        _createEvmScriptsRegistryPermissions(state.acl, state.voting, state.voting);
        _createVotingPermissions(state.acl, state.voting, state.voting, state.tokenManager, state.voting);
        _createTokenManagerPermissions(state.acl, state.tokenManager, state.voting, state.voting);

        // StETH
        state.acl.createPermission(state.voting, state.steth, state.steth.PAUSE_ROLE(), state.voting);
        state.acl.createPermission(state.lido, state.steth, state.steth.MINT_ROLE(), state.voting);
        state.acl.createPermission(state.lido, state.steth, state.steth.BURN_ROLE(), state.voting);

        // Oracle
        state.acl.createPermission(state.voting, state.oracle, state.oracle.MANAGE_MEMBERS(), state.voting);
        state.acl.createPermission(state.voting, state.oracle, state.oracle.MANAGE_QUORUM(), state.voting);
        state.acl.createPermission(state.voting, state.oracle, state.oracle.SET_BEACON_SPEC(), state.voting);

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
        state.acl.createPermission(state.voting, state.lido, state.lido.SET_DEPOSIT_ITERATION_LIMIT(), state.voting);
    }

    function _resetStorage() internal {
        delete deployState.dao;
        delete deployState.acl;
        delete deployState.token;
        delete deployState.agentOrVault;
        delete deployState.finance;
        delete deployState.tokenManager;
        delete deployState.voting;
        delete deployState.steth;
        delete deployState.oracle;
        delete deployState.operators;
        delete deployState.lido;
        delete deployState.id;
        delete deployState.holders;
        delete deployState.stakes;
        delete deployState;
    }
}
