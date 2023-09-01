// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import {VotingHistory} from "./VotingHistory.sol";

contract LinkedList is VotingHistory {
    error PushingNonValidPrice();
    error PushingExistingNode(uint256 price);
    error UpdatingNonExistingNode(uint256 price);
    error RemovingNonExistingNode(uint256 price);
    error DecreasingNodeValueByTooMuch(uint256 price, uint256 power);

    event NodeAction(uint256 indexed price, uint256 power);

    struct Node {
        // index (price) pointer to the previous node
        uint256 prev;
        // index (price) pointer to the next node
        uint256 next;
        uint256 power;
        uint256 price;
    }

    // _votingNumber => price => node
    mapping(uint256 => mapping(uint256 => Node)) private _nodes;
    mapping(uint256 => mapping(address => uint256)) private _voterToPrice;

    // top price
    uint256 public head = 0;
    uint256 public tail = 0;

    function getNodeByPrice(uint256 price) public view returns (Node memory) {
        return _nodes[_votingNumber][price];
    }

    function getPowerByPrice(uint256 price) public view returns (uint256) {
        return _nodes[_votingNumber][price].power;
    }

    function getTopPrice() external view returns (uint256) {
        return head;
    }

    function getPriceByVoter(address owner) public view returns (uint256) {
        return _voterToPrice[_votingNumber][owner];
    }

    function push(uint256 price, uint256 power, uint256 prev) public {
        if (price <= 0) {
            revert PushingNonValidPrice();
        }

        if (_nodes[_votingNumber][price].power != 0) {
            remove(price);
        }

        if (prev == 0) {
            _pushFront(price, power);

            if (tail == 0) {
                tail = price;
            }

            return;
        }

        if (prev == tail) {
            _pushBack(price, power);

            if (head == 0) {
                head = price;
            }

            return;
        }

        uint256 next = _nodes[_votingNumber][prev].next;

        _insert(price, power, prev, next);
    }

    function remove(uint256 price) public {
        if (price <= 0) {
            revert RemovingNonExistingNode(price);
        }

        uint256 prev = _nodes[_votingNumber][price].prev;
        uint256 next = _nodes[_votingNumber][price].next;

        if (prev == 0) {
            if (head == tail) {
                tail = 0;
            }

            _popFront();

            return;
        }

        if (next == 0) {
            if (head == tail) {
                tail = 0;
            }

            _popBack();

            return;
        }

        _erase(price);
    }

    function _increaseNodeValueBy(uint256 price, uint256 value) internal {
        uint256 power = getPowerByPrice(price);

        if (power == 0) {
            revert UpdatingNonExistingNode(price);
        }

        _nodes[_votingNumber][price].power = power + value;
    }

    function _decreaseNodeValueBy(uint256 price, uint256 value) internal {
        uint256 power = getPowerByPrice(price);

        if (power == 0) {
            revert UpdatingNonExistingNode(price);
        }

        if (power < value) {
            revert DecreasingNodeValueByTooMuch(price, power);
        }

        _nodes[_votingNumber][price].power = power - value;
    }

    function _decreaseVoterPricePowerBy(address owner, uint256 amount) internal {
        uint256 votedPrice = getPriceByVoter(owner);

        _decreaseNodeValueBy(votedPrice, amount);
    }

    function _increaseVoterPricePowerBy(address owner, uint256 amount) internal {
        uint256 votedPrice = getPriceByVoter(owner);

        _increaseNodeValueBy(votedPrice, amount);
    }

    function clearVoterPrice(address owner) public {
        _voterToPrice[_votingNumber][owner] = 0;
    }

    function _setVoterToPrice(address voter, uint256 price) internal {
        _voterToPrice[_votingNumber][voter] = price;
    }

    function _pushFront(uint256 price, uint256 power) internal {
        if (_nodes[_votingNumber][price].power != 0) {
            revert PushingExistingNode(price);
        }

        uint256 nextNode = head;

        _nodes[_votingNumber][price] = Node({prev: 0, next: nextNode, power: power, price: price});

        if (nextNode != 0) {
            _nodes[_votingNumber][nextNode].prev = price;
        }

        head = price;
    }

    function _pushBack(uint256 price, uint256 power) internal {
        if (_nodes[_votingNumber][price].power != 0) {
            revert PushingExistingNode(price);
        }

        uint256 prevNode = tail;

        _nodes[_votingNumber][price] = Node({prev: prevNode, next: 0, power: power, price: price});

        if (prevNode != 0) {
            _nodes[_votingNumber][prevNode].next = price;
        }

        tail = price;
    }

    function _insert(uint256 price, uint256 power, uint256 prev, uint256 next) internal {
        if (_nodes[_votingNumber][price].power != 0) {
            revert PushingExistingNode(price);
        }

        _nodes[_votingNumber][price] = Node({prev: prev, next: next, power: power, price: price});

        _nodes[_votingNumber][next].prev = price;
        _nodes[_votingNumber][prev].next = price;
    }

    function _popBack() internal {
        if (_nodes[_votingNumber][tail].power == 0) {
            return;
        }

        uint256 nodePrice = tail;
        uint256 prevNode = _nodes[_votingNumber][nodePrice].prev;

        tail = prevNode;
        _nodes[_votingNumber][prevNode].next = 0;

        delete _nodes[_votingNumber][nodePrice];
    }

    function _popFront() internal {
        uint256 nodePrice = head;
        uint256 nextNode = _nodes[_votingNumber][nodePrice].next;

        head = nextNode;
        _nodes[_votingNumber][nextNode].prev = 0;

        delete _nodes[_votingNumber][nodePrice];
    }

    function _erase(uint256 price) internal {
        uint256 nodePrice = price;
        uint256 nextNode = _nodes[_votingNumber][nodePrice].next;
        uint256 prevNode = _nodes[_votingNumber][nodePrice].prev;

        _nodes[_votingNumber][nextNode].prev = prevNode;
        _nodes[_votingNumber][prevNode].next = nextNode;

        delete _nodes[_votingNumber][nodePrice];
    }
}
