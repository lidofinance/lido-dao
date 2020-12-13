// SPDX-FileCopyrightText: 2020 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.4.24;

import "@aragon/os/contracts/factory/APMRegistryFactory.sol";
import "@aragon/os/contracts/acl/ACL.sol";
import "@aragon/os/contracts/apm/Repo.sol";
import "@aragon/os/contracts/apm/APMRegistry.sol";
import "@aragon/os/contracts/ens/ENSSubdomainRegistrar.sol";
import "@aragon/os/contracts/kernel/Kernel.sol";
import "@aragon/os/contracts/lib/ens/ENS.sol";
import "@aragon/os/contracts/lib/ens/PublicResolver.sol";
import "@aragon/os/contracts/factory/DAOFactory.sol";
import "@aragon/os/contracts/common/IsContract.sol";

import "@aragon/apps-agent/contracts/Agent.sol";
import "@aragon/apps-vault/contracts/Vault.sol";
import "@aragon/apps-voting/contracts/Voting.sol";
import "@aragon/apps-finance/contracts/Finance.sol";
import "@aragon/apps-token-manager/contracts/TokenManager.sol";
import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";

import "@aragon/id/contracts/IFIFSResolvingRegistrar.sol";

import "../Lido.sol";
import "../oracle/LidoOracle.sol";
import "../nos/NodeOperatorsRegistry.sol";
import "../interfaces/IValidatorRegistration.sol";


contract LidoTemplate3 is IsContract {
    // Configurarion errors
    string constant private ERROR_ZERO_OWNER = "TMPL_ZERO_OWNER";
    string constant private ERROR_ENS_NOT_CONTRACT = "TMPL_ENS_NOT_CONTRACT";
    string constant private ERROR_DAO_FACTORY_NOT_CONTRACT = "TMPL_DAO_FAC_NOT_CONTRACT";
    string constant private ERROR_MINIME_FACTORY_NOT_CONTRACT = "TMPL_MINIME_FAC_NOT_CONTRACT";
    string constant private ERROR_ARAGON_ID_NOT_CONTRACT = "TMPL_ARAGON_ID_NOT_CONTRACT";
    string constant private ERROR_APM_REGISTRY_FACTORY_NOT_CONTRACT = "TMPL_APM_REGISTRY_FAC_NOT_CONTRACT";
    string constant private ERROR_EMPTY_HOLDERS = "TMPL_EMPTY_HOLDERS";
    string constant private ERROR_BAD_AMOUNTS_LEN = "TMPL_BAD_AMOUNTS_LEN";
    string constant private ERROR_INVALID_ID = "TMPL_INVALID_ID";

    // Operational errors
    string constant private ERROR_PERMISSION_DENIED = "TMPL_PERMISSION_DENIED";
    string constant private ERROR_REGISTRY_ALREADY_DEPLOYED = "TMPL_REGISTRY_ALREADY_DEPLOYED";
    string constant private ERROR_ENS_NODE_NOT_OWNED_BY_TEMPLATE = "TMPL_ENS_NODE_NOT_OWNED_BY_TEMPLATE";
    string constant private ERROR_REGISTRY_NOT_DEPLOYED = "TMPL_REGISTRY_NOT_DEPLOYED";
    string constant private ERROR_DAO_ALREADY_DEPLOYED = "TMPL_DAO_ALREADY_DEPLOYED";
    string constant private ERROR_DAO_NOT_DEPLOYED = "TMPL_DAO_NOT_DEPLOYED";
    string constant private ERROR_ALREADY_FINALIZED = "TMPL_ALREADY_FINALIZED";

    // Aragon app IDs
    bytes32 constant private ARAGON_AGENT_APP_ID = 0x9ac98dc5f995bf0211ed589ef022719d1487e5cb2bab505676f0d084c07cf89a; // agent.aragonpm.eth
    bytes32 constant private ARAGON_VAULT_APP_ID = 0x7e852e0fcfce6551c13800f1e7476f982525c2b5277ba14b24339c68416336d1; // vault.aragonpm.eth
    bytes32 constant private ARAGON_VOTING_APP_ID = 0x9fa3927f639745e587912d4b0fea7ef9013bf93fb907d29faeab57417ba6e1d4; // voting.aragonpm.eth
    bytes32 constant private ARAGON_FINANCE_APP_ID = 0xbf8491150dafc5dcaee5b861414dca922de09ccffa344964ae167212e8c673ae; // finance.aragonpm.eth
    bytes32 constant private ARAGON_TOKEN_MANAGER_APP_ID = 0x6b20a3010614eeebf2138ccec99f028a61c811b3b1a3343b6ff635985c75c91f; // token-manager.aragonpm.eth

    // APM app names, see https://github.com/aragon/aragonOS/blob/f3ae59b/contracts/apm/APMRegistry.sol#L11
    string constant private APM_APP_NAME = "apm-registry";
    string constant private APM_REPO_APP_NAME = "apm-repo";
    string constant private APM_ENSSUB_APP_NAME = "apm-enssub";

    // Aragon app names
    string constant private ARAGON_AGENT_APP_NAME = "aragon-agent";
    string constant private ARAGON_FINANCE_APP_NAME = "aragon-finance";
    string constant private ARAGON_TOKEN_MANAGER_APP_NAME = "aragon-token-manager";
    string constant private ARAGON_VOTING_APP_NAME = "aragon-voting";

    // Lido app names
    string constant private LIDO_APP_NAME = "lido";
    string constant private NODE_OPERATORS_REGISTRY_APP_NAME = "node-operators-registry";
    string constant private ORACLE_APP_NAME = "oracle";

    // DAO config constants
    bool constant private TOKEN_TRANSFERABLE = true;
    uint8 constant private TOKEN_DECIMALS = uint8(18);
    uint64 constant private DEFAULT_FINANCE_PERIOD = uint64(30 days);
    uint256 constant private TOKEN_MAX_PER_ACCOUNT = 0;

    struct APMRepos {
        Repo lido;
        Repo oracle;
        Repo nodeOperatorsRegistry;
        Repo aragonAgent;
        Repo aragonFinance;
        Repo aragonTokenManager;
        Repo aragonVoting;
    }

    struct DeployState {
        bytes32 lidoRegistryEnsNode;
        APMRegistry lidoRegistry;
        Kernel dao;
        ACL acl;
        MiniMeToken token;
        Agent agent;
        Finance finance;
        TokenManager tokenManager;
        Voting voting;
        Lido lido;
        LidoOracle oracle;
        NodeOperatorsRegistry operators;
    }

    struct AppVersion {
        uint16[3] semanticVersion;
        address contractAddress;
        bytes contentURI;
    }

    address private owner;
    ENS private ens;
    DAOFactory private daoFactory;
    MiniMeTokenFactory private miniMeFactory;
    IFIFSResolvingRegistrar private aragonID;
    APMRegistryFactory private apmRegistryFactory;

    DeployState private deployState;
    APMRepos private apmRepos;

    event TmplAPMDeployed(address apm);
    event TmplReposCreated();
    event TmplAppInstalled(address appProxy, bytes32 appId);
    event TmplDAOAndTokenDeployed(address dao, address token);
    event TmplTokensIssued(uint256 totalAmount);
    event TmplDaoFinalized();

    modifier onlyOwner() {
        require(msg.sender == owner, ERROR_PERMISSION_DENIED);
        _;
    }

    function setOwner(address _newOwner) onlyOwner external {
        owner = _newOwner;
    }

    constructor(
        address _owner,
        DAOFactory _daoFactory,
        ENS _ens,
        MiniMeTokenFactory _miniMeFactory,
        IFIFSResolvingRegistrar _aragonID,
        APMRegistryFactory _apmRegistryFactory
    )
        public
    {
        require(_owner != address(0), ERROR_ZERO_OWNER);
        require(isContract(address(_daoFactory)), ERROR_DAO_FACTORY_NOT_CONTRACT);
        require(isContract(address(_ens)), ERROR_ENS_NOT_CONTRACT);
        require(isContract(address(_miniMeFactory)), ERROR_MINIME_FACTORY_NOT_CONTRACT);
        require(isContract(address(_aragonID)), ERROR_ARAGON_ID_NOT_CONTRACT);
        require(isContract(address(_apmRegistryFactory)), ERROR_APM_REGISTRY_FACTORY_NOT_CONTRACT);

        owner = _owner;
        daoFactory = _daoFactory;
        ens = _ens;
        miniMeFactory = _miniMeFactory;
        aragonID = _aragonID;
        apmRegistryFactory = _apmRegistryFactory;
    }

    function getConfig() external view returns (
        address _owner,
        address _daoFactory,
        address _ens,
        address _miniMeFactory,
        address _aragonID,
        address _apmRegistryFactory
    ) {
        return (
            owner,
            daoFactory,
            ens,
            miniMeFactory,
            aragonID,
            apmRegistryFactory
        );
    }

    function deployLidoAPM(bytes32 _tld, bytes32 _label) onlyOwner external {
        require(deployState.lidoRegistry == address(0), ERROR_REGISTRY_ALREADY_DEPLOYED);

        bytes32 node = keccak256(abi.encodePacked(_tld, _label));
        require(ens.owner(node) == address(this), ERROR_ENS_NODE_NOT_OWNED_BY_TEMPLATE);
        deployState.lidoRegistryEnsNode = node;

        APMRegistryFactory factory = apmRegistryFactory;

        // transfer ENS node ownership to the APM factory, which will
        // subsequently transfer it to the subdomain registrar
        ens.setOwner(node, factory);

        // make the template a (temporary) manager of the APM registry
        APMRegistry registry = factory.newAPM(_tld, _label, address(this));
        deployState.lidoRegistry = registry;

        emit TmplAPMDeployed(address(registry));
    }

    function createRepos(
        uint16[3] _initialSemanticVersion,
        address _lidoImplAddress,
        bytes _lidoContentURI,
        address _nodeOperatorsRegistryImplAddress,
        bytes _nodeOperatorsRegistryContentURI,
        address _oracleImplAddress,
        bytes _oracleContentURI
    )
        onlyOwner
        external
    {
        require(deployState.lidoRegistry != address(0), ERROR_REGISTRY_NOT_DEPLOYED);

        APMRegistry lidoRegistry = deployState.lidoRegistry;

        // create Lido app repos

        apmRepos.lido = lidoRegistry.newRepoWithVersion(
            LIDO_APP_NAME,
            this,
            _initialSemanticVersion,
            _lidoImplAddress,
            _lidoContentURI
        );

        apmRepos.nodeOperatorsRegistry = lidoRegistry.newRepoWithVersion(
            NODE_OPERATORS_REGISTRY_APP_NAME,
            this,
            _initialSemanticVersion,
            _nodeOperatorsRegistryImplAddress,
            _nodeOperatorsRegistryContentURI
        );

        apmRepos.oracle = lidoRegistry.newRepoWithVersion(
            ORACLE_APP_NAME,
            this,
            _initialSemanticVersion,
            _oracleImplAddress,
            _oracleContentURI
        );

        // create Aragon app repos pointing to latest upstream versions

        AppVersion memory latest = _apmResolveLatest(ARAGON_AGENT_APP_ID);
        apmRepos.aragonAgent = lidoRegistry.newRepoWithVersion(
            ARAGON_AGENT_APP_NAME,
            this,
            latest.semanticVersion,
            latest.contractAddress,
            latest.contentURI
        );

        latest = _apmResolveLatest(ARAGON_FINANCE_APP_ID);
        apmRepos.aragonFinance = lidoRegistry.newRepoWithVersion(
            ARAGON_FINANCE_APP_NAME,
            this,
            latest.semanticVersion,
            latest.contractAddress,
            latest.contentURI
        );

        latest = _apmResolveLatest(ARAGON_TOKEN_MANAGER_APP_ID);
        apmRepos.aragonTokenManager = lidoRegistry.newRepoWithVersion(
            ARAGON_TOKEN_MANAGER_APP_NAME,
            this,
            latest.semanticVersion,
            latest.contractAddress,
            latest.contentURI
        );

        latest = _apmResolveLatest(ARAGON_VOTING_APP_ID);
        apmRepos.aragonVoting = lidoRegistry.newRepoWithVersion(
            ARAGON_VOTING_APP_NAME,
            this,
            latest.semanticVersion,
            latest.contractAddress,
            latest.contentURI
        );

        emit TmplReposCreated();
    }

    function newDAO(
        string _tokenName,
        string _tokenSymbol,
        uint64[3] _votingSettings,
        IValidatorRegistration _beaconDepositContract,
        uint32[4] _beaconSpec
    )
        onlyOwner
        external
    {
        DeployState memory state = deployState;

        require(state.lidoRegistry != address(0), ERROR_REGISTRY_NOT_DEPLOYED);
        require(state.dao == address(0), ERROR_DAO_ALREADY_DEPLOYED);

        state.token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);
        (state.dao, state.acl) = _createDAO();

        state.agent = _installAgentApp(state.lidoRegistryEnsNode, state.dao);

        state.finance = _installFinanceApp(
            state.lidoRegistryEnsNode,
            state.dao,
            state.agent,
            DEFAULT_FINANCE_PERIOD
        );

        state.tokenManager = _installTokenManagerApp(
            state.lidoRegistryEnsNode,
            state.dao,
            state.token,
            TOKEN_TRANSFERABLE,
            TOKEN_MAX_PER_ACCOUNT
        );

        state.voting = _installVotingApp(
            state.lidoRegistryEnsNode,
            state.dao,
            state.token,
            _votingSettings[0],
            _votingSettings[1],
            _votingSettings[2]
        );

        bytes memory noInit = new bytes(0);

        state.lido = Lido(_installNonDefaultApp(
            state.dao,
            _getAppId(LIDO_APP_NAME, state.lidoRegistryEnsNode),
            noInit
        ));

        state.operators = NodeOperatorsRegistry(_installNonDefaultApp(
            state.dao,
            _getAppId(NODE_OPERATORS_REGISTRY_APP_NAME, state.lidoRegistryEnsNode),
            noInit
        ));

        state.oracle = LidoOracle(_installNonDefaultApp(
            state.dao,
            _getAppId(ORACLE_APP_NAME, state.lidoRegistryEnsNode),
            noInit
        ));

        state.oracle.initialize(
            state.lido,
            _beaconSpec[0], // epochsPerFrame
            _beaconSpec[1], // slotsPerEpoch
            _beaconSpec[2], // secondsPerSlot
            _beaconSpec[3]  // genesisTime
        );

        state.operators.initialize(state.lido);

        state.lido.initialize(
            _beaconDepositContract,
            state.oracle,
            state.operators,
            state.agent, // treasury
            state.agent  // insurance fund
        );

        // used for issuing vested tokens in the next step
        _createTokenManagerPersissionsForTemplate(state.acl, state.tokenManager);

        emit TmplDAOAndTokenDeployed(address(state.dao), address(state.token));

        deployState = state;
    }

    function issueTokens(
        address[] _holders,
        uint256[] _amounts,
        uint64 _vestingStart,
        uint64 _vestingCliff,
        uint64 _vestingEnd,
        bool _vestingRevokable
    )
        onlyOwner
        external
    {
        require(_holders.length > 0, ERROR_EMPTY_HOLDERS);
        require(_holders.length == _amounts.length, ERROR_BAD_AMOUNTS_LEN);

        TokenManager tokenManager = deployState.tokenManager;
        require(tokenManager != address(0), ERROR_DAO_NOT_DEPLOYED);

        uint256 totalAmount = _issueTokens(
            deployState.acl,
            tokenManager,
            _holders,
            _amounts,
            _vestingStart,
            _vestingCliff,
            _vestingEnd,
            _vestingRevokable
        );

        emit TmplTokensIssued(totalAmount);
    }

    function finalizeDAO(
        string _daoName,
        uint16 _totalFeeBP,
        uint16 _treasuryFeeBP,
        uint16 _insuranceFeeBP,
        uint16 _operatorsFeeBP
    )
        onlyOwner
        external
    {
        DeployState memory state = deployState;
        APMRepos memory repos = apmRepos;

        require(state.dao != address(0), ERROR_DAO_NOT_DEPLOYED);
        require(bytes(_daoName).length > 0, ERROR_INVALID_ID);

        // Set initial values for fee and its distribution
        bytes32 LIDO_MANAGE_FEE = state.lido.MANAGE_FEE();
        _createPermissionForTemplate(state.acl, state.lido, LIDO_MANAGE_FEE);
        state.lido.setFee(_totalFeeBP);
        state.lido.setFeeDistribution(_treasuryFeeBP, _insuranceFeeBP, _operatorsFeeBP);
        _removePermissionFromTemplate(state.acl, state.lido, LIDO_MANAGE_FEE);

        _setupPermissions(state, repos);
        _transferRootPermissionsFromTemplateAndFinalizeDAO(state.dao, state.voting, state.voting);
        _resetState();

        aragonID.register(keccak256(abi.encodePacked(_daoName)), state.dao);

        emit TmplDaoFinalized();
    }

    /* DAO AND APPS */

    /**
    * @dev Create a DAO using the DAO Factory and grant the template root permissions so it has full
    *      control during setup. Once the DAO setup has finished, it is recommended to call the
    *      `_transferRootPermissionsFromTemplateAndFinalizeDAO()` helper to transfer the root
    *      permissions to the end entity in control of the organization.
    */
    function _createDAO() private returns (Kernel dao, ACL acl) {
        dao = daoFactory.newDAO(this);
        acl = ACL(dao.acl());
        _createPermissionForTemplate(acl, dao, dao.APP_MANAGER_ROLE());
    }

    function _installAgentApp(bytes32 _lidoRegistryEnsNode, Kernel _dao) private returns (Agent) {
        bytes32 appId = _getAppId(ARAGON_AGENT_APP_NAME, _lidoRegistryEnsNode);
        bytes memory initializeData = abi.encodeWithSelector(Agent(0).initialize.selector);
        Agent agent = Agent(_installApp(_dao, appId, initializeData, true));
        _dao.setRecoveryVaultAppId(appId);
        return agent;
    }

    function _installFinanceApp(
        bytes32 _lidoRegistryEnsNode,
        Kernel _dao,
        Vault _vault,
        uint64 _periodDuration
    )
        private returns (Finance)
    {
        bytes32 appId = _getAppId(ARAGON_FINANCE_APP_NAME, _lidoRegistryEnsNode);
        bytes memory initializeData = abi.encodeWithSelector(Finance(0).initialize.selector, _vault, _periodDuration);
        return Finance(_installNonDefaultApp(_dao, appId, initializeData));
    }

    function _installTokenManagerApp(
        bytes32 _lidoRegistryEnsNode,
        Kernel _dao,
        MiniMeToken _token,
        bool _transferable,
        uint256 _maxAccountTokens
    )
        private returns (TokenManager)
    {
        bytes32 appId = _getAppId(ARAGON_TOKEN_MANAGER_APP_NAME, _lidoRegistryEnsNode);
        TokenManager tokenManager = TokenManager(_installNonDefaultApp(_dao, appId, new bytes(0)));
        _token.changeController(tokenManager);
        tokenManager.initialize(_token, _transferable, _maxAccountTokens);
        return tokenManager;
    }

    function _installVotingApp(
        bytes32 _lidoRegistryEnsNode,
        Kernel _dao,
        MiniMeToken _token,
        uint64 _support,
        uint64 _acceptance,
        uint64 _duration
    )
        private returns (Voting)
    {
        bytes32 appId = _getAppId(ARAGON_VOTING_APP_NAME, _lidoRegistryEnsNode);
        bytes memory initializeData = abi.encodeWithSelector(Voting(0).initialize.selector, _token, _support, _acceptance, _duration);
        return Voting(_installNonDefaultApp(_dao, appId, initializeData));
    }

    function _installNonDefaultApp(Kernel _dao, bytes32 _appId, bytes memory _initializeData) internal returns (address) {
        return _installApp(_dao, _appId, _initializeData, false);
    }

    function _installApp(Kernel _dao, bytes32 _appId, bytes memory _initializeData, bool _setDefault) internal returns (address) {
        address latestBaseAppAddress = _apmResolveLatest(_appId).contractAddress;
        address instance = address(_dao.newAppInstance(_appId, latestBaseAppAddress, _initializeData, _setDefault));
        emit TmplAppInstalled(instance, _appId);
        return instance;
    }

    /* TOKEN */

    function _createToken(string memory _name, string memory _symbol, uint8 _decimals) internal returns (MiniMeToken) {
        MiniMeToken token = miniMeFactory.createCloneToken(MiniMeToken(address(0)), 0, _name, _decimals, _symbol, true);
        return token;
    }

    function _issueTokens(
        ACL _acl,
        TokenManager _tokenManager,
        address[] memory _holders,
        uint256[] memory _amounts,
        uint64 _vestingStart,
        uint64 _vestingCliff,
        uint64 _vestingEnd,
        bool _vestingRevokable
    )
        private
        returns (uint256 totalAmount)
    {
        totalAmount = 0;
        uint256 i;

        for (i = 0; i < _holders.length; ++i) {
            totalAmount += _amounts[i];
        }

        _tokenManager.issue(totalAmount);

        for (i = 0; i < _holders.length; ++i) {
            _tokenManager.assignVested(_holders[i], _amounts[i], _vestingStart, _vestingCliff, _vestingEnd, _vestingRevokable);
        }

        return totalAmount;
    }

    /* PERMISSIONS */

    function _setupPermissions(DeployState memory _state, APMRepos memory _repos) private {
        _removeTokenManagerPersissionsFromTemplate(_state.acl, _state.tokenManager);

        _createAgentPermissions(_state.acl, _state.agent, _state.voting, _state.voting);
        _createVaultPermissions(_state.acl, _state.agent, _state.finance, _state.voting);
        _createFinancePermissions(_state.acl, _state.finance, _state.voting, _state.voting);
        _createEvmScriptsRegistryPermissions(_state.acl, _state.voting, _state.voting);
        _createVotingPermissions(_state.acl, _state.voting, _state.voting, _state.tokenManager, _state.voting);
        _createTokenManagerPermissions(_state.acl, _state.tokenManager, _state.voting, _state.voting);

        // APM

        Kernel apmDAO = Kernel(_state.lidoRegistry.kernel());
        ACL apmACL = ACL(apmDAO.acl());
        bytes32 REPO_CREATE_VERSION_ROLE = _repos.lido.CREATE_VERSION_ROLE();
        ENSSubdomainRegistrar apmRegistrar = _state.lidoRegistry.registrar();

        _transferPermissionFromTemplate(apmACL, _state.lidoRegistry, _state.voting, _state.lidoRegistry.CREATE_REPO_ROLE());
        apmACL.setPermissionManager(_state.voting, apmDAO, apmDAO.APP_MANAGER_ROLE());
        _transferPermissionFromTemplate(apmACL, apmACL, _state.voting, apmACL.CREATE_PERMISSIONS_ROLE());
        apmACL.setPermissionManager(_state.voting, apmRegistrar, apmRegistrar.CREATE_NAME_ROLE());
        apmACL.setPermissionManager(_state.voting, apmRegistrar, apmRegistrar.POINT_ROOTNODE_ROLE());

        // APM repos

        _transferPermissionFromTemplate(apmACL, _repos.lido, _state.voting, REPO_CREATE_VERSION_ROLE);
        _transferPermissionFromTemplate(apmACL, _repos.oracle, _state.voting, REPO_CREATE_VERSION_ROLE);
        _transferPermissionFromTemplate(apmACL, _repos.nodeOperatorsRegistry, _state.voting, REPO_CREATE_VERSION_ROLE);
        _transferPermissionFromTemplate(apmACL, _repos.aragonAgent, _state.voting, REPO_CREATE_VERSION_ROLE);
        _transferPermissionFromTemplate(apmACL, _repos.aragonFinance, _state.voting, REPO_CREATE_VERSION_ROLE);
        _transferPermissionFromTemplate(apmACL, _repos.aragonTokenManager, _state.voting, REPO_CREATE_VERSION_ROLE);
        _transferPermissionFromTemplate(apmACL, _repos.aragonVoting, _state.voting, REPO_CREATE_VERSION_ROLE);

        _transferPermissionFromTemplate(
            apmACL,
            _resolveRepo(_getAppId(APM_APP_NAME, _state.lidoRegistryEnsNode)),
            _state.voting,
            REPO_CREATE_VERSION_ROLE
        );

        _transferPermissionFromTemplate(
            apmACL,
            _resolveRepo(_getAppId(APM_REPO_APP_NAME, _state.lidoRegistryEnsNode)),
            _state.voting,
            REPO_CREATE_VERSION_ROLE
        );

        _transferPermissionFromTemplate(
            apmACL,
            _resolveRepo(_getAppId(APM_ENSSUB_APP_NAME, _state.lidoRegistryEnsNode)),
            _state.voting,
            REPO_CREATE_VERSION_ROLE
        );

        // Oracle
        _state.acl.createPermission(_state.voting, _state.oracle, _state.oracle.MANAGE_MEMBERS(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.oracle, _state.oracle.MANAGE_QUORUM(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.oracle, _state.oracle.SET_BEACON_SPEC(), _state.voting);

        // NodeOperatorsRegistry
        _state.acl.createPermission(_state.voting, _state.operators, _state.operators.MANAGE_SIGNING_KEYS(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.operators, _state.operators.ADD_NODE_OPERATOR_ROLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.operators, _state.operators.SET_NODE_OPERATOR_ACTIVE_ROLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.operators, _state.operators.SET_NODE_OPERATOR_NAME_ROLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.operators, _state.operators.SET_NODE_OPERATOR_ADDRESS_ROLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.operators, _state.operators.SET_NODE_OPERATOR_LIMIT_ROLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.operators, _state.operators.REPORT_STOPPED_VALIDATORS_ROLE(), _state.voting);

        // Lido
        _state.acl.createPermission(_state.voting, _state.lido, _state.lido.PAUSE_ROLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.lido, _state.lido.MANAGE_FEE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.lido, _state.lido.MANAGE_WITHDRAWAL_KEY(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.lido, _state.lido.SET_ORACLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.lido, _state.lido.BURN_ROLE(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.lido, _state.lido.SET_TREASURY(), _state.voting);
        _state.acl.createPermission(_state.voting, _state.lido, _state.lido.SET_INSURANCE_FUND(), _state.voting);
    }

    function _createTokenManagerPersissionsForTemplate(ACL _acl, TokenManager _tokenManager) internal {
        _createPermissionForTemplate(_acl, _tokenManager, _tokenManager.ISSUE_ROLE());
        _createPermissionForTemplate(_acl, _tokenManager, _tokenManager.ASSIGN_ROLE());
    }

    function _removeTokenManagerPersissionsFromTemplate(ACL _acl, TokenManager _tokenManager) internal {
        _removePermissionFromTemplate(_acl, _tokenManager, _tokenManager.ISSUE_ROLE());
        _removePermissionFromTemplate(_acl, _tokenManager, _tokenManager.ASSIGN_ROLE());
    }

    function _createAgentPermissions(ACL _acl, Agent _agent, address _grantee, address _manager) internal {
        _acl.createPermission(_grantee, _agent, _agent.EXECUTE_ROLE(), _manager);
        _acl.createPermission(_grantee, _agent, _agent.RUN_SCRIPT_ROLE(), _manager);
    }

    function _createVaultPermissions(ACL _acl, Vault _vault, address _grantee, address _manager) internal {
        _acl.createPermission(_grantee, _vault, _vault.TRANSFER_ROLE(), _manager);
    }

    function _createFinancePermissions(ACL _acl, Finance _finance, address _grantee, address _manager) internal {
        _acl.createPermission(_grantee, _finance, _finance.EXECUTE_PAYMENTS_ROLE(), _manager);
        _acl.createPermission(_grantee, _finance, _finance.MANAGE_PAYMENTS_ROLE(), _manager);
        _acl.createPermission(_grantee, _finance, _finance.CREATE_PAYMENTS_ROLE(), _manager);
    }

    function _createEvmScriptsRegistryPermissions(ACL _acl, address _grantee, address _manager) internal {
        EVMScriptRegistry registry = EVMScriptRegistry(_acl.getEVMScriptRegistry());
        _acl.createPermission(_grantee, registry, registry.REGISTRY_MANAGER_ROLE(), _manager);
        _acl.createPermission(_grantee, registry, registry.REGISTRY_ADD_EXECUTOR_ROLE(), _manager);
    }

    function _createVotingPermissions(
        ACL _acl,
        Voting _voting,
        address _settingsGrantee,
        address _createVotesGrantee,
        address _manager
    )
        internal
    {
        _acl.createPermission(_settingsGrantee, _voting, _voting.MODIFY_QUORUM_ROLE(), _manager);
        _acl.createPermission(_settingsGrantee, _voting, _voting.MODIFY_SUPPORT_ROLE(), _manager);
        _acl.createPermission(_createVotesGrantee, _voting, _voting.CREATE_VOTES_ROLE(), _manager);
    }

    function _createTokenManagerPermissions(ACL _acl, TokenManager _tokenManager, address _grantee, address _manager) internal {
        _acl.createPermission(_grantee, _tokenManager, _tokenManager.MINT_ROLE(), _manager);
        _acl.createPermission(_grantee, _tokenManager, _tokenManager.BURN_ROLE(), _manager);
    }

    function _createPermissionForTemplate(ACL _acl, address _app, bytes32 _permission) private {
        _acl.createPermission(address(this), _app, _permission, address(this));
    }

    function _removePermissionFromTemplate(ACL _acl, address _app, bytes32 _permission) private {
        _acl.revokePermission(address(this), _app, _permission);
        _acl.removePermissionManager(_app, _permission);
    }

    function _transferRootPermissionsFromTemplateAndFinalizeDAO(Kernel _dao, address _to, address _manager) private {
        ACL _acl = ACL(_dao.acl());
        _transferPermissionFromTemplate(_acl, _dao, _to, _dao.APP_MANAGER_ROLE(), _manager);
        _transferPermissionFromTemplate(_acl, _acl, _to, _acl.CREATE_PERMISSIONS_ROLE(), _manager);
    }

    function _transferPermissionFromTemplate(ACL _acl, address _app, address _to, bytes32 _permission) private {
        _transferPermissionFromTemplate(_acl, _app, _to, _permission, _to);
    }

    function _transferPermissionFromTemplate(ACL _acl, address _app, address _to, bytes32 _permission, address _manager) private {
        _acl.grantPermission(_to, _app, _permission);
        _acl.revokePermission(address(this), _app, _permission);
        _acl.setPermissionManager(_manager, _app, _permission);
    }

    /* APM and ENS */

    function _apmResolveLatest(bytes32 _appId) private view returns (AppVersion memory) {
        Repo repo = _resolveRepo(_appId);
        (uint16[3] memory semanticVersion, address contractAddress, bytes memory contentURI) = repo.getLatest();
        return AppVersion(semanticVersion, contractAddress, contentURI);
    }

    function _resolveRepo(bytes32 _appId) private view returns (Repo) {
        return Repo(PublicResolver(ens.resolver(_appId)).addr(_appId));
    }

    /**
     * @return the app ID: ENS node with name `_appName` and parent node `_apmRootNode`.
     */
    function _getAppId(string _appName, bytes32 _apmRootNode) private pure returns (bytes32 subnode) {
        return keccak256(abi.encodePacked(_apmRootNode, keccak256(abi.encodePacked(_appName))));
    }

    /* STATE RESET */

    function _resetState() private {
        delete deployState.lidoRegistryEnsNode;
        delete deployState.lidoRegistry;
        delete deployState.dao;
        delete deployState.acl;
        delete deployState.token;
        delete deployState.agent;
        delete deployState.finance;
        delete deployState.tokenManager;
        delete deployState.voting;
        delete deployState.lido;
        delete deployState.oracle;
        delete deployState.operators;
        delete deployState;
        delete apmRepos.lido;
        delete apmRepos.oracle;
        delete apmRepos.nodeOperatorsRegistry;
        delete apmRepos.aragonAgent;
        delete apmRepos.aragonFinance;
        delete apmRepos.aragonTokenManager;
        delete apmRepos.aragonVoting;
        delete apmRepos;
    }
}
