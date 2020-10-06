const { BN, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { assert, expect } = require('chai');
const { ZERO_ADDRESS } = constants;

const tokens = (value) => web3.utils.toWei(value + '', 'ether');

const { shouldBehaveLikeERC20 } = require('./helpers/ERC20.behavior');
const { shouldBehaveLikeERC20Burnable } = require('./helpers/ERC20Burnable.behavior');

const CstETH = artifacts.require('CstETHMock');
const StETH = artifacts.require('StETHMock');

contract('CstETH', function ([deployer, initialHolder, recipient, anotherAccount, ...otherAccounts]) {
  beforeEach(async function () {
    this.steth = await StETH.new({ from: deployer });
    this.csteth = await CstETH.new(this.steth.address, { from: deployer });
  });

  describe('Wrapping / Unwrapping', function () {
    [ user1, user2 ] = otherAccounts;

    beforeEach(async function () {
      await this.steth.mint(user1, new BN(100), { from: deployer });
      expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('100');
      expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('0');
      await this.steth.approve(this.csteth.address, 50, { from: user1 });
      expect(await this.steth.allowance(user1, this.csteth.address)).to.be.bignumber.equal('50');
    });

    it('stETH is set correctly', async function () {
      expect(await this.csteth.stETH()).to.be.equal(this.steth.address);
    });

    it('can\'t wrap more than allowed', async function () {
      await expectRevert(this.csteth.wrap(51, { from: user1 }), 'ERC20: transfer amount exceeds allowance');
    });

    it('cant wrap if sender hasn\'t any stETH', async function () {
      await this.steth.approve(this.csteth.address, 50, { from: user2 });
      await expectRevert(this.csteth.wrap(1, { from: user2 }), 'ERC20: transfer amount exceeds balance');
    });

    describe('After successful wrap', function () {
      beforeEach(async function () {
        await this.csteth.wrap(50, { from: user1 });
      });

      it('balances are correct', async function () {
        expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('50');
        expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('50');
        expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('50');
      });

      it('can\'t unwrap more than current balance', async function () {
        await expectRevert(this.csteth.unwrap(51, { from: user1 }), 'ERC20: burn amount exceeds balance');
      });

      it('cant unwrap if sender hasn\'t any cstETH', async function () {
        await expectRevert(this.csteth.unwrap(1, { from: user2 }), 'ERC20: burn amount exceeds balance');
      });

      describe('After successful immediate unwrap', function () {
        beforeEach(async function () {
          await this.csteth.unwrap(10, { from: user1 });
        });

        it('balances are correct', async function () {
          expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('60');
          expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('40');
          expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('40');
        });
      });

      describe('After successful unwrap after stETH supply update', function () {
        beforeEach(async function () {
          await this.steth.mint(user1, new BN(5), { from: deployer }); // balance increased +10%
          await this.steth.mint(this.csteth.address, new BN(5), { from: deployer }); // balance increased +10%
          await this.csteth.unwrap(10, { from: user1 });
        });

        it('balances are correct', async function () {
          expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('66');
          expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('44');
          expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('40');
        });
      });
    });
  });

  describe('Token exchange calculations', function () {
    [ user1, user2 ] = otherAccounts;

    beforeEach(async function () {
      await this.steth.mint(user1, new BN(100), { from: deployer });
      await this.steth.mint(user2, new BN(100), { from: deployer });
    });

    it('initial state is correct (0 issued cstETH)', async function () {
      expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('100');
      expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('0');
      expect(await this.steth.balanceOf(user2)).to.be.bignumber.equal('100');
      expect(await this.csteth.balanceOf(user2)).to.be.bignumber.equal('0');
      expect(await this.csteth.getStETHByCstETH(1)).to.be.bignumber.equal('0');
      expect(await this.csteth.getCstETHByStETH(1)).to.be.bignumber.equal('1');
    });

    describe('After first wrap', function () {
      beforeEach(async function () {
        await this.steth.approve(this.csteth.address, 50, { from: user1 });
        await this.csteth.wrap(50, { from: user1 });
      });

      it('balances are correct', async function () {
        expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('50');
        expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('50');
        expect(await this.steth.balanceOf(user2)).to.be.bignumber.equal('100');
        expect(await this.csteth.balanceOf(user2)).to.be.bignumber.equal('0');
        expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('50');
      });

      it('ratio unchanged', async function () {
        expect(await this.csteth.getStETHByCstETH(1)).to.be.bignumber.equal('1');
        expect(await this.csteth.getCstETHByStETH(1)).to.be.bignumber.equal('1');
      });

      describe('After steth balances changed (+10%)', function () {
        beforeEach(async function () {
          await this.steth.mint(user1, new BN(5), { from: deployer }); // 50 -> 55
          await this.steth.mint(user2, new BN(10), { from: deployer }); // 100 -> 110
          await this.steth.mint(this.csteth.address, new BN(5), { from: deployer }); // 50 -> 55
        });

        it('ratio changed', async function () {
          expect(await this.csteth.getStETHByCstETH(10)).to.be.bignumber.equal('11');
          expect(await this.csteth.getCstETHByStETH(11)).to.be.bignumber.equal('10');
        });

        describe('After second wrap', function () {
          beforeEach(async function () {
            await this.steth.approve(this.csteth.address, 55, { from: user1 });
            await this.csteth.wrap(55, { from: user1 }); // 55 st -> 50 cst
            await this.steth.approve(this.csteth.address, 55, { from: user2 });
            await this.csteth.wrap(55, { from: user2 }); // 55 st -> 50 cst
          });

          it('balances are correct', async function () {
            expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('0');
            expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('100');
            expect(await this.steth.balanceOf(user2)).to.be.bignumber.equal('55');
            expect(await this.csteth.balanceOf(user2)).to.be.bignumber.equal('50');
            expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('165');
          });

          it('ratio unchanged', async function () {
            expect(await this.csteth.getStETHByCstETH(100)).to.be.bignumber.equal('110');
            expect(await this.csteth.getCstETHByStETH(110)).to.be.bignumber.equal('100');
          });

          describe('After steth balances changed (+10%)', function () {
            beforeEach(async function () {
              await this.steth.mint(user1, new BN(0), { from: deployer }); // 0 -> 0
              await this.steth.mint(user2, new BN(5), { from: deployer }); // 55 (+5) -> 60
              await this.steth.mint(this.csteth.address, new BN(16), { from: deployer }); // 165 (+16) -> 181
            });

            it('balances are correct', async function () {
              expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('0');
              expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('100');
              expect(await this.steth.balanceOf(user2)).to.be.bignumber.equal('60');
              expect(await this.csteth.balanceOf(user2)).to.be.bignumber.equal('50');
              expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('181');
            });

            it('ratio changed', async function () {
              expect(await this.csteth.getStETHByCstETH(150)).to.be.bignumber.equal('181');
              expect(await this.csteth.getCstETHByStETH(181)).to.be.bignumber.equal('150');
            });

            describe('After third wrap', function () {
              beforeEach(async function () {
                await this.steth.approve(this.csteth.address, 60, { from: user2 });
                await this.csteth.wrap(60, { from: user2 });
              });

              it('balances are correct', async function () {
                expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('0');
                expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('100');
                expect(await this.steth.balanceOf(user2)).to.be.bignumber.equal('0');
                expect(await this.csteth.balanceOf(user2)).to.be.bignumber.equal('99');
                expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('241');
              });

              it('ratio almost unchanged (error caused by rounding)', async function () {
                // 199:251 ~ 0.82 ~ 150:181
                expect(await this.csteth.getStETHByCstETH(199)).to.be.bignumber.equal('241');
                expect(await this.csteth.getCstETHByStETH(241)).to.be.bignumber.equal('199');
              });

              describe('After unwrap', function () {
                it('partial unwrap: balances are correct', async function () {
                  await this.csteth.unwrap(10, { from: user1 });
                  await this.csteth.unwrap(10, { from: user2 });

                  expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('12');
                  expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('90');
                  expect(await this.steth.balanceOf(user2)).to.be.bignumber.equal('12');
                  expect(await this.csteth.balanceOf(user2)).to.be.bignumber.equal('89');
                  expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('217');
                });

                it('unwrap all: balances are correct', async function () {
                  await this.csteth.unwrap(100, { from: user1 });
                  await this.csteth.unwrap(99, { from: user2 });

                  expect(await this.steth.balanceOf(user1)).to.be.bignumber.equal('121');
                  expect(await this.csteth.balanceOf(user1)).to.be.bignumber.equal('0');
                  expect(await this.steth.balanceOf(user2)).to.be.bignumber.equal('120');
                  expect(await this.csteth.balanceOf(user2)).to.be.bignumber.equal('0');
                  expect(await this.steth.balanceOf(this.csteth.address)).to.be.bignumber.equal('0');
                });
              });
            });
          });
        });
      });
    });
  });

  describe('ERC20 part', function () {
    const name = 'Wrapped Liquid staked DePool Ether';
    const symbol = 'cstETH';

    const initialSupply = new BN(100);

    beforeEach(async function () {
      this.token = this.csteth;
      await this.token.mint(initialHolder, initialSupply);
    });

    it('has a name', async function () {
      expect(await this.token.name()).to.equal(name);
    });

    it('has a symbol', async function () {
      expect(await this.token.symbol()).to.equal(symbol);
    });

    it('has 18 decimals', async function () {
      expect(await this.token.decimals()).to.be.bignumber.equal('18');
    });

    shouldBehaveLikeERC20('ERC20', initialSupply, initialHolder, recipient, anotherAccount);
    shouldBehaveLikeERC20Burnable(initialHolder, initialSupply, otherAccounts);

    describe('decrease allowance', function () {
      describe('when the spender is not the zero address', function () {
        const spender = recipient;

        function shouldDecreaseApproval (amount) {
          describe('when there was no approved amount before', function () {
            it('reverts', async function () {
              await expectRevert(this.token.decreaseAllowance(
                spender, amount, { from: initialHolder }), 'ERC20: decreased allowance below zero',
              );
            });
          });

          describe('when the spender had an approved amount', function () {
            const approvedAmount = amount;

            beforeEach(async function () {
              ({ logs: this.logs } = await this.token.approve(spender, approvedAmount, { from: initialHolder }));
            });

            it('emits an approval event', async function () {
              const { logs } = await this.token.decreaseAllowance(spender, approvedAmount, { from: initialHolder });

              expectEvent.inLogs(logs, 'Approval', {
                owner: initialHolder,
                spender: spender,
                value: new BN(0),
              });
            });

            it('decreases the spender allowance subtracting the requested amount', async function () {
              await this.token.decreaseAllowance(spender, approvedAmount.subn(1), { from: initialHolder });

              expect(await this.token.allowance(initialHolder, spender)).to.be.bignumber.equal('1');
            });

            it('sets the allowance to zero when all allowance is removed', async function () {
              await this.token.decreaseAllowance(spender, approvedAmount, { from: initialHolder });
              expect(await this.token.allowance(initialHolder, spender)).to.be.bignumber.equal('0');
            });

            it('reverts when more than the full allowance is removed', async function () {
              await expectRevert(
                this.token.decreaseAllowance(spender, approvedAmount.addn(1), { from: initialHolder }),
                'ERC20: decreased allowance below zero',
              );
            });
          });
        }

        describe('when the sender has enough balance', function () {
          const amount = initialSupply;

          shouldDecreaseApproval(amount);
        });

        describe('when the sender does not have enough balance', function () {
          const amount = initialSupply.addn(1);

          shouldDecreaseApproval(amount);
        });
      });

      describe('when the spender is the zero address', function () {
        const amount = initialSupply;
        const spender = ZERO_ADDRESS;

        it('reverts', async function () {
          await expectRevert(this.token.decreaseAllowance(
            spender, amount, { from: initialHolder }), 'ERC20: decreased allowance below zero',
          );
        });
      });
    });

    describe('increase allowance', function () {
      const amount = initialSupply;

      describe('when the spender is not the zero address', function () {
        const spender = recipient;

        describe('when the sender has enough balance', function () {
          it('emits an approval event', async function () {
            const { logs } = await this.token.increaseAllowance(spender, amount, { from: initialHolder });

            expectEvent.inLogs(logs, 'Approval', {
              owner: initialHolder,
              spender: spender,
              value: amount,
            });
          });

          describe('when there was no approved amount before', function () {
            it('approves the requested amount', async function () {
              await this.token.increaseAllowance(spender, amount, { from: initialHolder });

              expect(await this.token.allowance(initialHolder, spender)).to.be.bignumber.equal(amount);
            });
          });

          describe('when the spender had an approved amount', function () {
            beforeEach(async function () {
              await this.token.approve(spender, new BN(1), { from: initialHolder });
            });

            it('increases the spender allowance adding the requested amount', async function () {
              await this.token.increaseAllowance(spender, amount, { from: initialHolder });

              expect(await this.token.allowance(initialHolder, spender)).to.be.bignumber.equal(amount.addn(1));
            });
          });
        });

        describe('when the sender does not have enough balance', function () {
          const amount = initialSupply.addn(1);

          it('emits an approval event', async function () {
            const { logs } = await this.token.increaseAllowance(spender, amount, { from: initialHolder });

            expectEvent.inLogs(logs, 'Approval', {
              owner: initialHolder,
              spender: spender,
              value: amount,
            });
          });

          describe('when there was no approved amount before', function () {
            it('approves the requested amount', async function () {
              await this.token.increaseAllowance(spender, amount, { from: initialHolder });

              expect(await this.token.allowance(initialHolder, spender)).to.be.bignumber.equal(amount);
            });
          });

          describe('when the spender had an approved amount', function () {
            beforeEach(async function () {
              await this.token.approve(spender, new BN(1), { from: initialHolder });
            });

            it('increases the spender allowance adding the requested amount', async function () {
              await this.token.increaseAllowance(spender, amount, { from: initialHolder });

              expect(await this.token.allowance(initialHolder, spender)).to.be.bignumber.equal(amount.addn(1));
            });
          });
        });
      });

      describe('when the spender is the zero address', function () {
        const spender = ZERO_ADDRESS;

        it('reverts', async function () {
          await expectRevert(
            this.token.increaseAllowance(spender, amount, { from: initialHolder }), 'ERC20: approve to the zero address',
          );
        });
      });
    });

    describe('_mint', function () {
      const amount = new BN(50);
      it('rejects a null account', async function () {
        await expectRevert(
          this.token.mint(ZERO_ADDRESS, amount), 'ERC20: mint to the zero address',
        );
      });

      describe('for a non zero account', function () {
        beforeEach('minting', async function () {
          const { logs } = await this.token.mint(recipient, amount);
          this.logs = logs;
        });

        it('increments totalSupply', async function () {
          const expectedSupply = initialSupply.add(amount);
          expect(await this.token.totalSupply()).to.be.bignumber.equal(expectedSupply);
        });

        it('increments recipient balance', async function () {
          expect(await this.token.balanceOf(recipient)).to.be.bignumber.equal(amount);
        });

        it('emits Transfer event', async function () {
          const event = expectEvent.inLogs(this.logs, 'Transfer', {
            from: ZERO_ADDRESS,
            to: recipient,
          });

          expect(event.args.value).to.be.bignumber.equal(amount);
        });
      });
    });
  });
});
