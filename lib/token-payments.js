// Description:
//   Ethereum token payment logic
//
// Dependencies:
//   ethers: "^3.0.8",
//
// Author:
//   PombeirP

const ethers = require('ethers')
const { Wallet, Contract, providers } = ethers

const ERC20_ABI = [
  {
    'constant': false,
    'inputs': [
      {
        'name': '_to',
        'type': 'address'
      },
      {
        'name': '_amount',
        'type': 'uint256'
      }
    ],
    'name': 'transfer',
    'outputs': [
      {
        'name': 'success',
        'type': 'bool'
      }
    ],
    'payable': false,
    'type': 'function'
  }
]

module.exports = {
  getContract: _getContract,
  transfer: _transfer
}

let transaction = null
let hash = null

function _getContract (contractAddress, privateKey, networkId) {
  const network = providers.Provider.getNetwork(networkId)
  const wallet = new Wallet(privateKey, ethers.providers.getDefaultProvider(network))

  async function customSendTransaction (tx) {
    hash = await wallet.provider.sendTransaction(tx)
    return hash
  }
  async function customSignTransaction (tx) {
    transaction = tx
    return wallet.sign(tx)
  }

  const customSigner = _getCustomSigner(wallet, customSignTransaction, customSendTransaction)
  const contract = new Contract(contractAddress, ERC20_ABI, customSigner)

  return { contract: contract, wallet: wallet }
}

async function _transfer (contract, wallet, pubkey, tokenAmount) {
  const bigNumberAmount = ethers.utils.parseUnits(tokenAmount.toString(), 'ether')

  await contract.transfer(pubkey, bigNumberAmount)

  transaction.hash = hash
  transaction.from = wallet.address
  transaction.value = bigNumberAmount

  return transaction
}

function _getCustomSigner (wallet, signTransaction, sendTransaction) {
  const provider = wallet.provider

  async function getAddress () { return wallet.address }

  async function resolveName (addressOrName) { return provider.resolveName(addressOrName) }
  async function estimateGas (transaction) { return provider.estimateGas(transaction) }
  async function getGasPrice () { return process.env.DEBUG ? 5000000 : provider.getGasPrice() }
  async function getTransactionCount (blockTag) { return provider.getTransactionCount(blockTag) }

  const customSigner = {
    getAddress: getAddress,
    provider: {
      resolveName: resolveName,
      estimateGas: estimateGas,
      getGasPrice: getGasPrice,
      getTransactionCount: getTransactionCount,
      sendTransaction: sendTransaction
    },
    sign: signTransaction
  }

  return customSigner
}
