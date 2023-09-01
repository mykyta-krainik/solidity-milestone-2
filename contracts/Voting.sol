// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {MyERC20} from "./MyERC20.sol";
import {VotingFee} from "./VotingFee.sol";
import {VotingHistory} from "./VotingHistory.sol";
import {LinkedList} from "./LinkedList.sol";

contract Voting is MyERC20, VotingFee, LinkedList {
    error TimeToVoteError(uint256 received, uint256 minTime);
    error TimeToVoteIsNotExpiredError(uint256 timeToVote, uint256 timeLeft);

    error VotingNotStartedError();
    error VotingIsRunningError();
    error VotingForTheSamePriceError(uint256 price);
    error VotingForNotValidPriceError(uint256 price);

    error TwoNodesWithSamePriceError(uint256 price);

    error EtherError(uint256 received, uint256 required);
    error SellingMoreThanYouHaveError(uint256 amount);
    error CantReturnEtherError();

    uint256 public tokenPrice;
    uint256 private _minTokenAmount;
    uint256 private _minTokenAmountPercentage = 5;

    bool private _isVotingStarted;
    uint256 private _votingStartedTime;
    uint256 private _timeToVote;

    // NOTE: Do I really need to index both timeStarted and timeEnded?
    event VotingStarted(uint256 indexed votingNumber, uint256 indexed timeStarted);
    event VotingEnded(uint256 indexed votingNumber, uint256 indexed timeEnded);
    event NewTokenPrice(uint256 indexed newTokenPrice);

    constructor(
        uint256 _tokenPrice,
        uint256 timeToVote,
        uint256 buyFeePercentage,
        uint256 sellFeePercentage,
        uint256 decimals
    ) VotingFee(buyFeePercentage, sellFeePercentage, decimals) {
        if (timeToVote < 1 days || timeToVote > 1 weeks) {
            revert TimeToVoteError({received: timeToVote, minTime: 1 days});
        }

        tokenPrice = _tokenPrice;
        _timeToVote = timeToVote;
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

        uint256 timestamp = block.timestamp;
        uint256 passedTime = timestamp - _votingStartedTime;

        if (passedTime < _timeToVote) {
            revert TimeToVoteIsNotExpiredError({timeToVote: _timeToVote, timeLeft: _timeToVote - passedTime});
        }

        _isVotingStarted = false;

        uint256 nextNodePrice = getNodeByPrice(head).next;

        if (head != nextNodePrice) {
            tokenPrice = head;
        }

        VotingPeriod memory votingPeriod = VotingPeriod({
            startTime: _votingStartedTime,
            endTime: timestamp,
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
            revert VotingForNotValidPriceError(price);
        }

        address voter = msg.sender;
        uint256 voterBalance = _balances[voter];
        bool isVoterBalanceEmpty = voterBalance == 0;

        if (isVoterBalanceEmpty) {
            revert BalanceIsNotEnoughError({yourBalance: voterBalance, minBalance: 1});
        }

        bool isPriceExist = getPowerByPrice(price) != 0;
        bool isPriceTheSame = getPriceByVoter(voter) == price;
        bool isVoterVoted = getPriceByVoter(voter) != 0;
        bool isVoterBalanceEnough = voterBalance >= _minTokenAmount;

        if (isPriceTheSame) {
            revert VotingForTheSamePriceError(price);
        }

        if (!isPriceExist && !isVoterBalanceEnough) {
            revert BalanceIsNotEnoughError({yourBalance: voterBalance, minBalance: _minTokenAmount});
        }

        if (isVoterVoted) {
            uint256 prevVoterPrice = getPriceByVoter(voter);

            _decreaseNodeValueBy(prevVoterPrice, voterBalance);

            uint256 prevVoterPricePower = getPowerByPrice(prevVoterPrice);

            if (prevVoterPricePower == 0) {
                remove(prevVoterPrice);
            }
        }

        if (!isPriceExist) {
            push(price, voterBalance, tail);
        } else {
            _increaseNodeValueBy(price, voterBalance);
        }

        _setVoterToPrice(voter, price);

        uint256 newPricePower = getPowerByPrice(price);

        emit NodeAction(price, newPricePower);
    }

    function buy(uint256 amount) external payable {
        uint256 requiredEtherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(requiredEtherAmount, _buyFeePercentage);
        uint256 totalEtherAmount = requiredEtherAmount + fee;
        uint256 receivedEtherAmount = msg.value;
        address sender = msg.sender;

        if (receivedEtherAmount < totalEtherAmount) {
            revert EtherError({received: receivedEtherAmount, required: totalEtherAmount});
        }

        _mint(sender, amount);
        _increaseVoterPricePowerBy(sender, amount);

        if (receivedEtherAmount > totalEtherAmount) {
            uint256 change = receivedEtherAmount - totalEtherAmount;

            payable(sender).transfer(change);
        }

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;
    }

    function sell(uint256 amount) external {
        address sender = msg.sender;

        if (_balances[sender] < amount) {
            revert SellingMoreThanYouHaveError(amount);
        }

        uint256 etherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(etherAmount, _sellFeePercentage);
        uint256 etherToReturn = etherAmount - fee;

        if (address(this).balance < etherToReturn) {
            revert CantReturnEtherError();
        }

        _burn(sender, amount);
        _decreaseVoterPricePowerBy(sender, amount);

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;

        payable(sender).transfer(etherToReturn);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);

        _decreaseVoterPricePowerBy(msg.sender, amount);
        _increaseVoterPricePowerBy(to, amount);

        return true;
    }

    function transferFrom(address owner, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(owner, to, amount);

        _decreaseVoterPricePowerBy(owner, amount);
        _increaseVoterPricePowerBy(to, amount);

        return true;
    }
}
