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

    struct DeployedApps {
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
    }

    address private deployer;
    DeployedApps private deployedApps;

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
        string _tokenName,
        string _tokenSymbol,
        uint64[3] _votingSettings,
        address _BeaconDepositContract,
        uint256 _depositIterationLimit
    )
        external
    {
        require(deployer == address(0), "PREVIOUS_DAO_NOT_FINALIZED");

        deployer = msg.sender;
        DeployedApps memory apps;

        apps.token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);
        (apps.dao, apps.acl) = _createDAO();

        _setupApps(apps, _votingSettings, _BeaconDepositContract, _depositIterationLimit);

        deployedApps = apps;
    }

    function finalizeDAO(string _id, address[] _holders, uint256[] _stakes) external {
        // read from the storage once to prevent gas spending on SLOADs
        DeployedApps memory apps = deployedApps;

        require(deployer != address(0), "DAO_NOT_DEPLOYED");
        require(deployer == msg.sender, "DEPLOYER_CHANGED");

        require(_holders.length > 0, "COMPANY_EMPTY_HOLDERS");
        require(_holders.length == _stakes.length, "COMPANY_BAD_HOLDERS_STAKES_LEN");

        _validateId(_id);

        // revert the cells back to get a refund
        _resetStorage();

        _mintTokens(apps.acl, apps.tokenManager, _holders, _stakes);
        _setupPermissions(apps);
        _transferRootPermissionsFromTemplateAndFinalizeDAO(apps.dao, apps.voting);
        _registerID(_id, apps.dao);
    }

    function _setupApps(
        DeployedApps memory apps,
        uint64[3] memory _votingSettings,
        address _BeaconDepositContract,
        uint256 _depositIterationLimit
    )
        internal
    {
        apps.agentOrVault = _installDefaultAgentApp(apps.dao);
        apps.finance = _installFinanceApp(apps.dao, apps.agentOrVault, DEFAULT_FINANCE_PERIOD);
        apps.tokenManager = _installTokenManagerApp(apps.dao, apps.token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        apps.voting = _installVotingApp(apps.dao, apps.token, _votingSettings);

        // skipping StETH initialization for now, will call it manually later since we need the pool
        bytes memory initializeData = new bytes(0);
        apps.steth = StETH(_installNonDefaultApp(apps.dao, STETH_APP_ID, initializeData));
        apps.oracle = LidoOracle(_installNonDefaultApp(apps.dao, LIDOORACLE_APP_ID, initializeData));
        apps.operators = NodeOperatorsRegistry(_installNonDefaultApp(apps.dao, REGISTRY_APP_ID, initializeData));

        initializeData = abi.encodeWithSelector(
            Lido(0).initialize.selector,
            apps.steth,
            _BeaconDepositContract,
            apps.oracle,
            apps.operators,
            _depositIterationLimit
        );
        apps.lido = Lido(_installNonDefaultApp(apps.dao, LIDO_APP_ID, initializeData));

        apps.steth.initialize(apps.lido);
        apps.oracle.initialize(apps.lido);
        apps.operators.initialize(apps.lido);
    }

    function _setupPermissions(DeployedApps memory apps) internal {
        _createAgentPermissions(apps.acl, Agent(apps.agentOrVault), apps.voting, apps.voting);
        _createVaultPermissions(apps.acl, apps.agentOrVault, apps.finance, apps.voting);
        _createFinancePermissions(apps.acl, apps.finance, apps.voting, apps.voting);
        _createFinanceCreatePaymentsPermission(apps.acl, apps.finance, apps.voting, apps.voting);
        _createEvmScriptsRegistryPermissions(apps.acl, apps.voting, apps.voting);
        _createVotingPermissions(apps.acl, apps.voting, apps.voting, apps.tokenManager, apps.voting);
        _createTokenManagerPermissions(apps.acl, apps.tokenManager, apps.voting, apps.voting);

        // StETH
        apps.acl.createPermission(apps.voting, apps.steth, apps.steth.PAUSE_ROLE(), apps.voting);
        apps.acl.createPermission(apps.lido, apps.steth, apps.steth.MINT_ROLE(), apps.voting);
        apps.acl.createPermission(apps.lido, apps.steth, apps.steth.BURN_ROLE(), apps.voting);

        // Oracle
        apps.acl.createPermission(apps.voting, apps.oracle, apps.oracle.MANAGE_MEMBERS(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.oracle, apps.oracle.MANAGE_QUORUM(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.oracle, apps.oracle.SET_REPORT_INTERVAL_DURATION(), apps.voting);

        // NodeOperatorsRegistry
        apps.acl.createPermission(apps.voting, apps.operators, apps.operators.MANAGE_SIGNING_KEYS(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.operators, apps.operators.ADD_NODE_OPERATOR_ROLE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.operators, apps.operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.operators, apps.operators.SET_NODE_OPERATOR_NAME_ROLE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.operators, apps.operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.operators, apps.operators.SET_NODE_OPERATOR_LIMIT_ROLE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.operators, apps.operators.REPORT_STOPPED_VALIDATORS_ROLE(), apps.voting);

        // Pool
        apps.acl.createPermission(apps.voting, apps.lido, apps.lido.PAUSE_ROLE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.lido, apps.lido.MANAGE_FEE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.lido, apps.lido.MANAGE_WITHDRAWAL_KEY(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.lido, apps.lido.SET_ORACLE(), apps.voting);
        apps.acl.createPermission(apps.voting, apps.lido, apps.lido.SET_DEPOSIT_ITERATION_LIMIT(), apps.voting);
    }

    function _resetStorage() internal {
        delete deployedApps.dao;
        delete deployedApps.acl;
        delete deployedApps.token;
        delete deployedApps.agentOrVault;
        delete deployedApps.finance;
        delete deployedApps.tokenManager;
        delete deployedApps.voting;
        delete deployedApps.steth;
        delete deployedApps.oracle;
        delete deployedApps.operators;
        delete deployedApps.lido;
        delete deployedApps;
        delete deployer;
    }
}
