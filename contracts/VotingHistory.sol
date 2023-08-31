// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

contract VotingHistory {
    struct VotingPeriod {
        uint256 startTime;
        uint256 endTime;
        uint256 topPrice;
        uint256 votingId;
    }

    uint256 internal _votingNumber = 0;
    VotingPeriod[] internal _votingHistory;

    error VotingIdError(uint256 received, uint256 maxId, uint256 minId);

    modifier validVotingId(uint256 votingId) {
        if (votingId > _votingNumber || votingId <= 0) {
            revert VotingIdError({
                received: votingId,
                maxId: _votingNumber,
                minId: 1
            });
        }

        _;
    }

    function getTokenPriceByVotingId(
        uint256 votingId
    ) external view validVotingId(votingId) returns (uint256) {
        return _votingHistory[votingId - 1].topPrice;
    }

    function getVotingHistory() external view returns (VotingPeriod[] memory) {
        return _votingHistory;
    }

    function getVotingHistorySliceById(
        uint256 votingId
    ) external view validVotingId(votingId) returns (VotingPeriod memory) {
        return _votingHistory[votingId - 1];
    }
}
