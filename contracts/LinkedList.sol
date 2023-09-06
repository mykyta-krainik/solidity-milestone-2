// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

contract LinkedList {
    error PushingNonValidPrice();
    error UpdatingNonExistingNode(uint256 price);
    error RemovingNonExistingNode(uint256 price);

    error VotingForTheSamePriceError(uint256 price);

    error NodeIndexIsNotValidError(uint256 index);

    struct Node {
        // index (price) pointer to the previous node
        uint256 prev;
        // index (price) pointer to the next node
        uint256 next;
        uint256 power;
        uint256 price;
    }
    // TODO: rewrite to use array
    // price => node
    mapping(uint256 => Node) private _nodes;
    // voter => price
    mapping(address => uint256) private _voterToPrice;
    // price => isVoted
    mapping(uint256 => bool) private _priceToIsVoted;

    // price with the highest power
    uint256 public head = 0;
    // price with the lowest power
    uint256 public tail = 0;

    uint256 internal _votingNumber = 0;

    modifier isIndexValid(uint256 index) {
        if (index < 0) {
            revert NodeIndexIsNotValidError(index);
        }

        bool isPriceExist = isPriceExists(index);

        if (index != 0 && !isPriceExist) {
            revert NodeIndexIsNotValidError(index);
        }

        _;
    }

    function getNodeByPrice(uint256 price) public view returns (Node memory) {
        return _nodes[price];
    }

    function getPowerByPrice(uint256 price) public view returns (uint256) {
        return _nodes[price].power;
    }

    function getTopPrice() external view returns (uint256) {
        return head;
    }

    function getPrevNode(uint256 price) public view returns (Node memory) {
        uint256 prevNodePrice = _nodes[price].prev;

        return getNodeByPrice(prevNodePrice);
    }

    function getNextNode(uint256 price) public view returns (Node memory) {
        uint256 nextNodePrice = _nodes[price].next;

        return getNodeByPrice(nextNodePrice);
    }

    function _isNodeInValidPosition(uint256 power, uint256 prev) internal view returns (bool) {
        uint256 prevNodePower = getPowerByPrice(prev);
        uint256 nextNodePower = getNextNode(prev).power;

        if (prev == 0 && power >= nextNodePower) {
            return true;
        }

        if (prevNodePower >= power && power >= nextNodePower) {
            return true;
        }

        return false;
    }

    function getPriceByVoter(address owner) public view returns (uint256) {
        return _voterToPrice[owner];
    }

    function isVoterVoted() external view returns (bool) {
        return getPriceByVoter(msg.sender) != 0;
    }

    function isPriceExists(uint256 price) public view returns (bool) {
        return _priceToIsVoted[price];
    }

    function _setPriceToVoted(uint256 price) internal {
        _priceToIsVoted[price] = true;
    }

    function _setVoterToPrice(address voter, uint256 price) internal {
        _voterToPrice[voter] = price;
    }

    function _clearVoterPrice(address owner) internal {
        _voterToPrice[owner] = 0;
    }

    function _push(uint256 price, uint256 power, uint256 prev) internal {
        if (price <= 0) {
            revert PushingNonValidPrice();
        }

        if (isPriceExists(price)) {
            _remove(price);
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

        uint256 next = _nodes[prev].next;

        _insert(price, power, prev, next);
    }

    function _remove(uint256 price) internal {
        if (price <= 0) {
            revert RemovingNonExistingNode(price);
        }

        uint256 prev = _nodes[price].prev;
        uint256 next = _nodes[price].next;

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

    function _pushFront(uint256 price, uint256 power) internal {
        uint256 nextNode = head;

        _nodes[price].prev = 0;
        _nodes[price].next = nextNode;
        _nodes[price].power = power;
        _nodes[price].price = price;

        if (nextNode != 0) {
            _nodes[nextNode].prev = price;
        }

        head = price;
    }

    function _pushBack(uint256 price, uint256 power) internal {
        uint256 prevNode = tail;

        _nodes[price].prev = prevNode;
        _nodes[price].next = 0;
        _nodes[price].power = power;
        _nodes[price].price = price;

        if (prevNode != 0) {
            _nodes[prevNode].next = price;
        }

        tail = price;
    }

    function _insert(uint256 price, uint256 power, uint256 prev, uint256 next) internal {
        _nodes[price].prev = prev;
        _nodes[price].next = next;
        _nodes[price].power = power;
        _nodes[price].price = price;

        _nodes[next].prev = price;
        _nodes[prev].next = price;
    }

    function _popBack() internal {
        if (_nodes[tail].power == 0) {
            return;
        }

        uint256 nodePrice = tail;
        uint256 prevNode = _nodes[nodePrice].prev;

        tail = prevNode;
        _nodes[prevNode].next = 0;

        delete _nodes[nodePrice];
    }

    function _popFront() internal {
        uint256 nodePrice = head;
        uint256 nextNode = _nodes[nodePrice].next;

        head = nextNode;
        _nodes[nextNode].prev = 0;

        delete _nodes[nodePrice];
    }

    function _erase(uint256 price) internal {
        uint256 nodePrice = price;
        uint256 nextNode = _nodes[nodePrice].next;
        uint256 prevNode = _nodes[nodePrice].prev;

        _nodes[nextNode].prev = prevNode;
        _nodes[prevNode].next = nextNode;

        delete _nodes[nodePrice];
    }
}
