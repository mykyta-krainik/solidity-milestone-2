// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

contract LinkedList {
    error PushingZeroPrice();
    error PushingExistingNode(uint256 price);
    error UpdatingNonExistingNode(uint256 price);
    error RemovingNonExistingNode(uint256 price);
    error DecreasingNodeValueByTooMuch(uint256 price, uint256 value);

    event NodeAction(uint256 price);

    struct Node {
        // index (price) pointer to the previous node
        uint256 prev;
        // index (price) pointer to the next node
        uint256 next;
        // value (power) of the node
        uint256 value;
    }

    // votingId => price => node
    mapping(uint256 => mapping(uint256 => Node)) private _nodes;
    mapping(uint256 => mapping(address => uint256)) private _voterToPrice;

    // top price
    uint256 public head = 0;
    uint256 public tail = 0;

    function getNodeByPrice(uint256 votingId, uint256 price) external view returns (Node memory) {
        return _nodes[votingId][price];
    }

    function getPowerByPrice(uint256 votingId, uint256 price) public view returns (uint256) {
        return _nodes[votingId][price].value;
    }

    function getTopPrice() external view returns (uint256) {
        return head;
    }

    function getPriceByVoter(uint256 votingId, address owner) public view returns (uint256) {
        return _voterToPrice[votingId][owner];
    }

    function push(uint256 votingId, uint256 price, uint256 value, uint256 prev) public {
        if (price == 0) {
            revert PushingZeroPrice();
        }

        uint256 next = _nodes[votingId][prev].next;

        if (prev == 0 && next == 0) {
            tail = price;
        }

        if (prev == 0) {
            _pushFront(votingId, price, value);

            return;
        }

        if (next == 0) {
            _pushBack(votingId, price, value);

            return;
        }

        _nodes[votingId][price] = Node({prev: prev, next: _nodes[votingId][prev].next, value: value});
        _nodes[votingId][_nodes[votingId][prev].next].prev = price;
        _nodes[votingId][prev].next = price;
    }

    function remove(uint256 votingId, uint256 price) external {
        if (_nodes[votingId][price].value == 0) {
            revert RemovingNonExistingNode(price);
        }

        uint256 prev = _nodes[votingId][price].prev;
        uint256 next = _nodes[votingId][price].next;

        if (prev == 0) {
            _popFront(votingId);

            return;
        }

        if (next == 0) {
            _popBack(votingId);

            return;
        }

        _erase(votingId, price);
    }

    function increaseNodeValueBy(uint256 votingId, uint256 price, uint256 value) public {
        uint256 power = getPowerByPrice(votingId, price);

        if (power == 0) {
            revert UpdatingNonExistingNode(price);
        }

        _nodes[votingId][price].value = power + value;
    }

    function decreaseNodeValueBy(uint256 votingId, uint256 price, uint256 value) public {
        uint256 power = getPowerByPrice(votingId, price);

        if (power == 0) {
            revert UpdatingNonExistingNode(price);
        }

        if (power < value) {
            revert DecreasingNodeValueByTooMuch(price, value);
        }

        _nodes[votingId][price].value = power - value;
    }

    function clearVoterPrice(uint256 votingId, address owner) public {
        _voterToPrice[votingId][owner] = 0;
    }

    function _setVoterToPrice(uint256 votingId, address voter, uint256 price) internal {
        _voterToPrice[votingId][voter] = price;
    }

    function _pushFront(uint256 votingId, uint256 price, uint256 value) internal {
        if (_nodes[votingId][price].value != 0) {
            revert PushingExistingNode(price);
        }

        uint256 nextNode = head;

        _nodes[votingId][price] = Node({prev: 0, next: nextNode, value: value});

        _nodes[votingId][nextNode].prev = price;
        head = price;
    }

    function _pushBack(uint256 votingId, uint256 price, uint256 value) internal {
        if (_nodes[votingId][price].value != 0) {
            revert PushingExistingNode(price);
        }

        uint256 prevNode = tail;

        _nodes[votingId][price] = Node({prev: prevNode, next: 0, value: value});

        _nodes[votingId][prevNode].next = price;
        tail = price;
    }

    function _popBack(uint256 votingId) internal {
        if (_nodes[votingId][tail].value == 0) {
            return;
        }

        uint256 nodePrice = tail;
        uint256 prevNode = _nodes[votingId][nodePrice].prev;

        tail = prevNode;
        _nodes[votingId][prevNode].next = 0;

        delete _nodes[votingId][nodePrice];
    }

    function _popFront(uint256 votingId) internal {
        if (_nodes[votingId][head].value == 0) {
            return;
        }

        uint256 nodePrice = head;
        uint256 nextNode = _nodes[votingId][nodePrice].next;

        head = nextNode;
        _nodes[votingId][nextNode].prev = 0;

        delete _nodes[votingId][nodePrice];
    }

    function _erase(uint256 votingId, uint256 price) internal {
        if (_nodes[votingId][price].value == 0) {
            return;
        }

        uint256 nodePrice = price;
        uint256 nextNode = _nodes[votingId][nodePrice].next;
        uint256 prevNode = _nodes[votingId][nodePrice].prev;

        _nodes[votingId][nextNode].prev = prevNode;
        _nodes[votingId][prevNode].next = nextNode;

        delete _nodes[votingId][nodePrice];
    }
}
