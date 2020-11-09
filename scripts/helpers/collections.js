function filterObject(obj, filter) {
  const result = {}
  Object.keys(obj).forEach(key => {
    if (filter(key)) {
      result[key] = obj[key]
    }
  })
  return result
}

module.exports = {filterObject}
