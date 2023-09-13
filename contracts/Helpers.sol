// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

contract Helpers {
    function _isTokenAmountValid(uint256 amount) internal pure returns (bool) {
        if (amount == 0) {
            return false;
        }

        return true;
    }
}
