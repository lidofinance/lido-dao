pragma solidity 0.4.24;

import "@aragon/os/contracts/ens/ENSConstants.sol";
import "@aragon/templates-shared/contracts/BaseTemplate.sol";

import "@depools/apps-steth/contracts/StETH.sol";
import "@depools/apps-depooloracle/contracts/DePoolOracle.sol";
import "@depools/apps-depool/contracts/DePool.sol";


contract DePoolTemplate is ENSConstants, BaseTemplate {
    bytes32 internal constant DEPOOLS_PM_NODE = keccak256(abi.encodePacked(ETH_TLD_NODE,
        keccak256(abi.encodePacked("depoolspm"))));

    bool constant private TOKEN_TRANSFERABLE = true;
    uint8 constant private TOKEN_DECIMALS = uint8(18);
    uint256 constant private TOKEN_MAX_PER_ACCOUNT = uint256(0);

    uint64 constant private DEFAULT_FINANCE_PERIOD = uint64(30 days);

    bool constant private USE_AGENT_AS_VAULT = true;


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
    DePool private depool;


    constructor(DAOFactory _daoFactory, ENS _ens, MiniMeTokenFactory _miniMeFactory)
        BaseTemplate(_daoFactory, _ens, _miniMeFactory, IFIFSResolvingRegistrar(0))
        public
    {
        _ensureMiniMeFactoryIsValid(_miniMeFactory);
    }

    function newDAO(
        string _tokenName,
        string _tokenSymbol,
        address[] _holders,
        uint256[] _stakes,
        uint64[3] _votingSettings,
        address _ETH2ValidatorRegistrationContract
    )
        external
    {
        require(_holders.length > 0, "COMPANY_EMPTY_HOLDERS");
        require(_holders.length == _stakes.length, "COMPANY_BAD_HOLDERS_STAKES_LEN");

        _reset();

        // setup apps
        token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);
        (dao, acl) = _createDAO();
        _setupApps(_votingSettings, _ETH2ValidatorRegistrationContract);

        // oracle setPool
        _createPermissionForTemplate(acl, oracle, oracle.SET_POOL());
        oracle.setPool(depool);
        _removePermissionFromTemplate(acl, oracle, oracle.SET_POOL());

        _mintTokens(acl, tokenManager, _holders, _stakes);

        _setupPermissions();

        _transferRootPermissionsFromTemplateAndFinalizeDAO(dao, voting);

        _reset();   // revert the cells back to get a refund
    }

    function _setupApps(
        uint64[3] memory _votingSettings,
        address _ETH2ValidatorRegistrationContract
    )
        internal
    {
        agentOrVault = USE_AGENT_AS_VAULT ? _installDefaultAgentApp(dao) : _installVaultApp(dao);
        finance = _installFinanceApp(dao, agentOrVault, DEFAULT_FINANCE_PERIOD);
        tokenManager = _installTokenManagerApp(dao, token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        voting = _installVotingApp(dao, token, _votingSettings);

        bytes memory initializeData = abi.encodeWithSelector(StETH(0).initialize.selector);
        steth = StETH(_installNonDefaultApp(dao, _depoolsAppId("steth"), initializeData));

        initializeData = abi.encodeWithSelector(DePoolOracle(0).initialize.selector);
        oracle = DePoolOracle(_installNonDefaultApp(dao, _depoolsAppId("depooloracle"), initializeData));

        initializeData = abi.encodeWithSelector(DePool(0).initialize.selector, steth, _ETH2ValidatorRegistrationContract, oracle);
        depool = DePool(_installNonDefaultApp(dao, _depoolsAppId("depool"), initializeData));
    }

    function _setupPermissions(
    )
        internal
    {
        if (USE_AGENT_AS_VAULT) {
            _createAgentPermissions(acl, Agent(agentOrVault), voting, voting);
        }
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
        acl.createPermission(voting, oracle, oracle.SET_POOL(), voting);

        // Pool
        acl.createPermission(voting, depool, depool.PAUSE_ROLE(), voting);
        acl.createPermission(voting, depool, depool.MANAGE_FEE(), voting);
        acl.createPermission(voting, depool, depool.MANAGE_WITHDRAWAL_KEY(), voting);
        acl.createPermission(voting, depool, depool.MANAGE_SIGNING_KEYS(), voting);
        acl.createPermission(voting, depool, depool.SET_ORACLE(), voting);
        acl.createPermission(voting, depool, depool.ADD_STAKING_PROVIDER_ROLE(), voting);
        acl.createPermission(voting, depool, depool.SET_STAKING_PROVIDER_ACTIVE_ROLE(), voting);
        acl.createPermission(voting, depool, depool.SET_STAKING_PROVIDER_NAME_ROLE(), voting);
        acl.createPermission(voting, depool, depool.SET_STAKING_PROVIDER_ADDRESS_ROLE(), voting);
        acl.createPermission(voting, depool, depool.SET_STAKING_PROVIDER_LIMIT_ROLE(), voting);
        acl.createPermission(voting, depool, depool.REPORT_STOPPED_VALIDATORS_ROLE(), voting);
    }


    /// @dev translates short depools app name to appId
    function _depoolsAppId(string name) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(DEPOOLS_PM_NODE, keccak256(bytes(name))));
    }


    /// @dev reset temporary storage
    function _reset() private {
        // using address(1) to avoid excess cas costs when polluting zero cells
        dao = Kernel(address(1));
        acl = ACL(address(1));
        token = MiniMeToken(address(1));
        agentOrVault = Vault(address(1));
        finance = Finance(address(1));
        tokenManager = TokenManager(address(1));
        voting = Voting(address(1));
        steth = StETH(address(1));
        oracle = DePoolOracle(address(1));
        depool = DePool(address(1));
    }
}
