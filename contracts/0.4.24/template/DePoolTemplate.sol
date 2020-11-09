pragma solidity 0.4.24;

import "@aragon/templates-shared/contracts/BaseTemplate.sol";

import "../StETH.sol";
import "../oracle/DePoolOracle.sol";
import "../sps/StakingProvidersRegistry.sol";
import "../DePool.sol";


contract DePoolTemplate is BaseTemplate {
    /* Hardcoded constants to save gas
     * bytes32 internal constant DEPOOLS_PM_NODE = keccak256(abi.encodePacked(ETH_TLD_NODE, keccak256(abi.encodePacked("lidofinance"))));
     */
    bytes32 internal constant DEPOOLS_PM_NODE = 0x9fa164e83dba3ca4aa168cd8c196df44cde7a27457391918be79a43c2807835e;

    /* Hardcoded constant to save gas
     * bytes32 internal constant STETH_APP_ID = keccak256(abi.encodePacked(DEPOOLS_PM_NODE, keccak256(abi.encodePacked("steth")))); // steth.lidofinance.eth
     * bytes32 internal constant DEPOOLORACLE_APP_ID = keccak256(abi.encodePacked(DEPOOLS_PM_NODE, keccak256(abi.encodePacked("oracle")))); // oracle.lidofinance.eth
     * bytes32 internal constant REGISTRY_APP_ID = keccak256(abi.encodePacked(DEPOOLS_PM_NODE, keccak256(abi.encodePacked("staking-providers-registry")))); // staking-providers-registry.lidofinance.eth
     * bytes32 internal constant DEPOOL_APP_ID = keccak256(abi.encodePacked(DEPOOLS_PM_NODE, keccak256(abi.encodePacked("lido")))); // lido.lidofinance.eth
     */
    bytes32 constant internal STETH_APP_ID = 0x4c88c2004db7e9fb0b13bc9ba52f60447f8917bf0743c6911aa546a726c2d10c;
    bytes32 constant internal DEPOOLORACLE_APP_ID = 0xeba505196c5a47d806338ab08bb9ca2f518115bd705602ffb991bc90843b0dcf;
    bytes32 internal constant REGISTRY_APP_ID = 0xc29e736bf32afbaec4dda8d213a38f158fd7afafdedbeb9a77f22261b87d671f;
    bytes32 constant internal DEPOOL_APP_ID = 0xe3dd17c3a59f34cfa257527766ba5d7561f6b7b15ab0299f102dbdf5a58cb791;

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
    DePoolOracle private oracle;
    StakingProvidersRegistry private sps;
    DePool private depool;


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
        require(dao == address(0), "PREVIOUS_DAO_NOT_FINALIZED");
        _validateId(_id);
        require(_holders.length > 0, "COMPANY_EMPTY_HOLDERS");
        require(_holders.length == _stakes.length, "COMPANY_BAD_HOLDERS_STAKES_LEN");

        // setup apps
        token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);
        (dao, acl) = _createDAO();
        _setupApps(_votingSettings, _ETH2ValidatorRegistrationContract, _depositIterationLimit);

        // oracle setPool
        _createPermissionForTemplate(acl, oracle, oracle.SET_POOL());
        oracle.setPool(depool);
        _removePermissionFromTemplate(acl, oracle, oracle.SET_POOL());

        // StakingProvidersRegistry setPool
        _createPermissionForTemplate(acl, sps, sps.SET_POOL());
        sps.setPool(depool);
        _removePermissionFromTemplate(acl, sps, sps.SET_POOL());

        _mintTokens(acl, tokenManager, _holders, _stakes);
        _registerID(_id, dao);
    }

    function finalizeDAO() external {
        require(dao != address(0), "DAO_NOT_DEPLOYED");
        _setupPermissions();
        _transferRootPermissionsFromTemplateAndFinalizeDAO(dao, voting);
        _reset(); // revert the cells back to get a refund
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

        // skipping StETH initialization for now, will call it manually later since we need the pool
        bytes memory initializeData = new bytes(0);
        steth = StETH(_installNonDefaultApp(dao, STETH_APP_ID, initializeData));

        initializeData = abi.encodeWithSelector(DePoolOracle(0).initialize.selector);
        oracle = DePoolOracle(_installNonDefaultApp(dao, DEPOOLORACLE_APP_ID, initializeData));

        initializeData = abi.encodeWithSelector(StakingProvidersRegistry(0).initialize.selector);
        sps = StakingProvidersRegistry(_installNonDefaultApp(dao, REGISTRY_APP_ID, initializeData));

        initializeData = abi.encodeWithSelector(
            DePool(0).initialize.selector,
            steth,
            _ETH2ValidatorRegistrationContract,
            oracle,
            sps,
            _depositIterationLimit
        );
        depool = DePool(_installNonDefaultApp(dao, DEPOOL_APP_ID, initializeData));

        steth.initialize(depool);
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
        acl.createPermission(depool, steth, steth.MINT_ROLE(), voting);
        acl.createPermission(depool, steth, steth.BURN_ROLE(), voting);

        // Oracle
        acl.createPermission(voting, oracle, oracle.MANAGE_MEMBERS(), voting);
        acl.createPermission(voting, oracle, oracle.MANAGE_QUORUM(), voting);
        acl.createPermission(voting, oracle, oracle.SET_REPORT_INTERVAL_DURATION(), voting);
        acl.createPermission(voting, oracle, oracle.SET_POOL(), voting);

        // StakingProvidersRegistry
        acl.createPermission(voting, sps, sps.MANAGE_SIGNING_KEYS(), voting);
        acl.createPermission(voting, sps, sps.ADD_STAKING_PROVIDER_ROLE(), voting);
        acl.createPermission(voting, sps, sps.SET_STAKING_PROVIDER_ACTIVE_ROLE(), voting);
        acl.createPermission(voting, sps, sps.SET_STAKING_PROVIDER_NAME_ROLE(), voting);
        acl.createPermission(voting, sps, sps.SET_STAKING_PROVIDER_ADDRESS_ROLE(), voting);
        acl.createPermission(voting, sps, sps.SET_STAKING_PROVIDER_LIMIT_ROLE(), voting);
        acl.createPermission(voting, sps, sps.REPORT_STOPPED_VALIDATORS_ROLE(), voting);
        acl.createPermission(voting, sps, sps.SET_POOL(), voting);

        // Pool
        acl.createPermission(voting, depool, depool.PAUSE_ROLE(), voting);
        acl.createPermission(voting, depool, depool.MANAGE_FEE(), voting);
        acl.createPermission(voting, depool, depool.MANAGE_WITHDRAWAL_KEY(), voting);
        acl.createPermission(voting, depool, depool.SET_ORACLE(), voting);
        acl.createPermission(voting, depool, depool.SET_DEPOSIT_ITERATION_LIMIT(), voting);
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
        delete sps;
        delete depool;
    }
}
