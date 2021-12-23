// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.6.12; // latest for the OZ versions [3.0; 4.0)

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

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

contract SelfOwnedStETHBurner is IBeaconReportReceiver {
    uint256 private coverSharesBurnRequested;
    uint256 private nonCoverSharesBurnRequested;
    
    uint256 private totalCoverSharesBurnt;
    uint256 private totalNonCoverSharesBurnt;
    
    address public immutable LIDO;
    address public immutable TREASURY;

    event StETHBurnRequested(
        bool indexed isCover,
        address indexed requestedBy,
        uint256 amount,
        uint256 sharesAmount
    );

    event StETHBurnt(
        bool indexed isCover,
        uint256 amount,
        uint256 sharesAmount
    );

    event ExcessStETHRecovered(
        address indexed requestedBy,
        uint256 amount,
        uint256 sharesAmount
    );

    event ERC20Recovered(
        address indexed requestedBy,
        address indexed token,
        uint256 amount
    );

    event ERC721Recovered(
        address indexed requestedBy,
        address indexed token,
        uint256 tokenId
    );

    constructor(address _treasury, address _lido) public
    {
        require(_treasury != address(0), "TREASURY_ZERO_ADDRESS");
        require(_lido != address(0), "LIDO_ZERO_ADDRESS");
        
        TREASURY = _treasury;
        LIDO = _lido;
    }

    function getCoverSharesBurnt() external view returns (uint256) {
        return totalCoverSharesBurnt;
    }
    
    function getNonCoverSharesBurnt() external view returns (uint256) {
        return totalNonCoverSharesBurnt;
    }
    
    function getExcessStETH() external view returns (uint256)  {
        uint256 sharesBurnRequested = (coverSharesBurnRequested + nonCoverSharesBurnRequested);
        uint256 totalShares = IStETH(LIDO).sharesOf(address(this));

        require (totalShares >= sharesBurnRequested);
        
        return IStETH(LIDO).getPooledEthByShares(totalShares - sharesBurnRequested);
    }    
    
    function requestStETHBurn(uint256 _stETH2Burn, bool _isCover) external {
        require(_stETH2Burn > 0, "ZERO_BURN_AMOUNT");
        require(IStETH(LIDO).transferFrom(msg.sender, address(this), _stETH2Burn));
        
        uint256 sharesAmount = IStETH(LIDO).getSharesByPooledEth(_stETH2Burn);
        
        emit StETHBurnRequested(_isCover, msg.sender, _stETH2Burn, sharesAmount);

        if (_isCover) { 
            coverSharesBurnRequested += sharesAmount;
        } else {
            nonCoverSharesBurnRequested += sharesAmount;
        }
    }
    
    function recoverExcessStETH() external {
        uint256 excessStETH = this.getExcessStETH();
        
        if (excessStETH > 0) {
            uint256 excessSharesAmount = IStETH(LIDO).getSharesByPooledEth(excessStETH);
            
            emit ExcessStETHRecovered(msg.sender, excessStETH, excessSharesAmount);

            IStETH(LIDO).transfer(TREASURY, excessStETH);
        }
    }
    
    //don't accept ether
    fallback() payable external {
        revert ("INCOMING_ETH_IS_FORBIDDEN");
    }
   
    function recoverERC20(address _token, uint256 _amount) external {
        require(_amount > 0, "ZERO_RECOVERY_AMOUNT");
        require(_token != address(0), "ZERO_ERC20_ADDRESS");
        require(_token != LIDO, "STETH_RECOVER_WRONG_FUNC");

        emit ERC20Recovered(msg.sender, _token, _amount);
        
        IERC20(_token).transfer(TREASURY, _amount);
    }

    function recoverERC721(address _token, uint256 _tokenId) external {
        require(_token != address(0), "ZERO_ERC721_ADDRESS");

        emit ERC721Recovered(msg.sender, _token, _tokenId);

        IERC721(_token).transferFrom(address(this), TREASURY, _tokenId);
    }
    
    function processLidoOracleReport(uint256 _postTotalPooledEther,
                                     uint256 _preTotalPooledEther,
                                     uint256 _timeElapsed) external override(IBeaconReportReceiver) {
        
        uint256 memCoverSharesBurnRequested = coverSharesBurnRequested;
        uint256 memNonCoverSharesBurnRequested = nonCoverSharesBurnRequested;

        uint256 burnAmount = memCoverSharesBurnRequested + memNonCoverSharesBurnRequested;

        if (burnAmount == 0) {
            return;
        }

        require(msg.sender == ILido(LIDO).getOracle(), "APP_AUTH_FAILED");

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
}
