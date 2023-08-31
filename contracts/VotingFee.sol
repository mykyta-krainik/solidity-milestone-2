// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VotingFee is Ownable {
    error BuyFeePercentageError(uint256 received, uint256 max, uint256 min);

    error SellFeePercentageError(uint256 received, uint256 max, uint256 min);

    uint256 internal _lastFeeWithdrawTime;
    uint256 internal _feeWithdrawPeriod = 1 weeks;
    uint256 internal _totalFees;
    uint256 internal _buyFeePercentage;
    uint256 internal _sellFeePercentage;

    constructor(uint256 buyFeePercentage, uint256 sellFeePercentage) {
        if (buyFeePercentage > 10000 || buyFeePercentage < 0) {
            revert BuyFeePercentageError({received: buyFeePercentage, max: 10000, min: 0});
        }

        if (sellFeePercentage > 10000 || sellFeePercentage < 0) {
            revert SellFeePercentageError({received: sellFeePercentage, max: 10000, min: 0});
        }

        _buyFeePercentage = buyFeePercentage;
        _sellFeePercentage = sellFeePercentage;
        _lastFeeWithdrawTime = block.timestamp;
    }

    function getTotalFees() external view returns (uint256) {
        return _totalFees;
    }

    function withdrawFees() external onlyOwner {
        require(
            block.timestamp - _lastFeeWithdrawTime >= _feeWithdrawPeriod,
            "Voting: fee withdraw period is not over yet"
        );

        _lastFeeWithdrawTime = block.timestamp;

        payable(address(0)).transfer(_totalFees);
        _totalFees = 0;
    }

    function setBuyFeePercentage(uint256 percentage) external onlyOwner {
        require(percentage < 10000, "Voting: percentage must be < 10000");

        _buyFeePercentage = percentage;
    }

    function setSellFeePercentage(uint256 percentage) external onlyOwner {
        require(percentage < 10000, "Voting: percentage must be < 10000");

        _sellFeePercentage = percentage;
    }

    function setFeeCollectionPeriod(uint256 period) external onlyOwner {
        _feeWithdrawPeriod = period;
    }
}
