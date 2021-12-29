// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-4/token/ERC721/IERC721.sol";

import "./interfaces/IStETH.sol";

/**
  * @title Interface defining a callback that the quorum will call on every quorum reached
  */
interface IBeaconReportReceiver {
    /**
      * @notice Callback to be called by the oracle contract upon the quorum is reached
      * @param _postTotalPooledEther total pooled ether on Lido right after the quorum value was reported
      * @param _preTotalPooledEther total pooled ether on Lido right before the quorum value was reported
      * @param _timeElapsed time elapsed in seconds between the last and the previous quorum
      */
    function processLidoOracleReport(uint256 _postTotalPooledEther,
                                     uint256 _preTotalPooledEther,
                                     uint256 _timeElapsed) external;
}

/**
  * @title Interface defining a Lido liquid staking pool
  * @dev see also [Lido liquid staking pool core contract](https://docs.lido.fi/contracts/lido)
  */
interface ILido {
    /**
      * @notice Gets authorized oracle address
      * @return address of oracle contract
      */
    function getOracle() external view returns (address);

    /**
      * @notice Destroys given amount of shares from account's holdings, 
      * @param _account address of the shares holder
      * @param _sharesAmount shares amount to burn
      * @dev incurs stETH token rebase by decreasing the total amount of shares.
      */
    function burnShares(address _account, uint256 _sharesAmount) external returns (uint256 newTotalShares);
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
contract SelfOwnedStETHBurner is IBeaconReportReceiver {
    uint256 private coverSharesBurnRequested;
    uint256 private nonCoverSharesBurnRequested;
    
    uint256 private totalCoverSharesBurnt;
    uint256 private totalNonCoverSharesBurnt;
    
    address public immutable LIDO;
    address public immutable TREASURY;
    address public immutable VOTING;

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
      * Emitted when the excessive stETH `amount` (corresponding to `sharesAmount` shares) recovered (e.g. transferred)
      * to the Lido treasure address by `requestedBy` sender.
      */
    event ExcessStETHRecovered(
        address indexed requestedBy,
        uint256 amount,
        uint256 sharesAmount
    );

    /**
      * Emitted when the ERC20 `token` recovered (e.g. transferred)
      * to the Lido treasure address by `requestedBy` sender.
      */
    event ERC20Recovered(
        address indexed requestedBy,
        address indexed token,
        uint256 amount
    );

    /**
      * Emitted when the ERC721-compatible `token` (NFT) recovered (e.g. transferred)
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
      */
    constructor(address _treasury, address _lido, address _voting)
    {
        require(_treasury != address(0), "TREASURY_ZERO_ADDRESS");
        require(_lido != address(0), "LIDO_ZERO_ADDRESS");
        require(_voting != address(0), "VOTING_ZERO_ADDRESS");
        
        TREASURY = _treasury;
        LIDO = _lido;
        VOTING = _voting;
    }

    /**
      * Returns the total cover shares ever burnt.
      */
    function getCoverSharesBurnt() external view returns (uint256) {
        return totalCoverSharesBurnt;
    }
    
    /**
      * Returns the total non-cover shares ever burnt.
      */
    function getNonCoverSharesBurnt() external view returns (uint256) {
        return totalNonCoverSharesBurnt;
    }
    
    /**
      * Returns the stETH amount belonging to the burner contract address but not marked for burning.
      */
    function getExcessStETH() external view returns (uint256)  {
        uint256 sharesBurnRequested = (coverSharesBurnRequested + nonCoverSharesBurnRequested);
        uint256 totalShares = IStETH(LIDO).sharesOf(address(this));

        require (totalShares >= sharesBurnRequested);
        
        return IStETH(LIDO).getPooledEthByShares(totalShares - sharesBurnRequested);
    }    
    
    /**
      * @notice BE CAREFUL, the provided stETH will be burnt permanently.
      *
      * Transfers `_stETH2Burn` stETH tokens from the message sender and irreversibly locks these
      * on the burner contract address. Internally converts `_stETH2Burn` amount into underlying
      * shares amount (`_stETH2BurnAsShares`) and marks the converted amount for burning
      * by increasing the `coverSharesBurnRequested` counter.
      *
      * @param _stETH2Burn stETH tokens to burn
      */
    function requestBurnMyStETHForCover(uint256 _stETH2Burn) external {
        _requestBurnMyStETH(_stETH2Burn, true);
    }

    /**
      * @notice BE CAREFUL, the provided stETH will be burnt permanently.
      *
      * Transfers `_stETH2Burn` stETH tokens from the message sender and irreversibly locks these
      * on the burner contract address. Internally converts `_stETH2Burn` amount into underlying
      * shares amount (`_stETH2BurnAsShares`) and marks the converted amount for burning
      * by increasing the `nonCoverSharesBurnRequested` counter.
      *
      * @param _stETH2Burn stETH tokens to burn
      */
    function requestBurnMyStETHForNonCover(uint256 _stETH2Burn) external {
        _requestBurnMyStETH(_stETH2Burn, false);
    }
    
    /**
      * Transfers the excess stETH amount (e.g. belonging to the burner contract address
      * but not marked for burning) to the Lido treasury address set upon the
      * contract construction.
      */
    function recoverExcessStETH() external {
        uint256 excessStETH = this.getExcessStETH();
        
        if (excessStETH > 0) {
            uint256 excessSharesAmount = IStETH(LIDO).getSharesByPooledEth(excessStETH);
            
            emit ExcessStETHRecovered(msg.sender, excessStETH, excessSharesAmount);

            IStETH(LIDO).transfer(TREASURY, excessStETH);
        }
    }
    
    /**
      * Intentionally deny incoming ether
      */
    receive() external payable {
        revert ("INCOMING_ETH_IS_FORBIDDEN");
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
        require(_token != address(0), "ZERO_ERC20_ADDRESS");
        require(_token != LIDO, "STETH_RECOVER_WRONG_FUNC");

        emit ERC20Recovered(msg.sender, _token, _amount);
        
        IERC20(_token).transfer(TREASURY, _amount);
    }

    /**
      * Transfers a given token_id of an ERC721-compatible NFT (defined by the token contract address)
      * currently belonging to the burner contract address to the Lido treasury address.
      *
      * @param _token an ERC721-compatible token
      * @param _tokenId minted token id
      */
    function recoverERC721(address _token, uint256 _tokenId) external {
        require(_token != address(0), "ZERO_ERC721_ADDRESS");

        emit ERC721Recovered(msg.sender, _token, _tokenId);

        IERC721(_token).transferFrom(address(this), TREASURY, _tokenId);
    }

    /**
     * Enacts cover/non-cover burning requests and logs cover/non-cover shares amount just burnt.
     * Increments `totalCoverSharesBurnt` and `totalNonCoverSharesBurnt` counters.
     * Resets `coverSharesBurnRequested` and `nonCoverSharesBurnRequested` counters to zero.
     * Does nothing if there are no pending burning requests.
     */
    function processLidoOracleReport(uint256, uint256, uint256) external override {
        
        uint256 memCoverSharesBurnRequested = coverSharesBurnRequested;
        uint256 memNonCoverSharesBurnRequested = nonCoverSharesBurnRequested;

        uint256 burnAmount = memCoverSharesBurnRequested + memNonCoverSharesBurnRequested;

        if (burnAmount == 0) {
            return;
        }

        address oracle = ILido(LIDO).getOracle();

        require(
            msg.sender == oracle
            || (msg.sender == IOracle(oracle).getBeaconReportReceiver()),
            "APP_AUTH_FAILED"
        );

        if (memCoverSharesBurnRequested > 0) {
            totalCoverSharesBurnt += memCoverSharesBurnRequested;
            uint256 coverStETHBurnAmountRequested = IStETH(LIDO).getPooledEthByShares(memCoverSharesBurnRequested);
            emit StETHBurnt(true /* isCover */, coverStETHBurnAmountRequested, memCoverSharesBurnRequested);
            coverSharesBurnRequested = 0;
        }
        if (memNonCoverSharesBurnRequested > 0) {
            totalNonCoverSharesBurnt += memNonCoverSharesBurnRequested;
            uint256 nonCoverStETHBurnAmountRequested = IStETH(LIDO).getPooledEthByShares(memNonCoverSharesBurnRequested);
            emit StETHBurnt(false /* isCover */, nonCoverStETHBurnAmountRequested, memNonCoverSharesBurnRequested);
            nonCoverSharesBurnRequested = 0;
        }

        ILido(LIDO).burnShares(address(this), burnAmount);
    }

    function _requestBurnMyStETH(uint256 _stETH2Burn, bool _isCover) private {
        require(_stETH2Burn > 0, "ZERO_BURN_AMOUNT");
        require(msg.sender == VOTING, "MSG_SENDER_MUST_BE_VOTING");
        require(IStETH(LIDO).transferFrom(msg.sender, address(this), _stETH2Burn));

        uint256 sharesAmount = IStETH(LIDO).getSharesByPooledEth(_stETH2Burn);

        emit StETHBurnRequested(_isCover, msg.sender, _stETH2Burn, sharesAmount);

        if (_isCover) {
            coverSharesBurnRequested += sharesAmount;
        } else {
            nonCoverSharesBurnRequested += sharesAmount;
        }
    }
}
