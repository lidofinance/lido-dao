/***
 * Inspired by & rewritten from: https://github.com/yushih/solidity-gas-profiler;
 * added support for multiple contracts (call, delegatecall, etc.) and multiple
 * sources per contract (inheritance).
 **/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const binarysearch = require('binarysearch');
const Web3 = require('web3');
const BN = require('bn.js');

const MAKE_EMPTY_SOURCE = (id, fileName) => ({
  id,
  fileName,
  text: null,
  lineOffsets: null,
  lineGas: []
});

const MAKE_EMPTY_CONTRACT = addressHexStr => ({
  addressHexStr,
  codeHexStr: null,
  fileName: null,
  name: null,
  sourcesById: {},
  sourceMap: null,
  pcToIdx: null,
  gasBeforeContract: 0,
  gasBeforeCall: 0,
  callSource: null,
  callLine: null,
  totalGasCost: 0,
  synthGasCost: 0,
});

const contractByAddr = {};
const sourceById = {};
const sourceByFilename = {};

async function getContractWithAddr(addr, web3, solcOutput) {
  const addressHexStr = normalizeAddress(addr);

  const cached = contractByAddr[addressHexStr];
  if (cached) {
    return cached;
  }

  const result = MAKE_EMPTY_CONTRACT(addressHexStr);
  contractByAddr[addressHexStr] = result;

  result.codeHexStr = strip0x(await web3.eth.getCode(addressHexStr)) || null;
  if (!result.codeHexStr) {
    console.error(`WARN no code at address 0x${addressHexStr}`);
    return result;
  }

  result.pcToIdx = buildPcToInstructionMapping(result.codeHexStr);

  const contractData = findContractByDeployedBytecode(result.codeHexStr, solcOutput);
  if (!contractData) {
    console.error(`WARN no source for contract at address 0x${addressHexStr}`);
    return result;
  }

  result.name = contractData.name;
  result.fileName = contractData.fileName;
  result.sourceMap = parseSourceMap(contractData.sourceMap);

  return result;
}

function getSourceWithId(sourceId, solcOutput) {
  const cached = sourceById[sourceId];
  if (cached) {
    return cached;
  }

  const fileName = Object
    .keys(solcOutput.sources)
    .find(sourceFileName => solcOutput.sources[sourceFileName].id === sourceId) || null;

  if (!fileName) {
    console.error(`WARN no source with id ${sourceId}`);
    return sourceById[sourceId] = MAKE_EMPTY_SOURCE(sourceId, null);
  }

  return getSourceForFilename(fileName, solcOutput);
}

function getSourceForFilename(fileName, solcOutput) {
  const cached = sourceByFilename[fileName];
  if (cached) {
    return cached;
  }

  const result = MAKE_EMPTY_SOURCE(null, fileName);
  sourceByFilename[fileName] = result;

  const sourceData = solcOutput.sources[fileName];
  if (!sourceData) {
    console.error(`WARN no source info for filename ${fileName}`);
    return result;
  }

  result.id = sourceData.id;
  sourceById[result.id] = result;

  result.text = readSource(fileName);
  if (result.text) {
    result.lineOffsets = buildLineOffsets(result.text);
  } else {
    console.error(`WARN no source text for filename ${fileName} (id ${result.id})`);
  }

  return result;
}

function findContractByDeployedBytecode(codeHexStr, solcOutput) {
  const filesNames = Object.keys(solcOutput.contracts);
  for (let iFile = 0; iFile < filesNames.length; ++iFile) {
    const fileName = filesNames[iFile];
    const fileContracts = solcOutput.contracts[fileName];
    const contractNames = Object.keys(fileContracts);
    for (let iContract = 0; iContract < contractNames.length; ++iContract) {
      const name = contractNames[iContract];
      const contractData = fileContracts[name];
      if (contractData.evm.deployedBytecode.object === codeHexStr) {
        const {sourceMap} = contractData.evm.deployedBytecode;
        return {fileName, name, sourceMap};
      }
    }
  }
  return null;
}

function readSource(fileName) {
  try {
    const sourcePath = path.resolve(__dirname, fileName);
    return fs.readFileSync(sourcePath, 'utf8');
  } catch (err) {
    try {
      const sourcePath = require.resolve(fileName);
      return fs.readFileSync(sourcePath, 'utf8');
    } catch (err) {
      return null;
    }
  }
}

(async function main () {
  const connString = 'http://localhost:8545';
  const provider = new Web3.providers.HttpProvider(connString);
  const web3 = new Web3(provider);

  web3.extend({methods: [
    {
      name: 'traceTx',
      call: 'debug_traceTransaction',
      params: 2
    }
  ]});

  const solcOutputPath = process.argv[2];
  const txHash = process.argv[3];

  const solcOutput = JSON.parse(fs.readFileSync(solcOutputPath, 'utf8'));

  const [receipt, tx] = await Promise.all([
    web3.eth.getTransactionReceipt(txHash),
    web3.eth.getTransaction(txHash)
  ]);

  console.log('Gas used by transaction:', receipt.gasUsed);

  const entryAddr = tx.to;
  if (!entryAddr) {
    // TODO: implement profiling construction code
    console.log(`The transaction is a create transaction`);
    return
  }

  const entryContract = await getContractWithAddr(entryAddr, web3, solcOutput);
  if (!entryContract) {
    console.log(`The transaction target address is not a contract`);
    return
  }

  // https://github.com/ethereum/go-ethereum/wiki/Tracing:-Introduction
  const trace = await web3.traceTx(txHash, {
    disableStack: false,
    disableMemory: true,
    disableStorage: true
  });

  const callStack = [entryContract];
  const bottomDepth = trace.structLogs[0].depth; // 1 in geth, 0 in ganache

  for (let i = 0; i < trace.structLogs.length; ++i) {
    const log = trace.structLogs[i];
    const gasCost = getGasCost(log);

    // console.error(`${log.op}, gas ${log.gas}, gasCost ${gasCost}, pc ${log.pc}, depth ${log.depth}`);

    while (log.depth - bottomDepth < callStack.length - 1) {
      const prevTopContract = callStack.pop();
      // using the prev opcode since Ganache reports RETURN opcodes as having negative cost
      const prevLog = trace.structLogs[i - 1];
      prevTopContract.totalGasCost += prevTopContract.gasBeforeContract - prevLog.gas + getGasCost(prevLog);

      const topContract = callStack[callStack.length - 1];
      const cumulativeCallCost = topContract.gasBeforeCall - log.gas;
      increaseGasCost(topContract.callSource, topContract.callLine, cumulativeCallCost);
    }

    assert(callStack.length > 0);

    const contract = callStack[log.depth - bottomDepth];
    const {source, line, isSynthOp} = getSourceInfo(contract, log, solcOutput);

    const callTargetAddrHexStr = getCallTargetAddr(log);
    if (callTargetAddrHexStr) {
      // the current instruction is a call instruction
      contract.callSource = source;
      contract.callLine = line;
      contract.gasBeforeCall = log.gas;
      const targetContract = await getContractWithAddr(callTargetAddrHexStr, web3, solcOutput);
      targetContract.gasBeforeContract = trace.structLogs[i + 1].gas;
      callStack.push(targetContract);
    } else if (isSynthOp) {
      contract.synthGasCost += gasCost;
    } else {
      increaseGasCost(source, line, gasCost);
    }
  }

  const firstLog = trace.structLogs[0];
  const lastLog = trace.structLogs[trace.structLogs.length - 1];

  entryContract.totalGasCost = firstLog.gas - lastLog.gas + getGasCost(lastLog);

  Object.keys(contractByAddr).forEach(addressHexStr => {
    const contract = contractByAddr[addressHexStr];
    if (contract.name == null) {
      console.log(`\nUnknown contract at 0x${addressHexStr}`);
    } else {
      const fileNames = Object.keys(contract.sourcesById)
        .map(id => contract.sourcesById[id])
        .map(source => source && source.fileName)
        .filter(x => !!x)
        .join(', ')
      console.log(`\nContract ${contract.name} at 0x${addressHexStr}`);
      console.log(`  defined in: ${fileNames || contract.fileName || '<no sources found>'}`);
      console.log('  synthetic instruction gas:', contract.synthGasCost);
      // showAllPointsInSourceMap(contract.sourceMap, contract.source, contract.lineOffsets);
    }
    console.log('  total gas spent in the contract:', contract.totalGasCost);
  });

  Object.keys(sourceByFilename).forEach(fileName => {
    const source = sourceByFilename[fileName];
    if (!source.text) {
      return;
    }

    console.log(`\nFile ${fileName}\n`);

    source.text.split('\n').forEach((lineText, i) => {
      const gas = source.lineGas[i] || 0;
      console.log('%s\t\t%s', gas, lineText);
    });
  });

})().catch(e => console.log(e));

function getCallTargetAddr(log) {
  return log.op === 'CALL' || log.op === 'CALLCODE' || log.op === 'DELEGATECALL' || log.op === 'STATICCALL'
    ? new BN(log.stack[log.stack.length - 2], 16).toString(16) // https://ethervm.io/#F1
    : null
}

function getSourceInfo(contract, log, solcOutput) {
  const result = {source: null, line: null, isSynthOp: false};
  if (!contract.pcToIdx || !contract.sourceMap) {
    return result;
  }

  const instructionIdx = contract.pcToIdx[log.pc];
  const {s: sourceOffset, f: sourceId} = contract.sourceMap[instructionIdx];

  if (sourceId === -1) {
    // > In the case of instructions that are not associated with any particular source file,
    // > the source mapping assigns an integer identifier of -1. This may happen for bytecode
    // > sections stemming from compiler-generated inline assembly statements.
    // From: https://solidity.readthedocs.io/en/v0.6.7/internals/source_mappings.html
    result.isSynthOp = true;
    return result;
  }

  result.source = getSourceWithId(sourceId, solcOutput) || null;

  if (contract.sourcesById[sourceId] === undefined) {
    contract.sourcesById[sourceId] = result.source;
  }

  if (result.source && result.source.lineOffsets) {
    result.line = binarysearch.closest(result.source.lineOffsets, sourceOffset);
  }

  return result;
}

function getGasCost(log) {
  // See: https://github.com/trufflesuite/ganache-core/issues/277
  // See: https://github.com/trufflesuite/ganache-core/pull/578
  if (log.gasCost < 0 && (log.op === 'RETURN' || log.op === 'REVERT' || log.op === 'STOP')) {
    console.error(`WARN skipping invalid gasCost value ${log.gasCost} for op ${log.op}`);
    return 0;
  } else {
    return log.gasCost;
  }
}

function increaseGasCost(source, line, gasCost) {
  if (source != null && line != null) {
    source.lineGas[line] = (source.lineGas[line] | 0) + gasCost;
  }
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

function normalizeAddress(addressHexStr) {
  if (!addressHexStr) {
    return addressHexStr;
  }
  const addressBN = new BN(strip0x(addressHexStr), 16);
  return addressBN.toString(16, 40);
}

function strip0x(hexStr) {
  return hexStr && hexStr[0] === '0' && hexStr[1] === 'x'
    ? hexStr.substring(2)
    : hexStr
}
