const { MerkleTree } = require('merkletreejs')
const { BN } = require('@openzeppelin/test-helpers');
const keccak256 = require('keccak256')
const fs = require('fs')

const ETH = (value) => web3.utils.toWei(value + '', 'ether')
const wei = (value) => web3.utils.toWei(value + '', 'wei')
const toBN = (value) => new BN(value)

const filename = 'account-rewards.json'

async function main() {

    //generate accs
    let signers = await hre.ethers.getSigners();

    let accsAmount = 10
    let accounts = Object.assign(
        {}, 
        ...signers.slice(3, accsAmount+3).map(x => ({ [x.address]: `0x${toBN(ETH(1)).toString(16)}` }))
    );

    const totalRewards = Object.keys(accounts).reduce(
        (memo, key) => memo.add(new BN(accounts[key].replace(/^0x/, ''), 16)), 
        new BN(0)
    )

    const leaves = Object.keys(accounts).map(address => keccak256(address + new BN(accounts[address].replace(/^0x/, ''), 16).toString(16,64) ))
    const tree = new MerkleTree(leaves, keccak256, { sort: true })
    const merkleRoot = tree.getHexRoot()

    let file = {
        merkleRoot,
        totalRewards: '0x'+totalRewards.toString(16),
        accounts
    }

    const data = JSON.stringify(file, null, '  ')
    fs.writeFileSync(filename, data + '\n', 'utf8')

    console.log("done")   
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });