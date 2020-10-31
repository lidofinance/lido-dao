const assert = require('assert');
const fs = require('fs');
const path = require('path');
const binarysearch = require('binarysearch');
const Web3 = require('web3');

(async function main () {
  const buidlerConfigPath = process.argv[2];
  const contractName = process.argv[3];
  const buidlerConfigText = fs.readFileSync(buidlerConfigPath, 'utf8')

  const [,sourcesDir] = buidlerConfigText.match(/sources: '([\w\.\/]+)'/)
  const [,cacheDir] = buidlerConfigText.match(/cache: '([\w\.\/]+)'/)

  // console.log('sourcesDir', sourcesDir)
  // console.log('cacheDir', cacheDir)

  const foundContracts = recFindByName(path.join(__dirname, sourcesDir), contractName)
  if (foundContracts.length !== 1) {
    console.error('found 0 or greater than 1 contracts', foundContracts)
  }
  
  const contractPath = foundContracts[0]
  const solcOutputPath = path.join(__dirname, cacheDir, 'solc-output.json')

  // console.log('contractPath', contractPath)
  // console.log('solcOutputPath', solcOutputPath)
  console.log()

  const solcOutput = JSON.parse(fs.readFileSync(solcOutputPath, 'utf8'))
  
  const relContractPath = path.relative(path.join(__dirname, sourcesDir), contractPath)
  let sourceMap = solcOutput.contracts[path.join(sourcesDir, relContractPath)][contractName].evm.deployedBytecode.sourceMap;

  const code = solcOutput.contracts[path.join(sourcesDir, relContractPath)][contractName].evm.deployedBytecode.object

  const src = fs.readFileSync(contractPath, 'utf8');

  // console.log('sourceMap', sourceMap)
  // console.log('src', src)

  sourceMap = parseSourceMap(sourceMap)

  const TX_HASH = process.argv[4];
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
  // https://github.com/ethereum/go-ethereum/wiki/Tracing:-Introduction
  const trace = await web3.traceTx(TX_HASH, {disableStack: false, disableMemory: false, disableStorage: true}); //FIXME: not disabled

  // console.log(trace.structLogs.filter(t => t.depth > 0).length)
  // const sourceMap = parseSourceMap(fs.readFileSync(SOURCEMAP_FILE, 'utf8'));
  
  // console.log(sourceMap)
  const addr = (await web3.eth.getTransaction(TX_HASH)).to;
  // const code = await web3.eth.getCode(addr);
  // console.log('code', code)
  const pcToIdx = buildPcToInstructionMapping(code);

  console.log('Gas used by transaction:', (await web3.eth.getTransactionReceipt(TX_HASH)).gasUsed);

  // const src = fs.readFileSync(CONTRACT_FILE, 'utf8');
  const lineOffsets = buildLineOffsets(src);

  const lineGas = [];

  let synthCost = 0;

  const logs = trace.structLogs
  const callOpCodes = ['CALL', 'CALLCODE', 'DELEGATECALL', 'STATICCALL']
  let contractAddresses = logs
    .filter(({op}) => callOpCodes.includes(op))
    .map(({stack}) => extractAddrFromCall(stack))

  contractAddresses = dedup(contractAddresses)

  let contractCodes = await Promise.all(
    contractAddresses.map(addr => web3.eth.getCode(addr))
  )

  contractCodes = contractCodes.map(c => c.slice(2))

  const contractIndex = contractCodes.findIndex(c => c === code)
  if(contractIndex === -1) {
    console.error('not found a contract')
    process.exit(1)
  }

  const thatContract = contractAddresses[contractIndex]

  let [,thatDepth] = logs
    .filter(({op}) => callOpCodes.includes(op))
    .map(({stack, depth}) => [extractAddrFromCall(stack), depth + 1])
    .find(([addr, depth]) => addr === thatContract)

  // console.log('thatContract', thatContract)
  // console.log('thatDepth', thatDepth)

  let lastContract = null
  for (let i=0; i<trace.structLogs.length; i++ ) {
    
    const {depth, error, gas, gasCost, op, pc, stack, memory} = trace.structLogs[i];
    
    let cost;

    if (callOpCodes.includes(op)) {
      lastContract = extractAddrFromCall(stack)
    }

    if (depth === thatDepth && lastContract === thatContract) {
      cost = Math.max(gasCost, 0)
      const instructionIdx = pcToIdx[pc];
      const {s, l, f, j} = sourceMap[instructionIdx];
      if (f===-1) {
        synthCost += cost;
        continue;
      }
      const line = binarysearch.closest(lineOffsets, s);
      if (lineGas[line]===undefined) {
        lineGas[line] = cost;
      } else {
        lineGas[line] += cost;
      }
    }
  } // for 

  const totalForDepth = 
  src.split('\n').forEach((line, i) => {
    const gas = lineGas[i] || 0;
    console.log('%s\t\t%s', gas, line);
  });
  console.log('synthetic instruction gas', synthCost);

  //showAllPointsInSourceMap (sourceMap, src, lineOffsets);

})().catch(e=>console.log(e));

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
  return src.split('\n').map(line=>{
    const ret = accu;
    accu += line.length+1;
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

function recFindByName(base, name, files, result) {
  files = files || fs.readdirSync(base) 
  result = result || [] 

  files.forEach( 
    function (file) {
      const newbase = path.join(base, file)
      if (fs.statSync(newbase).isDirectory()) {
        result = recFindByName(newbase,name,fs.readdirSync(newbase), result)
      } else {
        if (file.split('.').slice(0, -1).join('.') == name) {
          result.push(newbase)
        } 
      }
    }
  )
  return result
}

function dedup(arr) {
  let s = new Set(arr);
  let it = s.values();
  return Array.from(it);
}

function extractAddrFromCall(stack) {
  return '0x' + stack[stack.length - 2].slice(24)
}