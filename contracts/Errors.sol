// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

contract Errors {
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
}