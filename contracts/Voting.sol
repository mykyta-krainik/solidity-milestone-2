// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {MyERC20} from "./MyERC20.sol";
import {VotingFee} from "./VotingFee.sol";
import {VotingHistory} from "./VotingHistory.sol";
import {LinkedList} from "./LinkedList.sol";

contract Voting is MyERC20, VotingFee, VotingHistory, LinkedList {
    error TimeToVoteError(uint256 received, uint256 minTime);
    error VotingNotStartedError();
    error VotingIsRunningError();
    error VotingForSamePriceError(uint256 price);
    error TimeToVoteIsNotExpiredError(uint256 timeToVote, uint256 timeLeft);
    error BalanceIsNotEnoughError(uint256 yourBalance, uint256 minBalance);
    error PriceIsNotValidError(uint256 price);

    uint256 public tokenPrice;
    uint256 private _minTokenAmount;
    uint256 private _minTokenAmountPercentage = 5;

    bool private _isVotingStarted;
    uint256 private _votingStartedTime;
    uint256 private _timeToVote;

    // votingId => LinkedList
    event VotingStarted(uint256 votingNumber, uint256 timeStarted);
    event VotingEnded(uint256 votingNumber, uint256 timeEnded);
    event NewTokenPrice(uint256 newTokenPrice);

    constructor(
        uint256 _tokenPrice,
        uint256 timeToVote,
        uint256 buyFeePercentage,
        uint256 sellFeePercentage
    ) VotingFee(buyFeePercentage, sellFeePercentage) {
        if (timeToVote < 1 days || timeToVote > 1 weeks) {
            revert TimeToVoteError({received: timeToVote, minTime: 1 days});
        }

        tokenPrice = _tokenPrice;
        _timeToVote = timeToVote;
    }

    function setNewTokenPrice(uint256 newTokenPrice) external {
        if (newTokenPrice == tokenPrice) {
            return;
        }

        if (_isVotingStarted) {
            revert VotingIsRunningError();
        }

        tokenPrice = newTokenPrice;

        emit NewTokenPrice(newTokenPrice);
    }

    function startVoting() external {
        if (_isVotingStarted) {
            revert VotingIsRunningError();
        }

        if (_balances[msg.sender] < _minTokenAmount) {
            revert BalanceIsNotEnoughError({yourBalance: _balances[msg.sender], minBalance: _minTokenAmount});
        }

        _isVotingStarted = true;
        _votingStartedTime = block.timestamp;
        _votingNumber++;

        emit VotingStarted(_votingNumber, _votingStartedTime);
    }

    function endVoting() external {
        if (!_isVotingStarted) {
            revert VotingNotStartedError();
        }

        uint256 passedTime = block.timestamp - _votingStartedTime;

        if (passedTime < _timeToVote) {
            revert TimeToVoteIsNotExpiredError({timeToVote: _timeToVote, timeLeft: _timeToVote - passedTime});
        }

        _isVotingStarted = false;
        tokenPrice = head;

        VotingPeriod memory votingPeriod = VotingPeriod({
            startTime: _votingStartedTime,
            endTime: block.timestamp,
            topPrice: tokenPrice,
            votingId: _votingNumber
        });

        _votingHistory.push(votingPeriod);

        emit VotingEnded(_votingNumber, votingPeriod.endTime);
    }

    function vote(uint256 price) external {
        if (!_isVotingStarted) {
            revert VotingNotStartedError();
        }

        if (price <= 0) {
            revert PriceIsNotValidError(price);
        }

        address voter = msg.sender;
        uint256 voterBalance = _balances[voter];
        bool isVoterBalanceEmpty = voterBalance == 0;

        if (isVoterBalanceEmpty) {
            revert BalanceIsNotEnoughError({yourBalance: voterBalance, minBalance: 1});
        }

        bool isPriceExist = getPowerByPrice(_votingNumber, price) != 0;
        bool isPriceTheSame = getPriceByVoter(_votingNumber, voter) == price;
        bool isVoterVoted = getPriceByVoter(_votingNumber, voter) != 0;
        bool isVoterBalanceEnough = voterBalance >= _minTokenAmount;

        if (isPriceTheSame) {
            revert VotingForSamePriceError(price);
        }

        if (!isPriceExist && !isVoterBalanceEnough) {
            revert BalanceIsNotEnoughError({yourBalance: voterBalance, minBalance: _minTokenAmount});
        }

        if (isVoterVoted) {
            uint256 prevVoterPrice = getPriceByVoter(_votingNumber, voter);

            decreaseNodeValueBy(_votingNumber, prevVoterPrice, voterBalance);
        }

        if (!isPriceExist) {
            push(_votingNumber, price, voterBalance, tail);
        } else {
            increaseNodeValueBy(_votingNumber, price, voterBalance);
        }

        _linkVoterToPrice(voter, price);

        emit NodeAction(price);
    }

    function buy(uint256 amount) external payable {
        uint256 requiredEtherAmount = tokenPrice * amount;
        uint256 fee = (requiredEtherAmount * _buyFeePercentage) / 10000;
        uint256 totalEtherAmount = requiredEtherAmount + fee;
        uint256 receivedEtherAmount = msg.value;
        address sender = msg.sender;

        require(receivedEtherAmount >= totalEtherAmount, "Voting: received ether amount is less than required");

        _mint(sender, amount);
        _increasePricePower(sender, amount);

        if (receivedEtherAmount > totalEtherAmount) {
            payable(sender).transfer(receivedEtherAmount - totalEtherAmount);
        }

        _minTokenAmount = (_minTokenAmountPercentage * totalSupply()) / 10000;
        _totalFees += fee;
    }

    function sell(uint256 amount) external {
        address sender = msg.sender;

        require(_balances[sender] >= amount, "Voting: you don't have enough tokens");

        uint256 etherAmount = tokenPrice * amount;
        uint256 fee = (etherAmount * _sellFeePercentage) / 10000;
        uint256 etherToReturn = etherAmount - fee;

        require(address(this).balance >= etherToReturn, "Voting: not enough ETH to send");

        _burn(sender, amount);
        _decreasePricePower(sender, amount);

        _minTokenAmount = (_minTokenAmountPercentage * totalSupply()) / 10000;
        _totalFees += fee;

        payable(sender).transfer(etherToReturn);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool result = super.transfer(to, amount);

        if (result) {
            _decreasePricePower(msg.sender, amount);
            _increasePricePower(to, amount);
        }

        return result;
    }

    function transferFrom(address owner, address to, uint256 amount) public override returns (bool) {
        bool result = super.transferFrom(owner, to, amount);

        if (result) {
            _decreasePricePower(owner, amount);
            _increasePricePower(to, amount);
        }

        return result;
    }

    function _decreasePricePower(address owner, uint256 amount) internal {
        uint256 votedPrice = getPriceByVoter(_votingNumber, owner);

        if (votedPrice > 0) {
            decreaseNodeValueBy(_votingNumber, votedPrice, amount);
        }
    }

    function _increasePricePower(address owner, uint256 amount) internal {
        uint256 votedPrice = getPriceByVoter(_votingNumber, owner);

        if (votedPrice > 0) {
            increaseNodeValueBy(_votingNumber, votedPrice, amount);
        }
    }

    function _linkVoterToPrice(address voter, uint256 price) internal {
        _setVoterToPrice(_votingNumber, voter, price);
    }
}
