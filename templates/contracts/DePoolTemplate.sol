pragma solidity 0.4.24;

import "@aragon/templates-shared/contracts/BaseTemplate.sol";


contract DePoolTemplate is BaseTemplate {
    bool constant private TOKEN_TRANSFERABLE = true;
    uint8 constant private TOKEN_DECIMALS = uint8(18);
    uint256 constant private TOKEN_MAX_PER_ACCOUNT = uint256(0);

    uint64 constant private DEFAULT_FINANCE_PERIOD = uint64(30 days);

    bool constant private USE_AGENT_AS_VAULT = true;


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
        uint64 _financePeriod
    )
        external
    {
        require(_holders.length > 0, "COMPANY_EMPTY_HOLDERS");
        require(_holders.length == _stakes.length, "COMPANY_BAD_HOLDERS_STAKES_LEN");

        MiniMeToken token = _createToken(_tokenName, _tokenSymbol, TOKEN_DECIMALS);

        (Kernel dao, ACL acl) = _createDAO();
        (Finance finance, Voting voting) = _setupApps(dao, acl, token, _holders, _stakes, _votingSettings, _financePeriod);
        _transferCreatePaymentManagerFromTemplate(acl, finance, voting);
        _transferRootPermissionsFromTemplateAndFinalizeDAO(dao, voting);
    }

    function _setupApps(
        Kernel _dao,
        ACL _acl,
        MiniMeToken _token,
        address[] memory _holders,
        uint256[] memory _stakes,
        uint64[3] memory _votingSettings,
        uint64 _financePeriod
    )
        internal
        returns (Finance, Voting)
    {
        Vault agentOrVault = USE_AGENT_AS_VAULT ? _installDefaultAgentApp(_dao) : _installVaultApp(_dao);
        Finance finance = _installFinanceApp(_dao, agentOrVault, _financePeriod == 0 ? DEFAULT_FINANCE_PERIOD : _financePeriod);
        TokenManager tokenManager = _installTokenManagerApp(_dao, _token, TOKEN_TRANSFERABLE, TOKEN_MAX_PER_ACCOUNT);
        Voting voting = _installVotingApp(_dao, _token, _votingSettings);

        _mintTokens(_acl, tokenManager, _holders, _stakes);
        _setupPermissions(_acl, agentOrVault, voting, finance, tokenManager);

        return (finance, voting);
    }

    function _setupPermissions(
        ACL _acl,
        Vault _agentOrVault,
        Voting _voting,
        Finance _finance,
        TokenManager _tokenManager
    )
        internal
    {
        if (USE_AGENT_AS_VAULT) {
            _createAgentPermissions(_acl, Agent(_agentOrVault), _voting, _voting);
        }
        _createVaultPermissions(_acl, _agentOrVault, _finance, _voting);
        _createFinancePermissions(_acl, _finance, _voting, _voting);
        _createFinanceCreatePaymentsPermission(_acl, _finance, _voting, address(this));
        _createEvmScriptsRegistryPermissions(_acl, _voting, _voting);
        _createVotingPermissions(_acl, _voting, _voting, _tokenManager, _voting);
        _createTokenManagerPermissions(_acl, _tokenManager, _voting, _voting);
    }
}
