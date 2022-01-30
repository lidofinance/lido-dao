// SPDX-FileCopyrightText: 2021 Lido <info@lido.fi>

// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import "@openzeppelin/contracts-v4.4/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-v4.4/token/ERC721/IERC721.sol";


interface ILido {
    /**
    * @notice A payable function supposed to be funded only by LidoMevTxFeeVault contract
    * @dev We need a separate function because funds received by default payable function
    * will go through entire deposit algorithm
    */
    function receiveMevTxFee() external payable;
}


/**
* @title A vault for temporary storage of MEV and transaction fees
*
* This contract has no payable functions because it's balance is supposed to be
* increased directly by ethereum protocol when transaction priority fees and extracted MEV
* rewards are earned by a validator.
* These vault replenishments happen continuously throught a day, while withdrawals
* happen much less often, only on LidoOracle beacon balance reports
*/
contract LidoMevTxFeeVault {
    address public immutable LIDO;
    address public immutable TREASURY;

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
      * @param _lido the Lido token (stETH) address
      * @param _treasury the Lido treasury address (see ERC20/ERC721-recovery interfaces)
      */
    constructor(address _lido, address _treasury) {
        require(_lido != address(0), "LIDO_ZERO_ADDRESS");

        LIDO = _lido;
        TREASURY = _treasury;
    }

    /**
    * @notice Allows the contract to receive ETH
    * @dev MEV rewards may be sent as plain ETH transfers
    */
    receive() external payable {
    }

    /**
    * @notice Withdraw all accumulated rewards to Lido contract
    * @dev Can be called only by the Lido contract
    * @return amount uint256 of funds received as MEV and transaction fees in wei
    */
    function withdrawRewards() external returns (uint256 amount) {
        require(msg.sender == LIDO, "ONLY_LIDO_CAN_WITHDRAW");

        amount = address(this).balance;
        if (amount > 0) {
            ILido(LIDO).receiveMevTxFee{value: amount}();
        }
        return amount;
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

        emit ERC20Recovered(msg.sender, _token, _amount);

        require(IERC20(_token).transfer(TREASURY, _amount));
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
}
