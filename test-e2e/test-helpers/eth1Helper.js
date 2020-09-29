export const getAccounts = async (web3) =>
  new Promise((resolve, reject) => {
    web3.eth.getAccounts((err, res) => (err ? reject(err) : resolve(res)))
  })

export async function sendTransaction(web3, receipt, sender, value) {
  await web3.eth.sendTransaction({ to: receipt, from: sender, value: value, gas: '1000000' })
}
