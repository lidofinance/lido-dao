const fs = require('fs')

function readFile(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, 'utf8', (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

function readJSON(path) {
  return readFile(path).then((data) => JSON.parse(data))
}

function directoryExists(path) {
  return fileExists(path, true)
}

function fileExists(path, isDirectory = false) {
  return new Promise((resolve, reject) => {
    fs.stat(path, (err, stats) => resolve(!err && stats.isDirectory() === isDirectory))
  })
}

module.exports = { readFile, readJSON, fileExists, directoryExists }
