// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Percents} from "./Percents.sol";

contract VotingFee is Ownable, Percents {
    error FeeWithdrawPeriodError(uint256 currentTime, uint256 lastFeeWithdrawTime, uint256 timeLeft);

    event BuyFeePercentageChanged(uint256 newPercentage);
    event SellFeePercentageChanged(uint256 newPercentage);
    event FeeWithdrawPeriodChanged(uint256 newPeriod);

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
    }

    function getTotalFees() external view returns (uint256) {
        return _totalFees;
    }

    function withdrawFees() external onlyOwner {
        uint256 currentTimestamp = block.timestamp;
        uint256 timePassed = currentTimestamp - _lastFeeWithdrawTime;

        if (timePassed < _feeWithdrawPeriod) {
            uint256 timeLeft = _feeWithdrawPeriod - timePassed;

            revert FeeWithdrawPeriodError({currentTime: currentTimestamp, lastFeeWithdrawTime: _lastFeeWithdrawTime, timeLeft: timeLeft});
        }

        _lastFeeWithdrawTime = currentTimestamp;

        payable(address(0)).transfer(_totalFees);
        _totalFees = 0;
    }

    function setBuyFeePercentage(uint256 percentage) external onlyOwner {
        _buyFeePercentage = percentage;

        emit BuyFeePercentageChanged(percentage);
    }

    function setSellFeePercentage(uint256 percentage) external onlyOwner {
        _sellFeePercentage = percentage;

        emit SellFeePercentageChanged(percentage);
    }

    function setFeeWithdrawPeriod(uint256 period) external onlyOwner {
        _feeWithdrawPeriod = period;

        emit FeeWithdrawPeriodChanged(period);
    }
}
