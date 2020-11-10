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

    // Storing temporary vars in storage to avoid hitting the `CompilerError: Stack too deep`
    Kernel private dao;
    ACL private acl;
    MiniMeToken private token;
    Vault private agentOrVault;
    Finance private finance;
    TokenManager private tokenManager;
    Voting private voting;
    StETH private steth;
    LidoOracle private oracle;
    NodeOperatorsRegistry private operators;
    Lido private lido;


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
        address _ETH2ValidatorRegistrationContract,
        uint256 _depositIterationLimit
    )
        external
    {
        _validateId(_id);
        require(_holders.length > 0, "COMPANY_EMPTY_HOLDERS");
        require(_holders.length == _stakes.length, "COMPANY_BAD_HOLDERS_STAKES_LEN");

        // setup apps
        token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);
        (dao, acl) = _createDAO();
        _setupApps(_votingSettings, _ETH2ValidatorRegistrationContract, _depositIterationLimit);

        // lido setApps
        _createPermissionForTemplate(acl, lido, lido.SET_APPS());
        lido.setApps(steth, oracle, operators);
        _removePermissionFromTemplate(acl, lido, lido.SET_APPS());

        _mintTokens(acl, tokenManager, _holders, _stakes);

        _setupPermissions();

        _transferRootPermissionsFromTemplateAndFinalizeDAO(dao, voting);
        _registerID(_id, dao);

        _reset();   // revert the cells back to get a refund
    }

    function _setupApps(
        uint64[3] memory _votingSettings,
        address _ETH2ValidatorRegistrationContract,
        uint256 _depositIterationLimit
    )
        internal
    {
        agentOrVault = _installDefaultAgentApp(dao);
        finance = _installFinanceApp(dao, agentOrVault, DEFAULT_FINANCE_PERIOD);
        tokenManager = _installTokenManagerApp(dao, token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        voting = _installVotingApp(dao, token, _votingSettings);

        bytes memory initializeData = abi.encodeWithSelector(
            Lido(0).initialize.selector,
            _ETH2ValidatorRegistrationContract,
            _depositIterationLimit
        );
        lido = Lido(_installNonDefaultApp(dao, LIDO_APP_ID, initializeData));
        
        initializeData = abi.encodeWithSelector(StETH(0).initialize.selector, lido);
        steth = StETH(_installNonDefaultApp(dao, STETH_APP_ID, initializeData));

        initializeData = abi.encodeWithSelector(LidoOracle(0).initialize.selector, lido);
        oracle = LidoOracle(_installNonDefaultApp(dao, LIDOORACLE_APP_ID, initializeData));

        initializeData = abi.encodeWithSelector(NodeOperatorsRegistry(0).initialize.selector, lido);
        operators = NodeOperatorsRegistry(_installNonDefaultApp(dao, REGISTRY_APP_ID, initializeData));
    }

    function _setupPermissions(
    )
        internal
    {
        _createAgentPermissions(acl, Agent(agentOrVault), voting, voting);
        _createVaultPermissions(acl, agentOrVault, finance, voting);
        _createFinancePermissions(acl, finance, voting, voting);
        _createFinanceCreatePaymentsPermission(acl, finance, voting, voting);
        _createEvmScriptsRegistryPermissions(acl, voting, voting);
        _createVotingPermissions(acl, voting, voting, tokenManager, voting);
        _createTokenManagerPermissions(acl, tokenManager, voting, voting);

        // StETH
        acl.createPermission(voting, steth, steth.PAUSE_ROLE(), voting);
        acl.createPermission(lido, steth, steth.MINT_ROLE(), voting);
        acl.createPermission(lido, steth, steth.BURN_ROLE(), voting);

        // Oracle
        acl.createPermission(voting, oracle, oracle.MANAGE_MEMBERS(), voting);
        acl.createPermission(voting, oracle, oracle.MANAGE_QUORUM(), voting);
        acl.createPermission(voting, oracle, oracle.SET_REPORT_INTERVAL_DURATION(), voting);

        // NodeOperatorsRegistry
        acl.createPermission(voting, operators, operators.MANAGE_SIGNING_KEYS(), voting);
        acl.createPermission(voting, operators, operators.ADD_NODE_OPERATOR_ROLE(), voting);
        acl.createPermission(voting, operators, operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), voting);
        acl.createPermission(voting, operators, operators.SET_NODE_OPERATOR_NAME_ROLE(), voting);
        acl.createPermission(voting, operators, operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), voting);
        acl.createPermission(voting, operators, operators.SET_NODE_OPERATOR_LIMIT_ROLE(), voting);
        acl.createPermission(voting, operators, operators.REPORT_STOPPED_VALIDATORS_ROLE(), voting);

        // Pool
        acl.createPermission(voting, lido, lido.PAUSE_ROLE(), voting);
        acl.createPermission(voting, lido, lido.MANAGE_FEE(), voting);
        acl.createPermission(voting, lido, lido.MANAGE_WITHDRAWAL_KEY(), voting);
        acl.createPermission(voting, lido, lido.SET_DEPOSIT_ITERATION_LIMIT(), voting);
        acl.createPermission(voting, lido, lido.SET_APPS(), voting);
    }

    /// @dev reset temporary storage
    function _reset() private {
        delete dao;
        delete acl;
        delete token;
        delete agentOrVault;
        delete finance;
        delete tokenManager;
        delete voting;
        delete steth;
        delete oracle;
        delete operators;
        delete lido;
    }
}
