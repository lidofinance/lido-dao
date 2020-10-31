/***
 * Modified from: https://github.com/yushih/solidity-gas-profiler
 * with the support for multiple contracts
 **/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const binarysearch = require('binarysearch');
const Web3 = require('web3');
const BN = require('bn.js');

const dataByContractAddr = {};

async function getContractData(_addressHexStr, web3, solcOutput) {
  const addressBN = new BN(strip0x(_addressHexStr), 16);
  const addressHexStr = addressBN.toString(16, 40);

  if (!!dataByContractAddr[addressHexStr]) {
    return dataByContractAddr[addressHexStr];
  }

  const codeHexStr = strip0x(await web3.eth.getCode(addressHexStr));
  const contractData = findContractByDeployedBytecode(codeHexStr, solcOutput);

  if (!contractData) {
    return dataByContractAddr[addressHexStr] = {
      source: null,
      gasBeforeContract: 0,
      totalGasCost: 0,
    };
  }

  const sourcePath = path.resolve(__dirname, contractData.fileName);
  const source = fs.readFileSync(sourcePath, 'utf8');

  return dataByContractAddr[addressHexStr] = {
    ...contractData,
    source,
    sourceMap: parseSourceMap(contractData.sourceMap),
    pcToIdx: buildPcToInstructionMapping(codeHexStr),
    lineOffsets: buildLineOffsets(source),
    gasBeforeContract: 0,
    callLine: null,
    gasBeforeCall: 0,
    lineGas: [],
    synthCost: 0,
    totalGasCost: 0,
  };
}

function findContractByDeployedBytecode(codeHexStr, solcOutput) {
  const filesNames = Object.keys(solcOutput.contracts);
  for (let iFile = 0; iFile < filesNames.length; ++iFile) {
    const fileName = filesNames[iFile];
    const fileContracts = solcOutput.contracts[fileName];
    const contractNames = Object.keys(fileContracts);
    for (let iContract = 0; iContract < contractNames.length; ++iContract) {
      const contractName = contractNames[iContract];
      const contractData = fileContracts[contractName];
      if (contractData.evm.deployedBytecode.object === codeHexStr) {
        return {
          fileName,
          contractName,
          codeHexStr,
          sourceMap: contractData.evm.deployedBytecode.sourceMap,
        };
      }
    }
  }
  return null;
}

(async function main () {
  const PROVIDER = "http://localhost:8545"
  const provider = new Web3.providers.HttpProvider(PROVIDER);
  const web3 = new Web3(provider);

  web3.extend({methods: [
    {
      name: 'traceTx',
      call: 'debug_traceTransaction',
      params: 2
    }
  ]});

  const solcOutputPath = process.argv[2];
  const TX_HASH = process.argv[3];

  const solcOutput = JSON.parse(fs.readFileSync(solcOutputPath, 'utf8'));

  const rootAddr = (await web3.eth.getTransaction(TX_HASH)).to;
  const rootData = await getContractData(rootAddr, web3, solcOutput);

  // console.error(`rootAddr ${rootAddr}, rootData:`, stripDataForLog(rootData));

  const receipt = await web3.eth.getTransactionReceipt(TX_HASH);
  console.log('Gas used by transaction:', receipt.gasUsed);

  if (!rootData) {
    console.log(`The transaction target address is not a contract`);
    return
  }

  // https://github.com/ethereum/go-ethereum/wiki/Tracing:-Introduction
  const trace = await web3.traceTx(TX_HASH, {disableStack: false, disableMemory: false, disableStorage: true});
  const callStack = [rootData];

  assert(trace.structLogs[0].depth === 0);

  for (let i = 0; i < trace.structLogs.length; ++i) {
    const log = trace.structLogs[i];

    // console.error(`${log.op}, gas ${log.gas}, gasCost ${log.gasCost}, pc ${log.pc}, depth ${log.depth}`);

    while (log.depth < callStack.length - 1) {
      const prevTopData = callStack.pop();
      // using the prev opcode since Ganache reports RETURN opcodes as having negative cost
      const prevLog = trace.structLogs[i - 1];
      prevTopData.totalGasCost += prevTopData.gasBeforeContract - prevLog.gas + Math.max(0, prevLog.gasCost);

      const topData = callStack[callStack.length - 1];
      // console.error(`call ended, parent:`, stripDataForLog(topData));
      if (topData.source != null) {
        const cumulativeCallCost = topData.gasBeforeCall - log.gas;
        // console.error(`current gas ${log.gas}, cumulativeCallCost: ${cumulativeCallCost}`);
        increaseLineCost(topData, topData.callLine, cumulativeCallCost);
      }
    }

    assert(callStack.length > 0);

    const data = callStack[log.depth];
    const line = getLineNumber(data, log);

    const callTargetHexStr = getCallTargetAddr(log);
    if (callTargetHexStr) {
      data.callLine = line;
      data.gasBeforeCall = log.gas;
      // the current instruction is a call instruction
      const targetData = await getContractData(callTargetHexStr, web3, solcOutput);
      targetData.gasBeforeContract = trace.structLogs[i + 1].gas;
      // console.error(`${log.op} to 0x${callTargetHexStr}, data:`, stripDataForLog(targetData) || '<empty>');
      callStack.push(targetData);
      if (targetData.source == null) {
        console.error(`WARN no source for contract at 0x${callTargetHexStr}`)
      }
    } else {
      if (log.gasCost < 0 && isTerminalOpcode(log.op)) {
        // see: https://github.com/trufflesuite/ganache-core/issues/277
        // see: https://github.com/trufflesuite/ganache-core/pull/578
        console.error(`WARN skipping invalid gasCost value ${log.gasCost} for op ${log.op}`)
      } else if (data.source != null) {
        increaseLineCost(data, line, log.gasCost);
      }
    }
  }

  const firstLog = trace.structLogs[0];
  const lastLog = trace.structLogs[trace.structLogs.length - 1];
  rootData.totalGasCost += firstLog.gas - lastLog.gas + Math.max(0, lastLog.gasCost);

  Object.keys(dataByContractAddr).forEach(addressHexStr => {
    const data = dataByContractAddr[addressHexStr];
    if (data.source == null) {
      console.log(`\nUnknown contract at 0x${addressHexStr}`);
    } else {
      console.log(`\nFile ${data.fileName}, contract ${data.contractName} at 0x${addressHexStr}\n`);

      data.source.split('\n').forEach((line, i) => {
        const gas = data.lineGas[i] || 0;
        console.log('%s\t\t%s', gas, line);
      });

      console.log('Synthetic instruction gas:', data.synthCost);

      // showAllPointsInSourceMap(data.sourceMap, data.source, data.lineOffsets);
    }
    console.log('Total gas spent in the contract:', data.totalGasCost);
  });

})().catch(e => console.log(e));

function getCallTargetAddr(log) {
  return log.op === 'CALL' || log.op === 'CALLCODE' || log.op === 'DELEGATECALL' || log.op === 'STATICCALL'
    ? new BN(log.stack[log.stack.length - 2], 16).toString(16) // https://ethervm.io/#F1
    : null
}

function getLineNumber(data, log) {
  if (!data.pcToIdx) {
    return null
  }
  const instructionIdx = data.pcToIdx[log.pc];
  const mapItem = data.sourceMap[instructionIdx];
  return mapItem.f === -1 ? null : binarysearch.closest(data.lineOffsets, mapItem.s);
}

function increaseLineCost(data, line, gasCost) {
  if (line === null) {
    data.synthCost += gasCost;
  } else {
    data.lineGas[line] = (data.lineGas[line] | 0) + gasCost;
  }
}

function isTerminalOpcode(op) {
  return op === 'RETURN' || op === 'REVERT' || op === 'STOP'
}

function showAllPointsInSourceMap (sourceMap, src, lineOffsets) {
  const linePoints = []; //line no -> number of points in source map
  sourceMap.forEach(instruction=>{
    if (instruction.f === -1) {
        return;
    }
    const s = instruction.s;
    const line = binarysearch.closest(lineOffsets, s);
    if (line === 0) {
        console.log('>>>', instruction);
    }
    if (linePoints[line] === undefined) {
        linePoints[line] = 1;
    } else {
        linePoints[line] += 1;
    }
  });

  src.split('\n').forEach((line, i) => {
    const points = linePoints[i] || 0;
    console.log('%s\t%s\t%s\t\t%s', i, lineOffsets[i], points, line);
  });
}

function buildLineOffsets (src) {
  let accu = 0;
  return src.split('\n').map(line => {
    const ret = accu;
    accu += line.length + 1;
    return ret;
  });
}

function buildPcToInstructionMapping (codeHexStr) {
  const mapping = {};
  let instructionIndex = 0;
  for (let pc=0; pc<codeHexStr.length/2;) {
    mapping[pc] = instructionIndex;

    const byteHex = codeHexStr[pc*2]+codeHexStr[pc*2+1];
    const byte = parseInt(byteHex, 16);

    // PUSH instruction has immediates
    if (byte >= 0x60 && byte <= 0x7f) {
        const n = byte-0x60+1; // number of immediates
        pc += (n+1);
    } else {
        pc += 1;
    }

    instructionIndex += 1;
  }
  return mapping;
}

// https://solidity.readthedocs.io/en/develop/miscellaneous.html#source-mappings
function parseSourceMap (raw) {
  let prevS, prevL, prevF, prevJ;
  return raw.trim().split(';').map(section=> {
    let [s,l,f,j] = section.split(':');

    if (s==='' || s===undefined) {
      s = prevS;
    } else {
      prevS = s;
    }

    if (l==='' || l===undefined) {
      l = prevL;
    } else {
      prevL = l;
    }

    if (f==='' || f===undefined) {
      f = prevF;
    } else {
      prevF = f;
    }

    if (j==='' || j===undefined) {
      j = prevJ;
    } else {
      prevJ = j;
    }

    return {s:Number(s), l:Number(l), f:Number(f), j};
  });
}

function strip0x(hexStr) {
  return hexStr[0] === '0' && hexStr[1] === 'x'
    ? hexStr.substring(2)
    : hexStr
}

function ensure0x(hexStr) {
  return hexStr[0] === '0' && hexStr[1] === 'x'
    ? hexStr
    : `0x${hexStr}`
}

function stripDataForLog(data) {
  if (!data) return data;
  const {fileName, contractName, callLine, gasBeforeCall} = data;
  return {fileName, contractName, callLine, gasBeforeCall};
}
