// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts-v4.4/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-v4.4/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts-v4.4/utils/math/Math.sol";
import "./interfaces/IBeaconReportReceiver.sol";
import "./interfaces/ISelfOwnedStETHBurner.sol";

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

/**
  * @title Interface for the Lido Beacon Chain Oracle
  */
interface IOracle {
    /**
     * @notice Gets currently set beacon report receiver
     * @return address of a beacon receiver
     */
    function getBeaconReportReceiver() external view returns (address);
}

/**
  * @title A dedicated contract for enacting stETH burning requests
  * @notice See the Lido improvement proposal #6 (LIP-6) spec.
  * @author Eugene Mamin <TheDZhon@gmail.com>
  *
  * @dev Burning stETH means 'decrease total underlying shares amount to perform stETH token rebase'
  */
contract SelfOwnedStETHBurner is ISelfOwnedStETHBurner, IBeaconReportReceiver, ERC165 {
    using SafeERC20 for IERC20;

    uint256 private constant MAX_BASIS_POINTS = 10000;

    uint256 private coverSharesBurnRequested;
    uint256 private nonCoverSharesBurnRequested;

    uint256 private totalCoverSharesBurnt;
    uint256 private totalNonCoverSharesBurnt;

    uint256 private maxBurnAmountPerRunBasisPoints = 4; // 0.04% by default for the biggest `stETH:ETH` curve pool

    address public immutable LIDO;
    address public immutable TREASURY;
    address public immutable VOTING;

    /**
      * Emitted when a new single burn quota is set
      */
    event BurnAmountPerRunQuotaChanged(
        uint256 maxBurnAmountPerRunBasisPoints
    );

    /**
      * Emitted when a new stETH burning request is added by the `requestedBy` address.
      */
    event StETHBurnRequested(
        bool indexed isCover,
        address indexed requestedBy,
        uint256 amount,
        uint256 sharesAmount
    );

    /**
      * Emitted when the stETH `amount` (corresponding to `sharesAmount` shares) burnt for the `isCover` reason.
      */
    event StETHBurnt(
        bool indexed isCover,
        uint256 amount,
        uint256 sharesAmount
    );

    /**
      * Emitted when the excessive stETH `amount` (corresponding to `sharesAmount` shares) recovered (i.e. transferred)
      * to the Lido treasure address by `requestedBy` sender.
      */
    event ExcessStETHRecovered(
        address indexed requestedBy,
        uint256 amount,
        uint256 sharesAmount
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
      * @param _treasury the Lido treasury address (see StETH/ERC20/ERC721-recovery interfaces)
      * @param _lido the Lido token (stETH) address
      * @param _voting the Lido Aragon Voting address
      * @param _totalCoverSharesBurnt Shares burnt counter init value (cover case)
      * @param _totalNonCoverSharesBurnt Shares burnt counter init value (non-cover case)
      * @param _maxBurnAmountPerRunBasisPoints Max burn amount per single run
      */
    constructor(
        address _treasury,
        address _lido,
        address _voting,
        uint256 _totalCoverSharesBurnt,
        uint256 _totalNonCoverSharesBurnt,
        uint256 _maxBurnAmountPerRunBasisPoints
    ) {
        require(_treasury != address(0), "TREASURY_ZERO_ADDRESS");
        require(_lido != address(0), "LIDO_ZERO_ADDRESS");
        require(_voting != address(0), "VOTING_ZERO_ADDRESS");
        require(_maxBurnAmountPerRunBasisPoints > 0, "ZERO_BURN_AMOUNT_PER_RUN");
        require(_maxBurnAmountPerRunBasisPoints <= MAX_BASIS_POINTS, "TOO_LARGE_BURN_AMOUNT_PER_RUN");

        TREASURY = _treasury;
        LIDO = _lido;
        VOTING = _voting;

        totalCoverSharesBurnt = _totalCoverSharesBurnt;
        totalNonCoverSharesBurnt = _totalNonCoverSharesBurnt;

        maxBurnAmountPerRunBasisPoints = _maxBurnAmountPerRunBasisPoints;
    }

    /**
      * Sets the maximum amount of shares allowed to burn per single run (quota).
      *
      * @dev only `voting` allowed to call this function.
      *
      * @param _maxBurnAmountPerRunBasisPoints a fraction expressed in basis points (taken from Lido.totalSharesAmount)
      *
      */
    function setBurnAmountPerRunQuota(uint256 _maxBurnAmountPerRunBasisPoints) external {
        require(_maxBurnAmountPerRunBasisPoints > 0, "ZERO_BURN_AMOUNT_PER_RUN");
        require(_maxBurnAmountPerRunBasisPoints <= MAX_BASIS_POINTS, "TOO_LARGE_BURN_AMOUNT_PER_RUN");
        require(msg.sender == VOTING, "MSG_SENDER_MUST_BE_VOTING");

        emit BurnAmountPerRunQuotaChanged(_maxBurnAmountPerRunBasisPoints);

        maxBurnAmountPerRunBasisPoints = _maxBurnAmountPerRunBasisPoints;
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
    function requestBurnMyStETHForCover(uint256 _stETH2Burn) external {
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
    function requestBurnMyStETH(uint256 _stETH2Burn) external {
        _requestBurnMyStETH(_stETH2Burn, false);
    }

    /**
      * Transfers the excess stETH amount (e.g. belonging to the burner contract address
      * but not marked for burning) to the Lido treasury address set upon the
      * contract construction.
      */
    function recoverExcessStETH() external {
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
        revert("INCOMING_ETH_IS_FORBIDDEN");
    }

    /**
      * Transfers a given `_amount` of an ERC20-token (defined by the `_token` contract address)
      * currently belonging to the burner contract address to the Lido treasury address.
      *
      * @param _token an ERC20-compatible token
      * @param _amount token amount
      */
    function recoverERC20(address _token, uint256 _amount) external {
        require(_amount > 0, "ZERO_RECOVERY_AMOUNT");
        require(_token != LIDO, "STETH_RECOVER_WRONG_FUNC");

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
    function recoverERC721(address _token, uint256 _tokenId) external {
        emit ERC721Recovered(msg.sender, _token, _tokenId);

        IERC721(_token).transferFrom(address(this), TREASURY, _tokenId);
    }

    /**
     * Enacts cover/non-cover burning requests and logs cover/non-cover shares amount just burnt.
     * Increments `totalCoverSharesBurnt` and `totalNonCoverSharesBurnt` counters.
     * Resets `coverSharesBurnRequested` and `nonCoverSharesBurnRequested` counters to zero.
     * Does nothing if there are no pending burning requests.
     */
    function processLidoOracleReport(uint256, uint256, uint256) external virtual override {
        uint256 memCoverSharesBurnRequested = coverSharesBurnRequested;
        uint256 memNonCoverSharesBurnRequested = nonCoverSharesBurnRequested;

        uint256 burnAmount = memCoverSharesBurnRequested + memNonCoverSharesBurnRequested;

        if (burnAmount == 0) {
            return;
        }

        address oracle = ILido(LIDO).getOracle();

        /**
          * Allow invocation only from `LidoOracle` or previously set composite beacon report receiver.
          * The second condition provides a way to use multiple callbacks packed into a single composite container.
          */
        require(
            msg.sender == oracle
            || (msg.sender == IOracle(oracle).getBeaconReportReceiver()),
            "APP_AUTH_FAILED"
        );

        uint256 maxSharesToBurnNow = (ILido(LIDO).getTotalShares() * maxBurnAmountPerRunBasisPoints) / MAX_BASIS_POINTS;

        if (memCoverSharesBurnRequested > 0) {
            uint256 sharesToBurnNowForCover = Math.min(maxSharesToBurnNow, memCoverSharesBurnRequested);

            totalCoverSharesBurnt += sharesToBurnNowForCover;
            uint256 stETHToBurnNowForCover = ILido(LIDO).getPooledEthByShares(sharesToBurnNowForCover);
            emit StETHBurnt(true /* isCover */, stETHToBurnNowForCover, sharesToBurnNowForCover);

            coverSharesBurnRequested -= sharesToBurnNowForCover;

            // early return if at least one of the conditions is TRUE:
            // - we have reached a capacity per single run already
            // - there are no pending non-cover requests
            if ((sharesToBurnNowForCover == maxSharesToBurnNow) || (memNonCoverSharesBurnRequested == 0)) {
                ILido(LIDO).burnShares(address(this), sharesToBurnNowForCover);
                return;
            }
        }

        // we're here only if memNonCoverSharesBurnRequested > 0
        uint256 sharesToBurnNowForNonCover = Math.min(
            maxSharesToBurnNow - memCoverSharesBurnRequested,
            memNonCoverSharesBurnRequested
        );

        totalNonCoverSharesBurnt += sharesToBurnNowForNonCover;
        uint256 stETHToBurnNowForNonCover = ILido(LIDO).getPooledEthByShares(sharesToBurnNowForNonCover);
        emit StETHBurnt(false /* isCover */, stETHToBurnNowForNonCover, sharesToBurnNowForNonCover);
        nonCoverSharesBurnRequested -= sharesToBurnNowForNonCover;

        ILido(LIDO).burnShares(address(this), memCoverSharesBurnRequested + sharesToBurnNowForNonCover);
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
      * Returns the max amount of shares allowed to burn per single run
      */
    function getBurnAmountPerRunQuota() external view returns (uint256) {
        return maxBurnAmountPerRunBasisPoints;
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

    function supportsInterface(bytes4 _interfaceId) public view virtual override returns (bool) {
        return (
            _interfaceId == type(IBeaconReportReceiver).interfaceId
            || _interfaceId == type(ISelfOwnedStETHBurner).interfaceId
            || super.supportsInterface(_interfaceId)
        );
    }

    function _requestBurnMyStETH(uint256 _stETH2Burn, bool _isCover) private {
        require(_stETH2Burn > 0, "ZERO_BURN_AMOUNT");
        require(msg.sender == VOTING, "MSG_SENDER_MUST_BE_VOTING");
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
