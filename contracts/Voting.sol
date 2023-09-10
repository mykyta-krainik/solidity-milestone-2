// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {MyERC20} from "./MyERC20.sol";
import {VotingFee} from "./VotingFee.sol";
import {LinkedList} from "./LinkedList.sol";

contract Voting is MyERC20, VotingFee, LinkedList {
    error TimeToVoteError(uint256 received, uint256 minTime);
    error TimeToVoteIsNotExpiredError(uint256 timeToVote, uint256 timeLeft);

    error VotingIsNotStartedError();
    error VotingIsRunningError();
    error VotingMethodIsNotAvailableError();
    error VotingForNotValidPriceError(uint256 price);
    error PowerIsNotValidError(uint256 power);
    error CallingUnsuitableMethodError();
    error CallingMethodWithWrongTxError();
    error PrevIndexIsNotValid(uint256 index);
    error TokenAmountIsNotValid(uint256 amount);

    error TwoNodesWithSamePriceError(uint256 price);

    error EtherError(uint256 received, uint256 required);
    error SellingMoreThanYouHaveError(uint256 amount);
    error CantReturnEtherError();

    struct NodeChange {
        uint256 price;
        uint256 power;
        uint256 prev;
    }

    uint256 public tokenPrice;
    uint256 private _minTokenAmount;
    uint256 private _minTokenAmountPercentage = 5;
    uint256 private _minTokenAmountToVote = 1;
    uint256 private _votingStartedTime;
    uint256 private _timeToVote;
    bool private _isVotingStarted;

    event VotingStarted(uint256 indexed votingNumber, uint256 indexed timeStarted);
    event VotingEnded(uint256 indexed votingNumber, uint256 indexed timeEnded);
    event NewTokenPrice(uint256 indexed newTokenPrice);

    modifier checkIfVoterVoted(address voter) {
        if (getPriceByVoter(voter) == 0) {
            revert CallingUnsuitableMethodError();
        }

        _;
    }

    modifier checkIfVoterNotVoted(address voter) {
        if (getPriceByVoter(voter) != 0) {
            revert CallingUnsuitableMethodError();
        }

        _;
    }

    modifier isVotingStarted() {
        if (!_isVotingStarted) {
            revert VotingIsNotStartedError();
        }

        _;
    }

    modifier isVotingRunning() {
        if (_isVotingStarted) {
            revert VotingIsRunningError();
        }

        _;
    }

    modifier isTokenAmountValid(uint256 amount) {
        if (amount == 0) {
            revert TokenAmountIsNotValid(amount);
        }

        _;
    }

    constructor(
        uint256 _tokenPrice,
        uint256 timeToVote,
        uint256 buyFeePercentage,
        uint256 sellFeePercentage,
        uint256 decimals
    ) VotingFee(buyFeePercentage, sellFeePercentage, decimals) {
        if (timeToVote < 1 days || timeToVote > 1 weeks) {
            revert TimeToVoteError(timeToVote, 1 days);
        }

        tokenPrice = _tokenPrice;
        _timeToVote = timeToVote;
    }

    function startVoting() external isVotingRunning {
        uint256 balance = balanceOf(msg.sender);

        if (balance < _minTokenAmount) {
            revert BalanceIsNotEnoughError(balance, _minTokenAmount);
        }

        _isVotingStarted = true;
        _votingStartedTime = block.timestamp;
        _votingNumber++;

        emit VotingStarted(_votingNumber, _votingStartedTime);
    }

    function endVoting() external isVotingStarted {
        uint256 timestamp = block.timestamp;
        uint256 passedTime = timestamp - _votingStartedTime;

        if (passedTime < _timeToVote) {
            revert TimeToVoteIsNotExpiredError(_timeToVote, _timeToVote - passedTime);
        }

        _isVotingStarted = false;

        uint256 nextNodePrice = getNodeByPrice(head).next;

        if (head != nextNodePrice) {
            tokenPrice = head;
        }

        emit VotingEnded(_votingNumber, timestamp);
    }

    function getMinTokenAmount() external view returns (uint256) {
        return _minTokenAmount;
    }

    function isVoting() external view returns (bool) {
        return _isVotingStarted;
    }

    function vote(NodeChange calldata nodeInfo) external checkIfVoterNotVoted(msg.sender) isVotingStarted {
        address voter = msg.sender;
        uint256 voterBalance = balanceOf(voter);

        if (!_isEnoughToken(nodeInfo.price)) {
            revert BalanceIsNotEnoughError(voterBalance, _minTokenAmountToVote);
        }

        if (nodeInfo.price <= 0) {
            revert PushingNonValidPrice();
        }

        if (nodeInfo.power < 0) {
            revert PowerIsNotValidError(nodeInfo.power);
        }

        uint256 oldPower = getPowerByPrice(nodeInfo.price);
        uint256 expectedPower = oldPower + voterBalance;

        if (nodeInfo.power != expectedPower) {
            revert PowerIsNotValidError(nodeInfo.power);
        }

        uint256 prevNodePower = getPowerByPrice(nodeInfo.prev);
        uint256 nextNodePower = getPowerByPrice(getNextNode(nodeInfo.prev).price);

        if ((nodeInfo.prev != 0 && prevNodePower < nodeInfo.power) || nodeInfo.power < nextNodePower) {
            revert PrevIndexIsNotValid(nodeInfo.power);
        }

        if (nodeInfo.prev < 0) {
            revert NodeIndexIsNotValidError(nodeInfo.prev);
        }

        if (nodeInfo.prev != 0 && !isPriceExists(nodeInfo.prev)) {
            revert NodeIndexIsNotValidError(nodeInfo.prev);
        }

        push(nodeInfo.price, nodeInfo.power, nodeInfo.prev);
        _setVoterToPrice(voter, nodeInfo.price);
    }

    function voteWithSwap(
        NodeChange calldata prevPriceChange,
        NodeChange calldata newPriceChange
    ) external checkIfVoterVoted(msg.sender) isVotingStarted {
        address voter = msg.sender;
        uint256 voterBalance = balanceOf(voter);

        if (!_isEnoughToken(prevPriceChange.price) || !_isEnoughToken(newPriceChange.price)) {
            revert BalanceIsNotEnoughError(voterBalance, _minTokenAmountToVote);
        }

        uint256 voterPrevPrice = getPriceByVoter(voter);

        if (prevPriceChange.price == newPriceChange.price) {
            revert VotingForTheSamePriceError(newPriceChange.price);
        }

        if (prevPriceChange.price != voterPrevPrice || newPriceChange.price != voterPrevPrice) {
            revert CallingMethodWithWrongTxError();
        }

        uint256 newPrice = prevPriceChange.price != voterPrevPrice ? prevPriceChange.price : newPriceChange.price;

        _processSwapping(
            prevPriceChange,
            newPriceChange,
            voterBalance,
            voterPrevPrice,
            newPrice,
            address(0),
            address(0)
        );
        _setVoterToPrice(voter, newPrice);
    }

    function buy(uint256 amount) external payable checkIfVoterNotVoted(msg.sender) isTokenAmountValid(amount) {
        _buy(amount, 0);
    }

    function buyWithSwap(
        uint256 amount,
        uint256 prev
    ) external payable checkIfVoterVoted(msg.sender) isIndexValid(prev) isTokenAmountValid(amount) {
        _buy(amount, prev);
    }

    function sell(uint256 amount) external checkIfVoterNotVoted(msg.sender) isTokenAmountValid(amount) {
        _sell(amount, 0);
    }

    function sellWithSwap(
        uint256 amount,
        uint256 prev
    ) external checkIfVoterVoted(msg.sender) isIndexValid(prev) isTokenAmountValid(amount) {
        _sell(amount, prev);
    }

    function transfer(
        address to,
        uint256 amount
    ) public override checkIfVoterNotVoted(msg.sender) checkIfVoterNotVoted(to) returns (bool) {
        return super.transfer(to, amount);
    }

    function transferWithSingleSwap(address to, uint256 amount, NodeChange calldata change) external returns (bool) {
        address sender = msg.sender;
        uint256 senderPrice = getPriceByVoter(sender);
        uint256 receiverPrice = getPriceByVoter(to);
        bool senderVoted = senderPrice != 0;
        bool receiverVoted = receiverPrice != 0;

        if ((senderVoted && receiverVoted) || (!senderVoted && !receiverVoted)) {
            revert CallingUnsuitableMethodError();
        }

        address priceOwner = senderVoted ? sender : to;

        return _transferWithSingleSwap(priceOwner, to, amount, change);
    }

    function transferWithDoubleSwap(
        address to,
        uint256 amount,
        NodeChange calldata change1,
        NodeChange calldata change2
    ) external checkIfVoterVoted(msg.sender) checkIfVoterVoted(to) returns (bool) {
        uint256 senderPrice = getPriceByVoter(msg.sender);
        uint256 receiverPrice = getPriceByVoter(to);

        if (
            (change1.price != senderPrice && change2.price != senderPrice) ||
            (change1.price != receiverPrice && change2.price != receiverPrice)
        ) {
            revert CallingMethodWithWrongTxError();
        }

        if (senderPrice == receiverPrice) {
            return super.transfer(to, amount);
        }

        _processSwapping(change1, change2, amount, senderPrice, receiverPrice, address(0), to);

        return true;
    }

    function _transferWithSingleSwap(
        address priceOwner,
        address to,
        uint256 amount,
        NodeChange calldata change
    ) internal returns (bool) {
        uint256 price = getPriceByVoter(priceOwner);
        bool hasPrice = change.price == price;

        if (!hasPrice) {
            revert CallingMethodWithWrongTxError();
        }

        if (
            (change.prev != 0 && !isPriceExists(change.prev)) ||
            !_isNodeInValidPosition(change.price, change.power, change.prev)
        ) {
            revert NodeIndexIsNotValidError(change.prev);
        }

        uint256 pricePrevPower = getPowerByPrice(price);

        if (change.power < 0 || change.power + amount != pricePrevPower) {
            revert PowerIsNotValidError(change.power);
        }

        super.transfer(to, amount);
        push(change.price, change.power, change.prev);

        return true;
    }

    function transferFrom(
        address owner,
        address to,
        uint256 amount
    ) public override checkIfVoterNotVoted(owner) checkIfVoterNotVoted(to) returns (bool) {
        return super.transferFrom(owner, to, amount);
    }

    function transferFromWithSingleSwap(
        address owner,
        address to,
        uint256 amount,
        NodeChange calldata change
    ) external returns (bool) {
        uint256 ownerPrice = getPriceByVoter(owner);
        uint256 receiverPrice = getPriceByVoter(to);
        bool ownerVoted = ownerPrice != 0;
        bool receiverVoted = receiverPrice != 0;

        if ((ownerVoted && receiverVoted) || (!ownerVoted && !receiverVoted)) {
            revert CallingUnsuitableMethodError();
        }

        address priceOwner = ownerVoted ? owner : to;

        return _transferFromWithSingleSwap(priceOwner, owner, to, amount, change);
    }

    function transferFromWithDoubleSwap(
        address owner,
        address to,
        uint256 amount,
        NodeChange calldata change1,
        NodeChange calldata change2
    ) external checkIfVoterVoted(owner) checkIfVoterVoted(to) returns (bool) {
        uint256 senderPrice = getPriceByVoter(owner);
        uint256 receiverPrice = getPriceByVoter(to);

        if (
            (change1.price != senderPrice && change2.price != senderPrice) ||
            (change1.price != receiverPrice && change2.price != receiverPrice)
        ) {
            revert CallingMethodWithWrongTxError();
        }

        if (senderPrice == receiverPrice) {
            return super.transferFrom(owner, to, amount);
        }

        _processSwapping(change1, change2, amount, senderPrice, receiverPrice, owner, to);

        return true;
    }

    function _transferFromWithSingleSwap(
        address priceOwner,
        address from,
        address to,
        uint256 amount,
        NodeChange calldata change
    ) internal returns (bool) {
        uint256 price = getPriceByVoter(priceOwner);
        bool hasPrice = change.price == price;

        if (!hasPrice) {
            revert CallingMethodWithWrongTxError();
        }

        if (!isPriceExists(change.prev)) {
            revert NodeIndexIsNotValidError(change.prev);
        }

        uint256 pricePrevPower = getPowerByPrice(price);

        if (
            change.power < 0 ||
            change.power + amount != pricePrevPower ||
            !_isNodeInValidPosition(change.price, change.power, change.prev)
        ) {
            revert PowerIsNotValidError(change.power);
        }

        super.transferFrom(from, to, amount);
        push(change.price, change.power, change.prev);

        return true;
    }

    function _buy(uint256 amount, uint256 prev) private {
        uint256 requiredEtherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(requiredEtherAmount, _buyFeePercentage);
        uint256 totalEtherAmount = requiredEtherAmount + fee;
        uint256 receivedEtherAmount = msg.value;
        address sender = msg.sender;

        if (receivedEtherAmount < totalEtherAmount) {
            revert EtherError(receivedEtherAmount, totalEtherAmount);
        }

        uint256 voterPrice;
        uint256 voterPricePower;
        uint256 newPricePower;

        if (msg.sig == this.buyWithSwap.selector) {
            voterPrice = getPriceByVoter(sender);
            voterPricePower = getPowerByPrice(voterPrice);
            newPricePower = voterPricePower + amount;

            if (!_isNodeInValidPosition(voterPrice, newPricePower, prev)) {
                revert PrevIndexIsNotValid(prev);
            }
        }

        _mint(sender, amount);

        if (msg.sig == this.buyWithSwap.selector) {
            push(voterPrice, newPricePower, prev);
        }

        if (receivedEtherAmount > totalEtherAmount) {
            uint256 change = receivedEtherAmount - totalEtherAmount;

            payable(sender).transfer(change);
        }

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;
    }

    function _sell(uint256 amount, uint256 prev) private {
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

        uint256 voterPrice;
        uint256 voterPricePower;
        uint256 newPricePower;

        if (msg.sig == this.sellWithSwap.selector) {
            voterPrice = getPriceByVoter(sender);
            voterPricePower = getPowerByPrice(voterPrice);
            newPricePower = voterPricePower - amount;

            if (!_isNodeInValidPosition(voterPrice, newPricePower, prev)) {
                revert PrevIndexIsNotValid(prev);
            }
        }

        _burn(sender, amount);

        if (msg.sig == this.sellWithSwap.selector) {
            push(voterPrice, newPricePower, prev);
        }

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;

        payable(sender).transfer(etherToReturn);
    }

    function _processSwapping(
        NodeChange calldata nodeChange1,
        NodeChange calldata nodeChange2,
        uint256 amount,
        uint256 price1,
        uint256 price2,
        address owner,
        address to
    ) private {
        (nodeChange1, nodeChange2) = nodeChange1.price == price1
            ? (nodeChange1, nodeChange2)
            : (nodeChange2, nodeChange1);

        uint256 senderPricePower = getPowerByPrice(price1);
        uint256 receiverPricePower = getPowerByPrice(price2);

        if (nodeChange1.power + amount != senderPricePower) {
            revert PowerIsNotValidError(nodeChange1.power);
        }

        if (nodeChange2.power - amount != receiverPricePower) {
            revert PowerIsNotValidError(nodeChange2.power);
        }

        if (nodeChange1.prev == nodeChange2.price) {
            _swapAdjacent(nodeChange2, nodeChange1, to, owner, amount);

            return;
        } else if (nodeChange2.prev == nodeChange1.price) {
            _swapAdjacent(nodeChange1, nodeChange2, to, owner, amount);

            return;
        }

        if (!_isNodeInValidPosition(nodeChange1.price, nodeChange1.power, nodeChange1.prev)) {
            revert PowerIsNotValidError(nodeChange1.power);
        }

        if (!_isNodeInValidPosition(nodeChange2.price, nodeChange2.power, nodeChange2.prev)) {
            revert PowerIsNotValidError(nodeChange2.power);
        }

        if (msg.sig == this.transferWithDoubleSwap.selector) {
            super.transfer(to, amount);
        } else if (msg.sig == this.transferFromWithDoubleSwap.selector) {
            super.transferFrom(owner, to, amount);
        }

        _pushAdjacentNodes(nodeChange1, nodeChange2);
    }

    function _swapAdjacent(
        NodeChange memory firstNode,
        NodeChange memory secondNode,
        address to,
        address owner,
        uint256 amount
    ) internal {
        if (!_areAdjacentNodesPositionsValid(firstNode, secondNode)) {
            revert PrevIndexIsNotValid(secondNode.prev);
        }

        if (msg.sig == this.transferWithDoubleSwap.selector) {
            super.transfer(to, amount);
        } else if (msg.sig == this.transferFromWithDoubleSwap.selector) {
            super.transferFrom(owner, to, amount);
        }

        _pushAdjacentNodes(firstNode, secondNode);
    }

    function _pushAdjacentNodes(NodeChange memory firstNode, NodeChange memory secondNode) internal {
        push(firstNode.price, firstNode.power, firstNode.prev);
        push(secondNode.price, secondNode.power, secondNode.price);
    }

    function _areAdjacentNodesPositionsValid(
        NodeChange memory firstNode,
        NodeChange memory secondNode
    ) internal view returns (bool) {
        return
            secondNode.power <= firstNode.power &&
            firstNode.power <= getPowerByPrice(firstNode.prev) &&
            secondNode.power >= getNextNode(firstNode.prev).power;
    }

    function _isEnoughToken(uint256 price) internal view returns (bool) {
        address voter = msg.sender;
        uint256 voterBalance = balanceOf(voter);
        bool isPriceExist = isPriceExists(price);
        bool isVoterBalanceEnough = voterBalance >= _minTokenAmount;

        if ((!isPriceExist && !isVoterBalanceEnough) || voterBalance < _minTokenAmountToVote) {
            return false;
        }

        return true;
    }
}
