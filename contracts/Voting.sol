// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {MyERC20} from "./MyERC20.sol";
import {VotingFee} from "./VotingFee.sol";
import {LinkedList} from "./LinkedList.sol";
import {VotingUnsecure} from "./VotingUnsecure.sol";
import {Errors} from "./Errors.sol";
import {Helpers} from "./Helpers.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract Voting is MyERC20, VotingFee, LinkedList, VotingUnsecure, Errors, Helpers, ReentrancyGuard {
    struct NodeChange {
        uint256 price;
        uint256 power;
        uint256 prev;
    }

    struct Stakeholder {
        address addr;
        uint256 weight;
    }

    Stakeholder public topStakeholder;

    uint256 public tokenPrice;
    uint256 internal _minTokenAmount;
    uint256 internal _minTokenAmountPercentage = 5;
    uint256 internal _minTokenAmountToVote = 1;
    uint256 internal _votingStartedTime;
    uint256 internal _timeToVote;
    bool internal _isVotingStarted;

    mapping(address => uint256) internal _stakeholderToRefund;

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

    function getRefundAmount(address addr) external view returns (uint256) {
        return _stakeholderToRefund[addr];
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function isVoting() external view returns (bool) {
        return _isVotingStarted;
    }

    function getCallerEtherBalance(address addr) external view returns (uint256) {
        return addr.balance;
    }

    function _changeTopStakeholder(address newTopStakeholder) internal {
        topStakeholder.addr = newTopStakeholder;
        topStakeholder.weight = balanceOf(newTopStakeholder);
    }

    function buy(uint256 amount) external payable checkIfVoterNotVoted(msg.sender) {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
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

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;

        if (balanceOf(sender) > topStakeholder.weight) {
            _stakeholderToRefund[topStakeholder.addr] = 5;

            _changeTopStakeholder(sender);
        }
    }

    function buyUnsecure(uint256 amount) external payable {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
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

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;

        if (balanceOf(sender) > topStakeholder.weight) {
            require(payable(topStakeholder.addr).send(5), "DoS with Unexpected revert");

            _changeTopStakeholder(sender);
        }
    }

    function sell(uint256 amount) external checkIfVoterNotVoted(msg.sender) nonReentrant {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
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

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;

        payable(sender).transfer(etherToReturn);
    }

    function sellUnsecure(uint256 amount) external {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
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

        payable(sender).call{value: etherToReturn}("");

        _burn(sender, amount);

        _minTokenAmount = _getPercentage(totalSupply(), _minTokenAmountPercentage);
        _totalFees += fee;
    }

    function transfer(
        address to,
        uint256 amount
    ) public override checkIfVoterNotVoted(msg.sender) checkIfVoterNotVoted(to) returns (bool) {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
        }

        return super.transfer(to, amount);
    }

    function transferWithSingleSwap(address to, uint256 amount, NodeChange calldata change) external returns (bool) {
        if (!_isBalanceEnough(amount, msg.sender)) {
            revert BalanceIsNotEnoughError(balanceOf(msg.sender), amount);
        }

        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
        }

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
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
        }

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
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
        }

        return super.transferFrom(owner, to, amount);
    }

    function transferFromWithSingleSwap(
        address owner,
        address to,
        uint256 amount,
        NodeChange calldata change
    ) external returns (bool) {
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
        }

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
        if (!_isTokenAmountValid(amount)) {
            revert TokenAmountIsNotValid(amount);
        }

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

    function refund() external {
        address sender = msg.sender;

        if (_stakeholderToRefund[sender] != 0) {
            uint256 refundAmount = _stakeholderToRefund[sender];

            _stakeholderToRefund[sender] = 0;

            payable(sender).send(refundAmount);
        }
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

        if (change.prev != 0 && !isPriceExists(change.prev)) {
            revert NodeIndexIsNotValidError(change.prev);
        }

        uint256 pricePrevPower = getPowerByPrice(price);

        if (
            change.power < 0 ||
            (priceOwner == to ? change.power - amount != pricePrevPower : change.power + amount != pricePrevPower) ||
            !_isNodeInValidPosition(change.price, change.power, change.prev)
        ) {
            revert PowerIsNotValidError(change.power);
        }

        super.transferFrom(from, to, amount);
        push(change.price, change.power, change.prev);

        return true;
    }

    function _processSwapping(
        NodeChange calldata nodeChange1,
        NodeChange calldata nodeChange2,
        uint256 amount,
        uint256 price1,
        uint256 price2,
        address owner,
        address to
    ) internal {
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
        uint256 prevNodePower = getPowerByPrice(firstNode.prev);

        prevNodePower = prevNodePower == 0 ? firstNode.power + 1 : prevNodePower;

        return
            secondNode.power <= firstNode.power &&
            firstNode.power <= prevNodePower &&
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

    function _isBalanceEnough(uint256 amount, address owner) internal view returns (bool) {
        return balanceOf(owner) >= amount;
    }
}
