// jest でモックできるよう分離している
module.exports = module => require.resolve(module)
