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
        uint256 voteId;
    }

    struct Price {
        uint256 price;
        uint256 voteId;
    }

    struct Voted {
        bool voted;
        uint256 voteId;
    }

    // price => node
    mapping(uint256 => Node) private _nodes;
    // voter => price
    mapping(address => Price) private _voterToPrice;
    // price => isVoted
    uint256 internal _votingNumber;

    // price with the highest power
    uint256 public head = 0;
    // price with the lowest power
    uint256 public tail = 0;

    modifier isIndexValid(uint256 index) {
        bool isPriceExist = isPriceExists(index);

        if (index != 0 && !isPriceExist) {
            revert NodeIndexIsNotValidError(index);
        }

        _;
    }

    function getNodeByPrice(uint256 price) public view returns (Node memory) {
        Node memory node = _nodes[price];

        if (node.voteId == _votingNumber) {
            return node;
        }

        return Node(0, 0, 0, 0, 0);
    }

    function getPowerByPrice(uint256 price) public view returns (uint256) {
        return getNodeByPrice(price).power;
    }

    function getTopPrice() external view returns (uint256) {
        return head;
    }

    function getPrevNode(uint256 price) public view returns (Node memory) {
        Node memory priceNode = getNodeByPrice(price);

        return getNodeByPrice(priceNode.prev);
    }

    function getNextNode(uint256 price) public view returns (Node memory) {
        Node memory priceNode = getNodeByPrice(price);

        return getNodeByPrice(priceNode.next);
    }

    function _isNodeInValidPosition(uint256 price, uint256 power, uint256 prev) internal view returns (bool) {
        uint256 prevNodePower = getPowerByPrice(prev);
        Node memory nextNode;

        if (prev == 0) {
            nextNode = getNodeByPrice(head);

            if (price == nextNode.price) {
                nextNode = getNodeByPrice(nextNode.next);
            }
        } else {
            nextNode = getNextNode(prev);
        }

        uint256 nextNodeNextNodePower = nextNode.power;

        if (price == nextNode.price) {
            nextNodeNextNodePower = getPowerByPrice(nextNode.next);
        }

        if (
            (prev == 0 && power >= nextNodeNextNodePower) || (prevNodePower >= power && power >= nextNodeNextNodePower)
        ) {
            return true;
        }

        return false;
    }

    function getPriceByVoter(address voter) public view returns (uint256) {
        Price memory priceInfo = _voterToPrice[voter];

        if (priceInfo.voteId == _votingNumber) {
            return priceInfo.price;
        }

        return 0;
    }

    function isVoterVoted() external view returns (bool) {
        return getPriceByVoter(msg.sender) != 0;
    }

    function isPriceExists(uint256 price) public view returns (bool) {
        return getNodeByPrice(price).price != 0;
    }

    function _setVoterToPrice(address voter, uint256 price) internal {
        _voterToPrice[voter].price = price;
        _voterToPrice[voter].voteId = _votingNumber;
    }

    function _clearVoterPrice(address voter) internal {
        delete _voterToPrice[voter];
    }

    function push(uint256 price, uint256 power, uint256 prev) public isIndexValid(prev) {
        if (price <= 0) {
            revert PushingNonValidPrice();
        }

        if (isPriceExists(price)) {
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

        uint256 next = getNodeByPrice(prev).next;

        _insert(price, power, prev, next);
    }

    function remove(uint256 price) public {
        if (price <= 0) {
            revert RemovingNonExistingNode(price);
        }

        if (!isPriceExists(price)) {
            revert RemovingNonExistingNode(price);
        }

        Node memory node = getNodeByPrice(price);
        uint256 prev = node.prev;
        uint256 next = node.next;

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

    function _pushFront(uint256 price, uint256 power) private {
        uint256 nextNode = head;

        _nodes[price].prev = 0;
        _nodes[price].next = nextNode;
        _nodes[price].power = power;
        _nodes[price].price = price;
        _nodes[price].voteId = _votingNumber;

        if (nextNode != 0) {
            _nodes[nextNode].prev = price;
        }

        head = price;
    }

    function _pushBack(uint256 price, uint256 power) private {
        uint256 prevNode = tail;

        _nodes[price].prev = prevNode;
        _nodes[price].next = 0;
        _nodes[price].power = power;
        _nodes[price].price = price;
        _nodes[price].voteId = _votingNumber;

        if (prevNode != 0) {
            _nodes[prevNode].next = price;
        }

        tail = price;
    }

    function _insert(uint256 price, uint256 power, uint256 prev, uint256 next) private {
        _nodes[price].prev = prev;
        _nodes[price].next = next;
        _nodes[price].power = power;
        _nodes[price].price = price;
        _nodes[price].voteId = _votingNumber;

        _nodes[next].prev = price;
        _nodes[prev].next = price;
    }

    function _popBack() private {
        if (_nodes[tail].power == 0) {
            return;
        }

        uint256 nodePrice = tail;
        uint256 prevNode = getNodeByPrice(nodePrice).prev;

        tail = prevNode;
        _nodes[prevNode].next = 0;

        delete _nodes[nodePrice];
    }

    function _popFront() private {
        uint256 nodePrice = head;
        uint256 nextNode = getNodeByPrice(nodePrice).next;

        head = nextNode;
        _nodes[nextNode].prev = 0;

        delete _nodes[nodePrice];
    }

    function _erase(uint256 price) private {
        uint256 nodePrice = price;
        uint256 nextNode = getNodeByPrice(nodePrice).next;
        uint256 prevNode = _nodes[nodePrice].prev;

        _nodes[nextNode].prev = prevNode;
        _nodes[prevNode].next = nextNode;

        delete _nodes[nodePrice];
    }
}
