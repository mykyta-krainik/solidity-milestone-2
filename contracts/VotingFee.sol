// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Percents} from "./Percents.sol";

contract VotingFee is Ownable, Percents {
    error FeeWithdrawPeriodError(uint256 currentTime, uint256 timeLeft);

    uint256 internal _lastFeeWithdrawTime;
    uint256 internal _feeWithdrawPeriod = 1 weeks;
    uint256 internal _totalFees;

    uint256 internal _buyFeePercentage;
    uint256 internal _sellFeePercentage;

    constructor(
        uint256 buyFeePercentage,
        uint256 sellFeePercentage,
        uint256 decimals
    ) Percents(decimals) notValidPercentage(buyFeePercentage) notValidPercentage(sellFeePercentage) {
        _buyFeePercentage = buyFeePercentage;
        _sellFeePercentage = sellFeePercentage;
        _lastFeeWithdrawTime = block.timestamp;
    }

    function getTotalFees() external view returns (uint256) {
        return _totalFees;
    }

    function withdrawFees() external onlyOwner {
        uint256 currentTimestamp = block.timestamp;
        uint256 timeLeft = currentTimestamp - _lastFeeWithdrawTime - _feeWithdrawPeriod;

        if (timeLeft > 0) {
            revert FeeWithdrawPeriodError({currentTime: currentTimestamp, timeLeft: timeLeft});
        }

        _lastFeeWithdrawTime = currentTimestamp;

        payable(address(0)).transfer(_totalFees);
        _totalFees = 0;
    }

    function setBuyFeePercentage(uint256 percentage) external onlyOwner {
        _buyFeePercentage = percentage;
    }

    function setSellFeePercentage(uint256 percentage) external onlyOwner {
        _sellFeePercentage = percentage;
    }

    function setFeeCollectionPeriod(uint256 period) external onlyOwner {
        _feeWithdrawPeriod = period;
    }
}
