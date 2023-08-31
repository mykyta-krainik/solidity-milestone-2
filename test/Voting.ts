import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Voting', () => {
  async function deployTokenFixture() {
    const [owner, acc2] = await ethers.getSigners();
    const tokenPrice = 1_000_000_000; // 1 token = 1 gwei
    const timeToVote = 60 * 60 * 24 * 3;
    const buyFeePercentage = 500;
    const sellFeePercentage = 500;

    const Voting = await ethers.getContractFactory('Voting');
    const votingToken = await Voting.deploy(
      tokenPrice,
      timeToVote,
      buyFeePercentage,
      sellFeePercentage
    );

    return {
      votingToken,
      owner,
      acc2,
      tokenPrice,
      timeToVote,
      buyFeePercentage,
      sellFeePercentage,
    };
  }

  describe('Deployment', () => {
    it('Should set the right tokenPrice', async function () {
      const { votingToken, tokenPrice } = await loadFixture(deployTokenFixture);

      expect(await votingToken.tokenPrice()).to.equal(tokenPrice);
    });
  });

  describe('Voting', () => {
    it('Should emit the VotingStarted event with the right params', async function () {
      const { votingToken } = await loadFixture(deployTokenFixture);

      await expect(votingToken.startVoting())
        .to.emit(votingToken, 'VotingStarted')
        .withArgs(1, (await time.latest()) + 1);
    });

    it('Should emit the VotingEnded event with the right params', async function () {
      const { votingToken, timeToVote } = await loadFixture(deployTokenFixture);

      await votingToken.startVoting();
      await time.increase(timeToVote);
      await expect(votingToken.endVoting())
        .to.emit(votingToken, 'VotingEnded')
        .withArgs(1, (await time.latest()) + 1);
    });

    it('Should have the right token amount after buying', async function () {
      const { votingToken } = await loadFixture(deployTokenFixture);

      await votingToken.startVoting();
      await votingToken.buy(2, { value: ethers.parseEther('1') });
      await expect(await votingToken.totalSupply()).to.be.equal(2);
    });

    it('Should have the right token amount after selling', async function () {
      const { votingToken } = await loadFixture(deployTokenFixture);

      await votingToken.startVoting();
      await votingToken.buy(2, { value: ethers.parseEther('1') });
      await votingToken.sell(1);
      await expect(await votingToken.totalSupply()).to.be.equal(1);
    });
  });

  describe('Linked list', () => {
    it('Should have the right head after buying', async function () {
      const { votingToken } = await loadFixture(deployTokenFixture);

      await votingToken.startVoting();
      await votingToken.buy(2, { value: ethers.parseEther('1') });
      expect(await votingToken.vote(4))
        .to.emit(votingToken, 'NodeAction')
        .withArgs(4);
    });
  });
});
