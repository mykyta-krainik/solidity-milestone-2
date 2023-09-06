import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { LinkedList } from '../typechain-types';

describe('Voting', () => {
  async function deployTokenFixture() {
    const [owner, acc1, acc2, acc3] = await ethers.getSigners();
    const tokenPrice = 1_000_000_000n; // 1 token = 1 gwei
    const timeToVote = 60 * 60 * 24 * 3;
    const tokenNumToBuy = 10000;
    const minTokenAmount = tokenNumToBuy * 0.05;
    const buyFeePercentage = 5;
    const sellFeePercentage = 5;
    const decimals = 2;

    const Voting = await ethers.getContractFactory('Voting');
    const votingToken = await Voting.deploy(
      tokenPrice,
      timeToVote,
      buyFeePercentage,
      sellFeePercentage,
      decimals
    );

    const getLinkedList = async () => {
      const linkedList = new Map<
        bigint | string,
        LinkedList.NodeStructOutput
      >();
      let currentNode = await votingToken.getNodeByPrice(
        await votingToken.head()
      );

      linkedList.set('head', currentNode);

      while (currentNode.power !== 0n) {
        linkedList.set(currentNode.price, currentNode);
        currentNode = await votingToken.getNodeByPrice(currentNode.next);
      }

      return linkedList;
    };

    type LinkedListMap = Awaited<ReturnType<typeof getLinkedList>>;

    const determineNodePosition = async (
      linkedList: LinkedListMap,
      currentPower: bigint
    ) => {
      let prevNode: bigint = 0n;

      for (const [_, node] of linkedList) {
        const prevPower =
          node.prev === 0n ? 0n : linkedList.get(node.prev)!.power;

        if (prevPower === 0n && currentPower >= node.power) {
          prevNode = 0n;
        }

        if (currentPower < prevPower && currentPower >= node.power) {
          prevNode = node.prev;
        }

        const nextPower =
          node.next === 0n ? 0n : linkedList.get(node.next)!.power;

        if (nextPower === 0n && currentPower < node.power) {
          prevNode = node.price;
        }
      }

      return prevNode;
    };

    const push = (
      linkedList: LinkedListMap,
      price: bigint,
      power: bigint,
      prev: bigint
    ) => {
      if (prev === 0n) {
        const head = linkedList.get('head')!;
        const newNode: LinkedList.NodeStructOutput = Object.assign(
          [prev, head.price, power, price],
          { prev, next: head.price, power, price }
        ) as LinkedList.NodeStructOutput;

        linkedList.set(price, newNode);

        head.prev = price;

        return;
      }

      const nextNode = linkedList.get(prev)!.next;
      const newNode: LinkedList.NodeStructOutput = Object.assign(
        [prev, nextNode, power, price],
        { prev, next: nextNode, power, price }
      ) as LinkedList.NodeStructOutput;

      linkedList.set(price, newNode);
    };

    const vote = async (price: bigint, voter: HardhatEthersSigner) => {
      const linkedList = await getLinkedList();
      const voterBalance = await votingToken.balanceOf(voter.address);
      const isVoterVoted = await votingToken.connect(voter).isVoterVoted();

      if (isVoterVoted) {
        const prevPrice = await votingToken.getPriceByVoter(voter.address);
        const prevPricePower = linkedList.get(prevPrice)?.power!;
        const newPrevPricePower = prevPricePower - voterBalance;
        const prevNodePosition = await determineNodePosition(
          linkedList,
          newPrevPricePower
        );

        push(linkedList, prevPrice, newPrevPricePower, prevNodePosition);

        const pricePrevPower = linkedList.get(price)?.power ?? 0n;
        const newPricePrevPower = pricePrevPower + voterBalance;
        const pricePosition = await determineNodePosition(
          linkedList,
          newPricePrevPower
        );
        const newPriceObj = {
          price,
          power: newPricePrevPower,
          prev: pricePosition,
        };
        const prevPriceObj = {
          price: prevPrice,
          power: newPrevPricePower,
          prev: prevNodePosition,
        };

        await votingToken
          .connect(voter)
          .voteWithSwap([newPriceObj, prevPriceObj]);

        return;
      }

      const currentPower = linkedList.get(price)?.power;
      const newPower = currentPower
        ? currentPower + voterBalance
        : voterBalance;
      const prevNodePosition = await determineNodePosition(
        linkedList,
        newPower
      );

      await votingToken.connect(voter).vote({
        price,
        power: newPower,
        prev: prevNodePosition,
      });
    };

    return {
      votingToken,
      owner,
      acc1,
      acc2,
      acc3,
      tokenPrice,
      tokenNumToBuy,
      minTokenAmount,
      timeToVote,
      buyFeePercentage,
      sellFeePercentage,
      getLinkedList,
      determineNodePosition,
      vote,
    };
  }

  describe('StartVoting', () => {
    it('Should change votingStartedTime, votingNumber and emit the VotingStarted event', async () => {
      const { votingToken } = await loadFixture(deployTokenFixture);
      const expectedVotingNumber = 1;
      const expectedStartedTime = (await time.latest()) + 1;

      expect(await votingToken.startVoting())
        .to.emit(votingToken, 'VotingStarted')
        .withArgs(expectedVotingNumber, expectedStartedTime);
    });

    it('Should start and emit the VotingStarted event only if the account has more than 0.05% of tokens', async () => {
      const { votingToken, tokenNumToBuy, owner, acc1 } = await loadFixture(
        deployTokenFixture
      );
      const tokenNumToTransfer = Math.floor(tokenNumToBuy / 10);
      const expectedVotingNumber = 1;
      const expectedStartedTime = (await time.latest()) + 1;

      await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

      expect(await votingToken.balanceOf(owner.address)).to.be.equal(
        tokenNumToBuy
      );

      await votingToken.transfer(acc1.address, tokenNumToTransfer);

      expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
        tokenNumToTransfer
      );

      expect(await votingToken.connect(acc1).startVoting())
        .to.emit(votingToken, 'VotingStarted')
        .withArgs(expectedVotingNumber, expectedStartedTime);
    });

    it('Should fail when the account has less than 0.05% of tokens', async () => {
      const { votingToken, tokenNumToBuy, minTokenAmount, owner, acc1 } =
        await loadFixture(deployTokenFixture);
      const tokenNumToTransfer = Math.floor(tokenNumToBuy * 0.04);

      console.log('minTokenAmount', minTokenAmount, tokenNumToTransfer);

      await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

      expect(await votingToken.balanceOf(owner.address)).to.be.equal(
        tokenNumToBuy
      );

      await votingToken.transfer(acc1.address, tokenNumToTransfer);

      expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
        tokenNumToTransfer
      );

      expect(
        await votingToken.connect(acc1).startVoting()
      ).to.be.revertedWithCustomError(votingToken, `BalanceIsNotEnoughError`);
    });
  });
});
