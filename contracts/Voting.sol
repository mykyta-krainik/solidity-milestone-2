// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {MyERC20} from "./MyERC20.sol";
import {VotingFee} from "./VotingFee.sol";
import {LinkedList} from "./LinkedList.sol";

contract Voting is MyERC20, VotingFee, LinkedList {
    error TimeToVoteError(uint256 received, uint256 minTime);
    error TimeToVoteIsNotExpiredError(uint256 timeToVote, uint256 timeLeft);

    error VotingNotStartedError();
    error VotingIsRunningError();
    error VotingMethodIsNotAvailableError();
    error VotingForNotValidPriceError(uint256 price);
    error PowerIsNotValidError(uint256 power);
    error CallingUnsuitableMethodError();
    error CallingMethodWithWrongTxError();
    error PrevIndexIsNotValid(uint256 index);

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
            revert VotingNotStartedError();
        }

        _;
    }

    modifier isVotingRunning() {
        if (_isVotingStarted) {
            revert VotingIsRunningError();
        }

        _;
    }

    modifier isVoterBalanceEnoughToAddPrice(uint256 price) {
        address voter = msg.sender;
        uint256 voterBalance = _balances[voter];
        bool isPriceExist = isPriceExists(price);
        bool isVoterBalanceEnough = voterBalance >= _minTokenAmount;

        if (!isPriceExist && !isVoterBalanceEnough) {
            revert BalanceIsNotEnoughError({yourBalance: voterBalance, minBalance: _minTokenAmount});
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
            revert TimeToVoteError({received: timeToVote, minTime: 1 days});
        }

        tokenPrice = _tokenPrice;
        _timeToVote = timeToVote;
    }

    function startVoting() external isVotingRunning {
        if (_balances[msg.sender] < _minTokenAmount) {
            revert BalanceIsNotEnoughError({yourBalance: _balances[msg.sender], minBalance: _minTokenAmount});
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
            revert TimeToVoteIsNotExpiredError({timeToVote: _timeToVote, timeLeft: _timeToVote - passedTime});
        }

        _isVotingStarted = false;

        uint256 nextNodePrice = getNodeByPrice(head).next;

        if (head != nextNodePrice) {
            tokenPrice = head;
        }
    }

    function isVoting() external view returns (bool) {
        return _isVotingStarted;
    }

    function vote(
        NodeChange calldata nodeInfo
    ) external checkIfVoterNotVoted(msg.sender) isVoterBalanceEnoughToAddPrice(nodeInfo.price) {
        address voter = msg.sender;
        uint256 voterBalance = _balances[voter];
        uint256 minTokenAmountToVote = 1;
        bool canVoterVote = _balances[voter] >= minTokenAmountToVote;

        if (!canVoterVote) {
            revert BalanceIsNotEnoughError({yourBalance: voterBalance, minBalance: minTokenAmountToVote});
        }

        if (nodeInfo.price <= 0) {
            revert PushingNonValidPrice();
        }

        bool isTheSame = getPriceByVoter(voter) == nodeInfo.price;

        if (isTheSame) {
            revert VotingForTheSamePriceError(nodeInfo.price);
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
        uint256 nextNodePower = getPowerByPrice(getNodeByPrice(nodeInfo.prev).next);

        if (prevNodePower < nodeInfo.power || nodeInfo.power < nextNodePower) {
            revert PrevIndexIsNotValid(nodeInfo.power);
        }

        if (nodeInfo.prev < 0) {
            revert NodeIndexIsNotValidError(nodeInfo.prev);
        }

        bool isPriceExist = isPriceExists(nodeInfo.prev);

        if (nodeInfo.prev != 0 && !isPriceExist) {
            revert NodeIndexIsNotValidError(nodeInfo.prev);
        }

        _push(nodeInfo.price, nodeInfo.power, nodeInfo.prev);
    }

    function voteWithSwap(
        NodeChange[2] calldata votes
    )
        external
        checkIfVoterVoted(msg.sender)
        isVoterBalanceEnoughToAddPrice(votes[0].price)
        isVoterBalanceEnoughToAddPrice(votes[1].price)
    {
        address voter = msg.sender;
        uint256 voterBalance = _balances[voter];
        uint256 minTokenAmountToVote = 1;
        bool canVoterVote = _balances[msg.sender] >= minTokenAmountToVote;

        if (!canVoterVote) {
            revert BalanceIsNotEnoughError({yourBalance: voterBalance, minBalance: minTokenAmountToVote});
        }

        uint256 prevVoterPrice = getPriceByVoter(voter);

        bool hasPrevTx = votes[0].price == prevVoterPrice || votes[1].price == prevVoterPrice;

        if (!hasPrevTx) {
            revert CallingMethodWithWrongTxError();
        }

        NodeChange memory prevPriceChange;
        NodeChange memory newPriceChange;

        (prevPriceChange, newPriceChange) = votes[0].price == prevVoterPrice
            ? (votes[0], votes[1])
            : (votes[1], votes[0]);

        if (prevPriceChange.price == newPriceChange.price) {
            revert VotingForTheSamePriceError(prevPriceChange.price);
        }

        uint256 prevPricePrevPower = getPowerByPrice(prevPriceChange.price);
        uint256 newPricePrevPower = getPowerByPrice(newPriceChange.price);

        if (prevPriceChange.power + voterBalance != prevPricePrevPower) {
            revert PowerIsNotValidError(prevPriceChange.power);
        }

        if (newPricePrevPower + voterBalance != newPriceChange.power) {
            revert PowerIsNotValidError(newPriceChange.power);
        }

        if (prevPriceChange.prev == newPriceChange.price) {
            if (!_areAdjacentNodesPositionsValid(newPriceChange, prevPriceChange)) {
                revert PrevIndexIsNotValid(prevPriceChange.prev);
            }

            _pushAdjacentNodes(newPriceChange, prevPriceChange);

            return;
        } else if (newPriceChange.prev == prevPriceChange.price) {
            if (!_areAdjacentNodesPositionsValid(prevPriceChange, newPriceChange)) {
                revert PrevIndexIsNotValid(newPriceChange.prev);
            }

            _pushAdjacentNodes(prevPriceChange, newPriceChange);

            return;
        }

        if (!_isNodeInValidPosition(prevPriceChange.power, prevPriceChange.prev)) {
            revert PowerIsNotValidError(prevPriceChange.power);
        }

        if (!_isNodeInValidPosition(newPriceChange.power, newPriceChange.prev)) {
            revert PowerIsNotValidError(newPriceChange.power);
        }

        _pushAdjacentNodes(prevPriceChange, newPriceChange);
    }

    function buy(uint256 amount) external payable checkIfVoterNotVoted(msg.sender) {
        uint256 requiredEtherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(requiredEtherAmount, _buyFeePercentage);
        uint256 totalEtherAmount = requiredEtherAmount + fee;
        uint256 receivedEtherAmount = msg.value;
        address sender = msg.sender;

        if (receivedEtherAmount < totalEtherAmount) {
            revert EtherError({received: receivedEtherAmount, required: totalEtherAmount});
        }

        _mint(sender, amount);

        if (receivedEtherAmount > totalEtherAmount) {
            uint256 change = receivedEtherAmount - totalEtherAmount;

            payable(sender).transfer(change);
        }

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;
    }

    function buyWithSwap(
        uint256 amount,
        uint256 prev
    ) external payable checkIfVoterVoted(msg.sender) isIndexValid(prev) {
        uint256 requiredEtherAmount = tokenPrice * amount;
        uint256 fee = _getPercentage(requiredEtherAmount, _buyFeePercentage);
        uint256 totalEtherAmount = requiredEtherAmount + fee;
        uint256 receivedEtherAmount = msg.value;
        address sender = msg.sender;

        if (receivedEtherAmount < totalEtherAmount) {
            revert EtherError({received: receivedEtherAmount, required: totalEtherAmount});
        }

        uint256 voterPrice = getPriceByVoter(sender);
        uint256 voterPricePower = getPowerByPrice(voterPrice);
        uint256 newPricePower = voterPricePower + amount;

        if (!_isNodeInValidPosition(newPricePower, prev)) {
            revert PrevIndexIsNotValid(prev);
        }

        _mint(sender, amount);
        _push(voterPrice, newPricePower, prev);

        if (receivedEtherAmount > totalEtherAmount) {
            uint256 change = receivedEtherAmount - totalEtherAmount;

            payable(sender).transfer(change);
        }

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;
    }

    function sell(uint256 amount) external checkIfVoterNotVoted(msg.sender) {
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

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;

        payable(sender).transfer(etherToReturn);
    }

    function sellWithSwap(uint256 amount, uint256 prev) external checkIfVoterVoted(msg.sender) isIndexValid(prev) {
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

        uint256 voterPrice = getPriceByVoter(sender);
        uint256 voterPricePower = getPowerByPrice(voterPrice);
        uint256 newPricePower = voterPricePower - amount;

        if (!_isNodeInValidPosition(newPricePower, prev)) {
            revert PrevIndexIsNotValid(prev);
        }

        _burn(sender, amount);
        _push(voterPrice, newPricePower, prev);

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;

        payable(sender).transfer(etherToReturn);
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
        NodeChange[2] calldata changes
    ) external checkIfVoterVoted(msg.sender) checkIfVoterVoted(to) returns (bool) {
        uint256 senderPrice = getPriceByVoter(msg.sender);
        uint256 receiverPrice = getPriceByVoter(to);

        bool hasSenderPrice = changes[0].price == senderPrice || changes[1].price == senderPrice;
        bool hasReceiverPrice = changes[0].price == receiverPrice || changes[1].price == receiverPrice;

        if (!hasSenderPrice || !hasReceiverPrice) {
            revert CallingMethodWithWrongTxError();
        }

        if (senderPrice == receiverPrice) {
            return super.transfer(to, amount);
        }

        NodeChange memory senderChange;
        NodeChange memory receiverChange;

        (senderChange, receiverChange) = changes[0].price == senderPrice
            ? (changes[0], changes[1])
            : (changes[1], changes[0]);

        uint256 senderPricePower = getPowerByPrice(senderPrice);
        uint256 receiverPricePower = getPowerByPrice(receiverPrice);

        if (senderChange.power + amount != senderPricePower) {
            revert PowerIsNotValidError(senderChange.power);
        }

        if (receiverChange.power - amount != receiverPricePower) {
            revert PowerIsNotValidError(receiverChange.power);
        }

        if (senderChange.prev == receiverPrice) {
            if (!_areAdjacentNodesPositionsValid(receiverChange, senderChange)) {
                revert PrevIndexIsNotValid(senderChange.prev);
            }

            super.transfer(to, amount);

            _pushAdjacentNodes(receiverChange, senderChange);

            return true;
        } else if (receiverChange.prev == senderPrice) {
            if (!_areAdjacentNodesPositionsValid(senderChange, receiverChange)) {
                revert PrevIndexIsNotValid(receiverChange.prev);
            }

            super.transfer(to, amount);

            _pushAdjacentNodes(senderChange, receiverChange);

            return true;
        }

        if (!_isNodeInValidPosition(senderChange.power, senderChange.prev)) {
            revert PowerIsNotValidError(senderChange.power);
        }

        if (!_isNodeInValidPosition(receiverChange.power, receiverChange.prev)) {
            revert PowerIsNotValidError(receiverChange.power);
        }

        super.transfer(to, amount);

        _pushAdjacentNodes(senderChange, receiverChange);

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

        if (!isPriceExists(change.prev) || !_isNodeInValidPosition(change.power, change.prev)) {
            revert NodeIndexIsNotValidError(change.prev);
        }

        uint256 pricePrevPower = getPowerByPrice(price);

        if (change.power < 0 || change.power + amount != pricePrevPower) {
            revert PowerIsNotValidError(change.power);
        }

        super.transfer(to, amount);
        _push(change.price, change.power, change.prev);

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
        NodeChange[2] calldata changes
    ) external checkIfVoterVoted(owner) checkIfVoterVoted(to) returns (bool) {
        uint256 senderPrice = getPriceByVoter(owner);
        uint256 receiverPrice = getPriceByVoter(to);

        bool hasSenderPrice = changes[0].price == senderPrice || changes[1].price == senderPrice;
        bool hasReceiverPrice = changes[0].price == receiverPrice || changes[1].price == receiverPrice;

        if (!hasSenderPrice || !hasReceiverPrice) {
            revert CallingMethodWithWrongTxError();
        }

        if (senderPrice == receiverPrice) {
            return super.transfer(to, amount);
        }

        NodeChange memory senderChange;
        NodeChange memory receiverChange;

        (senderChange, receiverChange) = changes[0].price == senderPrice
            ? (changes[0], changes[1])
            : (changes[1], changes[0]);

        uint256 senderPricePower = getPowerByPrice(senderPrice);
        uint256 receiverPricePower = getPowerByPrice(receiverPrice);

        if (senderChange.power + amount != senderPricePower) {
            revert PowerIsNotValidError(senderChange.power);
        }

        if (receiverChange.power - amount != receiverPricePower) {
            revert PowerIsNotValidError(receiverChange.power);
        }

        if (senderChange.prev == receiverChange.price) {
            if (!_areAdjacentNodesPositionsValid(receiverChange, senderChange)) {
                revert PrevIndexIsNotValid(senderChange.prev);
            }

            super.transferFrom(owner, to, amount);

            _pushAdjacentNodes(receiverChange, senderChange);

            return true;
        } else if (receiverChange.prev == senderChange.price) {
            if (!_areAdjacentNodesPositionsValid(senderChange, receiverChange)) {
                revert PrevIndexIsNotValid(receiverChange.prev);
            }

            super.transferFrom(owner, to, amount);

            _pushAdjacentNodes(senderChange, receiverChange);

            return true;
        }

        if (!_isNodeInValidPosition(senderChange.power, senderChange.prev)) {
            revert PowerIsNotValidError(senderChange.power);
        }

        if (!_isNodeInValidPosition(receiverChange.power, receiverChange.prev)) {
            revert PowerIsNotValidError(receiverChange.power);
        }

        super.transferFrom(owner, to, amount);

        _pushAdjacentNodes(senderChange, receiverChange);

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
            !_isNodeInValidPosition(change.power, change.prev)
        ) {
            revert PowerIsNotValidError(change.power);
        }

        super.transferFrom(from, to, amount);
        _push(change.price, change.power, change.prev);

        return true;
    }

    function _pushAdjacentNodes(NodeChange memory firstNode, NodeChange memory secondNode) internal {
        _push(firstNode.price, firstNode.power, firstNode.prev);
        _push(secondNode.price, secondNode.power, secondNode.price);
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
}
