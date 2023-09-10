// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

contract Percents {
    error PercentageError(uint256 received, uint256 max, uint256 min);

    modifier notValidPercentage(uint256 percentage) {
        if (percentage > _maxPercentage || percentage < _minPercentage) {
            revert PercentageError({received: percentage, max: _maxPercentage, min: _minPercentage});
        }

        _;
    }

    modifier notValidDecimals(uint256 decimals) {
        if (decimals > _maxDecimals) {
            revert PercentageError({received: decimals, max: 18, min: 0});
        }

        _;
    }

    uint256 private constant _maxDecimals = 16;
    uint256 internal _decimals;
    uint256 internal _percentageMultiplier;
    uint256 internal _maxPercentage;
    uint256 internal _minPercentage = 0;

    constructor(uint256 decimals) {
        setDecimals(decimals);
    }

    function setDecimals(uint256 decimals) public virtual notValidDecimals(_decimals) {
        _decimals = decimals;
        _percentageMultiplier = 100 * (10 ** _decimals);
        _maxPercentage = _percentageMultiplier;
    }

    function _getPercentage(
        uint256 amount,
        uint256 percentage
    ) internal view notValidPercentage(percentage) returns (uint256) {
        return ((amount * 10 ** _decimals) * percentage) / _maxPercentage;
    }
}
