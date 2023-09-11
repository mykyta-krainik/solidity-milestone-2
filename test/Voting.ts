import {
  time,
  loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { LinkedList, Voting } from '../typechain-types';

describe('Voting', () => {
  async function deployTokenFixture() {
    const [owner, acc1, acc2, acc3] = await ethers.getSigners();
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const zeroAddressSigner = await ethers.getSigner(zeroAddress);
    const tokenPrice = 1_000_000_000n; // 1 token = 1 gwei
    const price = 1_000_000_000n;
    const day = 60 * 60 * 24;
    const week = day * 7;
    const timeToVote = day * 3;
    const withdrawPeriod = week;
    const tokenNumToBuy = 10000;
    const tokenNumToApprove = 2000;
    const minTokenAmount = tokenNumToBuy * 0.05;
    const buyFeePercentage = 5n;
    const sellFeePercentage = 5n;
    const decimals = 2n;

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

    const determineNodePosition = (
      linkedList: LinkedListMap,
      price: bigint,
      currentPower: bigint
    ) => {
      let prevNode: bigint = 0n;

      for (const [_, node] of linkedList) {
        if (price === node.price) {
          continue;
        }

        const prevPower =
          node.prev === 0n ? 0n : linkedList.get(node.prev)!.power;

        if (prevPower === 0n && currentPower >= node.power) {
          prevNode = 0n;

          break;
        }

        if (currentPower < prevPower && currentPower >= node.power) {
          prevNode = node.prev;

          break;
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
          [prev, head.price, power, price, head.voteId],
          { prev, next: head.price, power, price, voteId: head.voteId }
        ) as LinkedList.NodeStructOutput;

        linkedList.set(price, newNode);
        linkedList.set('head', newNode);

        const newHead = Object.assign(
          [price, head.next, head.power, head.price, head.voteId],
          {
            prev: price,
            next: head.next,
            power: head.power,
            price: head.price,
            voteId: head.voteId,
          }
        ) as LinkedList.NodeStructOutput;

        linkedList.set(newHead.price, newHead);

        return;
      }

      const nextNode = linkedList.get(prev)!;
      const newNode: LinkedList.NodeStructOutput = Object.assign(
        [prev, nextNode.next, power, price, nextNode.voteId],
        { prev, next: nextNode.next, power, price, voteId: nextNode.voteId }
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
        const prevNodePosition = determineNodePosition(
          linkedList,
          price,
          newPrevPricePower
        );

        push(linkedList, prevPrice, newPrevPricePower, prevNodePosition);

        const pricePrevPower = linkedList.get(price)?.power ?? 0n;
        const newPricePrevPower = pricePrevPower + voterBalance;
        const pricePosition = determineNodePosition(
          linkedList,
          price,
          newPricePrevPower
        );
        const newPriceObj: Voting.NodeChangeStruct = {
          price,
          power: newPricePrevPower,
          prev: pricePosition,
        };
        const prevPriceObj: Voting.NodeChangeStruct = {
          price: prevPrice,
          power: newPrevPricePower,
          prev: prevNodePosition,
        };

        await votingToken
          .connect(voter)
          .voteWithSwap(newPriceObj, prevPriceObj);

        return;
      }

      const currentPower = linkedList.get(price)?.power ?? 0n;
      const newPower = currentPower + voterBalance;
      const prevNodePosition = determineNodePosition(
        linkedList,
        price,
        newPower
      );

      await votingToken.connect(voter).vote({
        price,
        power: newPower,
        prev: prevNodePosition,
      });
    };

    const buyWithSwap = async (
      amount: bigint,
      buyer: HardhatEthersSigner,
      etherNum: number,
      units: string | number = 'ether'
    ) => {
      const linkedList = await getLinkedList();

      const price = await votingToken.getPriceByVoter(buyer.address);
      const pricePrevPower = linkedList.get(price)?.power ?? 0n;
      const priceNewPower = pricePrevPower + amount;
      const nodePosition = determineNodePosition(
        linkedList,
        price,
        priceNewPower
      );

      await votingToken.connect(buyer).buyWithSwap(amount, nodePosition, {
        value: ethers.parseUnits(etherNum.toString(), units),
      });
    };

    const sellWithSwap = async (
      amount: bigint,
      seller: HardhatEthersSigner
    ) => {
      const linkedList = await getLinkedList();
      const price = await votingToken.getPriceByVoter(seller.address);
      const pricePrevPower = linkedList.get(price)?.power ?? 0n;
      const priceNewPower = pricePrevPower - amount;
      const nodePosition = determineNodePosition(
        linkedList,
        price,
        priceNewPower
      );

      await votingToken.connect(seller).sellWithSwap(amount, nodePosition);
    };

    const transferWithSingleSwap = async (
      from: HardhatEthersSigner,
      to: HardhatEthersSigner,
      amount: bigint
    ) => {
      let priceVoter: HardhatEthersSigner;

      if (await votingToken.connect(from).isVoterVoted()) {
        priceVoter = from;
      } else {
        priceVoter = to;
      }

      const linkedList = await getLinkedList();
      const price = await votingToken.getPriceByVoter(priceVoter!.address);
      const pricePrevPower = linkedList.get(price)?.power ?? 0n;
      const priceNewPower =
        pricePrevPower && pricePrevPower >= amount
          ? pricePrevPower - amount
          : 0n;
      const nodePosition = determineNodePosition(
        linkedList,
        price,
        priceNewPower
      );
      const newNode: Voting.NodeChangeStruct = {
        price,
        power: priceNewPower,
        prev: nodePosition,
      };

      await votingToken
        .connect(from)
        .transferWithSingleSwap(to.address, amount, newNode);
    };

    const transferWithDoubleSwap = async (
      from: HardhatEthersSigner,
      to: HardhatEthersSigner,
      amount: bigint
    ) => {
      const linkedList = await getLinkedList();

      const fromPrice = await votingToken.getPriceByVoter(from.address);
      const fromPricePrevPower = linkedList.get(price)?.power ?? 0n;
      const fromPriceNewPower =
        fromPricePrevPower >= amount ? fromPricePrevPower - amount : 0n;
      const fromPriceNodePosition = determineNodePosition(
        linkedList,
        fromPrice,
        fromPriceNewPower
      );
      const fromPriceNode: Voting.NodeChangeStruct = {
        price,
        power: fromPriceNewPower,
        prev: fromPriceNodePosition,
      };

      push(linkedList, fromPrice, fromPriceNewPower, fromPriceNodePosition);

      const toPrice = await votingToken.getPriceByVoter(to.address);
      const toPricePrevPower = linkedList.get(toPrice)?.power ?? 0n;
      const toPriceNewPower = toPricePrevPower + amount;
      const toPriceNodePosition = determineNodePosition(
        linkedList,
        toPrice,
        toPriceNewPower
      );
      const toPriceNode: Voting.NodeChangeStruct = {
        price: toPrice,
        power: toPriceNewPower,
        prev: toPriceNodePosition,
      };

      if (fromPriceNodePosition === toPriceNodePosition) {
        if (fromPriceNewPower >= toPriceNewPower) {
          toPriceNode.prev = fromPrice;
        } else {
          fromPriceNode.prev = toPrice;
        }
      }

      await votingToken
        .connect(from)
        .transferWithDoubleSwap(to.address, amount, fromPriceNode, toPriceNode);
    };

    const transferFromWithSingleSwap = async (
      spender: HardhatEthersSigner,
      owner: HardhatEthersSigner,
      to: HardhatEthersSigner,
      amount: bigint
    ) => {
      let priceVoter: HardhatEthersSigner;

      if (await votingToken.connect(owner).isVoterVoted()) {
        priceVoter = owner;
      } else {
        priceVoter = to;
      }

      const linkedList = await getLinkedList();
      const price = await votingToken.getPriceByVoter(priceVoter!.address);
      const pricePrevPower = linkedList.get(price)?.power ?? 0n;
      const priceNewPower =
        priceVoter === to ? pricePrevPower + amount : pricePrevPower - amount;
      const nodePosition = determineNodePosition(
        linkedList,
        price,
        priceNewPower
      );
      const newNode: Voting.NodeChangeStruct = {
        price,
        power: priceNewPower,
        prev: nodePosition,
      };

      await votingToken
        .connect(spender)
        .transferFromWithSingleSwap(owner.address, to.address, amount, newNode);
    };

    const transferFromWithDoubleSwap = async (
      sender: HardhatEthersSigner,
      from: HardhatEthersSigner,
      to: HardhatEthersSigner,
      amount: bigint
    ) => {
      const linkedList = await getLinkedList();

      const fromPrice = await votingToken.getPriceByVoter(from.address);
      const fromPricePrevPower = linkedList.get(price)?.power ?? 0n;
      const fromPriceNewPower =
        fromPricePrevPower >= amount ? fromPricePrevPower - amount : 0n;
      const fromPriceNodePosition = determineNodePosition(
        linkedList,
        fromPrice,
        fromPriceNewPower
      );
      const fromPriceNode: Voting.NodeChangeStruct = {
        price,
        power: fromPriceNewPower,
        prev: fromPriceNodePosition,
      };

      push(linkedList, fromPrice, fromPriceNewPower, fromPriceNodePosition);

      const toPrice = await votingToken.getPriceByVoter(to.address);
      const toPricePrevPower = linkedList.get(toPrice)?.power ?? 0n;
      const toPriceNewPower = toPricePrevPower + amount;
      const toPriceNodePosition = determineNodePosition(
        linkedList,
        toPrice,
        toPriceNewPower
      );
      const toPriceNode: Voting.NodeChangeStruct = {
        price: toPrice,
        power: toPriceNewPower,
        prev: toPriceNodePosition,
      };

      if (fromPriceNodePosition === toPriceNodePosition) {
        if (fromPriceNewPower >= toPriceNewPower) {
          toPriceNode.prev = fromPrice;
        } else {
          fromPriceNode.prev = toPrice;
        }
      }

      await votingToken
        .connect(sender)
        .transferFromWithDoubleSwap(
          owner.address,
          to.address,
          amount,
          fromPriceNode,
          toPriceNode
        );
    };

    const getPercentage = (amount: bigint, percentage: bigint) => {
      return (
        (amount * 10n ** decimals * percentage) /
        (100n * 10n ** BigInt(decimals))
      );
    };

    return {
      votingToken,
      owner,
      acc1,
      acc2,
      acc3,
      zeroAddressSigner,
      zeroAddress,
      tokenPrice,
      price,
      decimals,
      tokenNumToBuy,
      tokenNumToApprove,
      minTokenAmount,
      timeToVote,
      day,
      week,
      withdrawPeriod,
      buyFeePercentage,
      sellFeePercentage,
      getLinkedList,
      determineNodePosition,
      vote,
      buyWithSwap,
      sellWithSwap,
      transferWithSingleSwap,
      transferWithDoubleSwap,
      transferFromWithSingleSwap,
      transferFromWithDoubleSwap,
      getPercentage,
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
      const { votingToken, tokenNumToBuy, owner, acc1 } = await loadFixture(
        deployTokenFixture
      );
      const tokenNumToTransfer = Math.floor(tokenNumToBuy * 0.04);

      await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

      expect(await votingToken.balanceOf(owner.address)).to.be.equal(
        tokenNumToBuy
      );

      await votingToken.transfer(acc1.address, tokenNumToTransfer);

      expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
        tokenNumToTransfer
      );

      await expect(
        votingToken.connect(acc1).startVoting()
      ).to.be.revertedWithCustomError(votingToken, `BalanceIsNotEnoughError`);
    });

    it('Should be able to start the new voting immediately after the previous voting is ended', async () => {
      const { votingToken, timeToVote } = await loadFixture(deployTokenFixture);
      const expectedVotingNumber = 1;
      const expectedStartedTime = (await time.latest()) + 1;

      await votingToken.startVoting();

      await time.increase(timeToVote);

      await votingToken.endVoting();

      expect(await votingToken.startVoting())
        .to.emit(votingToken, 'VotingStarted')
        .withArgs(expectedVotingNumber, expectedStartedTime);
    });
  });

  describe('EndVoting', () => {
    it('Should work if the voting is started, the timeToVote time is elapsed and emit the VotingEnded event', async () => {
      const { votingToken, timeToVote } = await loadFixture(deployTokenFixture);
      const expectedVotingNumber = 1;
      const expectedEndTime = (await time.latest()) + 1;

      await votingToken.startVoting();

      await time.increase(timeToVote);

      expect(await votingToken.endVoting())
        .to.emit(votingToken, 'VotingEnded')
        .withArgs(expectedVotingNumber, expectedEndTime);
    });

    it('Should fail if the voting is not started', async () => {
      const { votingToken } = await loadFixture(deployTokenFixture);

      await expect(votingToken.endVoting()).to.be.revertedWithCustomError(
        votingToken,
        `VotingIsNotStartedError`
      );
    });

    it('Should fail if the voting is started but the timeToVote time is not elapsed', async () => {
      const { votingToken } = await loadFixture(deployTokenFixture);

      await votingToken.startVoting();

      await expect(votingToken.endVoting()).to.be.revertedWithCustomError(
        votingToken,
        `TimeToVoteIsNotExpiredError`
      );
    });

    it('Should fail if the voting is started, the timeToVote time is partly elapsed', async () => {
      const { votingToken, timeToVote } = await loadFixture(deployTokenFixture);

      await votingToken.startVoting();

      await time.increase(timeToVote / 2);

      await expect(votingToken.endVoting()).to.be.revertedWithCustomError(
        votingToken,
        `TimeToVoteIsNotExpiredError`
      );
    });

    it('Should fail if the voting is already stoped', async () => {
      const { votingToken, timeToVote } = await loadFixture(deployTokenFixture);

      await votingToken.startVoting();

      await time.increase(timeToVote);

      await votingToken.endVoting();

      await expect(votingToken.endVoting()).to.be.revertedWithCustomError(
        votingToken,
        `VotingIsNotStartedError`
      );
    });

    it('Should success if the time elapsed is greater than the timeToVote time', async () => {
      const { votingToken, timeToVote } = await loadFixture(deployTokenFixture);
      const expectedVotingNumber = 1;
      const expectedEndTime = (await time.latest()) + 1;

      await votingToken.startVoting();

      await time.increase(timeToVote * 2);

      expect(await votingToken.endVoting())
        .to.emit(votingToken, 'VotingEnded')
        .withArgs(expectedVotingNumber, expectedEndTime);
    });

    it('Could be stopped by anyone if the voting has been started and the timeToVote time is elapsed', async () => {
      const { votingToken, tokenNumToBuy, timeToVote, owner, acc1 } =
        await loadFixture(deployTokenFixture);
      const expectedVotingNumber = 1;
      const expectedEndTime = (await time.latest()) + 1;
      const tokenNumToTransfer = Math.floor((tokenNumToBuy * 0.01) / 100);

      await votingToken.buy(BigInt(tokenNumToBuy), {
        value: ethers.parseEther('1'),
      });

      expect(await votingToken.balanceOf(owner.address)).to.be.equal(
        tokenNumToBuy
      );

      await votingToken.transfer(acc1.address, BigInt(tokenNumToTransfer));

      expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
        tokenNumToTransfer
      );

      await votingToken.startVoting();

      await time.increase(timeToVote);

      expect(await votingToken.connect(acc1).endVoting())
        .to.emit(votingToken, 'VotingEnded')
        .withArgs(expectedVotingNumber, expectedEndTime);
    });
  });

  describe('Buying', () => {
    describe('Buy', () => {
      it('Should emit the Transfer event with the right params', async () => {
        const { votingToken, tokenNumToBuy, owner, zeroAddress } =
          await loadFixture(deployTokenFixture);
        const expectedTransferAmount = tokenNumToBuy;

        expect(
          await votingToken.buy(tokenNumToBuy, {
            value: ethers.parseEther('1'),
          })
        )
          .to.emit(votingToken, 'Transfer')
          .withArgs(zeroAddress, owner, expectedTransferAmount);
      });

      it('Should have the right amount of tokens after the buying', async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const expectedBalance = tokenNumToBuy;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedBalance
        );
      });

      it('Should change the totalSupply after buying new tokens', async () => {
        const { votingToken, tokenNumToBuy } = await loadFixture(
          deployTokenFixture
        );
        const expectedtotalSupply = tokenNumToBuy;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.totalSupply()).to.be.equal(
          expectedtotalSupply
        );
      });

      it('Should change the minTokenAmount after buying new tokens', async () => {
        const { votingToken, tokenNumToBuy, minTokenAmount } =
          await loadFixture(deployTokenFixture);
        const expectedMinTokenAmount = minTokenAmount;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.getMinTokenAmount()).to.be.equal(
          expectedMinTokenAmount
        );
      });

      it("Should pass if the user hasn't voted yet and try to buy tokens", async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const expectedBalance = tokenNumToBuy;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedBalance
        );
      });

      it('Should fail if the user has voted and try to buy more tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken.buy(tokenNumToBuy, {
            value: ethers.parseEther('1'),
          })
        ).to.be.revertedWithCustomError(
          votingToken,
          `CallingUnsuitableMethodError`
        );
      });

      it('Should fail if the user passes an incorrect amount of tokens', async () => {
        const { votingToken } = await loadFixture(deployTokenFixture);

        await expect(
          votingToken.buy(0, {
            value: ethers.parseEther('1'),
          })
        ).to.be.revertedWithCustomError(votingToken, `TokenAmountIsNotValid`);
      });

      it('Should fail if the user passed too little ether', async () => {
        const { votingToken, tokenNumToBuy } = await loadFixture(
          deployTokenFixture
        );

        await expect(
          votingToken.buy(tokenNumToBuy, {
            value: ethers.parseUnits('100', 'gwei'),
          })
        ).to.be.revertedWithCustomError(votingToken, `EtherError`);
      });
    });

    describe('BuyWithSwap', () => {
      it('Should emit the Transfer event with the right params', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          zeroAddress,
          vote,
          buyWithSwap,
        } = await loadFixture(deployTokenFixture);
        const expectedTransferAmount = tokenNumToBuy;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);

        expect(await buyWithSwap(BigInt(tokenNumToBuy), owner, 1))
          .to.emit(votingToken, 'Transfer')
          .withArgs(zeroAddress, owner, expectedTransferAmount);
      });

      it('Should have the right amount of tokens after the buying', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, buyWithSwap } =
          await loadFixture(deployTokenFixture);
        const expectedTransferAmount = tokenNumToBuy;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await buyWithSwap(BigInt(tokenNumToBuy), owner, 1);

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedTransferAmount * 2
        );
      });

      it('Should change the minTokenAmount after buying new tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, buyWithSwap } =
          await loadFixture(deployTokenFixture);
        const expectedTransferAmount = tokenNumToBuy * 2 * 0.05;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await buyWithSwap(BigInt(tokenNumToBuy), owner, 1);

        expect(await votingToken.getMinTokenAmount()).to.be.equal(
          expectedTransferAmount
        );
      });

      it('Should change the totalSupply after buying new tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, buyWithSwap } =
          await loadFixture(deployTokenFixture);
        const expectedTotalSupply = tokenNumToBuy * 2;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await buyWithSwap(BigInt(tokenNumToBuy), owner, 1);

        expect(await votingToken.totalSupply()).to.be.equal(
          expectedTotalSupply
        );
      });

      it('Should change the votePower of the voted price', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, buyWithSwap } =
          await loadFixture(deployTokenFixture);
        const expectedPower = tokenNumToBuy * 2;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          tokenNumToBuy
        );

        await buyWithSwap(BigInt(tokenNumToBuy), owner, 1);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          expectedPower
        );
      });

      it("Should fail if the user hasn't voted and try to buy more tokens using the buyWithSwap function", async () => {
        const { votingToken, tokenNumToBuy, price, owner, buyWithSwap } =
          await loadFixture(deployTokenFixture);

        await expect(
          buyWithSwap(BigInt(tokenNumToBuy), owner, 1)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail if the user passes an incorrect amount of tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, buyWithSwap } =
          await loadFixture(deployTokenFixture);
        const priceToVote = price;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(priceToVote, owner);

        expect(await votingToken.getPowerByPrice(priceToVote)).to.be.equal(
          tokenNumToBuy
        );

        await expect(buyWithSwap(0n, owner, 1)).to.be.revertedWithCustomError(
          votingToken,
          'TokenAmountIsNotValid'
        );
      });

      it('Should fail if the user passed too little ether', async () => {
        const { votingToken, tokenNumToBuy, owner, buyWithSwap } =
          await loadFixture(deployTokenFixture);

        await expect(
          buyWithSwap(BigInt(tokenNumToBuy), owner, 1)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail if the user passes an incorrect amount of tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, buyWithSwap } =
          await loadFixture(deployTokenFixture);
        const priceToVote = price;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(priceToVote, owner);

        expect(await votingToken.getPowerByPrice(priceToVote)).to.be.equal(
          tokenNumToBuy
        );

        await expect(
          buyWithSwap(BigInt(tokenNumToBuy), owner, 100, 'gwei')
        ).to.be.revertedWithCustomError(votingToken, 'EtherError');
      });

      it('Should fail if the user passed an incorrect previous node index', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);
        const priceToVote = price;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(priceToVote, owner);

        expect(await votingToken.getPowerByPrice(priceToVote)).to.be.equal(
          tokenNumToBuy
        );

        await expect(
          votingToken.buyWithSwap(tokenNumToBuy, 1_000_000n, {
            value: ethers.parseEther('1'),
          })
        ).to.be.revertedWithCustomError(
          votingToken,
          'NodeIndexIsNotValidError'
        );
      });
    });
  });

  describe('Selling', () => {
    describe('Sell', () => {
      it('Should emit the Transfer event with the right params', async () => {
        const { votingToken, tokenNumToBuy, owner, zeroAddress } =
          await loadFixture(deployTokenFixture);
        const expectedTransferAmount = tokenNumToBuy / 2;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        expect(await votingToken.sell(tokenNumToBuy / 2))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner, zeroAddress, expectedTransferAmount);
      });

      it('Should have the right amount of tokens after the selling', async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const expectedTransferAmount = tokenNumToBuy / 2;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await votingToken.sell(tokenNumToBuy / 2);

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedTransferAmount
        );
      });

      it('Should change the minTokenAmount after selling new tokens', async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const tokensNumToSell = tokenNumToBuy / 2;
        const expectedMinTokenAmount = (tokenNumToBuy - tokensNumToSell) * 0.05;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await votingToken.sell(tokensNumToSell);

        expect(await votingToken.getMinTokenAmount()).to.be.equal(
          expectedMinTokenAmount
        );
      });

      it('Should change the totalSupply after selling new tokens', async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const tokensNumToSell = tokenNumToBuy / 2;
        const expectedTotalSupply = tokenNumToBuy - tokensNumToSell;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await votingToken.sell(tokensNumToSell);

        expect(await votingToken.totalSupply()).to.be.equal(
          expectedTotalSupply
        );
      });

      it("Should pass if the user hasn't voted yet and try to sell tokens", async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const tokensNumToSell = tokenNumToBuy / 2;
        const expectedBalance = tokenNumToBuy - tokensNumToSell;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await votingToken.sell(tokensNumToSell);

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedBalance
        );
      });

      it('Should fail if the user has voted and try to sell some tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);
        const priceToVote = price;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(priceToVote, owner);

        await expect(
          votingToken.sell(tokenNumToBuy / 2)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail if the user tries to sell more tokens than they have', async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const tokensNumToSell = tokenNumToBuy * 2;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await expect(
          votingToken.sell(tokensNumToSell)
        ).to.be.revertedWithCustomError(
          votingToken,
          'SellingMoreThanYouHaveError'
        );
      });

      it('Should fail if the user passes an incorrect amount of tokens', async () => {
        const { votingToken, tokenNumToBuy, owner } = await loadFixture(
          deployTokenFixture
        );
        const tokensNumToSell = 0n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await expect(
          votingToken.sell(tokensNumToSell)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });
    });

    describe('SellWithSwap', () => {
      it('Should emit the Transfer event with the right params', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          zeroAddress,
          vote,
          sellWithSwap,
        } = await loadFixture(deployTokenFixture);
        const expectedTokenNumToSell = Math.floor(tokenNumToBuy / 2);

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);

        expect(await sellWithSwap(BigInt(expectedTokenNumToSell), owner))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner, zeroAddress, expectedTokenNumToSell);
      });

      it('Should have the right amount of tokens after the selling', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, sellWithSwap } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = Math.floor(tokenNumToBuy / 2);
        const expectedBalance = tokenNumToBuy - tokenNumToSell;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await sellWithSwap(BigInt(tokenNumToSell), owner);

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedBalance
        );
      });

      it('Should change the minTokenAmount after selling new tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, sellWithSwap } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = Math.floor(tokenNumToBuy / 2);
        const expectedMinTokenAmount = (tokenNumToBuy - tokenNumToSell) * 0.05;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await sellWithSwap(BigInt(tokenNumToSell), owner);

        expect(await votingToken.getMinTokenAmount()).to.be.equal(
          expectedMinTokenAmount
        );
      });

      it('Should change the totalSupply after selling new tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, sellWithSwap } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = Math.floor(tokenNumToBuy / 2);
        const expectedTotalSupply = tokenNumToBuy - tokenNumToSell;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await sellWithSwap(BigInt(tokenNumToSell), owner);

        expect(await votingToken.totalSupply()).to.be.equal(
          expectedTotalSupply
        );
      });

      it('Should change the votePower of the voted price', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, sellWithSwap } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = Math.floor(tokenNumToBuy / 2);
        const expectedPower = tokenNumToBuy - tokenNumToSell;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await sellWithSwap(BigInt(tokenNumToSell), owner);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          expectedPower
        );
      });

      it('Should pass if the user has voted and try to sell tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote, sellWithSwap } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = Math.floor(tokenNumToBuy / 2);

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);
        await sellWithSwap(BigInt(tokenNumToSell), owner);

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy - tokenNumToSell
        );
      });

      it("Should fail if the user hasn't voted and try to sell more tokens", async () => {
        const { votingToken, tokenNumToBuy, owner, sellWithSwap } =
          await loadFixture(deployTokenFixture);
        const expectedTokenNumToBuy = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        await expect(
          sellWithSwap(BigInt(expectedTokenNumToBuy), owner)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail if the user passed an incorrect previous node index', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = Math.floor(tokenNumToBuy / 2);
        const positionToInsert = price - 1n;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        await vote(price, owner);

        await expect(
          votingToken.sellWithSwap(tokenNumToSell, positionToInsert)
        ).to.be.revertedWithCustomError(
          votingToken,
          'NodeIndexIsNotValidError'
        );
      });

      it('Should fail if the user tries to sell more tokens than they have', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = tokenNumToBuy + 1;
        const positionToInsert = 0n;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        await vote(price, owner);

        await expect(
          votingToken.sellWithSwap(tokenNumToSell, positionToInsert)
        ).to.be.revertedWithCustomError(
          votingToken,
          'SellingMoreThanYouHaveError'
        );
      });

      it('Should fail if the user passes an incorrect amount of tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToSell = 0n;
        const positionToInsert = 0n;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });

        await vote(price, owner);

        await expect(
          votingToken.sellWithSwap(tokenNumToSell, positionToInsert)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });
    });
  });

  describe('Transferring', () => {
    describe('Transfer', () => {
      it('Should emit the Transfer event', async () => {
        const { votingToken, tokenNumToBuy, owner, acc1 } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.transfer(acc1.address, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it("Should change the recipient's balance after transferring", async () => {
        const { votingToken, tokenNumToBuy, acc1 } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await votingToken.transfer(acc1.address, tokenNumToTransfer);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
          tokenNumToTransfer
        );
      });

      it("Should change the sender's balance after transferring", async () => {
        const { votingToken, tokenNumToBuy, owner, acc1 } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);
        const expectedBalance = tokenNumToBuy - tokenNumToTransfer;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await votingToken.transfer(acc1.address, tokenNumToTransfer);

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedBalance
        );
      });

      it('Should pass while calling with a right amount', async () => {
        const { votingToken, tokenNumToBuy, owner, acc1 } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.transfer(acc1.address, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it("Should pass while calling when both the sender and recipient haven't voted", async () => {
        const { votingToken, tokenNumToBuy, owner, acc1 } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.transfer(acc1.address, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should fail while calling with a zero address', async () => {
        const { votingToken, tokenNumToBuy, owner, zeroAddress } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await expect(
          votingToken.transfer(zeroAddress, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'TransferToZeroAddressError'
        );
      });

      it('Should fail while calling when the sender has voted', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken.transfer(acc1.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when recipient has voted', async () => {
        const { votingToken, tokenNumToBuy, price, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy * 2, { value: ethers.parseEther('1') });
        await vote(price, acc1);

        await expect(
          votingToken.transfer(acc1.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when both the sender and recipient have voted', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price * 2n, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy * 2, { value: ethers.parseEther('1') });
        await vote(price, acc1);

        await expect(
          votingToken.transfer(acc1.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling with a wrong amount to transfer', async () => {
        const { votingToken, tokenNumToBuy, acc1 } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await expect(
          votingToken.transfer(acc1.address, 0)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });

      it("Should fail while calling when the voter's balance is less than the amount to transfer", async () => {
        const { votingToken, tokenNumToBuy, acc1 } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToTransfer = tokenNumToBuy * 2;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await expect(
          votingToken.transfer(acc1.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(votingToken, 'BalanceIsNotEnoughError');
      });
    });

    describe('TransferWithSingleSwap', () => {
      it('Should emit the Transfer event', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        expect(await transferWithSingleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it("Shouldn't allow to double-spend tokens on transferring", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 10);
        const ownerBalanceAfterTransferring =
          tokenNumToBuy - tokenNumToTransfer;
        const acc1PriceToVote = price + 1n;

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          tokenNumToBuy
        );

        await transferWithSingleSwap(owner, acc1, BigInt(tokenNumToTransfer));

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          ownerBalanceAfterTransferring
        );
        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
          tokenNumToTransfer
        );

        await vote(acc1PriceToVote, acc1);

        expect(await votingToken.getPowerByPrice(acc1PriceToVote)).to.be.equal(
          tokenNumToTransfer
        );
        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          ownerBalanceAfterTransferring
        );
      });

      it("Should change the recipient's balance after transferring", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const expectedPower = BigInt(tokenNumToBuy) - tokenNumToTransfer;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          tokenNumToBuy
        );

        await transferWithSingleSwap(owner, acc1, tokenNumToTransfer);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          expectedPower
        );
        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
          tokenNumToTransfer
        );
      });

      it("Should change the sender's balance after transferring", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const expectedBalance = BigInt(tokenNumToBuy) - tokenNumToTransfer;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          tokenNumToBuy
        );

        await transferWithSingleSwap(owner, acc1, tokenNumToTransfer);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          expectedBalance
        );
        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          expectedBalance
        );
      });

      it('Should pass while calling with a right amount', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        expect(await transferWithSingleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling when the sender has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        expect(await transferWithSingleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling when the recipient has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy * 2, { value: ethers.parseEther('1') });
        await vote(price, acc1);

        expect(await transferWithSingleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling with a non-zero address', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        expect(await transferWithSingleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling with a right nodeChange', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        expect(await transferWithSingleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should fail while calling with a zero address', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          zeroAddressSigner,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferWithSingleSwap(owner, zeroAddressSigner, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'TransferToZeroAddressError'
        );
      });

      it('Should fail while calling when both the sender and recipient have voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy * 2, { value: ethers.parseEther('1') });
        await vote(price * 2n, acc1);

        await expect(
          transferWithSingleSwap(owner, acc1, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it("Should fail while calling when both the sender and recipient haven't voted", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          acc1,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await expect(
          transferWithSingleSwap(owner, acc1, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling with a wrong amount to transfer', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferWithSingleSwap(owner, acc1, 0n)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });

      it("Should fail while calling when the voter's balance is less than the amount to transfer", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          price,
          acc1,
          vote,
          transferWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToBuy) * 2n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferWithSingleSwap(owner, acc1, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(votingToken, 'BalanceIsNotEnoughError');
      });

      it('Should fail while calling with a non-existing price', async () => {
        const { votingToken, tokenNumToBuy, owner, price, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken.transferWithSingleSwap(acc1.address, tokenNumToTransfer, {
            price: price * 2n,
            power: 5000n,
            prev: 0n,
          })
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });

      it('Should fail while calling with a wrong previous node index', async () => {
        const { votingToken, tokenNumToBuy, owner, price, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken.transferWithSingleSwap(acc1.address, tokenNumToTransfer, {
            price: 0n,
            power: 5000n,
            prev: price * 2n,
          })
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });

      it('Should fail while calling with a wrong new power', async () => {
        const { votingToken, tokenNumToBuy, owner, price, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken.transferWithSingleSwap(acc1.address, tokenNumToTransfer, {
            price: 0n,
            power: 5000n,
            prev: price * 2n,
          })
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });
    });

    describe('TransferWithDoubleSwap', () => {
      it('Should emit the Transfer event', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        expect(await transferWithDoubleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
        expect(await votingToken.getPowerByPrice(price2)).to.be.equal(
          tokenNumToBuy2 + tokenNumToTransfer
        );
        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          BigInt(tokenNumToBuy) - tokenNumToTransfer
        );
      });

      it("Shouldn't allow to double-spend tokens on transferring", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = Math.floor(tokenNumToBuy / 10);
        const ownerBalanceAfterTransferring =
          tokenNumToBuy - tokenNumToTransfer;
        const acc1PriceToVote = price + 1n;
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);

        await votingToken.startVoting();
        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          tokenNumToBuy
        );

        await vote(price, owner);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          tokenNumToBuy
        );

        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
          tokenNumToBuy2
        );

        await vote(acc1PriceToVote, acc1);

        expect(await votingToken.getPowerByPrice(acc1PriceToVote)).to.be.equal(
          tokenNumToBuy2
        );

        await transferWithDoubleSwap(owner, acc1, BigInt(tokenNumToTransfer));

        expect(await votingToken.balanceOf(owner.address)).to.be.equal(
          ownerBalanceAfterTransferring
        );
        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
          BigInt(tokenNumToTransfer) + tokenNumToBuy2
        );

        expect(await votingToken.getPowerByPrice(acc1PriceToVote)).to.be.equal(
          BigInt(tokenNumToTransfer) + tokenNumToBuy2
        );
        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          ownerBalanceAfterTransferring
        );
      });

      it('Should pass while calling with a right amount', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        expect(await transferWithDoubleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling when both the sender and recipient have voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        expect(await transferWithDoubleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling with a non-zero address', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        expect(await transferWithDoubleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling with the right first nodeChange', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        expect(await transferWithDoubleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should pass while calling with the right second nodeChange', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        expect(await transferWithDoubleSwap(owner, acc1, tokenNumToTransfer))
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc1.address, tokenNumToTransfer);
      });

      it('Should fail while calling when only the sender has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferWithDoubleSwap(owner, acc1, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when only the recipient has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.startVoting();
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        await expect(
          transferWithDoubleSwap(owner, acc1, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when nobody has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          owner,
          acc1,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));

        await expect(
          transferWithDoubleSwap(owner, acc1, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling with a wrong amount to transfer', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        await expect(
          transferWithDoubleSwap(owner, acc1, 0n)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });

      it("Should fail while calling when the voter's balance is less than the amount to transfer", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          price,
          owner,
          acc1,
          vote,
          transferWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToBuy * 2);
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        await expect(
          transferWithDoubleSwap(owner, acc1, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(votingToken, 'PowerIsNotValidError');
      });

      it('Should fail while calling with a wrong previous node index', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const balanceAfterTransfer = BigInt(tokenNumToBuy) - tokenNumToTransfer;
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        await expect(
          votingToken.transferWithDoubleSwap(
            acc1.address,
            tokenNumToTransfer,
            { price, power: balanceAfterTransfer, prev: 0 },
            {
              price: price2,
              power: tokenNumToBuy2 + tokenNumToTransfer,
              prev: 0,
            }
          )
        ).to.be.revertedWithCustomError(votingToken, 'PowerIsNotValidError');
      });

      it('Should fail while calling with a wrong new power', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const balanceAfterTransfer = BigInt(tokenNumToBuy) - tokenNumToTransfer;
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        await expect(
          votingToken.transferWithDoubleSwap(
            acc1.address,
            tokenNumToTransfer,
            { price, power: balanceAfterTransfer - 1n, prev: price2 },
            {
              price: price2,
              power: tokenNumToBuy2 + tokenNumToTransfer,
              prev: 0,
            }
          )
        ).to.be.revertedWithCustomError(votingToken, 'PowerIsNotValidError');
      });

      it('Should fail while calling with a non-existing price', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(Math.floor(tokenNumToBuy / 2));
        const balanceAfterTransfer = BigInt(tokenNumToBuy) - tokenNumToTransfer;
        const tokenNumToBuy2 = BigInt(tokenNumToBuy * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, {
          value: ethers.parseEther('1'),
        });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        await expect(
          votingToken.transferWithDoubleSwap(
            acc1.address,
            tokenNumToTransfer,
            { price: price + 1n, power: balanceAfterTransfer, prev: price2 },
            {
              price: price2,
              power: tokenNumToBuy2 + tokenNumToTransfer,
              prev: 0,
            }
          )
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });
    });
  });

  describe('TransferringFrom', () => {
    describe('TransferFrom', () => {
      it('Should have the right allowance', async () => {
        const { votingToken, tokenNumToBuy, tokenNumToApprove, owner, acc1 } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);
      });

      it('Should emit the Transfer event', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          owner,
          acc1,
          acc2,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = 1000;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);

        expect(
          await votingToken
            .connect(acc1)
            .transferFrom(owner.address, acc2.address, tokenNumToTransfer)
        )
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc2.address, tokenNumToTransfer);

        expect(await votingToken.balanceOf(acc2.address)).to.be.equal(
          tokenNumToTransfer
        );
      });

      it('Should fail while calling with a zero address for the recipient param', async () => {
        const { votingToken, tokenNumToBuy, tokenNumToApprove, zeroAddress } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await expect(
          votingToken.approve(zeroAddress, tokenNumToApprove)
        ).to.be.revertedWithCustomError(
          votingToken,
          'TransferToZeroAddressError'
        );
      });

      it('Should fail while calling when the owner has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = 1000;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        await votingToken.startVoting();

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);
        await vote(price, owner);

        await expect(
          votingToken
            .connect(acc1)
            .transferFrom(owner.address, acc2.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when the recipient has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = 1000;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await votingToken.startVoting();

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);
        await vote(price + 1n, acc2);

        await expect(
          votingToken
            .connect(acc1)
            .transferFrom(owner.address, acc2.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when both the recipient and sender have voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = 1000;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await votingToken.startVoting();

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);
        await vote(price + 1n, acc2);
        await vote(price, owner);

        await expect(
          votingToken
            .connect(acc1)
            .transferFrom(owner.address, acc2.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling with a wrong amount to transfer', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          owner,
          acc1,
          acc2,
        } = await loadFixture(deployTokenFixture);
        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await votingToken.startVoting();

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        await expect(
          votingToken.connect(acc1).transferFrom(owner.address, acc2.address, 0)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });

      it('Should fail while calling when the allowance is less than the amount to transfer', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          owner,
          acc1,
          acc2,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = tokenNumToApprove * 2;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);

        await expect(
          votingToken
            .connect(acc1)
            .transferFrom(owner.address, acc2.address, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'AllowanceIsNotEnoughError'
        );
      });
    });

    describe('TransferFromWithSingleSwap', () => {
      it('Should emit the Transfer event', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithSingleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(1000);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await vote(price, owner);

        expect(
          await transferFromWithSingleSwap(
            acc1,
            owner,
            acc2,
            tokenNumToTransfer
          )
        )
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc2.address, tokenNumToTransfer);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          BigInt(tokenNumToBuy) - tokenNumToTransfer
        );

        expect(await votingToken.balanceOf(acc2.address)).to.be.equal(
          tokenNumToTransfer
        );
      });

      it("Shouldn't allow to double-spend tokens on transferring", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithSingleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(1000);
        const price2 = price * 2n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await vote(price, owner);

        expect(
          await transferFromWithSingleSwap(
            acc1,
            owner,
            acc2,
            tokenNumToTransfer
          )
        )
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc2.address, tokenNumToTransfer);

        await vote(price2, acc2);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          BigInt(tokenNumToBuy) - tokenNumToTransfer
        );
        expect(await votingToken.getPowerByPrice(price2)).to.be.equal(
          tokenNumToTransfer
        );

        expect(await votingToken.balanceOf(acc2.address)).to.be.equal(
          tokenNumToTransfer
        );
      });

      it('Should pass while calling when the recipient has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithSingleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);
        const expectedBalance = BigInt(tokenNumToBuy) + tokenNumToTransfer;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price, acc2);

        expect(
          await transferFromWithSingleSwap(
            acc1,
            owner,
            acc2,
            tokenNumToTransfer
          )
        )
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc2.address, tokenNumToTransfer);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          expectedBalance
        );
        expect(await votingToken.balanceOf(acc2.address)).to.be.equal(
          expectedBalance
        );
      });

      it('Should fail while calling with a zero address for the recipient param', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          zeroAddressSigner,
          transferFromWithSingleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferFromWithSingleSwap(
            acc1,
            owner,
            zeroAddressSigner,
            tokenNumToTransfer
          )
        ).to.be.revertedWithCustomError(
          votingToken,
          'TransferToZeroAddressError'
        );
      });

      it('Should fail while calling when both the sender and recipient have voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithSingleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        await vote(price, owner);
        await vote(price + 1n, acc2);

        await expect(
          transferFromWithSingleSwap(acc1, owner, acc2, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when nobody has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          owner,
          acc1,
          acc2,
          transferFromWithSingleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        await expect(
          transferFromWithSingleSwap(acc1, owner, acc2, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling with a wrong amount to transfer', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithSingleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferFromWithSingleSwap(acc1, owner, acc2, 0n)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });

      it("Should fail while calling when the voter's balance is less than the amount to transfer", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithSingleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove * 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferFromWithSingleSwap(acc1, owner, acc2, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'AllowanceIsNotEnoughError'
        );
      });

      it('Should fail while calling with a non-existing price', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken
            .connect(acc1)
            .transferFromWithSingleSwap(
              owner.address,
              acc2.address,
              tokenNumToTransfer,
              {
                price: price + 1n,
                power: BigInt(tokenNumToBuy) - tokenNumToTransfer,
                prev: 0,
              }
            )
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });

      it('Should fail while calling with a wrong previous node index', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken
            .connect(acc1)
            .transferFromWithSingleSwap(
              owner.address,
              acc2.address,
              tokenNumToTransfer,
              {
                price: price + 1n,
                power: BigInt(tokenNumToBuy) - tokenNumToTransfer,
                prev: 1,
              }
            )
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });

      it('Should fail while calling with a wrong new power', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          votingToken
            .connect(acc1)
            .transferFromWithSingleSwap(
              owner.address,
              acc2.address,
              tokenNumToTransfer,
              {
                price,
                power: BigInt(tokenNumToBuy) - tokenNumToTransfer + 1n,
                prev: 0,
              }
            )
        ).to.be.revertedWithCustomError(votingToken, 'PowerIsNotValidError');
      });
    });

    describe('TransferFromWithDoubleSwap', () => {
      it('Should emit the Transfer event', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithDoubleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price2, acc2);

        expect(
          await transferFromWithDoubleSwap(
            acc1,
            owner,
            acc2,
            tokenNumToTransfer
          )
        )
          .to.emit(votingToken, 'Transfer')
          .withArgs(owner.address, acc2.address, tokenNumToTransfer);
      });

      it('Should fail while calling when only the sender has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithDoubleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(
          transferFromWithDoubleSwap(acc1, owner, acc2, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when only the recipient has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithDoubleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price, acc2);

        await expect(
          transferFromWithDoubleSwap(acc1, owner, acc2, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling when nobody has voted', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          owner,
          acc1,
          acc2,
          transferFromWithDoubleSwap,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);

        await expect(
          transferFromWithDoubleSwap(acc1, owner, acc2, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail while calling with a wrong amount to transfer', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithDoubleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price2, owner);
        await vote(price, acc2);

        await expect(
          transferFromWithDoubleSwap(acc1, owner, acc2, 0n)
        ).to.be.revertedWithCustomError(votingToken, 'TokenAmountIsNotValid');
      });

      it("Should fail while calling when the voter's balance is less than the amount to transfer", async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          transferFromWithDoubleSwap,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove * 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price2, owner);
        await vote(price, acc2);

        await expect(
          transferFromWithDoubleSwap(acc1, owner, acc2, tokenNumToTransfer)
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });

      it('Should fail while calling with a non-existing price', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price2, owner);
        await vote(price, acc2);

        await expect(
          votingToken.connect(acc1).transferFromWithDoubleSwap(
            owner,
            acc2,
            tokenNumToTransfer,
            {
              price: price + 2n,
              power: BigInt(tokenNumToBuy) - tokenNumToTransfer,
              prev: price,
            },
            {
              price: price,
              power: BigInt(tokenNumToBuy) + tokenNumToTransfer,
              prev: 0,
            }
          )
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });

      it('Should fail while calling with a wrong previous node index', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price2, owner);
        await vote(price, acc2);

        await expect(
          votingToken.connect(acc1).transferFromWithDoubleSwap(
            owner,
            acc2,
            tokenNumToTransfer,
            {
              price: price2,
              power: BigInt(tokenNumToBuy) - tokenNumToTransfer,
              prev: 0,
            },
            {
              price: price,
              power: BigInt(tokenNumToBuy) + tokenNumToTransfer,
              prev: 0,
            }
          )
        ).to.be.revertedWithCustomError(votingToken, 'PowerIsNotValidError');
      });

      it('Should fail while calling with a wrong new power', async () => {
        const {
          votingToken,
          tokenNumToBuy,
          tokenNumToApprove,
          price,
          owner,
          acc1,
          acc2,
          vote,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToTransfer = BigInt(tokenNumToApprove / 2);
        const price2 = price + 1n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.approve(acc1.address, tokenNumToApprove);

        expect(
          await votingToken.allowance(owner.address, acc1.address)
        ).to.be.equal(tokenNumToApprove);

        expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
        await votingToken.startVoting();
        await votingToken
          .connect(acc2)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price2, owner);
        await vote(price, acc2);

        await expect(
          votingToken.connect(acc1).transferFromWithDoubleSwap(
            owner,
            acc2,
            tokenNumToTransfer,
            {
              price: price2,
              power: BigInt(tokenNumToBuy) - tokenNumToTransfer - 1n,
              prev: price,
            },
            {
              price: price,
              power: BigInt(tokenNumToBuy) + tokenNumToTransfer,
              prev: 0,
            }
          )
        ).to.be.revertedWithCustomError(votingToken, 'PowerIsNotValidError');
      });
    });
  });

  describe('Voting', () => {
    it('Should return the right price after the end of voting', async () => {
      const {
        votingToken,
        tokenNumToBuy,
        tokenNumToApprove,
        price,
        timeToVote,
        owner,
        acc1,
        acc2,
        transferFromWithSingleSwap,
        vote,
      } = await loadFixture(deployTokenFixture);
      const tokenNumToTransfer = BigInt(1000);
      const price2 = price * 2n;

      await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
      await votingToken.approve(acc1.address, tokenNumToApprove);
      await votingToken
        .connect(acc2)
        .buy(tokenNumToBuy * 2, { value: ethers.parseEther('1') });

      expect(await votingToken.balanceOf(acc1.address)).to.be.equal(0);
      await votingToken.startVoting();
      await vote(price, owner);

      expect(
        await transferFromWithSingleSwap(acc1, owner, acc2, tokenNumToTransfer)
      )
        .to.emit(votingToken, 'Transfer')
        .withArgs(owner.address, acc2.address, tokenNumToTransfer);

      await vote(price2, acc2);

      await time.increase(timeToVote);

      await votingToken.endVoting();

      expect(await votingToken.getTopPrice()).to.be.equal(price2);
    });

    describe('Vote', () => {
      it('Should set the voter to its voted price', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        expect(await votingToken.getPriceByVoter(owner.address)).to.be.equal(
          price
        );
      });

      it('Should push the price node to the right position', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const price2 = price * 2n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy * 2, { value: ethers.parseEther('1') });
        await vote(price2, acc1);

        const node = await votingToken.getNodeByPrice(price);

        expect(node.prev).to.be.equal(price2);
      });

      it('Should pass when the user tries to vote for the price which already exists and has at least 1 token', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await vote(price, acc1);

        expect(await votingToken.getPowerByPrice(price)).to.be.equal(
          tokenNumToBuy * 2
        );
      });

      it("Should fail when the user tries to vote for the price which already exists and doesn't have any tokens", async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(vote(price, acc1)).to.be.revertedWithCustomError(
          votingToken,
          'BalanceIsNotEnoughError'
        );
      });

      it('Should fail when the user tries to add a price and has less than 0.05% of tokens', async () => {
        const { votingToken, tokenNumToBuy, price, owner, acc1, vote } =
          await loadFixture(deployTokenFixture);
        const tokenNumToBuy2 = Math.floor((tokenNumToBuy * 0.04) / 100);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);
        await votingToken
          .connect(acc1)
          .buy(tokenNumToBuy2, { value: ethers.parseEther('1') });

        await expect(vote(price + 1n, acc1)).to.be.revertedWithCustomError(
          votingToken,
          'BalanceIsNotEnoughError'
        );
      });

      it('Should fail when the user has voted', async () => {
        const { votingToken, tokenNumToBuy, price, owner, vote } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(vote(price + 1n, owner)).to.be.revertedWithCustomError(
          votingToken,
          'CallingMethodWithWrongTxError'
        );
      });

      it('Should fail when the user passes an incorrect price', async () => {
        const { votingToken, tokenNumToBuy } = await loadFixture(
          deployTokenFixture
        );

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();

        await expect(
          votingToken.vote({ price: 0, power: tokenNumToBuy, prev: 0 })
        ).to.be.revertedWithCustomError(votingToken, 'PushingNonValidPrice');
      });

      it('Should fail when the user passes an incorrect previous node index', async () => {
        const { votingToken, price, tokenNumToBuy } = await loadFixture(
          deployTokenFixture
        );

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();

        await expect(
          votingToken.vote({ price, power: tokenNumToBuy, prev: price + 1n })
        ).to.be.revertedWithCustomError(votingToken, 'PrevIndexIsNotValid');
      });

      it('Should fail when the user passes an incorrect new power', async () => {
        const { votingToken, price, tokenNumToBuy } = await loadFixture(
          deployTokenFixture
        );

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();

        await expect(
          votingToken.vote({ price, power: tokenNumToBuy + 1, prev: 0 })
        ).to.be.revertedWithCustomError(votingToken, 'PowerIsNotValidError');
      });
    });

    describe('VoteWithSwap', () => {
      it("Should fail when the user hasn't voted yet", async () => {
        const { votingToken, price, tokenNumToBuy } = await loadFixture(
          deployTokenFixture
        );

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();

        await expect(
          votingToken.voteWithSwap(
            { price, power: tokenNumToBuy, prev: 0 },
            { price: 0, power: 0, prev: 0 }
          )
        ).to.be.revertedWithCustomError(
          votingToken,
          'CallingUnsuitableMethodError'
        );
      });

      it('Should fail when voting for the same price', async () => {
        const { votingToken, price, tokenNumToBuy, owner, vote } =
          await loadFixture(deployTokenFixture);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.startVoting();
        await vote(price, owner);

        await expect(vote(price, owner)).to.be.revertedWithCustomError(
          votingToken,
          'VotingForTheSamePriceError'
        );
      });
    });
  });

  describe('Fees', () => {
    it('Should return the right amount of total fees', async () => {
      const {
        buyFeePercentage,
        votingToken,
        tokenNumToBuy,
        tokenPrice,
        getPercentage,
        acc1,
      } = await loadFixture(deployTokenFixture);
      const totalTokenPrice = BigInt(tokenNumToBuy) * tokenPrice;
      const fee = getPercentage(totalTokenPrice, buyFeePercentage);

      await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
      await votingToken
        .connect(acc1)
        .buy(tokenNumToBuy, { value: ethers.parseEther('1') });

      expect(await votingToken.getTotalFees()).to.be.equal(fee * 2n);
    });

    describe('Buying fee', () => {
      it('Should charge 5% fee when buying', async () => {
        const {
          buyFeePercentage,
          votingToken,
          tokenNumToBuy,
          tokenPrice,
          getPercentage,
        } = await loadFixture(deployTokenFixture);
        const totalTokenPrice = BigInt(tokenNumToBuy) * tokenPrice;
        const fee = getPercentage(totalTokenPrice, buyFeePercentage);

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });

        expect(await votingToken.getTotalFees()).to.be.equal(fee);
      });

      it('Should change the buyFeePercentage if the setBuyFeePercentage is called by the owner', async () => {
        const { votingToken } = await loadFixture(deployTokenFixture);
        const newBuyFeePercentage = 10;

        expect(await votingToken.setBuyFeePercentage(newBuyFeePercentage))
          .to.emit(votingToken, 'BuyFeePercentageChanged')
          .withArgs(newBuyFeePercentage);
      });

      it('Should fail if the setBuyFeePercentage is not called by the owner', async () => {
        const { votingToken, acc1 } = await loadFixture(deployTokenFixture);
        const newBuyFeePercentage = 10;

        await expect(
          votingToken.connect(acc1).setBuyFeePercentage(newBuyFeePercentage)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    describe('Selling fee', () => {
      it('Should charge 5% fee when selling', async () => {
        const {
          buyFeePercentage,
          sellFeePercentage,
          votingToken,
          tokenNumToBuy,
          tokenPrice,
          getPercentage,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToSell = BigInt(tokenNumToBuy) / 10n;
        const totalTokenPriceBuy = BigInt(tokenNumToBuy) * tokenPrice;
        const totalTokenPriceSell = BigInt(tokenNumToSell) * tokenPrice;
        const buyFee = getPercentage(totalTokenPriceBuy, buyFeePercentage);
        const sellFee = getPercentage(totalTokenPriceSell, sellFeePercentage);
        const totalFee = buyFee + sellFee;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.sell(tokenNumToSell);

        expect(await votingToken.getTotalFees()).to.be.equal(totalFee);
      });

      it('Should change the sellFeePercentage if the setSellFeePercentage is called by the owner', async () => {
        const { votingToken } = await loadFixture(deployTokenFixture);
        const newSellFee = 10n;

        expect(await votingToken.setSellFeePercentage(newSellFee))
          .to.emit(votingToken, 'SellFeePercentageChanged')
          .withArgs(newSellFee);
      });

      it('Should fail if the setSellFeePercentage is not called by the owner', async () => {
        const { votingToken, acc1 } = await loadFixture(deployTokenFixture);
        const newSellFee = 10n;

        await expect(
          votingToken.connect(acc1).setSellFeePercentage(newSellFee)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    describe('Withdrawing', () => {
      it('Should pass if the withdrawer is the owner', async () => {
        const {
          buyFeePercentage,
          sellFeePercentage,
          votingToken,
          tokenNumToBuy,
          tokenPrice,
          getPercentage,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToSell = BigInt(tokenNumToBuy) / 10n;
        const totalTokenPriceBuy = BigInt(tokenNumToBuy) * tokenPrice;
        const totalTokenPriceSell = BigInt(tokenNumToSell) * tokenPrice;
        const buyFee = getPercentage(totalTokenPriceBuy, buyFeePercentage);
        const sellFee = getPercentage(totalTokenPriceSell, sellFeePercentage);
        const totalFee = buyFee + sellFee;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.sell(tokenNumToSell);

        expect(await votingToken.getTotalFees()).to.be.equal(totalFee);

        await votingToken.withdrawFees();

        expect(await votingToken.getTotalFees()).to.be.equal(0n);
      });

      it('Should pass if a withdrawing is made after the withdraw period elapsed', async () => {
        const {
          buyFeePercentage,
          sellFeePercentage,
          votingToken,
          tokenNumToBuy,
          tokenPrice,
          getPercentage,
          withdrawPeriod,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToSell = BigInt(tokenNumToBuy) / 10n;
        const totalTokenPriceBuy = BigInt(tokenNumToBuy) * tokenPrice;
        const totalTokenPriceSell = BigInt(tokenNumToSell) * tokenPrice;
        const buyFee = getPercentage(totalTokenPriceBuy, buyFeePercentage);
        const sellFee = getPercentage(totalTokenPriceSell, sellFeePercentage);
        const totalFee = buyFee + sellFee;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.sell(tokenNumToSell);
        await votingToken.withdrawFees();
        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.sell(tokenNumToSell);
        await time.increase(withdrawPeriod);
        await votingToken.withdrawFees();

        expect(await votingToken.getTotalFees()).to.be.equal(0);
      });

      it('Should change the feeWithdrawPeriod if the setFeeWithdrawPeriod is called by the owner', async () => {
        const { votingToken } = await loadFixture(deployTokenFixture);
        const newFeeWithdrawPeriod = 10n;

        expect(await votingToken.setFeeWithdrawPeriod(newFeeWithdrawPeriod))
          .to.emit(votingToken, 'FeeWithdrawPeriodChanged')
          .withArgs(newFeeWithdrawPeriod);
      });

      it('Should fail if the withdrawer is not the owner', async () => {
        const {
          buyFeePercentage,
          sellFeePercentage,
          votingToken,
          tokenNumToBuy,
          tokenPrice,
          getPercentage,
          acc1,
        } = await loadFixture(deployTokenFixture);
        const tokenNumToSell = BigInt(tokenNumToBuy) / 10n;
        const totalTokenPriceBuy = BigInt(tokenNumToBuy) * tokenPrice;
        const totalTokenPriceSell = BigInt(tokenNumToSell) * tokenPrice;
        const buyFee = getPercentage(totalTokenPriceBuy, buyFeePercentage);
        const sellFee = getPercentage(totalTokenPriceSell, sellFeePercentage);
        const totalFee = buyFee + sellFee;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.sell(tokenNumToSell);

        expect(await votingToken.getTotalFees()).to.be.equal(totalFee);

        await expect(
          votingToken.connect(acc1).withdrawFees()
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('Should fail if a withdrawing is made before the withdraw period elapsed', async () => {
        const { votingToken, tokenNumToBuy } = await loadFixture(
          deployTokenFixture
        );
        const tokenNumToSell = BigInt(tokenNumToBuy) / 10n;

        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.sell(tokenNumToSell);
        await votingToken.withdrawFees();
        await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
        await votingToken.sell(tokenNumToSell);

        await expect(votingToken.withdrawFees()).to.be.revertedWithCustomError(
          votingToken,
          'FeeWithdrawPeriodError'
        );
      });

      it('Should fail if the setFeeWithdrawPeriod is not called by the owner', async () => {
        const { votingToken, acc1 } = await loadFixture(deployTokenFixture);
        const newFeeWithdrawPeriod = 10n;

        await expect(
          votingToken.connect(acc1).setFeeWithdrawPeriod(newFeeWithdrawPeriod)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });
});
