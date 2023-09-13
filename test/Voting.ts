import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Voting', () => {
  async function deployTokenFixture() {
    const [owner, acc1, acc2, acc3, acc4, acc5] = await ethers.getSigners();
    const tokenPrice = 1_000_000_000n; // 1 token = 1 gwei
    const buyFeePercentage = 5n;
    const sellFeePercentage = 5n;
    const decimals = 2n;

    const Voting = await ethers.getContractFactory('Voting', owner);
    const votingToken = await Voting.deploy(
      tokenPrice,
      buyFeePercentage,
      sellFeePercentage,
      decimals
    );
    const votingTokenAddress = await votingToken.getAddress();

    const ReentrancyAttacker = await ethers.getContractFactory(
      'ReentrancyAttacker',
      acc1
    );
    const reentrancyAttacker = await ReentrancyAttacker.deploy(
      votingTokenAddress
    );
    const reentrancyAttackerAddress = await reentrancyAttacker.getAddress();

    const DosAttacker = await ethers.getContractFactory('DosAttacker', acc2);
    const dosAttacker = await DosAttacker.deploy(votingTokenAddress);
    const dosAttackerAddress = await dosAttacker.getAddress();

    const getPercentage = (amount: bigint, percentage: bigint) => {
      return (
        (amount * 10n ** decimals * percentage) /
        (100n * 10n ** BigInt(decimals))
      );
    };

    return {
      votingToken,
      reentrancyAttacker,
      reentrancyAttackerAddress,
      dosAttacker,
      dosAttackerAddress,
      owner,
      acc1,
      acc2,
      acc3,
      acc4,
      acc5,
      tokenPrice,
      decimals,
      buyFeePercentage,
      sellFeePercentage,
      getPercentage,
    };
  }

  describe('Reentrancy', () => {
    it('Should be able to reenter', async () => {
      const {
        votingToken,
        reentrancyAttacker,
        tokenPrice,
        buyFeePercentage,
        getPercentage,
      } = await loadFixture(deployTokenFixture);
      const reentrancyAttackerInitialBalance = ethers.parseEther('1');
      const tokenNumToBuyAttacker = 100000n;
      const tokenNumToBuy = 500000n;
      const totalTokenNum = tokenNumToBuy + tokenNumToBuyAttacker;

      await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
      await reentrancyAttacker.buy(tokenNumToBuyAttacker, {
        value: ethers.parseEther('1'),
      });

      expect(await votingToken.totalSupply()).to.be.equal(totalTokenNum);
      expect(
        await votingToken.balanceOf(await reentrancyAttacker.getAddress())
      ).to.be.equal(tokenNumToBuyAttacker);

      const totalTokenPrice = tokenPrice * tokenNumToBuyAttacker;
      const fee = getPercentage(totalTokenPrice, buyFeePercentage);
      const reentrancyAttackerBalanceAfterBuying =
        reentrancyAttackerInitialBalance - (totalTokenPrice + fee);
      const toReturnAfterSelling = totalTokenPrice - fee;

      await reentrancyAttacker.attackSellUnsecure(100000);

      const reentrancyNum = await reentrancyAttacker.getAmount();
      const reentrancyAttackerBalanceAfterAttack =
        reentrancyAttackerBalanceAfterBuying +
        reentrancyNum * toReturnAfterSelling;

      expect(reentrancyNum).to.be.not.equal(0n);
      expect(await votingToken.totalSupply()).to.be.equal(0n);
      expect(await reentrancyAttacker.getBalance()).to.be.equal(
        reentrancyAttackerBalanceAfterAttack
      );
    });

    it("Shouldn't be able to reenter", async () => {
      const {
        votingToken,
        reentrancyAttacker,
        reentrancyAttackerAddress,
        tokenPrice,
        buyFeePercentage,
        getPercentage,
      } = await loadFixture(deployTokenFixture);
      const reentrancyAttackerInitialBalance = ethers.parseEther('1');
      const tokenNumToBuyAttacker = 10n;
      const tokenNumToBuy = 50n;
      const totalTokenNum = tokenNumToBuy + tokenNumToBuyAttacker;

      await votingToken.buy(tokenNumToBuy, { value: ethers.parseEther('1') });
      await reentrancyAttacker.buy(tokenNumToBuyAttacker, {
        value: ethers.parseEther('1'),
      });

      expect(await votingToken.totalSupply()).to.be.equal(totalTokenNum);

      const totalTokenPrice = tokenPrice * tokenNumToBuyAttacker;
      const fee = getPercentage(totalTokenPrice, buyFeePercentage);
      const reentrancyAttackerBalanceAfterBuying =
        reentrancyAttackerInitialBalance - (totalTokenPrice + fee);

      await expect(
        reentrancyAttacker.attackSellSecure(10)
      ).to.be.revertedWithoutReason();

      expect(
        await votingToken.balanceOf(reentrancyAttackerAddress)
      ).to.be.equal(tokenNumToBuyAttacker);
      expect(await votingToken.totalSupply()).to.be.equal(totalTokenNum);
      expect(await reentrancyAttacker.getBalance()).to.be.equal(
        reentrancyAttackerBalanceAfterBuying
      );
    });
  });

  describe('Dos', () => {
    it('Should be able to dos', async () => {
      const { votingToken, dosAttacker, owner, acc1, dosAttackerAddress } =
        await loadFixture(deployTokenFixture);
      const tokenNumToBuy1 = 100n;
      const tokenNumToBuy3 = 300n;
      const tokenNumToBuy4 = 400n;

      await votingToken.buyUnsecure(tokenNumToBuy1, {
        value: ethers.parseEther('1'),
      });

      let topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(owner.address);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy1);

      await votingToken.connect(acc1).buyUnsecure(tokenNumToBuy4, {
        value: ethers.parseEther('1'),
      });

      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(acc1.address);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy4);

      await dosAttacker.buyUnsecure(tokenNumToBuy3, {
        value: ethers.parseEther('1'),
      });
      expect(await votingToken.balanceOf(dosAttackerAddress)).to.be.equal(
        tokenNumToBuy3
      );

      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(acc1.address);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy4);

      await dosAttacker.buyUnsecure(tokenNumToBuy3, {
        value: ethers.parseEther('1'),
      });
      expect(await votingToken.balanceOf(dosAttackerAddress)).to.be.equal(
        tokenNumToBuy3 * 2n
      );

      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(dosAttackerAddress);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy3 * 2n);

      await expect(
        votingToken.connect(acc1).buyUnsecure(tokenNumToBuy4, {
          value: ethers.parseEther('1'),
        })
      ).to.be.revertedWith('DoS with Unexpected revert');
      expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
        tokenNumToBuy4
      );
      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(dosAttackerAddress);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy3 * 2n);
    });

    it("Shouldn't be able to dos", async () => {
      const { votingToken, dosAttacker, owner, acc1, dosAttackerAddress } =
        await loadFixture(deployTokenFixture);
      const tokenNumToBuy1 = 100n;
      const tokenNumToBuy3 = 300n;
      const tokenNumToBuy4 = 400n;
      const reward = 5n;

      await votingToken.buy(tokenNumToBuy1, {
        value: ethers.parseEther('1'),
      });

      let topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(owner.address);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy1);

      await votingToken.connect(acc1).buy(tokenNumToBuy4, {
        value: ethers.parseEther('1'),
      });

      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(acc1.address);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy4);

      expect(await votingToken.getRefundAmount(owner.address)).to.be.equal(
        reward
      );
      await votingToken.connect(owner).refund();
      expect(await votingToken.getRefundAmount(owner.address)).to.be.equal(0n);

      await dosAttacker.buySecure(tokenNumToBuy3, {
        value: ethers.parseEther('1'),
      });
      expect(await votingToken.balanceOf(dosAttackerAddress)).to.be.equal(
        tokenNumToBuy3
      );

      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(acc1.address);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy4);

      await dosAttacker.buySecure(tokenNumToBuy3, {
        value: ethers.parseEther('1'),
      });
      expect(await votingToken.balanceOf(dosAttackerAddress)).to.be.equal(
        tokenNumToBuy3 * 2n
      );

      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(dosAttackerAddress);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy3 * 2n);
      expect(await votingToken.getRefundAmount(acc1.address)).to.be.equal(
        reward
      );

      await votingToken.connect(acc1).buy(tokenNumToBuy4, {
        value: ethers.parseEther('1'),
      });

      expect(await votingToken.balanceOf(acc1.address)).to.be.equal(
        tokenNumToBuy4 * 2n
      );
      topStakeholder = await votingToken.topStakeholder();
      expect(topStakeholder.addr).to.be.equal(acc1.address);
      expect(topStakeholder.weight).to.be.equal(tokenNumToBuy4 * 2n);
      expect(await votingToken.getRefundAmount(dosAttackerAddress)).to.be.equal(
        reward
      );

      expect(await votingToken.getRefundAmount(acc1.address)).to.be.equal(
        reward
      );
      await votingToken.connect(acc1).refund();
      expect(await votingToken.getRefundAmount(acc1.address)).to.be.equal(0n);
    });
  });
});
