// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {MyERC20} from "./MyERC20.sol";
import {VotingFee} from "./VotingFee.sol";
import {Errors} from "./Errors.sol";
import {Helpers} from "./Helpers.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Voting is MyERC20, VotingFee, Errors, Helpers, ReentrancyGuard {
    struct Stakeholder {
        address addr;
        uint256 weight;
    }

    Stakeholder public topStakeholder;

    uint256 public tokenPrice;

    mapping(address => uint256) internal _stakeholderToRefund;

    constructor(
        uint256 _tokenPrice,
        uint256 buyFeePercentage,
        uint256 sellFeePercentage,
        uint256 decimals
    ) VotingFee(buyFeePercentage, sellFeePercentage, decimals) {
        tokenPrice = _tokenPrice;
    }

    function getRefundAmount(address addr) external view returns (uint256) {
        return _stakeholderToRefund[addr];
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getCallerEtherBalance(address addr) external view returns (uint256) {
        return addr.balance;
    }

    function buy(uint256 amount) external payable {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValidError(amount);
        }

        uint256 requiredEtherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(requiredEtherAmount, _buyFeePercentage);
        uint256 totalEtherAmount = requiredEtherAmount + fee;
        uint256 receivedEtherAmount = msg.value;
        address sender = msg.sender;

        if (receivedEtherAmount < totalEtherAmount) {
            revert EtherError(receivedEtherAmount, totalEtherAmount);
        }

        _mint(sender, amount);

        if (receivedEtherAmount > totalEtherAmount) {
            uint256 change = receivedEtherAmount - totalEtherAmount;

            payable(sender).send(change);
        }

        _totalFees += fee;

        if (balanceOf(sender) > topStakeholder.weight) {
            _stakeholderToRefund[topStakeholder.addr] = 5 wei;

            _changeTopStakeholder(sender);
        }
    }

    function buyUnsecure(uint256 amount) external payable {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValidError(amount);
        }

        uint256 requiredEtherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(requiredEtherAmount, _buyFeePercentage);
        uint256 totalEtherAmount = requiredEtherAmount + fee;
        uint256 receivedEtherAmount = msg.value;
        address sender = msg.sender;

        if (receivedEtherAmount < totalEtherAmount) {
            revert EtherError(receivedEtherAmount, totalEtherAmount);
        }

        _mint(sender, amount);

        if (receivedEtherAmount > totalEtherAmount) {
            uint256 change = receivedEtherAmount - totalEtherAmount;

            payable(sender).send(change);
        }

        _totalFees += fee;

        if (balanceOf(sender) > topStakeholder.weight) {
            require(payable(topStakeholder.addr).send(5), "DoS with Unexpected revert");

            _changeTopStakeholder(sender);
        }
    }

    function sell(uint256 amount) external nonReentrant {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValidError(amount);
        }

        address sender = msg.sender;

        if (balanceOf(sender) < amount) {
            revert SellingMoreThanYouHaveError(amount);
        }

        uint256 etherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(etherAmount, _sellFeePercentage);
        uint256 etherToReturn = etherAmount - fee;

        if (address(this).balance < etherToReturn) {
            revert CantReturnEtherError();
        }

        _burn(sender, amount);

        _totalFees += fee;

        payable(sender).transfer(etherToReturn);
    }

    function sellUnsecure(uint256 amount) external {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValidError(amount);
        }

        address sender = msg.sender;

        uint256 etherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(etherAmount, _sellFeePercentage);
        uint256 etherToReturn = etherAmount - fee;

        if (address(this).balance < etherToReturn) {
            return;
        }

        payable(sender).call{value: etherToReturn}("");

        _burnUnsecure(sender, amount);

        _totalFees += fee;
    }

    function refund() external {
        address sender = msg.sender;

        if (_stakeholderToRefund[sender] != 0) {
            uint256 refundAmount = _stakeholderToRefund[sender];

            _stakeholderToRefund[sender] = 0;

            payable(sender).send(refundAmount);
        }
    }

    function _changeTopStakeholder(address newTopStakeholder) internal {
        topStakeholder.addr = newTopStakeholder;
        topStakeholder.weight = balanceOf(newTopStakeholder);
    }
}
