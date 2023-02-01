// SPDX-FileCopyrightText: 2023 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";
import {ERC165} from "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import {Math} from "@openzeppelin/contracts-v4.4/utils/math/Math.sol";
import {AccessControlEnumerable} from "./utils/access/AccessControlEnumerable.sol";

/**
  * @title Interface defining a Lido liquid staking pool
  * @dev see also [Lido liquid staking pool core contract](https://docs.lido.fi/contracts/lido)
  */
interface ILido {
    /**
      * @notice Destroys given amount of shares from account's holdings
      * @param _account address of the shares holder
      * @param _sharesAmount shares amount to burn
      * @dev incurs stETH token rebase by decreasing the total amount of shares.
      */
    function burnShares(address _account, uint256 _sharesAmount) external returns (uint256 newTotalShares);

    /**
      * @notice Gets authorized oracle address
      * @return address of oracle contract.
      */
    function getOracle() external view returns (address);

    /**
      * @notice Get stETH amount by the provided shares amount
      * @param _sharesAmount shares amount
      * @dev dual to `getSharesByPooledEth`.
      */
    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);

    /**
      * @notice Get shares amount by the provided stETH amount
      * @param _pooledEthAmount stETH amount
      * @dev dual to `getPooledEthByShares`.
      */
    function getSharesByPooledEth(uint256 _pooledEthAmount) external view returns (uint256);

    /**
      * @notice Get shares amount of the provided account
      * @param _account provided account address.
      */
    function sharesOf(address _account) external view returns (uint256);

    /**
      * @notice Get total amount of shares in existence
      */
    function getTotalShares() external view returns (uint256);
}

interface ISelfOwnedStETHBurner {
    /**
     * Enacts cover/non-cover burning requests and logs cover/non-cover shares amount just burnt.
     * Increments `totalCoverSharesBurnt` and `totalNonCoverSharesBurnt` counters.
     * Resets `coverSharesBurnRequested` and `nonCoverSharesBurnRequested` counters to zero.
     * Does nothing if there are no pending burning requests.
     */
    function processLidoOracleReport(uint256 sharesToBurnLimit) external ;

    /**
      * Returns the current amount of shares locked on the contract to be burnt.
      */
    function getSharesRequestedToBurn() external view returns (
        uint256 coverShares, uint256 nonCoverShares
    );

    /**
      * Returns the total cover shares ever burnt.
      */
    function getCoverSharesBurnt() external view returns (uint256);

    /**
      * Returns the total non-cover shares ever burnt.
      */
    function getNonCoverSharesBurnt() external view returns (uint256);
}

/**
  * @notice A dedicated contract for enacting stETH burning requests
  *
  * @dev Burning stETH means 'decrease total underlying shares amount to perform stETH token rebase'
  */
contract SelfOwnedStETHBurner is ISelfOwnedStETHBurner, ERC165, AccessControlEnumerable {
    using SafeERC20 for IERC20;

    error ErrorAppAuthLidoFailed();
    error ErrorDirectETHTransfer();
    error ZeroRecoveryAmount();
    error StETHRecoveryWrongFunc();
    error ZeroBurnAmount();
    error ErrorZeroAddress(string field);

    bytes32 public constant REQUEST_BURN_MY_STETH_ROLE = keccak256("REQUEST_BURN_MY_STETH_ROLE");
    bytes32 public constant RECOVER_ASSETS_ROLE = keccak256("RECOVER_ASSETS_ROLE");

    uint256 private coverSharesBurnRequested;
    uint256 private nonCoverSharesBurnRequested;

    uint256 private totalCoverSharesBurnt;
    uint256 private totalNonCoverSharesBurnt;

    address public immutable LIDO;
    address public immutable TREASURY;

    /**
      * Emitted when a new stETH burning request is added by the `requestedBy` address.
      */
    event StETHBurnRequested(
        bool indexed isCover,
        address indexed requestedBy,
        uint256 amountOfStETH,
        uint256 amountOfShares
    );

    /**
      * Emitted when the stETH `amount` (corresponding to `amountOfShares` shares) burnt for the `isCover` reason.
      */
    event StETHBurnt(
        bool indexed isCover,
        uint256 amountOfStETH,
        uint256 amountOfShares
    );

    /**
      * Emitted when the excessive stETH `amount` (corresponding to `amountOfShares` shares) recovered (i.e. transferred)
      * to the Lido treasure address by `requestedBy` sender.
      */
    event ExcessStETHRecovered(
        address indexed requestedBy,
        uint256 amountOfStETH,
        uint256 amountOfShares
    );

    /**
      * Emitted when the ERC20 `token` recovered (i.e. transferred)
      * to the Lido treasure address by `requestedBy` sender.
      */
    event ERC20Recovered(
        address indexed requestedBy,
        address indexed token,
        uint256 amount
    );

    /**
      * Emitted when the ERC721-compatible `token` (NFT) recovered (i.e. transferred)
      * to the Lido treasure address by `requestedBy` sender.
      */
    event ERC721Recovered(
        address indexed requestedBy,
        address indexed token,
        uint256 tokenId
    );

    /**
      * Ctor
      *
      * @param _admin the Lido DAO Aragon agent contract address
      * @param _treasury the Lido treasury address (see StETH/ERC20/ERC721-recovery interfaces)
      * @param _lido the Lido token (stETH) address
      * @param _totalCoverSharesBurnt Shares burnt counter init value (cover case)
      * @param _totalNonCoverSharesBurnt Shares burnt counter init value (non-cover case)
      */
    constructor(
        address _admin,
        address _treasury,
        address _lido,
        uint256 _totalCoverSharesBurnt,
        uint256 _totalNonCoverSharesBurnt
    ) {
        if (_admin == address(0)) revert ErrorZeroAddress("_admin");
        if (_treasury == address(0)) revert ErrorZeroAddress("_treasury");
        if (_lido == address(0)) revert ErrorZeroAddress("_lido");

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        TREASURY = _treasury;
        LIDO = _lido;

        totalCoverSharesBurnt = _totalCoverSharesBurnt;
        totalNonCoverSharesBurnt = _totalNonCoverSharesBurnt;
    }

    /**
      * @notice BE CAREFUL, the provided stETH will be burnt permanently.
      * @dev only `voting` allowed to call this function.
      *
      * Transfers `_stETH2Burn` stETH tokens from the message sender and irreversibly locks these
      * on the burner contract address. Internally converts `_stETH2Burn` amount into underlying
      * shares amount (`_stETH2BurnAsShares`) and marks the converted amount for burning
      * by increasing the `coverSharesBurnRequested` counter.
      *
      * @param _stETH2Burn stETH tokens to burn
      *
      */
    function requestBurnMyStETHForCover(uint256 _stETH2Burn) external onlyRole(REQUEST_BURN_MY_STETH_ROLE) {
        _requestBurnMyStETH(_stETH2Burn, true);
    }

    /**
      * @notice BE CAREFUL, the provided stETH will be burnt permanently.
      * @dev only `voting` allowed to call this function.
      *
      * Transfers `_stETH2Burn` stETH tokens from the message sender and irreversibly locks these
      * on the burner contract address. Internally converts `_stETH2Burn` amount into underlying
      * shares amount (`_stETH2BurnAsShares`) and marks the converted amount for burning
      * by increasing the `nonCoverSharesBurnRequested` counter.
      *
      * @param _stETH2Burn stETH tokens to burn
      *
      */
    function requestBurnMyStETH(uint256 _stETH2Burn) external onlyRole(REQUEST_BURN_MY_STETH_ROLE) {
        _requestBurnMyStETH(_stETH2Burn, false);
    }

    /**
      * Transfers the excess stETH amount (e.g. belonging to the burner contract address
      * but not marked for burning) to the Lido treasury address set upon the
      * contract construction.
      */
    function recoverExcessStETH() external onlyRole(RECOVER_ASSETS_ROLE) {
        uint256 excessStETH = getExcessStETH();

        if (excessStETH > 0) {
            uint256 excessSharesAmount = ILido(LIDO).getSharesByPooledEth(excessStETH);

            emit ExcessStETHRecovered(msg.sender, excessStETH, excessSharesAmount);

            require(IERC20(LIDO).transfer(TREASURY, excessStETH));
        }
    }

    /**
      * Intentionally deny incoming ether
      */
    receive() external payable {
        revert ErrorDirectETHTransfer();
    }

    /**
      * Transfers a given `_amount` of an ERC20-token (defined by the `_token` contract address)
      * currently belonging to the burner contract address to the Lido treasury address.
      *
      * @param _token an ERC20-compatible token
      * @param _amount token amount
      */
    function recoverERC20(address _token, uint256 _amount) external onlyRole(RECOVER_ASSETS_ROLE) {
        if (_amount == 0) revert ZeroRecoveryAmount();
        if (_token == LIDO) revert StETHRecoveryWrongFunc();

        emit ERC20Recovered(msg.sender, _token, _amount);

        IERC20(_token).safeTransfer(TREASURY, _amount);
    }

    /**
      * Transfers a given token_id of an ERC721-compatible NFT (defined by the token contract address)
      * currently belonging to the burner contract address to the Lido treasury address.
      *
      * @param _token an ERC721-compatible token
      * @param _tokenId minted token id
      */
    function recoverERC721(address _token, uint256 _tokenId) external onlyRole(RECOVER_ASSETS_ROLE) {
        if (_token == LIDO) revert StETHRecoveryWrongFunc();

        emit ERC721Recovered(msg.sender, _token, _tokenId);

        IERC721(_token).transferFrom(address(this), TREASURY, _tokenId);
    }

    /**
     * Enacts cover/non-cover burning requests and logs cover/non-cover shares amount just burnt.
     * Increments `totalCoverSharesBurnt` and `totalNonCoverSharesBurnt` counters.
     * Resets `coverSharesBurnRequested` and `nonCoverSharesBurnRequested` counters to zero.
     * Does nothing if there are no pending burning requests.
     */
    function processLidoOracleReport(uint256 sharesToBurnLimit) external virtual override {
        if (msg.sender != LIDO) revert ErrorAppAuthLidoFailed();

        uint256 memCoverSharesBurnRequested = coverSharesBurnRequested;
        uint256 memNonCoverSharesBurnRequested = nonCoverSharesBurnRequested;

        uint256 burnAmount = memCoverSharesBurnRequested + memNonCoverSharesBurnRequested;

        if (burnAmount == 0) {
            return;
        }

        uint256 sharesToBurnNow;
        if (memCoverSharesBurnRequested > 0) {
            uint256 sharesToBurnNowForCover = Math.min(sharesToBurnLimit, memCoverSharesBurnRequested);

            totalCoverSharesBurnt += sharesToBurnNowForCover;
            uint256 stETHToBurnNowForCover = ILido(LIDO).getPooledEthByShares(sharesToBurnNowForCover);
            emit StETHBurnt(true /* isCover */, stETHToBurnNowForCover, sharesToBurnNowForCover);

            coverSharesBurnRequested -= sharesToBurnNowForCover;
            sharesToBurnNow += sharesToBurnNowForCover;
        }
        if ((memNonCoverSharesBurnRequested > 0) && (sharesToBurnNow < sharesToBurnLimit)) {
            uint256 sharesToBurnNowForNonCover = Math.min(
                sharesToBurnLimit - sharesToBurnNow,
                memNonCoverSharesBurnRequested
            );

            totalNonCoverSharesBurnt += sharesToBurnNowForNonCover;
            uint256 stETHToBurnNowForNonCover = ILido(LIDO).getPooledEthByShares(sharesToBurnNowForNonCover);
            emit StETHBurnt(false /* isCover */, stETHToBurnNowForNonCover, sharesToBurnNowForNonCover);

            nonCoverSharesBurnRequested -= sharesToBurnNowForNonCover;
            sharesToBurnNow += sharesToBurnNowForNonCover;
        }
        ILido(LIDO).burnShares(address(this), sharesToBurnNow);
    }

    /**
      * Returns the current amount of shares locked on the contract to be burnt.
      */
    function getSharesRequestedToBurn() external view virtual override returns (
        uint256 coverShares, uint256 nonCoverShares
    ) {
        coverShares = coverSharesBurnRequested;
        nonCoverShares = nonCoverSharesBurnRequested;
    }

    /**
      * Returns the total cover shares ever burnt.
      */
    function getCoverSharesBurnt() external view virtual override returns (uint256) {
        return totalCoverSharesBurnt;
    }

    /**
      * Returns the total non-cover shares ever burnt.
      */
    function getNonCoverSharesBurnt() external view virtual override returns (uint256) {
        return totalNonCoverSharesBurnt;
    }

    /**
      * Returns the stETH amount belonging to the burner contract address but not marked for burning.
      */
    function getExcessStETH() public view returns (uint256)  {
        uint256 sharesBurnRequested = (coverSharesBurnRequested + nonCoverSharesBurnRequested);
        uint256 totalShares = ILido(LIDO).sharesOf(address(this));

        // sanity check, don't revert
        if (totalShares <= sharesBurnRequested) {
            return 0;
        }

        return ILido(LIDO).getPooledEthByShares(totalShares - sharesBurnRequested);
    }

    function supportsInterface(
        bytes4 _interfaceId
    ) public view virtual override (ERC165, AccessControlEnumerable) returns (bool) {
        return (
            _interfaceId == type(ISelfOwnedStETHBurner).interfaceId
            || super.supportsInterface(_interfaceId)
        );
    }

    function _requestBurnMyStETH(uint256 _stETH2Burn, bool _isCover) private {
        if (_stETH2Burn == 0) revert ZeroBurnAmount();

        require(IERC20(LIDO).transferFrom(msg.sender, address(this), _stETH2Burn));

        uint256 sharesAmount = ILido(LIDO).getSharesByPooledEth(_stETH2Burn);

        emit StETHBurnRequested(_isCover, msg.sender, _stETH2Burn, sharesAmount);

        if (_isCover) {
            coverSharesBurnRequested += sharesAmount;
        } else {
            nonCoverSharesBurnRequested += sharesAmount;
        }
    }
}
